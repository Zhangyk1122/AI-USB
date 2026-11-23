import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { packageItems, sha256File } from '../lib/integrity.mjs';
import { extractZip } from '../lib/zip.mjs';
import { validatePackage, checkForUpdate, updateOnline, currentRelease } from '../lib/updater.mjs';

const fflate = createRequire(path.resolve('platforms/win32-x64/node_modules/fflate/package.json'))('fflate');
const str = value => fflate.strToU8(value);

function fixture(t, release = 'v0.1.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb update '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'platforms/win32-x64'), { recursive: true });
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'old-node');
  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), JSON.stringify({ release, versions: { node: '24.17.0' }, platforms: ['win32-x64'] }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'dsh.bat'), 'old-dsh');
  return root;
}
const put = (root, rel, value) => { const full = path.join(root, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); return full; };
const sha = value => createHash('sha256').update(value).digest('hex');

// Build a minimal valid package tree (all files validatePackage requires) as a zip.
function packageZip(tag) {
  const tree = {};
  tree['BUILD-INFO.json'] = str(JSON.stringify({ release: tag, versions: { node: '24.17.0' }, platforms: ['win32-x64'] }));
  tree['RUNTIME-SHA256.json'] = str('{}');
  tree['lib/launch.mjs'] = str('// launch');
  tree['dsh.bat'] = str('@echo off');
  tree['dsh.ps1'] = str('$x=1');
  tree['platforms/win32-x64/node.exe'] = str('new-node');
  tree['platforms/win32-x64/node_modules/@deepseek-ai/dsh/lib/bin.js'] = str('// bin');
  tree['data/unwanted.txt'] = str('must not replace user data');
  return fflate.zipSync(tree);
}

function mockFetch(routes) {
  return async url => {
    const text = String(url);
    for (const [pattern, body] of Object.entries(routes)) {
      if (text.includes(pattern)) {
        if (typeof body === 'function') return body();
        if (body instanceof Uint8Array) return new Response(body);
        if (typeof body === 'string') return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  };
}

function release(tag, assetNames = ['AI-USB-Demo-win32-x64.zip', 'SHA256SUMS.txt']) {
  return {
    tag_name: tag, name: tag, draft: false, created_at: '2026-11-1' + tag.slice(-1) + 'T00:00:00Z',
    html_url: 'https://example.invalid/' + tag,
    assets: assetNames.map(name => ({ name, browser_download_url: 'https://dl.invalid/' + tag + '/' + name })),
  };
}

test('packageItems only allows packaged program files, never user data', t => {
  const root = fixture(t);
  const stage = path.join(root, 'stage');
  put(stage, 'lib/a.mjs', 'x');
  put(stage, 'tests/a.test.mjs', 'x');
  put(stage, 'platforms/win32-x64/node.exe', 'x');
  put(stage, 'dsh.bat', 'x');
  put(stage, 'README.md', 'x');
  put(stage, 'data/harness/keep.json', 'x');
  put(stage, 'config/settings.json', 'x');
  put(stage, 'workspace/keep.txt', 'x');
  put(stage, 'SHA256SUMS.txt', 'ci');
  const items = packageItems(stage).sort();
  assert.deepEqual(items, ['README.md', 'dsh.bat', 'lib', 'platforms', 'tests']);
});

test('validatePackage rejects an incomplete or wrong-platform tree', t => {
  const root = fixture(t);
  const good = path.join(root, 'good');
  put(good, 'BUILD-INFO.json', JSON.stringify({ platforms: ['win32-x64'] }));
  put(good, 'RUNTIME-SHA256.json', '{}');
  put(good, 'lib/launch.mjs', 'x');
  put(good, 'dsh.bat', 'x');
  put(good, 'dsh.ps1', 'x');
  put(good, 'platforms/win32-x64/node.exe', 'x');
  put(good, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/lib/bin.js', 'x');
  assert.doesNotThrow(() => validatePackage(good));

  const bad = path.join(root, 'bad');
  put(bad, 'BUILD-INFO.json', JSON.stringify({ platforms: ['darwin-arm64'] }));
  put(bad, 'RUNTIME-SHA256.json', '{}');
  put(bad, 'lib/launch.mjs', 'x');
  put(bad, 'dsh.bat', 'x');
  put(bad, 'dsh.ps1', 'x');
  put(bad, 'platforms/win32-x64/node.exe', 'x');
  put(bad, 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/lib/bin.js', 'x');
  assert.throws(() => validatePackage(bad), /win32-x64/);
});

test('extractZip writes nested entries and rejects path traversal', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb zip '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const good = path.join(root, 'good.zip');
  fs.writeFileSync(good, fflate.zipSync({ 'lib/a.mjs': str('hello'), 'platforms/x.txt': str('bin') }));
  await extractZip(good, path.join(root, 'out'));
  assert.equal(fs.readFileSync(path.join(root, 'out/lib/a.mjs'), 'utf8'), 'hello');
  const evil = path.join(root, 'evil.zip');
  fs.writeFileSync(evil, fflate.zipSync({ '../escape.txt': str('x') }));
  await assert.rejects(extractZip(evil, path.join(root, 'out2')), /越界|非法/);
});

test('checkForUpdate reports newer when the remote tag differs', async t => {
  const root = fixture(t, 'v0.1.0');
  const fetchImpl = mockFetch({ '/releases': [release('v0.1.0'), release('v0.1.1')] });
  const result = await checkForUpdate(root, { repo: 'o/r', fetchImpl });
  assert.equal(result.current, 'v0.1.0');
  assert.equal(result.latest.tag, 'v0.1.1');
  assert.equal(result.newer, true);
  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), JSON.stringify({ release: 'v0.1.1' }));
  assert.equal((await checkForUpdate(root, { repo: 'o/r', fetchImpl })).newer, false);
});

test('updateOnline downloads, verifies SHA256, replaces program files and keeps user data', async t => {
  const root = fixture(t, 'v0.1.0');
  put(root, 'data/harness/profiles/web/package.json', '{"keep":"me"}');
  const zipBytes = packageZip('v0.1.1');
  const sums = sha(zipBytes) + '  AI-USB-Demo-win32-x64.zip\n';
  const fetchImpl = mockFetch({
    '/releases': [release('v0.1.0'), release('v0.1.1')],
    'AI-USB-Demo-win32-x64.zip': zipBytes,
    'SHA256SUMS.txt': sums,
  });
  const result = await updateOnline(root, { repo: 'o/r', fetchImpl, workDir: path.join(root, '.cache'), onLog: () => {} });
  assert.equal(result.status, 'updated');
  assert.equal(result.tag, 'v0.1.1');
  assert.equal(currentRelease(root), 'v0.1.1');
  assert.equal(fs.readFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'utf8'), 'new-node');
  assert.equal(fs.readFileSync(path.join(root, 'dsh.bat'), 'utf8'), '@echo off');
  // user data untouched, and the package's own data/ was not imported
  assert.equal(fs.readFileSync(path.join(root, 'data/harness/profiles/web/package.json'), 'utf8'), '{"keep":"me"}');
  assert.ok(!fs.existsSync(path.join(root, 'data/unwanted.txt')));
});

