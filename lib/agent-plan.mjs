import fs from 'node:fs';
import path from 'node:path';
import { startBridge } from './bridge.mjs';
import { portableCache } from './portable-cache.mjs';

export function ccPaths(root) {
  const base = path.join(root, 'data', 'cc-switch');
  const home = path.join(base, 'controller-home');
  return {
    home, controller: path.join(home, '.cc-switch'),
    codex: path.join(base, 'agents', 'codex'),
    claude: path.join(base, 'agents', 'claude'),
    harness: path.join(base, 'agents', 'harness'),
  };
}

export function cleanProviderEnv(parentEnv) {
  return Object.fromEntries(Object.entries(parentEnv).filter(([name]) =>
    !/^(OPENAI_|ANTHROPIC_|CLAUDE_|CODEX_|DSH_|DEEPSEEK_|CC_SWITCH_|AI_USB_BRIDGE_TOKEN$)/i.test(name)));
}

export function runtimeEnv(root, parentEnv, node, hostPlatform) {
  const env = cleanProviderEnv(parentEnv);
  const pathKey = Object.keys(env).find(name => name.toLowerCase() === 'path');
  const originalPath = pathKey ? env[pathKey] : '';
  if (pathKey) delete env[pathKey];
  const entries = [path.dirname(node)];
  if (hostPlatform === 'win32') {
    const git = path.join(root, 'platforms', 'win32-x64', 'git');
    entries.push(path.join(git, 'cmd'), path.join(git, 'usr', 'bin'));
    env.CLAUDE_CODE_GIT_BASH_PATH = path.join(git, 'bin', 'bash.exe');
  }
  env.PATH = [...entries, originalPath].filter(Boolean).join(hostPlatform === 'win32' ? ';' : ':');
  const cache = portableCache(root, { parentEnv, hostPlatform });
  Object.assign(env, cache.env);
  env.AI_USB_CACHE_LOCAL = cache.local ? '1' : '0';
  return env;
}

export async function buildAgentPlan({
  root, agent, extra = [], parentEnv = process.env,
  hostPlatform = process.platform, arch = process.arch,
  node = process.execPath, bridgeFactory = startBridge,
}) {
  if (!['codex', 'claude', 'harness'].includes(agent)) throw new Error('Choose codex, claude or harness.');
  const platform = `${hostPlatform}-${arch}`;
  if (!['darwin-arm64', 'win32-x64'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  const managed = extra.includes('--cc-switch');
  extra = extra.filter(arg => arg !== '--cc-switch');
  const infoOnly = extra.some(arg => ['--help', '--version', '-h', '-V'].includes(arg));
  const key = parentEnv.DEEPSEEK_API_KEY;
  if (!managed && !infoOnly && !key) throw new Error('DEEPSEEK_API_KEY is missing; use the direct launcher to enter it privately.');
  const env = runtimeEnv(root, parentEnv, node, hostPlatform);
  const apps = path.join(root, 'platforms', platform, 'node_modules');
  const cwd = parentEnv.AI_USB_WORKSPACE ? path.resolve(parentEnv.AI_USB_WORKSPACE) : path.join(root, 'workspace');
  const home = managed ? ccPaths(root)[agent] : path.join(root, 'data', agent);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  if (managed && !infoOnly) {
    const file = agent === 'codex' ? 'config.toml' : agent === 'claude' ? 'settings.json' : 'profiles/web/cordis.patch.yml';
    if (!fs.existsSync(path.join(home, file))) {
      throw new Error(`CC Switch configuration missing for ${agent}. Open Mac-CC-Switch.command / Windows-CC-Switch.bat, add and enable a provider for this Agent, then retry.\nExpected: ${path.join(home, file)}`);
    }
  }
  const settings = managed ? null : JSON.parse(fs.readFileSync(path.join(root, 'config', 'settings.json'), 'utf8'));
  let command = node, args, bridge;
  if (agent === 'codex') {
    env.CODEX_HOME = home;
    if (!managed && !infoOnly) {
      bridge = await bridgeFactory({ key, model: settings.model });
      env.AI_USB_BRIDGE_TOKEN = bridge.token;
      const config = `web_search = "disabled"\nmodel_provider = "deepseek_usb"\nmodel = ${JSON.stringify(settings.model)}\n[model_providers.deepseek_usb]\nname = "DeepSeek USB bridge"\nbase_url = ${JSON.stringify(bridge.baseUrl)}\nenv_key = "AI_USB_BRIDGE_TOKEN"\nwire_api = "responses"\nsupports_websockets = false\n`;
      try { fs.writeFileSync(path.join(home, 'config.toml'), config, { mode: 0o600 }); }
      catch (error) { await bridge.close(); throw error; }
    }
    args = [path.join(apps, '@openai', 'codex', 'bin', 'codex.js'), ...extra];
  } else if (agent === 'claude') {
    env.CLAUDE_CONFIG_DIR = home;
    if (!managed) {
      env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';
      env.ANTHROPIC_AUTH_TOKEN = key || '';
      for (const name of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) env[name] = settings.model;
    }
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    env.DISABLE_AUTOUPDATER = '1';
    command = path.join(apps, '@anthropic-ai', `claude-code-${platform}`, hostPlatform === 'win32' ? 'claude.exe' : 'claude');
    if (!fs.existsSync(command)) throw new Error(`Missing native Claude executable: ${command}`);
    args = extra;
  } else {
    env.DSH_HOME = home;
    env.DSH_AGENTS_HOME = path.join(home, 'agents');
    if (!managed) {
      env.DEEPSEEK_API_KEY = key || '';
      env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
    }
    env.DSH_TELEMETRY_DISABLED = '1';
    args = [path.join(apps, '@deepseek-ai', 'dsh', 'lib', 'bin.js'), ...(extra.length ? extra : ['web'])];
  }
  return { command, args, cwd, env, bridge, platform, mode: managed ? 'CC Switch' : 'DeepSeek direct' };
}
