import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const DEFAULT_REPO = 'Zhangyk1122/AI-USB';
export const DELTA_FORMAT = 'ai-usb-delta-v1';

function headers(token) {
  const value = { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-usb-demo-updater' };
  if (token) value.Authorization = 'Bearer ' + token;
  return value;
}

export async function githubJSON(url, { fetchImpl = fetch, token } = {}) {
  const response = await fetchImpl(url, { headers: headers(token), redirect: 'follow' });
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = Number(response.headers.get('x-ratelimit-reset') || 0);
    if (remaining === '0' || response.status === 429) {
      const minutes = reset ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : null;
      throw new Error('GitHub API 速率限制（未认证每小时 60 次）' + (minutes ? '，约 ' + minutes + ' 分钟后恢复' : '') + '；可设置环境变量 GITHUB_TOKEN 提高额度');
    }
    throw new Error('GitHub 请求失败：HTTP ' + response.status + '（' + url + '）');
  }
  return response.json();
}

export async function listReleases(repo = DEFAULT_REPO, { fetchImpl, token, perPage = 30 } = {}) {
  const list = await githubJSON('https://api.github.com/repos/' + repo + '/releases?per_page=' + perPage, { fetchImpl, token });
  if (!Array.isArray(list)) throw new Error('GitHub 返回的 release 列表格式异常');
  return list.filter(item => !item.draft).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function findAsset(release, name) {
  return (release.assets || []).find(asset => asset.name === name) || null;
}

export function assetURL(release, name) {
  const asset = findAsset(release, name);
  return asset ? asset.browser_download_url : null;
}

export async function downloadText(url, { fetchImpl = fetch, token } = {}) {
  const response = await fetchImpl(url, { headers: headers(token), redirect: 'follow' });
  if (!response.ok) throw new Error('下载失败：HTTP ' + response.status);
  return response.text();
}

export async function downloadFile(url, dest, { fetchImpl = fetch, token, onProgress } = {}) {
  const response = await fetchImpl(url, { headers: headers(token), redirect: 'follow' });
  if (!response.ok) throw new Error('下载失败：HTTP ' + response.status);
  const total = Number(response.headers.get('content-length') || 0);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let received = 0, last = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', chunk => {
    received += chunk.length;
    if (onProgress && (received - last > 5 * 1024 * 1024 || received === total)) { last = received; onProgress(received, total); }
  });
  await pipeline(source, fs.createWriteStream(dest));
  return { bytes: received, total };
}
