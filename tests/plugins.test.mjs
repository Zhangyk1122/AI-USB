import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlugins, removePlugins, planPlugins, expandPluginName, declaredPlugins, applyDeclaredPlugins, readProfile, profileFile } from '../lib/plugins.mjs';

const SESSION_SEARCH = '@deepseek-ai/dsh-experimental-session-search';
const TERMINAL = '@deepseek-ai/dsh-experimental-terminal-bundle';

function fixture(t, { profile = true, bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usb plugins '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const pkg of [SESSION_SEARCH, TERMINAL]) {
    fs.mkdirSync(path.join(root, 'platforms/win32-x64/node_modules', pkg), { recursive: true });
    fs.writeFileSync(path.join(root, 'platforms/win32-x64/node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg }));
  }
  if (profile) {
    fs.mkdirSync(path.dirname(profileFile(root)), { recursive: true });
    fs.writeFileSync(profileFile(root), JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles } } }, null, 2) + '\n');
  }
  return root;
}

test('aliases expand to the shipped bundle names and unknown names are rejected', () => {
  assert.equal(expandPluginName('session-search'), SESSION_SEARCH);
  assert.equal(expandPluginName(TERMINAL), TERMINAL);
  assert.throws(() => expandPluginName('nope'), /未知插件/);
});

test('enabling appends to the profile bundle list once and keeps other fields', t => {
  const root = fixture(t);
  const plan = applyPlugins(root, ['session-search', 'session-search', 'terminal']);
  assert.deepEqual(plan.added, [SESSION_SEARCH, TERMINAL]);
  const json = JSON.parse(fs.readFileSync(profileFile(root), 'utf8'));
  assert.deepEqual(json.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SESSION_SEARCH, TERMINAL]);
  assert.equal(json.private, true);
  const again = applyPlugins(root, ['session-search']);
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.present, [SESSION_SEARCH]);
});

test('a bundle that does not ship is reported instead of written', t => {
  const root = fixture(t);
  const plan = applyPlugins(root, ['agent-team']);
  assert.deepEqual(plan.added, []);
  assert.equal(plan.missing.length, 1);
  const json = JSON.parse(fs.readFileSync(profileFile(root), 'utf8'));
  assert.equal(json.dsh.profile.bundles.length, 2);
});

test('a missing profile is refused so the first boot stays in charge', t => {
  const root = fixture(t, { profile: false });
  assert.equal(readProfile(root), null);
  assert.throws(() => planPlugins(root, ['session-search']), /先启动一次/);
});

test('removing filters only the requested bundles', t => {
  const root = fixture(t);
  applyPlugins(root, ['session-search', 'terminal']);
  const result = removePlugins(root, ['terminal']);
  assert.deepEqual(result.removed, [TERMINAL]);
  assert.deepEqual(result.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', SESSION_SEARCH]);
});

test('plugins.txt ignores comments and blank lines, and is absent by default', t => {
  const root = fixture(t);
  assert.equal(declaredPlugins(root), null);
  assert.equal(applyDeclaredPlugins(root), null);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/plugins.txt'), '# 注释\n\nsession-search  # 行尾注释\nterminal\n');
  assert.deepEqual(declaredPlugins(root).names, ['session-search', 'terminal']);
  const plan = applyDeclaredPlugins(root);
  assert.deepEqual(plan.added, [SESSION_SEARCH, TERMINAL]);
});
