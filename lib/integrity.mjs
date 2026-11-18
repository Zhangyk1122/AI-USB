import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The set of files an update replaces. User data (data/, workspace/) is never included.
export const PACKAGE_DIRS = ['lib', 'tests', 'platforms'];
export const PACKAGE_FILE = /\.(?:bat|ps1|md|txt|json)$/;

export function sha256File(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function walk(base, prefix, out) {
  for (const name of fs.readdirSync(base).sort()) {
    if (name === '.DS_Store') continue;
    const full = path.join(base, name);
    const rel = prefix ? prefix + '/' + name : name;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(full, rel, out);
    else if (stat.isFile()) out.push(rel);
  }
}

export function listPackageFiles(root) {
  const files = [];
  for (const dir of PACKAGE_DIRS) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) walk(full, dir, files);
  }
  for (const name of fs.readdirSync(root).sort()) {
    const full = path.join(root, name);
    try { if (!fs.lstatSync(full).isFile()) continue; } catch { continue; }
    if (PACKAGE_FILE.test(name)) files.push(name);
  }
  return files;
}

export function buildManifest(root) {
  const files = {};
  for (const rel of listPackageFiles(root)) files[rel] = { sha256: sha256File(path.join(root, rel)), size: fs.statSync(path.join(root, rel)).size };
  return { format: 'ai-usb-manifest-v1', files };
}

export function diffManifests(base, target) {
  const added = [], changed = [], deleted = [];
  for (const [rel, meta] of Object.entries(target.files || {})) {
    const old = base.files?.[rel];
    if (!old) added.push(rel);
    else if (old.sha256 !== meta.sha256) changed.push(rel);
  }
  for (const rel of Object.keys(base.files || {})) if (!target.files?.[rel]) deleted.push(rel);
  return { added, changed, deleted };
}

export function readManifest(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.format !== 'ai-usb-manifest-v1' || typeof value.files !== 'object' || value.files === null) throw new Error('不是支持的清单格式：' + file);
  return value;
}

function main() {
  const [command, dir, out] = process.argv.slice(2);
  if (command !== 'manifest' || !dir || !out) throw new Error('Usage: integrity.mjs manifest <目录> <输出文件>');
  const manifest = buildManifest(path.resolve(dir));
  fs.writeFileSync(out, JSON.stringify(manifest) + '\n');
  console.log('清单已写入 ' + out + '：' + Object.keys(manifest.files).length + ' 个文件');
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.url.replace('file://', '')) {
  try { main(); } catch (error) { console.error('清单生成失败：' + error.message); process.exitCode = 1; }
}
