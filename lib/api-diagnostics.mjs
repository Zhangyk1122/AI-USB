import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse as parseToml } from './vendor/smol-toml/index.cjs';
import { cleanProviderEnv } from './agent-plan.mjs';

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const optionalJSON = file => fs.existsSync(file) ? json(file) : {};
function credential(value, env) {
  if (typeof value !== 'string') return '';
  const match = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value);
  return match ? (env[match[1]] || '') : value;
}
export function apiTargets(root, { mode = 'cc', agent = 'all', parentEnv = process.env, platform = `${process.platform}-${process.arch}` } = {}) {
  if (mode === 'direct') return [{ name: 'DeepSeek 官方直连', url: 'https://api.deepseek.com/models', key: parentEnv.DEEPSEEK_API_KEY || '' }];
  const base = path.join(root, 'data/cc-switch/agents'), targets = [], inherited = cleanProviderEnv(parentEnv);
  for (const name of (agent === 'all' ? ['codex', 'claude', 'harness'] : [agent])) {
    try {
      const home = path.join(base, name);
      if (name === 'codex') {
        const file = path.join(home, 'config.toml');
        if (!fs.existsSync(file)) { targets.push({ name, skip: '尚未在 CC Switch 配置该 Agent' }); continue; }
        const config = parseToml(fs.readFileSync(file, 'utf8'));
        const provider = config.model_providers?.[config.model_provider];
        if (!provider?.base_url) { targets.push({ name, skip: '当前不是自定义 API 供应商；账号登录检查需在 Agent 内进行' }); continue; }
        const auth = optionalJSON(path.join(home, 'auth.json'));
        const headers = { ...(provider.http_headers || {}) };
        for (const [header, variable] of Object.entries(provider.env_http_headers || {})) if (inherited[variable]) headers[header] = inherited[variable];
        const key = provider.env_key ? inherited[provider.env_key] : (provider.experimental_bearer_token || auth.OPENAI_API_KEY);
        targets.push({ name, base: provider.base_url, key: key || '', headers });
      } else if (name === 'claude') {
        const file = path.join(home, 'settings.json');
        if (!fs.existsSync(file)) { targets.push({ name, skip: '尚未在 CC Switch 配置该 Agent' }); continue; }
        const config = json(file), env = config.env || {};
        if (!env.ANTHROPIC_BASE_URL) { targets.push({ name, skip: '未设置 API 地址；账号登录或动态凭据需在 Agent 内验证' }); continue; }
        targets.push({ name, base: env.ANTHROPIC_BASE_URL,
          key: credential(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY, env),
          anthropic: !/api\.deepseek\.com/i.test(env.ANTHROPIC_BASE_URL), apiKeyHeader: !env.ANTHROPIC_AUTH_TOKEN });
      } else if (name === 'harness') {
        const file = path.join(home, 'profiles/web/cordis.patch.yml');
        if (!fs.existsSync(file)) { targets.push({ name, skip: '尚未在 CC Switch 配置该 Agent' }); continue; }
        const require = createRequire(path.join(root, 'platforms', platform, 'package.json'));
        const { parse } = require('yaml');
        const patch = parse(fs.readFileSync(file, 'utf8'));
        const credentialsFile = path.join(home, '.credentials.yaml');
        const refs = fs.existsSync(credentialsFile) ? parse(fs.readFileSync(credentialsFile, 'utf8'))?.refs || {} : {};
        let found = false;
        const visit = value => {
          if (!value || typeof value !== 'object') return;
          if (value.providers && typeof value.providers === 'object') for (const [providerId, provider] of Object.entries(value.providers)) {
            if (!provider?.baseURL) continue;
            found = true;
            targets.push({ name: `harness/${providerId}`, base: provider.baseURL,
              key: credential(provider.apiKey, refs) || refs[provider.apiKeyEnv] || '', anthropic: provider.api === 'anthropic-messages', apiKeyHeader: true });
          }
          for (const [key, child] of Object.entries(value)) if (key !== 'providers') visit(child);
        };
        visit(patch);
        if (!found) targets.push({ name, skip: 'profile 中没有可直接检查的 API 供应商' });
      } else throw new Error('请选择 codex、claude 或 harness');
    } catch {
      // Parser exceptions may quote the input line, including secrets. Never print them.
      targets.push({ name, invalid: '配置解析失败；请在 CC Switch 检查该 Agent 的配置文件格式' });
    }
  }
  return targets;
}
export function modelEndpoint(target) {
  const url = new URL(target.url || target.base);
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('API 地址必须使用 HTTPS；本机回环地址可使用 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('诊断不接受在 URL 中携带凭据或查询参数的地址');
  if (url.hostname === 'api.deepseek.com') { url.pathname = '/models'; return url; }
  if (!target.url) {
    const base = url.pathname.replace(/\/+$/, '').replace(/\/(?:responses|messages|chat\/completions)$/, '');
    url.pathname = `${base}${target.anthropic && !/\/v1$/.test(base) ? '/v1' : ''}/models`;
  }
  return url;
}
export async function checkTarget(target, { fetchImpl = fetch, timeout = 12000 } = {}) {
  const row = (status, detail) => ({ status, name: target.name, detail });
  if (target.skip) return row('SKIP', target.skip);
  if (target.invalid) return row('FAIL', target.invalid);
  if (!target.key && !Object.keys(target.headers || {}).some(h => /^(authorization|x-api-key|api-key)$/i.test(h))) return row('SKIP', '未找到静态 Key；请配置或在 Agent 内验证动态认证');
  let url;
  try { url = modelEndpoint(target); } catch (e) { return row('FAIL', e.message); }
  const headers = { ...(target.headers || {}) };
  if (target.key) {
    if (target.anthropic && target.apiKeyHeader) {
      if (!Object.keys(headers).some(h => h.toLowerCase() === 'x-api-key')) headers['x-api-key'] = target.key;
    } else if (!Object.keys(headers).some(h => h.toLowerCase() === 'authorization')) headers.Authorization = `Bearer ${target.key}`;
  }
  if (target.anthropic) headers['anthropic-version'] = '2023-06-01';
  try {
    const response = await fetchImpl(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    // Never persist response bodies: a provider can echo credentials in an error.
    if (!response.ok) {
      await response.body?.cancel();
      const meaning = { 401: 'Key 无效或认证方式不匹配', 403: '账户权限或接口访问被拒绝', 402: '账户余额或付款限制', 429: '请求频率或额度限制' }[response.status];
      if ([404, 405].includes(response.status)) return row('WARN', '接口可达，但不提供模型列表；尚不能验证模型调用');
      return row('FAIL', `HTTP ${response.status}：${meaning || '供应商接口异常'}`);
    }
    let text = '', size = 0;
    if (!response.body) return row('WARN', '接口返回空响应，未验证模型列表');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) return row('WARN', '模型列表响应过大，已停止读取');
      text += Buffer.from(chunk).toString('utf8');
    }
    let body;
    try { body = JSON.parse(text); } catch { return row('WARN', '接口有响应，但没有返回 JSON 模型列表'); }
    if (!Array.isArray(body.data)) return row('WARN', '接口有响应，但模型列表格式不同；请在 Agent 内进一步验证');
    return row('OK', `API 可达并返回 ${body.data.length} 个模型；未发送会话或工作区内容，也未发起推理请求`);
  } catch (e) {
    const code = e.cause?.code || e.code;
    return row('FAIL', e.name === 'TimeoutError' || e.name === 'AbortError' ? '网络请求超时' :
      ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? '域名解析失败' : code === 'ECONNREFUSED' ? '连接被拒绝；本地供应商代理可能未启动' : '网络、TLS 或重定向检查失败；请检查供应商地址与网络');
  }
}
export async function checkAPIs(root, options = {}) {
  const targets = apiTargets(root, options);
  const rows = [];
  // Bound parallelism so failed endpoints cannot flood the network.
  for (let i = 0; i < targets.length; i += 3) rows.push(...await Promise.all(targets.slice(i, i + 3).map(t => checkTarget(t, options))));
  return rows;
}
