import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { maintenanceLock, assertIdle, clearForeignRecords } from './state-lock.mjs';
import { PLATFORMS, runtimeChecks } from './preflight.mjs';

const ignoredData = new Set(['.runtime', 'cache', 'npm-cache']);
const id = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const exists = file => fs.existsSync(file);
const remove = file => fs.rmSync(file, { recursive: true, force: true });
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function digest(file) {
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export function copyTree(source, destination, { skip = () => false, relative = '' } = {}) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`不跟随外部链接，请将其改为普通文件后重试：${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) {
      const next = relative ? `${relative}/${name}` : name;
      if (!skip(next)) copyTree(path.join(source, name), path.join(destination, name), { skip, relative: next });
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode & 0o777);
  } else throw new Error(`不支持的文件类型：${source}`);
}
function walk(base, prefix = '') {
  const entries = [];
  for (const name of fs.readdirSync(base).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name, full = path.join(base, name), stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('备份中包含链接，已停止');
    if (stat.isDirectory()) entries.push({ path: relative, directory: true }, ...walk(full, relative));
    else if (stat.isFile()) entries.push({ path: relative, size: stat.size, sha256: digest(full) });
    else throw new Error('备份中存在不支持的文件类型');
  }
  return entries;
}
function validEntry(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.includes(':') || name.includes('\0') || name.startsWith('/') || name.split('/').some(x => !x || x === '.' || x === '..')) return false;
  const [top, dataTop] = name.split('/');
  return top === 'config' || (top === 'data' && !ignoredData.has(dataTop));
}
export function verifyBackup(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'ai-usb-backup-v1' || !Array.isArray(manifest.entries)) throw new Error('不是支持的 AI USB 备份');
  const payload = path.join(folder, 'payload');
  if (fs.lstatSync(payload).isSymbolicLink()) throw new Error('备份 payload 不允许使用链接');
  if (manifest.entries.some(e => !validEntry(e.path))) throw new Error('备份包含非法路径');
  const actual = walk(payload);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries)) throw new Error('备份校验失败：文件缺失、多出、大小或 SHA256 不一致；当前数据未更改');
  return manifest;
}
function unresolved(root) {
  const base = path.join(root, 'backups', '.transactions');
  if (!exists(base)) return [];
  return fs.readdirSync(base).filter(name => {
    const file = path.join(base, name, 'journal.json');
    if (!exists(file)) return false;
    const state = JSON.parse(fs.readFileSync(file)).state;
    return state === 'installing';
  });
}
function idle(root) {
  assertIdle(root);
  if (unresolved(root).length) throw new Error('发现未完成的恢复或更新。请先运行维护菜单中的“恢复中断操作”。');
}
export function createBackupUnlocked(root, reason) {
  const folder = path.join(root, 'backups', `${id()}-${reason}`), partial = folder + '.partial';
  fs.mkdirSync(path.join(partial, 'payload'), { recursive: true, mode: 0o700 });
  try {
    if (exists(path.join(root, 'config'))) copyTree(path.join(root, 'config'), path.join(partial, 'payload/config'));
    fs.mkdirSync(path.join(partial, 'payload/data'), { recursive: true });
    if (exists(path.join(root, 'data'))) for (const name of fs.readdirSync(path.join(root, 'data'))) {
      if (!ignoredData.has(name)) copyTree(path.join(root, 'data', name), path.join(partial, 'payload/data', name), {
        relative: name,
        // Disposable, machine-rebuildable areas. May contain junctions on Windows
        // that must never be copied into a backup.
        skip: relative => /(?:^|\/)(?:tmp|cache|logs|node_modules)(?:\/|$)/i.test(relative),
      });
    }
    writeJSON(path.join(partial, 'manifest.json'), { format: 'ai-usb-backup-v1', created: new Date().toISOString(), reason,
      build: exists(path.join(root, 'BUILD-INFO.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json'))) : null,
      entries: walk(path.join(partial, 'payload')) });
    verifyBackup(partial);
    fs.renameSync(partial, folder);
    return folder;
  } catch (e) { remove(partial); throw e; }
}
export function createBackup(root, reason = 'manual') {
  if (!/^[a-z-]+$/.test(reason)) throw new Error('无效备份原因');
  const unlock = maintenanceLock(root);
  try { idle(root); return createBackupUnlocked(root, reason); } finally { unlock(); }
}
export function listBackups(root) {
  const base = path.join(root, 'backups');
  if (!exists(base)) return [];
  return fs.readdirSync(base).filter(n => !n.startsWith('.') && !n.endsWith('.partial') && exists(path.join(base, n, 'manifest.json'))).sort().reverse();
}
function backupPath(root, name) {
  if (!name || name !== path.basename(name) || name === '.' || name === '..') throw new Error('请选择本目录 backups 中的备份名称');
  const folder = path.join(root, 'backups', name);
  if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('备份目录不允许使用链接');
  return folder;
}
function rollback(root, transaction) {
  const journalFile = path.join(transaction, 'journal.json'), journal = JSON.parse(fs.readFileSync(journalFile));
  if (!Array.isArray(journal.entries) || journal.entries.some(e => typeof e.name !== 'string' || !(
    ['config', 'lib', 'platforms', 'tests'].includes(e.name) || (/^data\/[^/\\]+$/.test(e.name) && !ignoredData.has(e.name.slice(5)) && !['.', '..'].includes(e.name.slice(5))) ||
    (!e.name.includes('/') && !e.name.includes('\\') && programFile(e.name))
  ))) throw new Error('恢复记录包含非法路径，已停止');
  for (const entry of [...journal.entries].reverse()) {
    const target = path.join(root, entry.name), previous = path.join(transaction, 'previous', entry.name);
    if (exists(previous)) {
      remove(target); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(previous, target);
    } else if (!entry.hadOld) remove(target);
  }
  journal.state = 'rolled-back'; writeJSON(journalFile, journal);
}
export function installItems(root, transaction, names, { injectFailure } = {}) {
  const journalFile = path.join(transaction, 'journal.json');
  const journal = { state: 'installing', entries: [] };
  writeJSON(journalFile, journal);
  try {
    for (const name of names) {
      const target = path.join(root, name), previous = path.join(transaction, 'previous', name), staged = path.join(transaction, 'stage', name);
      journal.entries.push({ name, hadOld: exists(target) }); writeJSON(journalFile, journal);
      if (exists(target)) { fs.mkdirSync(path.dirname(previous), { recursive: true }); fs.renameSync(target, previous); }
      if (injectFailure) injectFailure(name);
      if (exists(staged)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(staged, target); }
    }
    journal.state = 'complete'; writeJSON(journalFile, journal);
  } catch (error) {
    try { rollback(root, transaction); }
    catch { throw new Error('替换失败且自动回退未完成；保留了事务记录，请运行“恢复中断操作”。'); }
    throw error;
  }
}
export function restoreBackup(root, name, options = {}) {
  const unlock = maintenanceLock(root);
  try {
    idle(root);
    const folder = backupPath(root, name); verifyBackup(folder);
    const before = createBackupUnlocked(root, 'before-restore');
    const transaction = path.join(root, 'backups', '.transactions', id());
    copyTree(path.join(folder, 'payload'), path.join(transaction, 'stage'));
    const rootData = path.join(root, 'data'), stagedData = path.join(transaction, 'stage/data');
    if (!exists(rootData)) fs.mkdirSync(rootData, { recursive: true });
    const dataNames = new Set([...fs.readdirSync(rootData), ...(exists(stagedData) ? fs.readdirSync(stagedData) : [])]);
    const names = ['config', ...[...dataNames].filter(n => !ignoredData.has(n)).map(n => `data/${n}`)];
    installItems(root, transaction, names, options);
    return { before, transaction };
  } finally { unlock(); }
}
const programFile = name => /\.(?:bat|ps1|md|txt)$/.test(name) || ['BUILD-INFO.json', 'RUNTIME-SHA256.json'].includes(name);
const runtimeHashNames = () => PLATFORMS.map(p => `platforms/${p}/node${p === 'win32-x64' ? '.exe' : ''}`);
export function updateFromFolder(root, source, options = {}) {
  root = fs.realpathSync(root); source = fs.realpathSync(source);
  const contains = (a, b) => { const r = path.relative(a, b); return !r || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); };
  if (contains(root, source) || contains(source, root)) throw new Error('新版目录与当前目录必须彼此独立，不能放在对方内部');
  if (process.platform === 'win32' && contains(path.join(root, 'platforms'), process.execPath)) throw new Error('Windows 更新请通过 Windows-Maintain.bat 启动，避免正在运行的 Node 锁住旧程序目录');
  const info = JSON.parse(fs.readFileSync(path.join(source, 'BUILD-INFO.json'), 'utf8'));
  if (!Array.isArray(info.platforms) || !PLATFORMS.every(p => info.platforms.includes(p))) throw new Error('新版必须包含本 Demo 的 Mac arm64 和 Windows x64 两套程序');
  for (const name of ['lib/maintenance.mjs', 'lib/launch.mjs', 'lib/doctor.mjs', 'dsh.bat', 'dsh.ps1', 'Windows-Maintain.bat']) {
    if (!exists(path.join(source, name))) throw new Error(`新版缺少 ${name}`);
  }
  for (const platform of PLATFORMS) {
    const failed = runtimeChecks(source, { platform }).filter(r => r.status === 'FAIL');
    if (failed.length) throw new Error(`新版文件不完整：${failed.map(r => r.detail).join(', ')}`);
  }
  const hashes = JSON.parse(fs.readFileSync(path.join(source, 'RUNTIME-SHA256.json'), 'utf8'));
  if (!hashes || Array.isArray(hashes) || !runtimeHashNames().every(n => /^[0-9a-f]{64}$/.test(hashes[n] || ''))) throw new Error('新版缺少有效的运行时校验清单');
  for (const [name, hash] of Object.entries(hashes)) {
    if (name.includes('\\') || name.split('/').includes('..') || !name.startsWith('platforms/')) throw new Error('新版运行时校验清单路径不合法');
    if (digest(path.join(source, name)) !== hash) throw new Error(`新版运行时校验失败：${name}`);
  }
  const unlock = maintenanceLock(root);
  try {
    idle(root);
    const before = createBackupUnlocked(root, 'before-update');
    const transaction = path.join(root, 'backups', '.transactions', id());
    const names = [...new Set(['lib', 'platforms', 'tests', ...fs.readdirSync(root).filter(programFile), ...fs.readdirSync(source).filter(programFile)])];
    try {
      for (const name of names) if (exists(path.join(source, name))) copyTree(path.join(source, name), path.join(transaction, 'stage', name));
      // Verify the staged copy, not only its source. The current runtime remains intact until this point.
      for (const [name, hash] of Object.entries(hashes)) if (digest(path.join(transaction, 'stage', name)) !== hash) throw new Error(`复制后校验失败：${name}`);
    } catch (e) { remove(transaction); throw e; }
    installItems(root, transaction, names, options);
    return { before, transaction, previousRuntime: path.join(transaction, 'previous') };
  } finally { unlock(); }
}
export function recoverTransactions(root) {
  const unlock = maintenanceLock(root);
  try {
    assertIdle(root);
    for (const name of unresolved(root)) rollback(root, path.join(root, 'backups/.transactions', name));
  } finally { unlock(); }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [command, value] = process.argv.slice(2);
  if (command === 'backup') console.log(`备份完成：${createBackup(root)}`);
  else if (command === 'list') console.log(listBackups(root).join('\n') || '暂无备份');
  else if (command === 'restore' && value) console.log(JSON.stringify(restoreBackup(root, value), null, 2));
  else if (command === 'update' && value) console.log(JSON.stringify(updateFromFolder(root, value), null, 2));
  else if (command === 'recover') { recoverTransactions(root); console.log('未完成操作已回退'); }
  else if (command === 'clear-locks' && value === '--all-programs-exited') { clearForeignRecords(root); console.log('运行记录已清理'); }
  else throw new Error('Usage: maintenance.mjs backup | list | restore <备份名> | update <完整新版目录> | recover | clear-locks --all-programs-exited');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(`维护失败：${e.message}`); process.exitCode = 1; });
