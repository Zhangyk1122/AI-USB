import fs from 'node:fs';
import path from 'node:path';
import { portableCache } from './portable-cache.mjs';

export const PLATFORM = 'win32-x64';
export const AGENT = 'harness';

export function harnessPaths(root) {
  const home = path.join(root, 'data', 'harness');
  return { home, agents: path.join(home, 'agents') };
}

// Only the portable launcher's own variables are cleared; provider settings stay untouched.
export function cleanPortableEnv(parentEnv) {
  return Object.fromEntries(Object.entries(parentEnv).filter(([name]) =>
    !/^(?:DSH_HOME|DSH_AGENTS_HOME|DSH_TELEMETRY_DISABLED|AI_USB_CACHE_DIR|AI_USB_CACHE_LOCAL)$/i.test(name)));
}

export function runtimeEnv(root, parentEnv, node, hostPlatform) {
  const env = cleanPortableEnv(parentEnv);
  const pathKey = Object.keys(env).find(name => name.toLowerCase() === 'path');
  const originalPath = pathKey ? env[pathKey] : '';
  if (pathKey) delete env[pathKey];
  const entries = [path.dirname(node)];
  // Bundled pnpm lets the web plugin manager install third-party plugins without a host install.
  if (hostPlatform === 'win32') entries.push(path.join(root, 'platforms', PLATFORM, 'pnpm'));
  env.PATH = [...entries, originalPath].filter(Boolean).join(hostPlatform === 'win32' ? ';' : ':');
  const cache = portableCache(root, { parentEnv, hostPlatform });
  Object.assign(env, cache.env);
  env.AI_USB_CACHE_LOCAL = cache.local ? '1' : '0';
  return env;
}

export async function buildAgentPlan({ root, extra = [], parentEnv = process.env, hostPlatform = process.platform, node = process.execPath }) {
  if (hostPlatform !== 'win32') {
    throw new Error('本 Demo 只包含 Windows x64 运行时；请把整个目录复制到 Windows 电脑后双击 dsh.bat。');
  }
  const env = runtimeEnv(root, parentEnv, node, hostPlatform);
  const apps = path.join(root, 'platforms', PLATFORM, 'node_modules');
  const cwd = parentEnv.AI_USB_WORKSPACE ? path.resolve(parentEnv.AI_USB_WORKSPACE) : path.join(root, 'workspace');
  const { home, agents } = harnessPaths(root);
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  env.DSH_HOME = home;
  env.DSH_AGENTS_HOME = agents;
  env.DSH_TELEMETRY_DISABLED = '1';
  // No API key is injected: DSH keeps its own default configuration.
  const args = [path.join(apps, '@deepseek-ai', 'dsh', 'lib', 'bin.js'), ...(extra.length ? extra : ['web'])];
  return { command: node, args, cwd, env, platform: PLATFORM, mode: 'DSH' };
}
