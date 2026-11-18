import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { portableCache, recordRun } from '../lib/portable-cache.mjs';
import { runtimeEnv, buildAgentPlan } from '../lib/agent-plan.mjs';
import { acquireLease, maintenanceLock, clearForeignRecords } from '../lib/state-lock.mjs';
import { requiredFiles, runtimeChecks, failureReason } from '../lib/preflight.mjs';
import { createBackup, verifyBackup, restoreBackup, updateFromFolder, recoverTransactions, listBackups, digest } from '../lib/maintenance.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ai usb portable '));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'USB folder'); fs.mkdirSync(root);
  return { base, root };
}
// Windows CI may forbid symlink creation without Developer Mode; such cases skip the link assertions.
function symlink(link, target) { try { fs.symlinkSync(target, link); return true; } catch { return false; } }
function put(root, file, value) {
  const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); return full;
}
function seed(root) {
  put(root, 'config/settings.json', '{"model":"keep-this-model"}\r\n');
  put(root, 'data/harness/profiles/web/cordis.patch.yml', 'keep: exact-bytes\r\n');
  put(root, 'data/harness/agents/sessions/session.jsonl', '{"conversation":"keep bytes"}\n');
  put(root, 'data/harness/.credentials.yaml', Buffer.from([0, 255, 1, 2]));
  put(root, 'workspace/user-work.txt', 'never replace workspace');
}
function runtime(root, marker) {
  for (const file of requiredFiles('win32-x64')) fs.chmodSync(put(root, 'platforms/win32-x64/' + file, marker), 0o755);
  for (const file of ['lib/maintenance.mjs', 'lib/launch.mjs', 'lib/doctor.mjs', 'dsh.bat', 'dsh.ps1', 'Windows-Maintain.bat']) put(root, file, marker);
  put(root, 'BUILD-INFO.json', JSON.stringify({ platforms: ['win32-x64'] }));
  put(root, 'RUNTIME-SHA256.json', JSON.stringify(Object.fromEntries(['platforms/win32-x64/node.exe'].map(n => [n, digest(path.join(root, n))]))));
}

