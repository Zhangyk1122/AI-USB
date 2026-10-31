// Real bundled Agents, local fake APIs, temporary CC-style configuration. No real Key required.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildAgentPlan, ccPaths } from '../lib/agent-plan.mjs';
import { startBridge } from '../lib/bridge.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'usb managed agents '));
const paths = ccPaths(temporary);
const parentEnv = { ...process.env, OPENAI_API_KEY: 'wrong-host-key', ANTHROPIC_AUTH_TOKEN: 'wrong-host-key', DEEPSEEK_API_KEY: 'wrong-host-key' };
const fakeToken = 'usb-offline-test-token';
let bridge, anthropicServer;

async function run(agent, extra) {
  const plan = await buildAgentPlan({ root: temporary, agent, extra: ['--cc-switch', ...extra], parentEnv,
    bridgeFactory: () => { throw new Error('Managed mode must use CC config without its own bridge'); } });
  const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: plan.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 40000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, `${agent} failed:\n${stdout}\n${stderr}`);
    return { stdout, stderr };
  } finally { clearTimeout(timeout); }
}

try {
  await fs.symlink(path.join(source, 'platforms'), path.join(temporary, 'platforms'), 'junction');
  for (const dir of Object.values(paths)) await fs.mkdir(dir, { recursive: true });
  let requests = 0;
  bridge = await startBridge({ key: 'fake-key', model: 'deepseek-flash', fetchImpl: async (_url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    const toolResult = body.messages.find(message => message.role === 'tool');
    if (!toolResult) {
      const tool = body.tools.find(t => /(?:shell_command|exec_command)$/.test(t.function.name));
      assert.ok(tool, 'Expected a shell tool from the actual CLI');
      const args = tool.function.name.endsWith('shell_command') ? { command: 'echo USB_CC_TOOL_OK', timeout_ms: 1000 } : { cmd: 'echo USB_CC_TOOL_OK', max_output_tokens: 100 };
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
        { id: 'usb_managed_tool_1', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } },
      ] } }] });
    }
    assert.match(toolResult.content, /USB_CC_TOOL_OK/);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'USB_CC_CODEX_OK' } }] });
  } });
  // Same auth.json and custom-provider mechanism as a CC Switch preset, pointed at a fake local API.
  const config = `web_search = "disabled"\nmodel_provider = "custom"\nmodel = "deepseek-flash"\ncli_auth_credentials_store = "file"\n[model_providers.custom]\nname = "USB offline test"\nbase_url = ${JSON.stringify(bridge.baseUrl)}\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n`;
  await fs.writeFile(path.join(paths.codex, 'config.toml'), config);
  await fs.writeFile(path.join(paths.codex, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: bridge.token }));
  const codex = await run('codex', ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--config', 'approval_policy="never"', 'Run echo USB_CC_TOOL_OK once, then say USB_CC_CODEX_OK.']);
  assert.match(codex.stdout, /USB_CC_CODEX_OK/);
  assert.ok(requests >= 2);
  assert.equal(await fs.readFile(path.join(paths.codex, 'config.toml'), 'utf8'), config);
  console.log(`PASS: managed Codex read config.toml + auth.json, completed tool round trip (${requests} requests), and preserved its config`);

  let claudeRequests = 0;
  anthropicServer = http.createServer(async (req, res) => {
    try {
      if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":10}'); return; }
      assert.match(req.url, /^\/v1\/messages/);
      assert.ok(req.headers.authorization === `Bearer ${fakeToken}` || req.headers['x-api-key'] === fakeToken, 'Claude must use the CC-saved key');
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      assert.equal(body.model, 'usb-offline-model');
      claudeRequests++;
      const content = [{ type: 'text', text: 'USB_CC_CLAUDE_OK' }];
      const message = { id: 'msg_usb_offline', type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
        event('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
        event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'USB_CC_CLAUDE_OK' } });
        event('content_block_stop', { type: 'content_block_stop', index: 0 });
        event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
        event('message_stop', { type: 'message_stop' });
        res.end();
      } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); }
    } catch (error) { res.writeHead(400); res.end(error.message); }
  });
  await new Promise(resolve => anthropicServer.listen(0, '127.0.0.1', resolve));
  const claudeSettings = JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicServer.address().port}`,
    ANTHROPIC_AUTH_TOKEN: fakeToken, ANTHROPIC_MODEL: 'usb-offline-model',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'usb-offline-model', ANTHROPIC_DEFAULT_SONNET_MODEL: 'usb-offline-model', ANTHROPIC_DEFAULT_OPUS_MODEL: 'usb-offline-model',
  } }, null, 2);
  await fs.writeFile(path.join(paths.claude, 'settings.json'), claudeSettings);
  const claude = await run('claude', ['--print', '--no-session-persistence', '--tools', '', '--max-turns', '1', 'Say USB_CC_CLAUDE_OK']);
  assert.match(claude.stdout, /USB_CC_CLAUDE_OK/);
  assert.ok(claudeRequests >= 1);
  assert.equal(await fs.readFile(path.join(paths.claude, 'settings.json'), 'utf8'), claudeSettings);
  console.log('PASS: managed Claude read the saved model, URL and key from settings.json and called the local fake API');

  const patch = `- id: llm-pi-ai\n  config:\n    providers:\n      usb-offline-provider:\n        displayName: USB CC Harness Test\n        api: openai-completions\n        baseURL: http://127.0.0.1:9/v1\n        apiKeyEnv: CC_SWITCH_DSH_USB_OFFLINE\n        models:\n          - id: usb-offline-model\n            contextWindow: 32000\n            maxTokens: 1000\n`;
  await fs.mkdir(path.join(paths.harness, 'profiles/web'), { recursive: true });
  await fs.writeFile(path.join(paths.harness, 'profiles/web/cordis.patch.yml'), patch);
  await fs.writeFile(path.join(paths.harness, '.credentials.yaml'), 'version: 1\nrefs:\n  CC_SWITCH_DSH_USB_OFFLINE: usb-fake-key\n');
  const harness = await run('harness', ['--profile', 'web', '--dump-config']);
  assert.match(harness.stdout, /usb-offline-provider/);
  assert.match(harness.stdout, /usb-offline-model/);
  assert.equal(await fs.readFile(path.join(paths.harness, 'profiles/web/cordis.patch.yml'), 'utf8'), patch);
  console.log('PASS: managed Harness composed the CC-style provider and model from its web profile and preserved the patch');
} finally {
  if (bridge) await bridge.close();
  if (anthropicServer) await new Promise(resolve => { anthropicServer.close(resolve); anthropicServer.closeAllConnections(); });
  await fs.rm(temporary, { recursive: true, force: true });
}
