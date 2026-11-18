import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkForUpdate, planChain, updateOnline } from './updater.mjs';
import { DEFAULT_REPO } from './release.mjs';
import { portableCache } from './portable-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = ['--check', '--yes', '--plan'];
const repo = process.env.AI_USB_REPO || DEFAULT_REPO;
const token = process.env.GITHUB_TOKEN || '';

async function main() {
  if (args.some(arg => !allowed.includes(arg))) throw new Error('Usage: update.mjs [--check | --plan | --yes]');
  const cache = portableCache(root).root;
  if (args.includes('--check') || (!args.includes('--yes') && !args.includes('--plan'))) {
    const result = await checkForUpdate(root, { repo, token });
    console.log('当前版本：' + (result.current || '未知（未标记 release）'));
    if (!result.latest) { console.log('远端没有发布记录'); return; }
    console.log('最新版本：' + result.latest.tag + '（' + (result.latest.published || '时间未知') + '）');
    if (result.latest.url) console.log('发布页：' + result.latest.url);
    console.log(result.newer ? '有新版本可更新。' : '已是最新。');
    return;
  }
  if (args.includes('--plan')) {
    const plan = await planChain(root, { repo, token });
    if (plan.mode === 'up-to-date') { console.log('已是最新：' + plan.current); return; }
    if (plan.mode === 'full') { console.log('将使用整包更新：' + plan.reason); return; }
    console.log('从 ' + plan.current + ' 到最新，需要 ' + plan.steps.length + ' 个增量：');
    for (const step of plan.steps) console.log('  ' + step.base + ' → ' + step.tag + '  ' + ((step.zipSize || 0) / 1024).toFixed(0) + ' KB');
    console.log('合计约 ' + (plan.totalSize / 1024).toFixed(0) + ' KB（整包 ' + (plan.fullSize / 1048576).toFixed(0) + ' MB）');
    return;
  }
  const result = await updateOnline(root, { repo, token, workDir: path.join(cache, 'update'), onLog: message => console.log(message) });
  if (result.status === 'up-to-date') { console.log('已是最新，无需更新。'); return; }
  console.log('\n更新完成：' + result.tag + '（' + (result.mode === 'delta' ? '增量' : '整包') + '）');
  console.log('更新前备份：' + result.before);
  console.log('旧文件保留在事务目录，确认无误后可手动清理。');
  console.log('请重新启动 dsh.bat。');
}

main().catch(error => { console.error('更新失败：' + error.message); process.exitCode = 1; });
