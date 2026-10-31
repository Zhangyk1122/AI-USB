import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAgentPlan, ccPaths } from '../lib/agent-plan.mjs';
import { prepareCCSwitch, assertHostStoreIsDefault, assertNoRunningInstance } from '../lib/cc-switch.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb cc switch '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const executable = path.join(root, 'platforms', platform, 'node_modules', '@anthropic-ai', `claude-code-${platform}`, platform.startsWith('win') ? 'claude.exe' : 'claude');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'fixture');
  }
  return root;
}

const inherited = {
  PATH: '/bin', OPENAI_API_KEY: 'host-key', OPENAI_BASE_URL: 'https://host.invalid',
  ANTHROPIC_AUTH_TOKEN: 'host-token', ANTHROPIC_MODEL: 'host-model',
  DEEPSEEK_API_KEY: 'host-deepseek-key', DEEPSEEK_BASE_URL: 'https://host.invalid',
  CODEX_HOME: '/host/codex', CLAUDE_CONFIG_DIR: '/host/claude', DSH_HOME: '/host/dsh',
  CC_SWITCH_TEST_HOME: '/host/cc', AI_USB_BRIDGE_TOKEN: 'old-token',
};

test('managed Agents use CC-owned config, ignore inherited providers, and never start the bridge', async t => {
  const root = fixture(t);
  const paths = ccPaths(root);
  const files = { codex: 'config.toml', claude: 'settings.json', harness: 'profiles/web/cordis.patch.yml' };
  const vars = { codex: 'CODEX_HOME', claude: 'CLAUDE_CONFIG_DIR', harness: 'DSH_HOME' };
  for (const agent of Object.keys(files)) {
    const file = path.join(paths[agent], files[agent]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = Buffer.from(`# CC Switch-owned ${agent}\r\n`);
    fs.writeFileSync(file, content);
    const plan = await buildAgentPlan({ root, agent, extra: ['--cc-switch'], parentEnv: inherited,
      hostPlatform: 'darwin', arch: 'arm64', bridgeFactory: () => { throw new Error('must not bridge'); } });
    assert.equal(plan.env[vars[agent]], paths[agent]);
    for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'CC_SWITCH_TEST_HOME', 'AI_USB_BRIDGE_TOKEN']) assert.equal(plan.env[name], undefined, name);
    assert.equal(plan.bridge, undefined);
    assert.ok(!plan.args.includes('--cc-switch'));
    assert.deepEqual(fs.readFileSync(file), content);
    assert.ok(!fs.existsSync(path.join(root, 'data', agent)), 'direct home must stay untouched');
  }
});

test('managed startup works without a key; missing providers give a useful error', async t => {
  const root = fixture(t);
  for (const agent of ['codex', 'claude', 'harness']) {
    await assert.rejects(buildAgentPlan({ root, agent, extra: ['--cc-switch'], parentEnv: {}, hostPlatform: 'darwin', arch: 'arm64' }), /CC Switch configuration missing/);
    const plan = await buildAgentPlan({ root, agent, extra: ['--cc-switch', '--version'], parentEnv: {}, hostPlatform: 'darwin', arch: 'arm64' });
    assert.equal(plan.mode, 'CC Switch');
  }
});

test('direct Codex retains its own bridge and never changes managed config', async t => {
  const root = fixture(t);
  const managedFile = path.join(ccPaths(root).codex, 'config.toml');
  fs.mkdirSync(path.dirname(managedFile), { recursive: true });
  fs.writeFileSync(managedFile, 'cc-owned');
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/settings.json'), '{"model":"direct-model"}');
  let calls = 0;
  const bridge = { token: 'local-token', baseUrl: 'http://127.0.0.1:1234/v1', close: async () => {} };
  const plan = await buildAgentPlan({ root, agent: 'codex', parentEnv: { DEEPSEEK_API_KEY: 'direct-key' }, hostPlatform: 'darwin', arch: 'arm64',
    bridgeFactory: async options => { calls++; assert.deepEqual(options, { key: 'direct-key', model: 'direct-model' }); return bridge; } });
  assert.equal(calls, 1);
  assert.equal(plan.env.CODEX_HOME, path.join(root, 'data/codex'));
  assert.equal(plan.env.AI_USB_BRIDGE_TOKEN, bridge.token);
  assert.match(fs.readFileSync(path.join(plan.env.CODEX_HOME, 'config.toml'), 'utf8'), /direct-model/);
  assert.equal(fs.readFileSync(managedFile, 'utf8'), 'cc-owned');
  await assert.rejects(buildAgentPlan({ root, agent: 'codex', parentEnv: {}, hostPlatform: 'darwin', arch: 'arm64' }), /DEEPSEEK_API_KEY is missing/);
});

