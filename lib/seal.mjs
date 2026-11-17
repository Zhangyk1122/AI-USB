import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM } from './preflight.mjs';
import { digest } from './maintenance.mjs';
import { detectVersions, readBuildInfo, syncBuildInfo } from './versions.mjs';

// Files whose integrity is recorded in RUNTIME-SHA256.json. Missing optional files are skipped.
export function sealFiles(root) {
  const base = path.join(root, 'platforms', PLATFORM);
  return [
    'platforms/' + PLATFORM + '/node.exe',
    'platforms/' + PLATFORM + '/pnpm/pnpm.exe',
    'platforms/' + PLATFORM + '/git/bin/bash.exe',
  ].filter(name => { try { return fs.statSync(path.join(root, name)).isFile(); } catch { return false; } });
}

function writeJSON(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

/**
 * Recompute the integrity manifest and refresh BUILD-INFO from the shipped runtime.
 * Intended for packaging a new drop; users never need to run it by hand.
 */
export function sealRuntime(root, { hostPlatform = process.platform, exec, write = true, today = new Date() } = {}) {
  const hashes = {};
  for (const name of sealFiles(root)) hashes[name] = digest(path.join(root, name));
  const manifest = path.join(root, 'RUNTIME-SHA256.json');
  let current = null;
  try { current = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { current = null; }
  const hashChanged = JSON.stringify(current) !== JSON.stringify(hashes);
  if (write && hashChanged) writeJSON(manifest, hashes);

  const detected = detectVersions(root, { hostPlatform, exec });
  let versionsChanged = [];
  if (write) versionsChanged = syncBuildInfo(root, { hostPlatform, exec }).changed;

  const info = readBuildInfo(root);
  const stamp = today.toISOString().slice(0, 10);
  if (write && info && info.trimmed !== stamp) {
    info.trimmed = stamp;
    writeJSON(path.join(root, 'BUILD-INFO.json'), info);
  }
  return { files: Object.keys(hashes), hashChanged, versionsChanged, detected, trimmed: stamp };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const write = !process.argv.includes('--dry-run');
  const result = sealRuntime(root, { write });
  console.log('校验清单文件：' + result.files.join(', '));
  console.log('RUNTIME-SHA256.json：' + (result.hashChanged ? (write ? '已更新' : '需要更新（--dry-run 未写入）') : '无变化'));
  console.log('BUILD-INFO 版本：' + (result.versionsChanged.length ? (write ? '已更新 ' + result.versionsChanged.join(', ') : '需要更新 ' + result.versionsChanged.join(', ')) : '无变化'));
  console.log('trimmed：' + result.trimmed);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error('封装失败：' + error.message); process.exitCode = 1; }
}
