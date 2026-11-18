import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PLATFORM } from './preflight.mjs';

let fflate;
function load() {
  if (fflate) return fflate;
  const anchor = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'platforms', PLATFORM, 'node_modules', 'fflate', 'package.json');
  try { fflate = createRequire(anchor)('fflate'); }
  catch (error) { throw new Error('缺少解压依赖 fflate（platforms/' + PLATFORM + '/node_modules/fflate）：' + error.message); }
  return fflate;
}

function safeJoin(root, name) {
  const clean = name.replace(/\\/g, '/');
  if (clean.startsWith('/') || clean.split('/').includes('..')) throw new Error('压缩包含有非法路径：' + name);
  const full = path.join(root, ...clean.split('/'));
  const base = path.resolve(root);
  if (!path.resolve(full).startsWith(base + path.sep) && path.resolve(full) !== base) throw new Error('压缩包含有越界路径：' + name);
  return full;
}

/**
 * Stream-extract a zip into destDir. Entries are written one at a time so a ~1 GB
 * package never has to sit fully in memory.
 */
export async function extractZip(zipPath, destDir, { onEntry } = {}) {
  const { Unzip, UnzipInflate } = load();
  fs.mkdirSync(destDir, { recursive: true });
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  const pending = [];
  unzip.onfile = file => {
    const name = file.name.replace(/\\/g, '/');
    if (name.endsWith('/')) return;
    const out = safeJoin(destDir, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const stream = fs.createWriteStream(out);
    const done = new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('close', () => { onEntry?.(name); resolve(); });
    });
    file.ondata = (error, chunk, final) => {
      if (error) { stream.destroy(error); return; }
      if (chunk && chunk.length) stream.write(Buffer.from(chunk));
      if (final) stream.end();
    };
    file.start();
    pending.push(done);
  };
  for await (const chunk of fs.createReadStream(zipPath)) unzip.push(chunk, false);
  unzip.push(new Uint8Array(0), true);
  await Promise.all(pending);
  return destDir;
}
