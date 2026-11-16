import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAgentPlan, harnessPaths } from '../lib/agent-plan.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb dsh plan '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('plan keeps the portable DSH home, injects no API key and defaults to web', async t => {
  const root = fixture(t);
  const node = path.join(root, 'platforms', 'win32-x64', 'node.exe');
  const plan = await buildAgentPlan({ root, hostPlatform: 'win32', node, parentEnv: { Path: 'C:\\Windows' } });
  const home = harnessPaths(root);
  assert.equal(plan.mode, 'DSH');
  assert.equal(plan.platform, 'win32-x64');
  assert.equal(plan.command, node);
  assert.equal(plan.env.DSH_HOME, home.home);
  assert.equal(plan.env.DSH_AGENTS_HOME, home.agents);
  assert.equal(plan.env.DSH_TELEMETRY_DISABLED, '1');
  assert.equal(plan.env.DEEPSEEK_API_KEY, undefined, 'no key is injected by the launcher');
  assert.equal(plan.env.OPENAI_API_KEY, undefined);
  assert.equal(plan.args.at(-1), 'web');
  assert.ok(plan.args[0].endsWith(path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')));
  assert.ok(plan.env.PATH.split(';')[0] === path.dirname(node));
  assert.ok(plan.env.PATH.split(';').includes(path.join(root, 'platforms', 'win32-x64', 'pnpm')));
  assert.ok(plan.env.PNPM_HOME.endsWith('pnpm-home'));
  assert.ok(plan.env.npm_config_store_dir.endsWith('pnpm-store'));
  assert.ok(fs.existsSync(path.join(root, 'data', 'harness', 'agents')));
});

test('inherited DSH variables are replaced, other provider variables are left alone', async t => {
  const root = fixture(t);
  const plan = await buildAgentPlan({
    root, hostPlatform: 'win32', node: path.join(root, 'platforms', 'win32-x64', 'node.exe'),
    parentEnv: { DSH_HOME: 'D:\\elsewhere', DSH_AGENTS_HOME: 'D:\\elsewhere\\agents', DEEPSEEK_API_KEY: 'host-key' },
  });
  assert.equal(plan.env.DSH_HOME, harnessPaths(root).home);
  assert.equal(plan.env.DSH_AGENTS_HOME, harnessPaths(root).agents);
  assert.equal(plan.env.DEEPSEEK_API_KEY, 'host-key');
});

test('extra arguments pass through and a custom workspace is honoured', async t => {
  const root = fixture(t);
  const workspace = path.join(root, 'my project');
  const plan = await buildAgentPlan({
    root, hostPlatform: 'win32', node: path.join(root, 'platforms', 'win32-x64', 'node.exe'),
    parentEnv: { AI_USB_WORKSPACE: workspace }, extra: ['--version'],
  });
  assert.equal(plan.cwd, workspace);
  assert.equal(plan.args.at(-1), '--version');
  assert.ok(fs.existsSync(workspace));
});

test('non-Windows hosts are refused with an actionable message', async t => {
  const root = fixture(t);
  await assert.rejects(buildAgentPlan({ root, hostPlatform: 'darwin', node: '/usr/bin/node' }), /Windows x64/);
});