test('manager refreshes paths after a move and preserves provider DB, agent configs and other settings', t => {
  const root = fixture(t);
  const { paths } = prepareCCSwitch(root, { parentEnv: inherited });
  const settingsFile = path.join(paths.controller, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsFile));
  settings.unknownFutureSetting = { keep: true };
  settings.language = 'en';
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
  fs.writeFileSync(path.join(paths.controller, 'cc-switch.db'), Buffer.from([1, 2, 3, 255]));
  fs.writeFileSync(path.join(paths.codex, 'config.toml'), '# exact config\r\n');
  const moved = path.join(root, 'new drive with spaces');
  fs.mkdirSync(moved);
  fs.renameSync(path.join(root, 'data'), path.join(moved, 'data'));
  const prepared = prepareCCSwitch(moved, { parentEnv: inherited });
  const updated = JSON.parse(fs.readFileSync(path.join(prepared.paths.controller, 'settings.json')));
  assert.equal(updated.codexConfigDir, path.join(moved, 'data/cc-switch/agents/codex'));
  assert.equal(updated.claudeConfigDir, prepared.paths.claude);
  assert.deepEqual(updated.unknownFutureSetting, { keep: true });
  assert.equal(updated.language, 'en');
  assert.deepEqual(fs.readFileSync(path.join(prepared.paths.controller, 'cc-switch.db')), Buffer.from([1, 2, 3, 255]));
  assert.equal(fs.readFileSync(path.join(prepared.paths.codex, 'config.toml'), 'utf8'), '# exact config\r\n');
  assert.equal(prepared.env.CC_SWITCH_TEST_HOME, prepared.paths.home);
  assert.equal(prepared.env.DSH_HOME, prepared.paths.harness);
  assert.equal(prepared.env.DEEPSEEK_API_KEY, undefined);
  assert.equal(prepared.env.OPENAI_API_KEY, undefined);
});

test('invalid portable settings are preserved instead of overwritten', t => {
  const root = fixture(t);
  const { paths } = prepareCCSwitch(root);
  const file = path.join(paths.controller, 'settings.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => prepareCCSwitch(root), /original file preserved/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('host data-directory override blocks the GUI without changing the host store', t => {
  const root = fixture(t);
  const file = path.join(root, 'Library/Application Support/com.ccswitch.desktop/app_paths.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"app_config_dir_override":"/host/providers"}');
  const original = fs.readFileSync(file);
  assert.throws(() => assertHostStoreIsDefault({ hostPlatform: 'darwin', hostHome: root }), /takes priority/);
  assert.deepEqual(fs.readFileSync(file), original);
  fs.writeFileSync(file, '{}');
  assert.doesNotThrow(() => assertHostStoreIsDefault({ hostPlatform: 'darwin', hostHome: root }));
  const appdata = path.join(root, 'AppData/Roaming');
  const winFile = path.join(appdata, 'com.ccswitch.desktop/app_paths.json');
  fs.mkdirSync(path.dirname(winFile), { recursive: true });
  fs.writeFileSync(winFile, '{"app_config_dir_override":"E:\\\\host"}');
  assert.throws(() => assertHostStoreIsDefault({ hostPlatform: 'win32', hostHome: root, parentEnv: { APPDATA: appdata } }), /takes priority/);
});

test('single-instance guard detects Mac and Windows instances', () => {
  assert.throws(() => assertNoRunningInstance({ hostPlatform: 'darwin', exec: () => '/Applications/CC Switch.app/Contents/MacOS/cc-switch\n' }), /already running/);
  assert.throws(() => assertNoRunningInstance({ hostPlatform: 'win32', exec: () => '"cc-switch.exe","234","Console","1","12 K"\r\n' }), /already running/);
  assert.doesNotThrow(() => assertNoRunningInstance({ hostPlatform: 'darwin', exec: () => '/bin/bash\n/usr/bin/node\n' }));
  assert.doesNotThrow(() => assertNoRunningInstance({ hostPlatform: 'win32', exec: () => 'INFO: No tasks are running which match the specified criteria.' }));
});

test('Windows managed plans select native executables and bundled Git', async t => {
  const root = fixture(t);
  for (const agent of ['codex', 'claude', 'harness']) {
    const plan = await buildAgentPlan({ root, agent, extra: ['--cc-switch', '--version'], parentEnv: { Path: 'C:\\Windows' }, hostPlatform: 'win32', arch: 'x64', node: path.join(root, 'platforms/win32-x64/node.exe') });
    assert.equal(plan.env.Path, undefined);
    assert.ok(plan.env.PATH.includes(';C:\\Windows'));
    assert.ok(plan.env.CLAUDE_CODE_GIT_BASH_PATH.endsWith('git/bin/bash.exe'));
    if (agent === 'claude') assert.ok(plan.command.endsWith('claude-code-win32-x64/claude.exe'));
  }
});
