// Offline smoke test against an actual Codex CLI. No real key or network call.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { startBridge } from '../lib/bridge.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-usb-codex-test-'));
let requests = 0;
const bridge = await startBridge({ key: 'fake-key', model: 'deepseek-flash', fetchImpl: async (_url, init) => {
  requests++;
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'deepseek-flash');
  const toolResult = body.messages.find(m => m.role === 'tool');
  if (!toolResult) {
    const tool = body.tools.find(t => t.function.name.endsWith('shell_command')) || body.tools.find(t => t.function.name.endsWith('exec_command'));
    if (!tool) throw new Error(`No shell tool found: ${body.tools.map(t => t.function.name).join(',')}`);
    const args = tool.function.name.endsWith('shell_command') ? { command: 'echo USB_TOOL_OK', timeout_ms: 1000 } : { cmd: 'echo USB_TOOL_OK', max_output_tokens: 100 };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
      { id: 'call_usb_1', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } },
    ] } }] });
  }
  assert.match(toolResult.content, /USB_TOOL_OK/);
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'USB_DEMO_OK' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
} });
try {
  await fs.writeFile(path.join(temporary, 'config.toml'), `web_search = "disabled"\nmodel_provider = "demo"\nmodel = "deepseek-flash"\n[model_providers.demo]\nname = "Mock DeepSeek"\nbase_url = ${JSON.stringify(bridge.baseUrl)}\nenv_key = "USB_TEST_TOKEN"\nwire_api = "responses"\nsupports_websockets = false\n`);
  const executable = process.env.CODEX_TEST_BIN || 'codex';
  const child = spawn(executable, ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--config', 'approval_policy="never"', 'Run echo USB_TOOL_OK once, then say USB_DEMO_OK.'], {
    cwd: temporary, env: { ...process.env, CODEX_HOME: temporary, USB_TEST_TOKEN: bridge.token }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const timeout = setTimeout(() => child.kill('SIGTERM'), 45000);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timeout);
  if (code !== 0) throw new Error(output);
  assert.match(output, /USB_DEMO_OK/);
  assert.ok(requests >= 2, 'Expected a real round trip through the tool result');
  console.log(`PASS: real Codex -> local bridge -> mock DeepSeek -> shell tool -> tool result -> final answer (${requests} requests)`);
} finally { await bridge.close(); await fs.rm(temporary, { recursive: true, force: true }); }
