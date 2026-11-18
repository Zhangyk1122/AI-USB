import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM } from './preflight.mjs';

export const PROFILE = 'web';

// Short names for the experimental bundles that ship inside the package.
export const PLUGIN_ALIASES = {
  'session-search': '@deepseek-ai/dsh-experimental-session-search',
  'session-titles': '@deepseek-ai/dsh-experimental-session-titles-bundle',
  'terminal': '@deepseek-ai/dsh-experimental-terminal-bundle',
  'voice-input': '@deepseek-ai/dsh-experimental-voice-input-bundle',
  'cot-translation': '@deepseek-ai/dsh-experimental-cot-translation-bundle',
  'auto-review': '@deepseek-ai/dsh-experimental-auto-review',
  'agent-team': '@deepseek-ai/dsh-experimental-agent-team-profile',
  'plugin-market': '@deepseek-ai/dsh-experimental-plugin-market-bundle',
  'inspector': '@deepseek-ai/dsh-experimental-inspector-profile',
  'tool-worktree': '@deepseek-ai/dsh-experimental-tool-worktree',
  'badge-skill': '@deepseek-ai/dsh-experimental-badge-skill-bundle',
  'ralph': '@deepseek-ai/dsh-experimental-ralph-bundle',
};

export function profileFile(root, profile = PROFILE) {
  return path.join(root, 'data', 'harness', 'profiles', profile, 'package.json');
}

export function readProfile(root, profile = PROFILE) {
  try {
    const file = profileFile(root, profile);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundles = json?.dsh?.profile?.bundles;
    return { file, json, bundles: Array.isArray(bundles) ? bundles : [] };
  } catch { return null; }
}

export function expandPluginName(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('插件名为空');
  if (value.startsWith('@')) return value;
  const full = PLUGIN_ALIASES[value];
  if (!full) throw new Error('未知插件：' + value + '；可用别名：' + Object.keys(PLUGIN_ALIASES).join(', '));
  return full;
}

export function shortName(pkg) {
  for (const [alias, full] of Object.entries(PLUGIN_ALIASES)) if (full === pkg) return alias;
  return pkg;
}

function bundleExists(root, pkg) {
  try { return fs.statSync(path.join(root, 'platforms', PLATFORM, 'node_modules', pkg, 'package.json')).isFile(); }
  catch { return false; }
}

export function planPlugins(root, names, profile = PROFILE) {
  const data = readProfile(root, profile);
  if (!data) throw new Error('profile 尚未生成（' + profileFile(root, profile) + '）；先启动一次 dsh.bat，再运行本命令');
  const added = [], present = [], missing = [];
  for (const name of names) {
    const pkg = expandPluginName(name);
    if (!bundleExists(root, pkg)) { missing.push(pkg); continue; }
    if (data.bundles.includes(pkg)) present.push(pkg); else if (!added.includes(pkg)) added.push(pkg);
  }
  return { data, added, present, missing, bundles: [...data.bundles, ...added] };
}

export function applyPlugins(root, names, { profile = PROFILE, write = true } = {}) {
  const plan = planPlugins(root, names, profile);
  if (write && plan.added.length) {
    plan.data.json.dsh.profile.bundles = plan.bundles;
    const temp = plan.data.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(plan.data.json, null, 2) + '\n');
    fs.renameSync(temp, plan.data.file);
  }
  return plan;
}

export function removePlugins(root, names, { profile = PROFILE, write = true } = {}) {
  const data = readProfile(root, profile);
  if (!data) throw new Error('profile 尚未生成；先启动一次 dsh.bat');
  const targets = new Set(names.map(expandPluginName));
  const kept = data.bundles.filter(pkg => !targets.has(pkg));
  const removed = data.bundles.filter(pkg => targets.has(pkg));
  if (write && removed.length) {
    data.json.dsh.profile.bundles = kept;
    const temp = data.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data.json, null, 2) + '\n');
    fs.renameSync(temp, data.file);
  }
  return { removed, bundles: kept };
}

// Declarative list shipped next to dsh.bat: one alias or package name per line, # comments allowed.
export function declaredPlugins(root) {
  // data/ survives whole-package updates and is covered by maintenance backups.
  const file = path.join(root, 'data', 'plugins.txt');
  if (!fs.existsSync(file)) return null;
  const names = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
  return { file, names };
}

export function applyDeclaredPlugins(root, options = {}) {
  const declared = declaredPlugins(root);
  if (!declared || !declared.names.length) return null;
  return applyPlugins(root, declared.names, options);
}

function status(root) {
  const data = readProfile(root);
  const enabled = new Set(data ? data.bundles : []);
  const rows = Object.entries(PLUGIN_ALIASES).map(([alias, pkg]) => ({
    alias, pkg, enabled: enabled.has(pkg), available: bundleExists(root, pkg),
  }));
  return { profile: data ? data.file : null, rows };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [command = 'list', ...args] = process.argv.slice(2);
  if (command === 'list') {
    const result = status(root);
    if (!result.profile) { console.log('profile 尚未生成：先启动一次 dsh.bat'); return; }
    for (const row of result.rows) {
      console.log('[' + (row.enabled ? '启用' : row.available ? '可启用' : '未随包') + '] ' + row.alias.padEnd(16) + row.pkg);
    }
    return;
  }
  if (command === 'add' || command === 'apply') {
    const names = command === 'apply' ? (declaredPlugins(root)?.names || []) : args;
    if (!names.length) { console.log('没有要启用的插件'); return; }
    const plan = applyPlugins(root, names);
    console.log('已启用：' + (plan.added.map(shortName).join(', ') || '（无变化）'));
    if (plan.present.length) console.log('早已启用：' + plan.present.map(shortName).join(', '));
    if (plan.missing.length) console.log('未随包提供：' + plan.missing.join(', '));
    return;
  }
  if (command === 'remove') {
    if (!args.length) throw new Error('remove 需要插件名');
    const result = removePlugins(root, args);
    console.log('已停用：' + (result.removed.map(shortName).join(', ') || '（无变化）'));
    return;
  }
  throw new Error('Usage: plugins.mjs [list | add <名称...> | remove <名称...> | apply]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('插件操作失败：' + error.message); process.exitCode = 1; }
}
