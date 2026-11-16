import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectVersions, versionReport, syncBuildInfo, readBuildInfo } from '../lib/versions.mjs';

function fixture(t, versions = { node: '1.0.0', 'deepseek-harness': '0.0.1' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb versions '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh'), { recursive: true });
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'fake-pe');
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '2.0.0' }));
  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), JSON.stringify({ prepared: '2026-10-31', platforms: ['win32-x64'], versions }, null, 2) + '\n');
  return root;
}
const fakeExec = stdout => () => ({ status: 0, stdout });

test('versions are detected from the shipped runtime, not from BUILD-INFO', t => {
  const root = fixture(t);
  const detected = detectVersions(root, { hostPlatform: 'win32', exec: fakeExec('v24.17.0\n') });
  assert.deepEqual(detected, { node: '24.17.0', 'deepseek-harness': '2.0.0' });
});

test('node.exe stays undetected off Windows instead of being guessed', t => {
  const root = fixture(t);
  assert.deepEqual(detectVersions(root, { hostPlatform: 'darwin' }), { 'deepseek-harness': '2.0.0' });
  const report = versionReport(root, { hostPlatform: 'darwin' });
  assert.equal(report.find(r => r.name === 'node').status, 'SKIP');
  assert.equal(report.find(r => r.name === 'deepseek-harness').status, 'MISMATCH');
});

test('a drifted BUILD-INFO is reported and can be synced without losing other fields', t => {
  const root = fixture(t);
  const before = readBuildInfo(root);
  const report = versionReport(root, { hostPlatform: 'win32', exec: fakeExec('v24.17.0') });
  assert.deepEqual(report.map(r => r.status), ['MISMATCH', 'MISMATCH']);
  const { changed } = syncBuildInfo(root, { hostPlatform: 'win32', exec: fakeExec('v24.17.0') });
  assert.deepEqual(changed.sort(), ['deepseek-harness', 'node']);
  const after = readBuildInfo(root);
  assert.deepEqual(after.versions, { node: '24.17.0', 'deepseek-harness': '2.0.0' });
  assert.equal(after.prepared, before.prepared);
  assert.deepEqual(after.platforms, before.platforms);
  assert.ok(!fs.existsSync(path.join(root, 'BUILD-INFO.json.tmp')));
});

test('a matching BUILD-INFO is left untouched and reported OK', t => {
  const root = fixture(t, { node: '24.17.0', 'deepseek-harness': '2.0.0' });
  const report = versionReport(root, { hostPlatform: 'win32', exec: fakeExec('v24.17.0') });
  assert.deepEqual(report.map(r => r.status), ['OK', 'OK']);
  const result = syncBuildInfo(root, { hostPlatform: 'win32', exec: fakeExec('v24.17.0') });
  assert.deepEqual(result.changed, []);
});

test('broken or missing BUILD-INFO is refused instead of overwritten', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), '{broken');
  assert.throws(() => syncBuildInfo(root), /BUILD-INFO/);
  assert.equal(fs.readFileSync(path.join(root, 'BUILD-INFO.json'), 'utf8'), '{broken');
});
