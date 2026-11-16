import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLATFORM } from './preflight.mjs';

// Single source of truth: read versions from the shipped runtime, never from memory.
export const VERSION_SOURCES = {
  node: 'platforms/' + PLATFORM + '/node.exe',
  'deepseek-harness': 'platforms/' + PLATFORM + '/node_modules/@deepseek-ai/dsh/package.json',
};

export function readBuildInfo(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json'), 'utf8')); }
  catch { return null; }
}

export function detectVersions(root, { hostPlatform = process.platform, exec = spawnSync } = {}) {
  const detected = {};
  // node.exe is a Windows PE file: only executable on Windows, otherwise it is left unknown.
  if (hostPlatform === 'win32') {
    try {
      const result = exec(path.join(root, VERSION_SOURCES.node), ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 64 * 1024 });
      const value = typeof result.stdout === 'string' ? result.stdout.trim().replace(/^v/, '') : '';
      if (result.status === 0 && /^\d+\.\d+\.\d+$/.test(value)) detected.node = value;
    } catch { /* leave node undetected */ }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, VERSION_SOURCES['deepseek-harness']), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version) detected['deepseek-harness'] = pkg.version;
  } catch { /* leave harness undetected */ }
  return detected;
}

export function versionReport(root, options = {}) {
  const recorded = readBuildInfo(root)?.versions || {};
  const detected = detectVersions(root, options);
  return ['node', 'deepseek-harness'].map(name => {
    const actual = detected[name] ?? null, expected = recorded[name] ?? null;
    return {
      name, recorded: expected, detected: actual,
      status: actual === null ? 'SKIP' : (expected === actual ? 'OK' : 'MISMATCH'),
    };
  });
}

export function syncBuildInfo(root, options = {}) {
  const info = readBuildInfo(root);
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('BUILD-INFO.json 缺失或无法解析，未做任何修改');
  const detected = detectVersions(root, options);
  const versions = { ...info.versions };
  const changed = [];
  for (const [name, value] of Object.entries(detected)) {
    if (versions[name] !== value) { versions[name] = value; changed.push(name); }
  }
  if (!changed.length) return { changed, versions };
  info.versions = versions;
  const file = path.join(root, 'BUILD-INFO.json');
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(info, null, 2) + '\n');
  fs.renameSync(temp, file);
  return { changed, versions };
}
