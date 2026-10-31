import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { portableCache, recordRun } from '../lib/portable-cache.mjs';
import { runtimeEnv } from '../lib/agent-plan.mjs';
import { acquireLease, maintenanceLock, clearForeignRecords } from '../lib/state-lock.mjs';
import { requiredFiles, runtimeChecks, failureReason } from '../lib/preflight.mjs';
import { createBackup, verifyBackup, restoreBackup, updateFromFolder, recoverTransactions, listBackups, digest } from '../lib/maintenance.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ai usb portable '));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'USB folder'); fs.mkdirSync(root);
  return { base, root };
}
function put(root, file, value) {
  const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); return full;
}
function seed(root) {
  put(root, 'config/settings.json', '{"model":"keep-this-model"}\r\n');
  put(root, 'data/cc-switch/agents/claude/settings.json', '{"key":"test-secret-only"}\r\n');
  put(root, 'data/cc-switch/agents/codex/sessions/session.jsonl', '{"conversation":"keep bytes"}\n');
  put(root, 'data/cc-switch/controller-home/.cc-switch/cc-switch.db', Buffer.from([0, 255, 1, 2]));
  put(root, 'workspace/user-work.txt', 'never replace workspace');
}
function runtime(root, marker) {
  for (const platform of ['darwin-arm64', 'win32-x64']) for (const file of requiredFiles(platform)) fs.chmodSync(put(root, `platforms/${platform}/${file}`, marker), 0o755);
  for (const file of ['lib/maintenance.mjs', 'lib/launch.mjs', 'lib/doctor.mjs', 'Mac-Start.command', 'Windows-Start.bat']) put(root, file, marker);
  put(root, 'BUILD-INFO.json', JSON.stringify({ platforms: ['darwin-arm64', 'win32-x64'] }));
  const names = ['platforms/darwin-arm64/node', 'platforms/win32-x64/node.exe'];
  put(root, 'RUNTIME-SHA256.json', JSON.stringify(Object.fromEntries(names.map(n => [n, digest(path.join(root, n))]))));
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
  assert.equal(actualEnv.TMPDIR, path.join(first.root, 'tmp')); assert.equal(actualEnv.DEEPSEEK_API_KEY, undefined);
  assert.equal(fs.readFileSync(path.join(moved, 'data/cc-switch/agents/claude/settings.json'), 'utf8'), '{"key":"test-secret-only"}\r\n');
});
test('unwritable host cache falls back to USB without moving sessions', t => {
  const { root, base } = fixture(t), blocked = put(base, 'file-not-directory', 'x');
  const cache = portableCache(root, { parentEnv: { AI_USB_HOST_CACHE: blocked } });
  assert.equal(cache.local, false); assert.ok(cache.root.startsWith(path.join(root, 'data/cache')));
});
test('backup/restore preserves exact bytes, excludes caches and temporary links, and backs up the replaced state', t => {
  const { root } = fixture(t); seed(root);
  put(root, 'data/npm-cache/large-file', 'disposable'); put(root, 'data/cache/large-file', 'disposable');
  const temp = put(root, 'data/cc-switch/agents/codex/tmp/target', 'temporary');
  fs.symlinkSync(temp, path.join(path.dirname(temp), 'apply_patch'));
  const backup = createBackup(root), manifest = verifyBackup(backup);
  assert.ok(!manifest.entries.some(e => /npm-cache|\/cache\/|\/tmp\//.test(e.path)));
  put(root, 'data/cc-switch/agents/codex/sessions/session.jsonl', 'changed session');
  put(root, 'data/claude/extra.txt', 'created after snapshot');
  put(root, 'config/settings.json', '{"model":"changed"}');
  const result = restoreBackup(root, path.basename(backup));
  verifyBackup(result.before);
  assert.equal(fs.readFileSync(path.join(root, 'data/cc-switch/agents/codex/sessions/session.jsonl'), 'utf8'), '{"conversation":"keep bytes"}\n');
  assert.deepEqual(fs.readFileSync(path.join(root, 'data/cc-switch/controller-home/.cc-switch/cc-switch.db')), Buffer.from([0, 255, 1, 2]));
  assert.ok(!fs.existsSync(path.join(root, 'data/claude/extra.txt')));
  assert.equal(fs.readFileSync(path.join(result.before, 'payload/data/cc-switch/agents/codex/sessions/session.jsonl'), 'utf8'), 'changed session');
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
  const target = put(base, 'external-secret', 'secret'); fs.symlinkSync(target, path.join(root, 'data/secret-link'));
  assert.throws(() => createBackup(root), /链接/);
});
test('running Agent and exclusive maintenance locks prevent inconsistent snapshots or concurrent launches', t => {
  const { root } = fixture(t); seed(root);
  const lease = acquireLease(root, 'codex');
  assert.throws(() => createBackup(root), /还.*运行/);
  assert.throws(() => clearForeignRecords(root), /活动进程/);
  lease.release();
  const unlock = maintenanceLock(root);
  assert.throws(() => acquireLease(root, 'claude'), /正在进行/);
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
  assert.throws(() => acquireLease(root, 'codex'), /未完成/);
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
  fs.symlinkSync(put(base, 'external-update-file', 'outside'), path.join(source, 'tests'));
  assert.throws(() => updateFromFolder(root, source), /链接/);
  assert.equal(fs.readFileSync(path.join(root, 'lib/launch.mjs'), 'utf8'), 'old runtime');
  assert.deepEqual(fs.readdirSync(path.join(root, 'backups/.transactions')), [], 'failed staging must not leave partial multi-GB copies');
  fs.unlinkSync(path.join(source, 'tests'));
  assert.throws(() => updateFromFolder(root, source, { injectFailure: name => { if (name === 'platforms') throw new Error('simulated replace failure'); } }), /simulated replace failure/);
  assert.equal(fs.readFileSync(path.join(root, 'platforms/darwin-arm64/node'), 'utf8'), 'old runtime');
  assert.equal(fs.readFileSync(path.join(root, 'lib/launch.mjs'), 'utf8'), 'old runtime');
});
test('preflight rejects unsupported architecture and incomplete dependencies; failure logs contain only classified reasons', t => {
  const { root, base } = fixture(t); runtime(root, 'runtime');
  assert.equal(runtimeChecks(root, { platform: 'darwin-x64' })[0].status, 'FAIL');
  fs.unlinkSync(path.join(root, 'platforms/win32-x64/git/bin/bash.exe'));
  assert.ok(runtimeChecks(root, { platform: 'win32-x64', agent: 'claude' }).some(r => r.status === 'FAIL'));
  const cache = portableCache(root, { parentEnv: { AI_USB_HOST_CACHE: path.join(base, 'host') } });
  const reason = failureReason({ code: 1, stderr: '401 key=do-not-log-this-secret' });
  recordRun(cache.root, { program: 'codex', status: 'failed', code: 1, reason });
  const log = fs.readFileSync(path.join(cache.root, 'logs/last-run.json'), 'utf8');
  assert.ok(!log.includes('do-not-log-this-secret')); assert.match(log, /认证/);
});
