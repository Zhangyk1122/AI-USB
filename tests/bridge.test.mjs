import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, toChat } from '../lib/bridge.mjs';

test('tool call history and custom tools survive translation', () => {
  const { request, custom } = toChat({ instructions: 'Be concise', input: [
    { role: 'user', content: [{ type: 'input_text', text: 'Read a file' }] },
    { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'hello' },
  ], tools: [{ type: 'custom', name: 'apply_patch' }] }, 'deepseek-flash');
  assert.equal(request.messages[1].content, 'Read a file');
  assert.equal(request.messages[2].tool_calls[0].id, 'call_1');
  assert.equal(request.messages[3].tool_call_id, 'call_1');
  assert.equal(custom.has('apply_patch'), true);
});

test('unsupported images fail explicitly', () => {
  assert.throws(() => toChat({ input: [{ role: 'user', content: [{ type: 'input_image' }] }] }, 'test'), /does not support/);
});

test('namespace tool names are flattened and preserved in history', () => {
  const { request, names } = toChat({
    tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }] }],
    input: [{ type: 'function_call', namespace: 'functions', name: 'exec_command', call_id: 'c', arguments: '{}' }],
  }, 'test');
  assert.equal(request.tools[0].function.name, 'functions__exec_command');
  assert.equal(request.messages[0].tool_calls[0].function.name, 'functions__exec_command');
  assert.deepEqual(names.get('functions__exec_command'), { name: 'exec_command', namespace: 'functions' });
});

test('local auth, upstream key isolation, SSE text and tool calls', async () => {
  const seen = [];
  const bridge = await startBridge({ key: 'fake-deepseek-key', model: 'deepseek-flash', fetchImpl: async (url, init) => {
    seen.push({ url, init });
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: 'Checking', tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } },
      { id: 'call_2', type: 'function', function: { name: 'apply_patch', arguments: '{"input":"*** Begin Patch\\n*** End Patch"}' } },
    ] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  } });
  try {
    const denied = await fetch(`${bridge.baseUrl}/responses`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    assert.equal(seen.length, 0);
    const response = await fetch(`${bridge.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify({ input: 'hello', stream: true, tools: [{ type: 'custom', name: 'apply_patch' }] }) });
    const sse = await response.text();
    assert.match(sse, /response.completed/);
    assert.match(sse, /response.function_call_arguments.done/);
    assert.match(sse, /response.custom_tool_call_input.done/);
    assert.match(sse, /"total_tokens":15/);
    assert.equal(seen[0].init.headers.Authorization, 'Bearer fake-deepseek-key');
    assert.notEqual(bridge.token, 'fake-deepseek-key');
    assert.equal(JSON.parse(seen[0].init.body).model, 'deepseek-flash');
  } finally { await bridge.close(); }
});

test('upstream failures produce an explicit stream error', async () => {
  const bridge = await startBridge({ key: 'fake', model: 'test', fetchImpl: async () => new Response('', { status: 401 }) });
  try {
    const response = await fetch(`${bridge.baseUrl}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ stream: true, input: 'hi' }) });
    assert.match(await response.text(), /DeepSeek HTTP 401/);
  } finally { await bridge.close(); }
});
