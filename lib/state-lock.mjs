import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const machine = createHash('sha256').update(`${os.hostname()}|${process.platform}|${os.userInfo().username}`).digest('hex');
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
function ownerActive(owner) {
  return owner.machine !== machine || alive(owner.pid) || alive(owner.childPid);
}
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('运行锁记录不完整。确认所有电脑上的本目录程序均已退出，再用维护菜单清理运行记录。'); }
}
export function maintenanceLock(root) {
  const base = path.join(root, 'data', '.runtime');
  fs.mkdirSync(base, { recursive: true });
  const lock = path.join(base, 'mutex');
  try { fs.mkdirSync(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = read(path.join(lock, 'owner.json'));
    if (ownerActive(owner)) throw new Error('另一个启动或维护操作正在进行；请等待退出。来自其他电脑的遗留记录可在维护菜单中清理。');
    throw new Error('发现上次异常退出留下的维护锁；确认程序已退出后，用维护菜单清理运行记录。');
  }
  const token = randomUUID();
  try { fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ machine, pid: process.pid, token }), { mode: 0o600 }); }
  catch (e) { fs.rmSync(lock, { recursive: true, force: true }); throw e; }
  return () => {
    if (fs.existsSync(lock) && read(path.join(lock, 'owner.json')).token === token) fs.rmSync(lock, { recursive: true });
  };
}
export function activeLeases(root) {
  const dir = path.join(root, 'data', '.runtime');
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const file = path.join(dir, name), owner = read(file);
    if (ownerActive(owner)) result.push(owner);
    else fs.unlinkSync(file);
  }
  return result;
}
export function assertIdle(root) {
  if (activeLeases(root).length) throw new Error('还有本目录启动的 Harness 在运行。请完全退出后再备份、恢复或更新。');
}
export function acquireLease(root, program) {
  const unlock = maintenanceLock(root);
  let file, owner;
  try {
    const transactions = path.join(root, 'backups', '.transactions');
    if (fs.existsSync(transactions)) for (const name of fs.readdirSync(transactions)) {
      const journal = path.join(transactions, name, 'journal.json');
      if (fs.existsSync(journal) && JSON.parse(fs.readFileSync(journal, 'utf8')).state === 'installing') throw new Error('有未完成的更新或恢复操作；请先在维护菜单选择“恢复中断操作”。');
    }
    file = path.join(root, 'data', '.runtime', `${randomUUID()}.json`);
    owner = { machine, pid: process.pid, program, started: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(owner), { mode: 0o600 });
  } finally { unlock(); }
  return {
    child(pid) { owner.childPid = pid; fs.writeFileSync(file, JSON.stringify(owner), { mode: 0o600 }); },
    release() { fs.rmSync(file, { force: true }); },
  };
}
export function clearForeignRecords(root) {
  const dir = path.join(root, 'data', '.runtime');
  if (!fs.existsSync(dir)) return;
  // Never clear records belonging to live local processes.
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name === 'mutex' ? 'mutex/owner.json' : name);
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (owner.machine === machine && (alive(owner.pid) || alive(owner.childPid))) throw new Error('本机仍有活动进程，不能清理运行记录。');
  }
  fs.rmSync(dir, { recursive: true });
}
