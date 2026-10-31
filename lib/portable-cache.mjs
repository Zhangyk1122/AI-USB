import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function portableCache(root, { parentEnv = process.env, hostPlatform = process.platform, hostHome = os.homedir() } = {}) {
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  const idFile = path.join(data, '.portable-id');
  let id;
  try { id = fs.readFileSync(idFile, 'utf8').trim(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!id) {
    try { fs.writeFileSync(idFile, randomUUID() + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    id = fs.readFileSync(idFile, 'utf8').trim();
  }
  const slot = createHash('sha256').update(id).digest('hex').slice(0, 16);
  const localBase = parentEnv.AI_USB_HOST_CACHE || (hostPlatform === 'win32'
    ? path.join(parentEnv.LOCALAPPDATA || path.join(hostHome, 'AppData', 'Local'), 'AI-USB-Demo')
    : path.join(hostHome, 'Library', 'Caches', 'AI-USB-Demo'));
  let cacheRoot = path.resolve(localBase, slot), local = true;
  const make = base => {
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    const probe = path.join(base, `.write-${randomUUID()}`);
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
    for (const name of ['npm', 'node-compile', 'tmp', 'xdg', 'logs']) fs.mkdirSync(path.join(base, name), { recursive: true, mode: 0o700 });
  };
  try { make(cacheRoot); }
  catch {
    local = false;
    cacheRoot = path.join(data, 'cache', slot);
    make(cacheRoot);
  }
  return { root: cacheRoot, local, env: {
    npm_config_cache: path.join(cacheRoot, 'npm'), NODE_COMPILE_CACHE: path.join(cacheRoot, 'node-compile'),
    XDG_CACHE_HOME: path.join(cacheRoot, 'xdg'),
    TMPDIR: path.join(cacheRoot, 'tmp'), TMP: path.join(cacheRoot, 'tmp'), TEMP: path.join(cacheRoot, 'tmp'),
    AI_USB_CACHE_DIR: cacheRoot,
  } };
}

// Record only controlled fields: never child output, credentials or provider responses.
export function recordRun(cacheRoot, { program, mode, status, code, signal, reason }) {
  const file = path.join(cacheRoot, 'logs', 'last-run.json');
  const temp = file + `.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ at: new Date().toISOString(), program, mode, status, code, signal, reason }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch { try { fs.unlinkSync(temp); } catch {} }
}
