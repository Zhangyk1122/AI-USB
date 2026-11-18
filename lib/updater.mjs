import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { maintenanceLock, assertIdle } from './state-lock.mjs';
import { createBackupUnlocked, installItems, copyTree, rollbackFileJournal } from './maintenance.mjs';
import { sha256File, PACKAGE_DIRS, isPackageRootFile, packageItems } from './integrity.mjs';
import { extractZip } from './zip.mjs';
import { listReleases, assetURL, assetSize, downloadFile, downloadText, DELTA_FORMAT, DEFAULT_REPO } from './release.mjs';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);

export function currentRelease(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json'), 'utf8')).release || null; }
  catch { return null; }
}

export async function checkForUpdate(root, { repo = DEFAULT_REPO, fetchImpl, token } = {}) {
  const current = currentRelease(root);
  const releases = await listReleases(repo, { fetchImpl, token });
  const latest = releases.at(-1);
  if (!latest) return { current, latest: null, newer: false };
  return {
    current,
    latest: { tag: latest.tag_name, name: latest.name || latest.tag_name, url: latest.html_url, published: latest.created_at },
    newer: Boolean(latest.tag_name && latest.tag_name !== current),
  };
}

/**
 * Resolve the shortest incremental path from the installed tag to the newest release.
 * Each release publishes delta-from-<previous>.{json,zip}; a missing hop falls back to a full package.
 */
export async function planChain(root, { repo = DEFAULT_REPO, fetchImpl, token, maxHops = 8 } = {}) {
  const current = currentRelease(root);
  const releases = await listReleases(repo, { fetchImpl, token });
  const index = releases.findIndex(release => release.tag_name === current);
  if (index < 0) return { mode: 'full', current, reason: '本地版本不在发布历史中（或从未标记 release）' };
  const hops = releases.slice(index + 1);
  if (!hops.length) return { mode: 'up-to-date', current };
  if (hops.length > maxHops) return { mode: 'full', current, reason: '落后 ' + hops.length + ' 个版本，超过增量上限' };
  const steps = [];
  let base = current;
  for (const release of hops) {
    const jsonUrl = assetURL(release, 'delta-from-' + base + '.json');
    const zipUrl = assetURL(release, 'delta-from-' + base + '.zip');
    if (!jsonUrl || !zipUrl) return { mode: 'full', current, reason: '缺少 ' + base + ' → ' + release.tag_name + ' 的增量包' };
    steps.push({ tag: release.tag_name, base, jsonUrl, zipUrl, zipSize: assetSize(release, 'delta-from-' + base + '.zip') });
    base = release.tag_name;
  }
  // Chained deltas are only worth it while they stay clearly cheaper than one full download.
  const latest = hops[hops.length - 1];
  const fullSize = assetSize(latest, 'AI-USB-Demo-win32-x64.zip');
  const totalSize = steps.reduce((sum, step) => sum + (step.zipSize || 0), 0);
  if (fullSize && totalSize >= fullSize * 0.8) {
    return { mode: 'full', current, reason: '增量合计 ' + (totalSize / 1048576).toFixed(1) + ' MB，接近整包 ' + (fullSize / 1048576).toFixed(1) + ' MB', totalSize, fullSize };
  }
  return { mode: 'delta', current, steps, totalSize, fullSize };
}

function writeJournal(file, journal) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(journal, null, 2) + '\n');
  fs.renameSync(temp, file);
}

// Never let a delta write outside the packaged file set (e.g. stale CI artifacts in an old delta).
export function validatePackage(dir) {
  for (const name of ['BUILD-INFO.json', 'RUNTIME-SHA256.json', 'lib/launch.mjs', 'dsh.bat', 'dsh.ps1',
    'platforms/win32-x64/node.exe', 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/lib/bin.js']) {
    if (!fs.existsSync(path.join(dir, ...name.split('/')))) throw new Error('包内容不完整，缺少 ' + name + '，已中止');
  }
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'BUILD-INFO.json'), 'utf8'));
  if (!Array.isArray(info.platforms) || !info.platforms.includes('win32-x64')) throw new Error('包的 BUILD-INFO 不含 win32-x64，已中止');
  return info;
}

export function isUpdatablePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) return false;
  if (PACKAGE_DIRS.some(dir => rel.startsWith(dir + '/'))) return true;
  return !rel.includes('/') && isPackageRootFile(rel);
}

