import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildManifest, diffManifests, sha256File } from '../lib/integrity.mjs';
import { extractZip } from '../lib/zip.mjs';
import { planChain, applyFileDelta } from '../lib/updater.mjs';
import { recoverTransactions } from '../lib/maintenance.mjs';

const fflate = createRequire(path.resolve('platforms/win32-x64/node_modules/fflate/package.json'))('fflate');
const str = value => fflate.strToU8(value);

function fixture(t, release = 'v0.1.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb update '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'platforms/win32-x64'), { recursive: true });
  fs.writeFileSync(path.join(root, 'platforms/win32-x64/node.exe'), 'node');
  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), JSON.stringify({ release, versions: { node: '24.17.0' } }, null, 2) + '\n');
  return root;
}
const put = (root, rel, value) => { const full = path.join(root, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); return full; };

function mockFetch(routes) {
  return async url => {
    const text = String(url);
    for (const [pattern, body] of Object.entries(routes)) {
      if (text.includes(pattern)) {
        if (typeof body === 'function') return body();
        if (body instanceof Uint8Array) return new Response(body);
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('not found', { status: 404 });
  };
}

function release(tag, assets = {}) {
  return {
    tag_name: tag, name: tag, draft: false, created_at: '2026-11-1' + tag.slice(-1) + 'T00:00:00Z',
    html_url: 'https://example.invalid/' + tag,
    assets: Object.keys(assets).map(name => ({ name, browser_download_url: 'https://dl.invalid/' + tag + '/' + name })),
  };
}

test('CI artifacts in the checkout root are never treated as package files', t => {
  const root = fixture(t);
  put(root, 'SHA256SUMS.txt', 'hash');
  put(root, 'test-output.txt', 'log');
  put(root, 'delta-from-v0.1.0.json', '{}');
  put(root, 'README.md', 'doc');
  const files = Object.keys(buildManifest(root).files);
  assert.deepEqual(files.filter(name => name.includes('SHA256SUMS') || name.includes('test-output') || name.startsWith('delta-from-')), []);
  assert.ok(files.includes('README.md'));
});

test('manifest diff classifies added, changed and deleted files', t => {
  const base = fixture(t), target = fixture(t);
  put(base, 'lib/a.mjs', 'old'); put(target, 'lib/a.mjs', 'new'); put(target, 'lib/b.mjs', 'added');
  put(base, 'lib/gone.mjs', 'bye');
  const diff = diffManifests(buildManifest(base), buildManifest(target));
  assert.deepEqual(diff.changed, ['lib/a.mjs']);
  assert.deepEqual(diff.added, ['lib/b.mjs']);
  assert.deepEqual(diff.deleted, ['lib/gone.mjs']);
});

test('extractZip writes nested entries and rejects path traversal', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb zip '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const good = path.join(root, 'good.zip');
  fs.writeFileSync(good, fflate.zipSync({ 'lib/a.mjs': str('hello'), 'platforms/x.txt': str('bin') }));
  await extractZip(good, path.join(root, 'out'));
  assert.equal(fs.readFileSync(path.join(root, 'out/lib/a.mjs'), 'utf8'), 'hello');
  assert.equal(fs.readFileSync(path.join(root, 'out/platforms/x.txt'), 'utf8'), 'bin');
  const evil = path.join(root, 'evil.zip');
  fs.writeFileSync(evil, fflate.zipSync({ '../escape.txt': str('x') }));
  await assert.rejects(extractZip(evil, path.join(root, 'out2')), /越界|非法/);
});

test('planChain walks consecutive delta releases and falls back when a hop is missing', async t => {
  const root = fixture(t, 'v0.1.0');
  const releases = [
    release('v0.1.0'),
    release('v0.1.1', { 'delta-from-v0.1.0.json': 1, 'delta-from-v0.1.0.zip': 1 }),
    release('v0.1.2', { 'delta-from-v0.1.1.json': 1, 'delta-from-v0.1.1.zip': 1 }),
  ];
  const fetchImpl = mockFetch({ '/releases': releases });
  const plan = await planChain(root, { repo: 'owner/repo', fetchImpl });
  assert.equal(plan.mode, 'delta');
  assert.deepEqual(plan.steps.map(step => step.tag), ['v0.1.1', 'v0.1.2']);

  const broken = [release('v0.1.0'), release('v0.1.1', {}), release('v0.1.2', {})];
  const fallback = await planChain(root, { fetchImpl: mockFetch({ '/releases': broken }) });
  assert.equal(fallback.mode, 'full');

  fs.writeFileSync(path.join(root, 'BUILD-INFO.json'), JSON.stringify({ release: 'v0.1.2' }));
  assert.equal((await planChain(root, { fetchImpl })).mode, 'up-to-date');
});

function deltaFixture(t) {
  const root = fixture(t, 'v0.1.0');
  put(root, 'lib/a.mjs', 'old-a');
  put(root, 'lib/old.mjs', 'old-b');
  const extracted = path.join(root, '.cache/files');
  put(extracted, 'lib/a.mjs', 'new-a');
  put(extracted, 'lib/b.mjs', 'new-b');
  const transaction = path.join(root, 'backups/.transactions/t1');
  fs.mkdirSync(transaction, { recursive: true });
  const delta = {
    format: 'ai-usb-delta-v1', base: 'v0.1.0', release: 'v0.1.1',
    files: [
      { path: 'lib/a.mjs', sha256: sha256File(path.join(extracted, 'lib/a.mjs')) },
      { path: 'lib/b.mjs', sha256: sha256File(path.join(extracted, 'lib/b.mjs')) },
    ],
    deleted: ['lib/old.mjs'],
  };
  return { root, extracted, transaction, delta };
}

test('applying a delta updates, adds and deletes files and keeps originals for rollback', t => {
  const { root, extracted, transaction, delta } = deltaFixture(t);
  applyFileDelta(root, extracted, delta, transaction);
  assert.equal(fs.readFileSync(path.join(root, 'lib/a.mjs'), 'utf8'), 'new-a');
  assert.equal(fs.readFileSync(path.join(root, 'lib/b.mjs'), 'utf8'), 'new-b');
  assert.ok(!fs.existsSync(path.join(root, 'lib/old.mjs')));
  assert.equal(fs.readFileSync(path.join(transaction, 'previous/lib/a.mjs'), 'utf8'), 'old-a');
  assert.equal(fs.readFileSync(path.join(transaction, 'previous/lib/old.mjs'), 'utf8'), 'old-b');
  assert.equal(JSON.parse(fs.readFileSync(path.join(transaction, 'journal.json'), 'utf8')).state, 'complete');
});

test('a delta cannot write files outside the packaged set', t => {
  const { root, extracted, transaction, delta } = deltaFixture(t);
  delta.files.push({ path: 'SHA256SUMS.txt', sha256: sha256File(put(extracted, 'SHA256SUMS.txt', 'ci')) });
  delta.files.push({ path: '../escape.txt', sha256: sha256File(put(extracted, 'escape.txt', 'x')) });
  applyFileDelta(root, extracted, delta, transaction);
  assert.ok(!fs.existsSync(path.join(root, 'SHA256SUMS.txt')));
  assert.ok(!fs.existsSync(path.join(root, '..', 'escape.txt')));
  const journal = JSON.parse(fs.readFileSync(path.join(transaction, 'journal.json'), 'utf8'));
  assert.deepEqual(journal.skipped.sort(), ['../escape.txt', 'SHA256SUMS.txt']);
});

test('user data paths are never updatable, even if a package contains them', t => {
  const { root, extracted, transaction, delta } = deltaFixture(t);
  put(extracted, 'data/harness/profiles/web/package.json', '{}');
  delta.files.push({ path: 'data/harness/profiles/web/package.json', sha256: sha256File(path.join(extracted, 'data/harness/profiles/web/package.json')) });
  delta.files.push({ path: 'workspace/README.md', sha256: '0'.repeat(64) });
  applyFileDelta(root, extracted, delta, transaction);
  assert.ok(!fs.existsSync(path.join(root, 'data/harness/profiles/web/package.json')));
  const journal = JSON.parse(fs.readFileSync(path.join(transaction, 'journal.json'), 'utf8'));
  assert.ok(journal.skipped.includes('data/harness/profiles/web/package.json'));
  assert.ok(journal.skipped.includes('workspace/README.md'));
});

test('a corrupted delta rolls back every file it touched', t => {
  const { root, extracted, transaction, delta } = deltaFixture(t);
  delta.files[1].sha256 = '0'.repeat(64);
  assert.throws(() => applyFileDelta(root, extracted, delta, transaction), /哈希不符/);
  assert.equal(fs.readFileSync(path.join(root, 'lib/a.mjs'), 'utf8'), 'old-a');
  assert.ok(!fs.existsSync(path.join(root, 'lib/b.mjs')));
  assert.ok(fs.existsSync(path.join(root, 'lib/old.mjs')));
});

test('an interrupted delta journal is recovered by the maintenance entry point', t => {
  const { root, extracted, transaction, delta } = deltaFixture(t);
  applyFileDelta(root, extracted, delta, transaction);
  const journalFile = path.join(transaction, 'journal.json');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  journal.state = 'applying';
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  recoverTransactions(root);
  assert.equal(fs.readFileSync(path.join(root, 'lib/a.mjs'), 'utf8'), 'old-a');
  assert.ok(fs.existsSync(path.join(root, 'lib/old.mjs')));
  assert.ok(!fs.existsSync(path.join(root, 'lib/b.mjs')));
});
