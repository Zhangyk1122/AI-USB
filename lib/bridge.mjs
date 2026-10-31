import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const id = prefix => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
function text(content) {
  if (typeof content === 'string') return content;
  return (content || []).map(p => {
    if (!['input_text', 'output_text', 'text'].includes(p.type)) throw new Error(`Demo does not support content type: ${p.type}`);
    return p.text || '';
  }).join('\n');
}

export function toChat(body, model) {
  if (body.previous_response_id) throw new Error('Demo requires full conversation input; previous_response_id is unsupported');
  const messages = [];
  if (body.instructions) messages.push({ role: 'system', content: body.instructions });
  for (const item of typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input || []) {
    if (item.type === 'reasoning') continue;
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      const call = { id: item.call_id, type: 'function', function: {
        name: item.namespace ? `${item.namespace}__${item.name}` : item.name,
        arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments,
      } };
      const last = messages.at(-1);
      if (last?.role === 'assistant' && last.tool_calls) last.tool_calls.push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) });
    } else if (!item.type || item.type === 'message') {
      messages.push({ role: item.role === 'developer' ? 'system' : item.role, content: text(item.content) });
    } else throw new Error(`Demo does not support input type: ${item.type}`);
  }
  const tools = [];
  const custom = new Set();
  const names = new Map();
  const flatten = (tools, namespace) => tools.flatMap(tool => tool.type === 'namespace' ? flatten(tool.tools || [], namespace ? `${namespace}.${tool.name}` : tool.name) : [{ ...tool, namespace }]);
  for (const raw of flatten(body.tools || [])) {
    const encoded = raw.namespace ? `${raw.namespace.replaceAll('.', '_')}__${raw.name}` : raw.name;
    const tool = { ...raw, name: encoded };
    if (raw.namespace) names.set(encoded, { name: raw.name, namespace: raw.namespace });
    if (tool.type === 'function') tools.push({ type: 'function', function: {
      name: tool.name, description: tool.description || '', parameters: tool.parameters || { type: 'object', properties: {} },
    } });
    else if (tool.type === 'custom') {
      custom.add(tool.name);
      tools.push({ type: 'function', function: { name: tool.name, description: tool.description || '',
        parameters: { type: 'object', properties: { input: { type: 'string', description: 'Full raw input for this custom tool.' } }, required: ['input'] },
      } });
    } else throw new Error(`Demo does not support tool type: ${tool.type}`);
  }
  const request = { model, messages, stream: false, thinking: { type: 'disabled' }, max_tokens: 8192 };
  if (tools.length) { request.tools = tools; request.tool_choice = 'auto'; }
  return { request, custom, names };
}

function makeResponse(chat, model, custom, names) {
  if (!chat.choices?.[0]?.message) throw new Error('Upstream returned no assistant message');
  const message = chat.choices[0].message;
  const output = [];
  if (message.content) output.push({ type: 'message', id: id('msg'), status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text: message.content, annotations: [] }] });
  for (const call of message.tool_calls || []) {
    if (custom.has(call.function.name)) {
      const value = JSON.parse(call.function.arguments);
      if (typeof value.input !== 'string') throw new Error('Invalid custom tool input');
      output.push({ type: 'custom_tool_call', id: id('ctc'), call_id: call.id, name: call.function.name, input: value.input, status: 'completed' });
    } else output.push({ type: 'function_call', id: id('fc'), call_id: call.id, name: call.function.name,
      arguments: call.function.arguments, status: 'completed' });
  }
  for (const item of output) {
    const decoded = names.get(item.name);
    if (decoded) Object.assign(item, decoded);
  }
  const usage = chat.usage || {};
  return { id: id('resp'), object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed',
    error: null, incomplete_details: chat.choices[0].finish_reason === 'length' ? { reason: 'max_output_tokens' } : null,
    model, output, parallel_tool_calls: true,
    usage: { input_tokens: usage.prompt_tokens || 0, input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0 },
      output_tokens: usage.completion_tokens || 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: usage.total_tokens || 0 },
  };
}

export async function startBridge({ key, model, token = crypto.randomBytes(32).toString('hex'), upstream = 'https://api.deepseek.com/chat/completions', fetchImpl = fetch }) {
  const controllers = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end(JSON.stringify({ error: { message: 'Invalid local bridge token' } })); return;
    }
    if (req.method !== 'POST' || !['/v1/responses', '/responses'].includes(req.url)) { res.writeHead(404).end(); return; }
    const controller = new AbortController();
    controllers.add(controller);
    let heartbeat;
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('Request exceeds 16 MiB'); chunks.push(chunk); }
      let bytes = Buffer.concat(chunks);
      const encoding = req.headers['content-encoding'];
      const opts = { maxOutputLength: 16 * 1024 * 1024 };
      if (encoding === 'gzip') bytes = zlib.gunzipSync(bytes, opts);
      else if (encoding === 'zstd') bytes = zlib.zstdDecompressSync(bytes, opts);
      else if (encoding && encoding !== 'identity') throw new Error('Unsupported request encoding');
      const body = JSON.parse(bytes);
      const { request, custom, names } = toChat(body, model);
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': bridge waiting for DeepSeek\n\n');
        heartbeat = setInterval(() => res.write(': keepalive\n\n'), 10000);
      }
      const upstreamResponse = await fetchImpl(upstream, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
      });
      if (!upstreamResponse.ok) throw new Error(`DeepSeek HTTP ${upstreamResponse.status}; check API key, model and balance`);
      const result = makeResponse(await upstreamResponse.json(), model, custom, names);
      if (result.incomplete_details) result.status = 'incomplete';
      clearInterval(heartbeat);
      if (!body.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result)); return; }
      let seq = 0;
      const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
      emit('response.created', { response: { ...result, status: 'in_progress', output: [], usage: null } });
      emit('response.in_progress', { response: { ...result, status: 'in_progress', output: [], usage: null } });
      result.output.forEach((item, output_index) => {
        const initial = { ...item, status: 'in_progress' };
        if (item.type === 'message') initial.content = [];
        if (item.type === 'function_call') initial.arguments = '';
        if (item.type === 'custom_tool_call') initial.input = '';
        emit('response.output_item.added', { output_index, item: initial });
        if (item.type === 'message') {
          emit('response.content_part.added', { item_id: item.id, output_index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
          emit('response.output_text.delta', { item_id: item.id, output_index, content_index: 0, delta: item.content[0].text });
          emit('response.output_text.done', { item_id: item.id, output_index, content_index: 0, text: item.content[0].text });
          emit('response.content_part.done', { item_id: item.id, output_index, content_index: 0, part: item.content[0] });
        } else if (item.type === 'function_call') {
          emit('response.function_call_arguments.delta', { item_id: item.id, output_index, delta: item.arguments });
          emit('response.function_call_arguments.done', { item_id: item.id, output_index, arguments: item.arguments });
        } else {
          emit('response.custom_tool_call_input.delta', { item_id: item.id, output_index, delta: item.input });
          emit('response.custom_tool_call_input.done', { item_id: item.id, output_index, input: item.input });
        }
        emit('response.output_item.done', { output_index, item });
      });
      emit(result.status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response: result });
      res.end();
    } catch (error) {
      clearInterval(heartbeat);
      const payload = { error: { type: 'bridge_error', message: error.message } };
      if (res.headersSent) res.end(`event: error\ndata: ${JSON.stringify({ type: 'error', ...payload })}\n\n`);
      else res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
    } finally { controllers.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { token, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise(resolve => {
    for (const controller of controllers) controller.abort();
    server.close(resolve); server.closeAllConnections();
  }) };
}
