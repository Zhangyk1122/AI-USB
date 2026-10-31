import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { apiTargets, checkTarget, checkAPIs, modelEndpoint } from '../lib/api-diagnostics.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb API config '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
function put(root, file, value) { const full = path.join(root, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); }
async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); }));
  return `http://127.0.0.1:${s.address().port}`;
}
test('CC Codex, Claude and Harness checks use their saved config, never inherited host provider keys', async t => {
  const root = fixture(t), token = 'saved-fake-key'; let requests = 0;
  const url = await server(t, (req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.url, '/v1/models');
    assert.equal(req.headers.authorization, `Bearer ${token}`); requests++;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"fake-model"}]}');
  });
  const base = 'data/cc-switch/agents';
  put(root, `${base}/codex/config.toml`, `model_provider = "custom"\n[model_providers.custom]\nbase_url = "${url}/v1"\n`);
  put(root, `${base}/codex/auth.json`, JSON.stringify({ OPENAI_API_KEY: token }));
  put(root, `${base}/claude/settings.json`, JSON.stringify({ env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: token } }));
  put(root, `${base}/harness/profiles/web/cordis.patch.yml`, `- id: llm-pi-ai\n  config:\n    providers:\n      custom:\n        baseURL: ${url}/v1\n        apiKeyEnv: CC_SWITCH_TEST_KEY\n        api: openai-completions\n`);
  put(root, `${base}/harness/.credentials.yaml`, `version: 1\nrefs:\n  CC_SWITCH_TEST_KEY: ${token}\n`);
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  fs.symlinkSync(path.join(source, 'platforms'), path.join(root, 'platforms'), 'junction');
  const rows = await checkAPIs(root, { parentEnv: { OPENAI_API_KEY: 'wrong-host-key', ANTHROPIC_AUTH_TOKEN: 'wrong-host-key' } });
  assert.equal(rows.length, 3); assert.ok(rows.every(r => r.status === 'OK'), JSON.stringify(rows));
  assert.equal(requests, 3); assert.ok(!JSON.stringify(rows).includes(token));
});
test('authentication failure, unsupported list endpoints and timeouts are distinguished without leaking secrets', async t => {
  const secret = 'must-never-be-logged';
  const url = await server(t, (req, res) => {
    if (req.url === '/timeout/models') return;
    const status = req.url === '/missing/models' ? 404 : 401;
    res.writeHead(status); res.end(`provider echo: ${secret}`);
  });
  const failed = await checkTarget({ name: 'test', base: url, key: secret });
  assert.equal(failed.status, 'FAIL'); assert.match(failed.detail, /401/); assert.ok(!JSON.stringify(failed).includes(secret));
  const missing = await checkTarget({ name: 'test', base: `${url}/missing`, key: secret });
  assert.equal(missing.status, 'WARN'); assert.match(missing.detail, /尚不能验证/);
  const timed = await checkTarget({ name: 'test', base: `${url}/timeout`, key: secret }, { timeout: 25 });
  assert.equal(timed.status, 'FAIL'); assert.match(timed.detail, /超时/);
});
test('redirects never forward API credentials to another endpoint', async t => {
  let otherRequests = 0;
  const other = await server(t, (_req, res) => { otherRequests++; res.end('{"data":[]}'); });
  const url = await server(t, (_req, res) => { res.writeHead(302, { Location: `${other}/models` }); res.end(); });
  const row = await checkTarget({ name: 'test', base: url, key: 'fake' });
  assert.equal(row.status, 'FAIL'); assert.equal(otherRequests, 0);
});
test('malformed configuration is reported without quoting secret input; missing credentials remain unverified', async t => {
  const root = fixture(t);
  put(root, 'data/cc-switch/agents/claude/settings.json', '{"secret":"do-not-quote-me" broken');
  const rows = await checkAPIs(root);
  assert.equal(rows.find(r => r.name === 'claude').status, 'FAIL'); assert.ok(!JSON.stringify(rows).includes('do-not-quote-me'));
  assert.equal(rows.find(r => r.name === 'codex').status, 'SKIP');
  assert.equal((await checkTarget({ name: 'direct', base: 'https://api.deepseek.com' })).status, 'SKIP');
});
test('endpoint handling supports DeepSeek Anthropic and rejects insecure remote addresses and URL credentials', () => {
  assert.equal(modelEndpoint({ base: 'https://api.deepseek.com/anthropic' }).href, 'https://api.deepseek.com/models');
  assert.equal(modelEndpoint({ base: 'https://example.com/v1/responses' }).pathname, '/v1/models');
  assert.throws(() => modelEndpoint({ base: 'http://example.com/v1' }), /HTTPS/);
  assert.throws(() => modelEndpoint({ base: 'https://example.com/v1?api_key=secret' }), /凭据/);
});