test('cache stays on host, survives a USB move, and keeps config/session bytes on USB', t => {
  const { base, root } = fixture(t); seed(root);
  const env = { AI_USB_HOST_CACHE: path.join(base, 'host cache') };
  const first = portableCache(root, { parentEnv: env });
  assert.ok(first.local); assert.ok(first.root.startsWith(env.AI_USB_HOST_CACHE));
  const moved = path.join(base, 'different drive folder'); fs.renameSync(root, moved);
  const second = portableCache(moved, { parentEnv: env }); assert.equal(second.root, first.root);
  const actualEnv = runtimeEnv(moved, { ...env, DEEPSEEK_API_KEY: 'inherited-secret' }, process.execPath, 'darwin');
  assert.equal(actualEnv.npm_config_cache, path.join(first.root, 'npm'));
  assert.equal(actualEnv.TMPDIR, path.join(first.root, 'tmp'));
  assert.equal(actualEnv.DEEPSEEK_API_KEY, 'inherited-secret', 'provider settings are left to DSH defaults');
  assert.equal(fs.readFileSync(path.join(moved, 'data/harness/profiles/web/cordis.patch.yml'), 'utf8'), 'keep: exact-bytes\r\n');
});
test('unwritable host cache falls back to USB without moving sessions', t => {
  const { root, base } = fixture(t), blocked = put(base, 'file-not-directory', 'x');
  const cache = portableCache(root, { parentEnv: { AI_USB_HOST_CACHE: blocked } });
  assert.equal(cache.local, false); assert.ok(cache.root.startsWith(path.join(root, 'data/cache')));
});
test('backup/restore preserves exact bytes, excludes caches and temporary links, and backs up the replaced state', t => {
  const { root } = fixture(t); seed(root);
  put(root, 'data/npm-cache/large-file', 'disposable'); put(root, 'data/cache/large-file', 'disposable');
  const temp = put(root, 'data/harness/tmp/target', 'temporary');
  const linked = symlink(path.join(path.dirname(temp), 'apply_patch'), temp);
  const backup = createBackup(root), manifest = verifyBackup(backup);
  assert.ok(!manifest.entries.some(e => /npm-cache|\/cache\/|\/tmp\//.test(e.path)));
  put(root, 'data/harness/agents/sessions/session.jsonl', 'changed session');
  put(root, 'data/harness/extra.txt', 'created after snapshot');
  put(root, 'config/settings.json', '{"model":"changed"}');
  const result = restoreBackup(root, path.basename(backup));
  verifyBackup(result.before);
  assert.equal(fs.readFileSync(path.join(root, 'data/harness/agents/sessions/session.jsonl'), 'utf8'), '{"conversation":"keep bytes"}\n');
  assert.deepEqual(fs.readFileSync(path.join(root, 'data/harness/.credentials.yaml')), Buffer.from([0, 255, 1, 2]));
  assert.ok(!fs.existsSync(path.join(root, 'data/harness/extra.txt')));
  assert.equal(fs.readFileSync(path.join(result.before, 'payload/data/harness/agents/sessions/session.jsonl'), 'utf8'), 'changed session');
  assert.equal(fs.readFileSync(path.join(root, 'workspace/user-work.txt'), 'utf8'), 'never replace workspace');
});
test('corrupt snapshots, traversal manifests and external symlinks are rejected before any restore', t => {
  const { root, base } = fixture(t); seed(root);
  const backup = createBackup(root);
  put(backup, 'payload/config/settings.json', 'corrupt');
  assert.throws(() => restoreBackup(root, path.basename(backup)), /校验失败/);
  assert.equal(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf8'), '{"model":"keep-this-model"}\r\n');
  const second = createBackup(root), file = path.join(second, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file)); manifest.entries.push({ path: '../../outside', size: 0 }); fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => verifyBackup(second), /非法路径/);
  const target = put(base, 'external-secret', 'secret');
  if (symlink(path.join(root, 'data/secret-link'), target)) assert.throws(() => createBackup(root), /链接/);
  else t.diagnostic('跳过外部链接断言：当前系统不允许创建符号链接');
});
test('running Agent and exclusive maintenance locks prevent inconsistent snapshots or concurrent launches', t => {
  const { root } = fixture(t); seed(root);
  const lease = acquireLease(root, 'dsh');
  assert.throws(() => createBackup(root), /还.*运行/);
  assert.throws(() => clearForeignRecords(root), /活动进程/);
  lease.release();
  const unlock = maintenanceLock(root);
  assert.throws(() => acquireLease(root, 'dsh'), /正在进行/);
  unlock(); assert.doesNotThrow(() => createBackup(root));
});
test('failed restore rolls back data; interrupted operations can be recovered from their journal', t => {
  const { root } = fixture(t); seed(root);
  const backup = createBackup(root); put(root, 'config/settings.json', 'newer current state');
  assert.throws(() => restoreBackup(root, path.basename(backup), { injectFailure: name => { if (name.startsWith('data/')) throw new Error('simulated disk failure'); } }), /simulated disk failure/);
  assert.equal(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf8'), 'newer current state');
  const txn = path.join(root, 'backups/.transactions/interrupted');
  fs.mkdirSync(path.join(txn, 'previous'), { recursive: true });
  fs.renameSync(path.join(root, 'config'), path.join(txn, 'previous/config'));
  put(root, 'config/settings.json', 'half installed');
  put(txn, 'journal.json', JSON.stringify({ state: 'installing', entries: [{ name: 'config', hadOld: true }] }));
  assert.throws(() => createBackup(root), /未完成/);
  assert.throws(() => acquireLease(root, 'dsh'), /未完成/);
  recoverTransactions(root);
  assert.equal(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf8'), 'newer current state');
});
test('update validates staged files, automatically backs up, and preserves USB config and workspace', t => {
  const { root, base } = fixture(t); seed(root); runtime(root, 'old runtime');
  const source = path.join(base, 'prepared new version'); fs.mkdirSync(source); runtime(source, 'new runtime');
  put(source, 'config/settings.json', 'must not overwrite settings'); put(source, 'data/unwanted', 'must not import');
  const result = updateFromFolder(root, source);
  assert.match(path.basename(result.before), /before-update$/); verifyBackup(result.before);
  assert.equal(fs.readFileSync(path.join(root, 'lib/launch.mjs'), 'utf8'), 'new runtime');
  assert.equal(fs.readFileSync(path.join(result.previousRuntime, 'lib/launch.mjs'), 'utf8'), 'old runtime');
  assert.equal(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf8'), '{"model":"keep-this-model"}\r\n');
  assert.ok(!fs.existsSync(path.join(root, 'data/unwanted')));
  assert.equal(fs.readFileSync(path.join(root, 'workspace/user-work.txt'), 'utf8'), 'never replace workspace');
});
test('bad candidate and failed program replacement leave the original runtime usable', t => {
  const { root, base } = fixture(t); seed(root); runtime(root, 'old runtime');
  const source = path.join(base, 'new version'); fs.mkdirSync(source); runtime(source, 'new runtime');
  put(source, 'platforms/win32-x64/node.exe', 'tampered');
  assert.throws(() => updateFromFolder(root, source), /校验失败/);
  assert.equal(listBackups(root).length, 0);
  runtime(source, 'new runtime');
  const linkedSource = symlink(path.join(source, 'tests'), put(base, 'external-update-file', 'outside'));
  if (linkedSource) assert.throws(() => updateFromFolder(root, source), /链接/);
  else t.diagnostic('跳过外部链接断言：当前系统不允许创建符号链接');
  assert.equal(fs.readFileSync(path.join(root, 'lib/launch.mjs'), 'utf8'), 'old runtime');
  assert.deepEqual(fs.readdirSync(path.join(root, 'backups/.transactions')), [], 'failed staging must not leave partial copies');
  if (linkedSource) fs.unlinkSync(path.join(source, 'tests'));
  assert.throws(() => updateFromFolder(root, source, { injectFailure: name => { if (name === 'platforms') throw new Error('simulated replace failure'); } }), /simulated replace failure/);
  assert.equal(fs.readFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'utf8'), 'old runtime');
  assert.equal(fs.readFileSync(path.join(root, 'lib/launch.mjs'), 'utf8'), 'old runtime');
});
test('preflight rejects unsupported platforms and missing files', t => {
  const { root } = fixture(t); runtime(root, 'runtime');
  assert.equal(runtimeChecks(root, { platform: 'darwin-arm64' })[0].status, 'FAIL');
  assert.ok(runtimeChecks(root, { platform: 'win32-x64' }).every(row => row.status !== 'FAIL'));
  fs.unlinkSync(path.join(root, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/lib/bin.js'));
  assert.ok(runtimeChecks(root, { platform: 'win32-x64' }).some(row => row.status === 'FAIL'));
});
test('failure logs contain only classified reasons, never raw stderr or credentials', t => {
  const { root, base } = fixture(t); runtime(root, 'runtime');
  const cache = portableCache(root, { parentEnv: { AI_USB_HOST_CACHE: path.join(base, 'host') } });
  const reason = failureReason({ code: 1, stderr: '401 key=do-not-log-this-secret' });
  recordRun(cache.root, { program: 'harness', status: 'failed', code: 1, reason });
  const log = fs.readFileSync(path.join(cache.root, 'logs/last-run.json'), 'utf8');
  assert.ok(!log.includes('do-not-log-this-secret')); assert.match(log, /认证/);
});