test('a wrong SHA256 aborts the update before touching any program file', async t => {
  const root = fixture(t, 'v0.1.0');
  const zipBytes = packageZip('v0.1.1');
  const fetchImpl = mockFetch({
    '/releases': [release('v0.1.0'), release('v0.1.1')],
    'AI-USB-Demo-win32-x64.zip': zipBytes,
    'SHA256SUMS.txt': '0'.repeat(64) + '  AI-USB-Demo-win32-x64.zip\n',
  });
  await assert.rejects(
    updateOnline(root, { repo: 'o/r', fetchImpl, workDir: path.join(root, '.cache'), onLog: () => {} }),
    /SHA256 校验失败/);
  assert.equal(currentRelease(root), 'v0.1.0');
  assert.equal(fs.readFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'utf8'), 'old-node');
  assert.equal(fs.readFileSync(path.join(root, 'dsh.bat'), 'utf8'), 'old-dsh');
});

test('up-to-date and missing-asset cases return cleanly or fail explicitly', async t => {
  const root = fixture(t, 'v0.1.1');
  const fetchImpl = mockFetch({ '/releases': [release('v0.1.1')] });
  assert.equal((await updateOnline(root, { repo: 'o/r', fetchImpl, workDir: path.join(root, '.cache') })).status, 'up-to-date');

  const root2 = fixture(t, 'v0.1.0');
  const fetchNoZip = mockFetch({ '/releases': [release('v0.1.0'), release('v0.1.1', [])] });
  await assert.rejects(updateOnline(root2, { repo: 'o/r', fetchImpl: fetchNoZip, workDir: path.join(root2, '.cache') }), /没有 AI-USB-Demo/);
});

test('sha256File matches crypto for the same bytes', t => {
  const root = fixture(t);
  const file = put(root, 'x.bin', Buffer.from([1, 2, 3, 4]));
  assert.equal(sha256File(file), createHash('sha256').update(Buffer.from([1, 2, 3, 4])).digest('hex'));
});
