import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sealRuntime, sealFiles } from '../lib/seal.mjs';
import { digest } from '../lib/maintenance.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb seal '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh'), { recursive: true });
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'node-bytes');
  fs.mkdirSync(path.join(root, 'platforms/win32-x64/pnpm'), { recursive: true });
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/pnpm/pnpm.exe'), 'pnpm-bytes');
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '2.0.0' }));
  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), JSON.stringify({ prepared: '2026-10-31', versions: { node: '1.0.0', 'deepseek-harness': '0.0.1' }, platforms: ['win32-x64'] }, null, 2) + '\n');
  return root;
}
const fakeExec = () => ({ status: 0, stdout: 'v24.17.0' });

test('seal records hashes of the files that exist and skips optional ones', t => {
  const root = fixture(t);
  const result = sealRuntime(root, { hostPlatform: 'win32', exec: fakeExec, today: new Date('2026-11-17T00:00:00Z') });
  assert.deepEqual(result.files, ['platforms/win32-x64/node.exe', 'platforms/win32-x64/pnpm/pnpm.exe']);
  assert.equal(result.hashChanged, true);
  const hashes = JSON.parse(fs.readFileSync(path.join(root, 'RUNTIME-SHA256.json'), 'utf8'));
  assert.equal(hashes['platforms/win32-x64/node.exe'], digest(path.join(root, 'platforms/win32-x64/node.exe')));
  assert.ok(!('platforms/win32-x64/git/bin/bash.exe' in hashes));
});

test('seal refreshes versions and the trimmed date without touching other fields', t => {
  const root = fixture(t);
  const result = sealRuntime(root, { hostPlatform: 'win32', exec: fakeExec, today: new Date('2026-11-17T00:00:00Z') });
  assert.deepEqual(result.versionsChanged.sort(), ['deepseek-harness', 'node']);
  const info = JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json'), 'utf8'));
  assert.deepEqual(info.versions, { node: '24.17.0', 'deepseek-harness': '2.0.0' });
  assert.equal(info.trimmed, '2026-11-17');
  assert.equal(info.prepared, '2026-10-31');
  assert.deepEqual(info.platforms, ['win32-x64']);
});

test('a sealed package is idempotent and dry-run writes nothing', t => {
  const root = fixture(t);
  sealRuntime(root, { hostPlatform: 'win32', exec: fakeExec, today: new Date('2026-11-17T00:00:00Z') });
  const before = fs.readFileSync(path.join(root, 'RUNTIME-SHA256.json'), 'utf8');
  const again = sealRuntime(root, { hostPlatform: 'win32', exec: fakeExec, today: new Date('2026-11-18T00:00:00Z') });
  assert.equal(again.hashChanged, false);
  assert.deepEqual(again.versionsChanged, []);
  assert.equal(fs.readFileSync(path.join(root, 'RUNTIME-SHA256.json'), 'utf8'), before);
  const dry = sealRuntime(root, { hostPlatform: 'win32', exec: fakeExec, write: false, today: new Date('2026-11-19T00:00:00Z') });
  assert.equal(dry.hashChanged, false);
  assert.ok(sealFiles(root).length === 2);
});
