import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { maintenanceLock, assertIdle } from './state-lock.mjs';
import { createBackupUnlocked, installItems, copyTree } from './maintenance.mjs';
import { sha256File, packageItems } from './integrity.mjs';
import { extractZip } from './zip.mjs';
import { listReleases, assetURL, downloadFile, downloadText, DEFAULT_REPO } from './release.mjs';

export const FULL_PACKAGE = 'AI-USB-Demo-win32-x64.zip';
export const CHECKSUMS = 'SHA256SUMS.txt';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);

export function currentRelease(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json'), 'utf8')).release || null; }
  catch { return null; }
}

export async function latestRelease(repo = DEFAULT_REPO, { fetchImpl, token } = {}) {
  const releases = await listReleases(repo, { fetchImpl, token });
  return releases.at(-1) || null;
}

export async function checkForUpdate(root, { repo = DEFAULT_REPO, fetchImpl, token } = {}) {
  const current = currentRelease(root);
  const latest = await latestRelease(repo, { fetchImpl, token });
  if (!latest) return { current, latest: null, newer: false };
  return {
    current,
    latest: { tag: latest.tag_name, name: latest.name || latest.tag_name, url: latest.html_url, published: latest.created_at },
    newer: Boolean(latest.tag_name && latest.tag_name !== current),
  };
}

function parseChecksum(sums, name) {
  for (const line of String(sums).split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+(.+)$/);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
}

// A release may only replace the packaged program files. data/, config/ and workspace/ are user data.
export function validatePackage(dir) {
  for (const name of ['BUILD-INFO.json', 'RUNTIME-SHA256.json', 'lib/launch.mjs', 'dsh.bat', 'dsh.ps1',
    'platforms/win32-x64/node.exe', 'platforms/win32-x64/node_modules/@deepseek-ai/dsh/lib/bin.js']) {
    if (!fs.existsSync(path.join(dir, ...name.split('/')))) throw new Error('包内容不完整，缺少 ' + name + '，已中止');
  }
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'BUILD-INFO.json'), 'utf8'));
  if (!Array.isArray(info.platforms) || !info.platforms.includes('win32-x64')) throw new Error('包的 BUILD-INFO 不含 win32-x64，已中止');
  return info;
}

/**
 * Download the newest full package, verify its SHA256, extract and transactionally
 * replace the program files. User data (data/, workspace/) is never touched.
 */
export async function updateOnline(root, { repo = DEFAULT_REPO, fetchImpl, token, workDir, onLog = () => {}, apply = true } = {}) {
  const unlock = maintenanceLock(root);
  try {
    assertIdle(root);
    const current = currentRelease(root);
    const latest = await latestRelease(repo, { fetchImpl, token });
    if (!latest) return { status: 'up-to-date', current };
    if (latest.tag_name && latest.tag_name === current) return { status: 'up-to-date', current };

    const zipUrl = assetURL(latest, FULL_PACKAGE);
    if (!zipUrl) throw new Error('最新发布 ' + latest.tag_name + ' 中没有 ' + FULL_PACKAGE);

    const cache = workDir || path.join(root, 'data', 'cache', 'update');
    fs.mkdirSync(cache, { recursive: true });
    const zipPath = path.join(cache, latest.tag_name + '.zip');

    onLog('下载完整包 ' + latest.tag_name + ' …');
    await downloadFile(zipUrl, zipPath, { fetchImpl, token,
      onProgress: (done, total) => onLog('  ' + Math.round(done / 1048576) + ' / ' + (total ? Math.round(total / 1048576) : '?') + ' MB') });

    const sumsUrl = assetURL(latest, CHECKSUMS);
    if (sumsUrl) {
      const expected = parseChecksum(await downloadText(sumsUrl, { fetchImpl, token }), FULL_PACKAGE);
      if (expected) {
        onLog('校验 SHA256 …');
        const actual = sha256File(zipPath);
        if (actual !== expected) throw new Error('SHA256 校验失败：下载文件不完整或损坏，已中止（未改动任何文件）');
        onLog('  SHA256 一致');
      } else {
        onLog('  发布里没有 ' + FULL_PACKAGE + ' 的校验条目，跳过校验');
      }
    }

    const extracted = path.join(cache, latest.tag_name + '-files');
    fs.rmSync(extracted, { recursive: true, force: true });
    onLog('解压 …');
    await extractZip(zipPath, extracted);
    validatePackage(extracted);

    onLog('备份配置与会话，然后替换程序文件（data/、workspace/ 保留）…');
    const before = createBackupUnlocked(root, 'before-update');
    const transaction = path.join(root, 'backups', '.transactions', stamp());
    copyTree(extracted, path.join(transaction, 'stage'));
    const names = packageItems(path.join(transaction, 'stage'));
    installItems(root, transaction, names);
    return { status: 'updated', mode: 'full', tag: latest.tag_name, before, transaction };
  } finally { unlock(); }
}