export function applyFileDelta(root, extracted, delta, transaction) {
  const journalFile = path.join(transaction, 'journal.json');
  const journal = { kind: 'files', state: 'applying', base: delta.base, release: delta.release, entries: [] };
  writeJournal(journalFile, journal);
  const previous = path.join(transaction, 'previous');
  try {
    for (const item of delta.files || []) {
      if (!isUpdatablePath(item.path)) { journal.skipped = [...(journal.skipped || []), item.path]; writeJournal(journalFile, journal); continue; }
      const source = path.join(extracted, ...item.path.split('/'));
      if (!fs.existsSync(source)) throw new Error('增量包缺少文件：' + item.path);
      if (sha256File(source) !== item.sha256) throw new Error('增量文件哈希不符：' + item.path);
      const target = path.join(root, ...item.path.split('/'));
      const hadOld = fs.existsSync(target);
      if (hadOld) {
        const backup = path.join(previous, ...item.path.split('/'));
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      journal.entries.push({ path: item.path, hadOld });
      writeJournal(journalFile, journal);
    }
    for (const rel of delta.deleted || []) {
      if (!isUpdatablePath(rel)) continue;
      const target = path.join(root, ...rel.split('/'));
      if (!fs.existsSync(target)) continue;
      const backup = path.join(previous, ...rel.split('/'));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(target, backup);
      journal.entries.push({ path: rel, hadOld: true, removed: true });
      writeJournal(journalFile, journal);
    }
    journal.state = 'complete';
    writeJournal(journalFile, journal);
    return transaction;
  } catch (error) {
    try { rollbackFileJournal(root, transaction); }
    catch { throw new Error('应用增量失败且自动回退未完成：' + error.message + '；请用维护菜单恢复中断操作'); }
    throw error;
  }
}

export async function updateOnline(root, { repo = DEFAULT_REPO, fetchImpl, token, workDir, onLog = () => {}, apply = true } = {}) {
  const unlock = maintenanceLock(root);
  try {
    assertIdle(root);
    const plan = await planChain(root, { repo, fetchImpl, token });
    if (plan.mode === 'up-to-date') return { status: 'up-to-date', current: plan.current };
    const cache = workDir || path.join(root, 'data', 'cache', 'update');
    fs.mkdirSync(cache, { recursive: true });
    const before = createBackupUnlocked(root, 'before-update');

    if (plan.mode === 'full') {
      onLog('增量不可用（' + plan.reason + '），改为整包更新');
      const releases = await listReleases(repo, { fetchImpl, token });
      const latest = releases.at(-1);
      const zipUrl = assetURL(latest, 'AI-USB-Demo-win32-x64.zip');
      if (!zipUrl) throw new Error('最新发布中没有 AI-USB-Demo-win32-x64.zip');
      const zipPath = path.join(cache, latest.tag_name + '.zip');
      onLog('下载整包 ' + latest.tag_name + ' …');
      await downloadFile(zipUrl, zipPath, { fetchImpl, token, onProgress: (done, total) => onLog('  下载 ' + Math.round(done / 1048576) + '/' + Math.round(total / 1048576) + ' MB') });
      const extracted = path.join(cache, latest.tag_name + '-files');
      onLog('解压 …');
      await extractZip(zipPath, extracted);
      validatePackage(extracted);
      const transaction = path.join(root, 'backups', '.transactions', stamp());
      copyTree(extracted, path.join(transaction, 'stage'));
      // Allowlist: a release can never replace data/, config/ or workspace/.
      const names = packageItems(path.join(transaction, 'stage'));
      installItems(root, transaction, names);
      return { status: 'updated', mode: 'full', tag: latest.tag_name, before, transaction };
    }

    const transaction = path.join(root, 'backups', '.transactions', stamp());
    let latestTag = plan.current;
    for (const step of plan.steps) {
      onLog('增量 ' + step.base + ' → ' + step.tag);
      const dir = path.join(cache, step.tag);
      const zipPath = path.join(dir, 'delta.zip');
      await downloadFile(step.zipUrl, zipPath, { fetchImpl, token, onProgress: (done, total) => total && onLog('  ' + Math.round(done * 100 / total) + '%') });
      const delta = JSON.parse(await downloadText(step.jsonUrl, { fetchImpl, token }));
      if (delta.format !== DELTA_FORMAT) throw new Error('不支持的增量格式：' + delta.format);
      if (delta.base !== step.base || delta.release !== step.tag) throw new Error('增量包与预期版本不符');
      const extracted = path.join(dir, 'files');
      await extractZip(zipPath, extracted);
      applyFileDelta(root, extracted, delta, transaction);
      fs.rmSync(zipPath, { force: true });
      latestTag = step.tag;
      onLog('  完成 ' + step.tag + '（' + delta.files.length + ' 个文件，删除 ' + (delta.deleted || []).length + ' 个）');
    }
    return { status: 'updated', mode: 'delta', tag: latestTag, before, transaction };
  } finally { unlock(); }
}
