import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { ccPaths, runtimeEnv } from './agent-plan.mjs';
import { assertRuntime, failureReason } from './preflight.mjs';
import { acquireLease } from './state-lock.mjs';
import { recordRun } from './portable-cache.mjs';

export const CC_SWITCH_VERSION = '4.0.22';

// These directory overrides are owned by the portable launcher. Provider content stays CC-owned.
export function prepareCCSwitch(root, {
  parentEnv = process.env, node = process.execPath, hostPlatform = process.platform,
} = {}) {
  const paths = ccPaths(root);
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
  const settingsFile = path.join(paths.controller, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read portable CC Switch settings; original file preserved: ${error.message}`); }
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('Portable CC Switch settings must be a JSON object; original file preserved.');
  const visibleApps = {
    claude: true, codex: true, dsh: true,
    'claude-desktop': false, gemini: false, grokbuild: false, opencode: false,
    openclaw: false, hermes: false, pi: false, omp: false, mcode: false, kimi: false, agy: false,
  };
  const next = {
    language: 'zh', minimizeToTrayOnClose: false, launchOnStartup: false,
    appOrder: ['claude', 'codex', 'dsh'],
    ...settings,
    claudeConfigDir: paths.claude, codexConfigDir: paths.codex,
    visibleApps: settings.visibleApps ?? visibleApps,
  };
  const text = JSON.stringify(next, null, 2) + '\n';
  if (!fs.existsSync(settingsFile) || fs.readFileSync(settingsFile, 'utf8') !== text) {
    const temporary = settingsFile + '.usb-tmp';
    fs.writeFileSync(temporary, text, { mode: 0o600 });
    fs.renameSync(temporary, settingsFile);
  }
  const env = runtimeEnv(root, parentEnv, node, hostPlatform);
  // Pinned upstream test/debug override, not a stable portable API. See CC-SWITCH.md.
  env.CC_SWITCH_TEST_HOME = paths.home;
  env.CODEX_HOME = paths.codex;
  env.CLAUDE_CONFIG_DIR = paths.claude;
  env.DSH_HOME = paths.harness;
  env.DSH_AGENTS_HOME = path.join(paths.harness, 'agents');
  env.DSH_TELEMETRY_DISABLED = '1';
  return { paths, env };
}

export function hostStoreFiles({ hostPlatform = process.platform, parentEnv = process.env, hostHome = os.homedir() } = {}) {
  const base = hostPlatform === 'darwin'
    ? [path.join(hostHome, 'Library', 'Application Support')]
    : [parentEnv.APPDATA || path.join(hostHome, 'AppData', 'Roaming'), parentEnv.LOCALAPPDATA || path.join(hostHome, 'AppData', 'Local')];
  return [...new Set(base.map(dir => path.join(dir, 'com.ccswitch.desktop', 'app_paths.json')))];
}

export function assertHostStoreIsDefault(options = {}) {
  for (const file of hostStoreFiles(options)) {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')).app_config_dir_override; }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error(`Cannot check host CC Switch data-directory override: ${file}. ${error.message}`);
    }
    if (typeof value === 'string' && value.trim()) {
      throw new Error(`Host CC Switch has a custom data-directory override. It takes priority over portable isolation. Clear that override in the host CC Switch settings and exit it before using USB CC Switch. Host file was not changed: ${file}`);
    }
  }
}

export function assertNoRunningInstance({ hostPlatform = process.platform, exec = execFileSync } = {}) {
  const listing = hostPlatform === 'win32'
    ? exec('tasklist.exe', ['/FI', 'IMAGENAME eq cc-switch.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
    : exec('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' });
  const running = hostPlatform === 'win32'
    ? /^"cc-switch\.exe",/im.test(listing)
    : listing.split('\n').some(line => /(?:^|\/)cc-switch$/i.test(line.trim()));
  if (running) throw new Error('CC Switch is already running. Fully quit it (including its tray/menu-bar icon), then open the USB launcher. This avoids activating a host instance with different configuration paths.');
}

export function ccSwitchExecutable(root, hostPlatform = process.platform) {
  return hostPlatform === 'darwin'
    ? path.join(root, 'platforms', 'darwin-arm64', 'cc-switch', 'CC Switch.app', 'Contents', 'MacOS', 'cc-switch')
    : path.join(root, 'platforms', 'win32-x64', 'cc-switch', 'cc-switch.exe');
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--paths', '--prepare', '--help'].includes(args[0]))) throw new Error('Usage: cc-switch.mjs [--paths | --prepare | --help]');
  if (args.includes('--help')) {
    console.log('Open the bundled CC Switch with USB configuration. --paths prints directories; --prepare refreshes portable directory settings without opening the GUI.');
    return;
  }
  if (args.includes('--paths')) { console.log(JSON.stringify(ccPaths(root), null, 2)); return; }
  if (!['darwin-arm64', 'win32-x64'].includes(`${process.platform}-${process.arch}`)) throw new Error('This demo supports Apple Silicon Mac and Windows x64.');
  if (args.includes('--prepare')) {
    const lease = acquireLease(root, 'cc-switch-prepare');
    try { console.log(JSON.stringify(prepareCCSwitch(root).paths, null, 2)); }
    finally { lease.release(); }
    return;
  }
  const executable = ccSwitchExecutable(root);
  assertRuntime(root, { agent: 'cc-switch' });
  if (!fs.existsSync(executable)) throw new Error(`Bundled CC Switch missing: ${executable}`);
  assertNoRunningInstance();
  assertHostStoreIsDefault();
  const lease = acquireLease(root, 'cc-switch');
  try {
    const { paths, env } = prepareCCSwitch(root);
    console.error(`CC Switch ${CC_SWITCH_VERSION} | USB data: ${paths.controller}\nConfigure providers here, then use the Mac-CC-* / Windows-CC-* Agent launchers.\nKeep this terminal open until CC Switch exits.`);
    const child = spawn(executable, [], { cwd: root, env, stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '', exitSignal;
    child.stderr.on('data', chunk => { process.stderr.write(chunk); stderr = (stderr + chunk.toString()).slice(-16384); });
    child.once('spawn', () => lease.child(child.pid));
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => { exitSignal = signal; resolve(code ?? (signal ? 130 : 1)); });
      });
      const reason = process.exitCode ? failureReason({ code: process.exitCode, signal: exitSignal, stderr }) : undefined;
      recordRun(env.AI_USB_CACHE_DIR, { program: 'cc-switch', status: process.exitCode ? 'failed' : 'ok', code: process.exitCode, signal: exitSignal, reason });
      if (reason) console.error(`启动诊断：${reason}`);
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  } finally { lease.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`USB CC Switch: ${error.message}`); process.exitCode = 1; });
}
