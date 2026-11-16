import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionReport, syncBuildInfo } from './versions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = ['--write'];
if (args.some(arg => !allowed.includes(arg))) {
  console.error('Usage: version.mjs [--write]');
  process.exitCode = 1;
} else {
  let failed = false;
  for (const row of versionReport(root)) {
    const label = row.status === 'MISMATCH' ? 'WARN' : row.status;
    const actual = row.detected === null ? '当前系统无法检测（请在 Windows 上复核）' : row.detected;
    console.log('[' + label + '] ' + row.name + ': 记录 ' + (row.recorded ?? '?') + ' / 实际 ' + actual);
    if (row.status === 'MISMATCH') failed = true;
  }
  if (args.includes('--write')) {
    const { changed } = syncBuildInfo(root);
    console.log(changed.length ? '已更新 BUILD-INFO.json：' + changed.join(', ') : 'BUILD-INFO.json 已是最新，无需修改');
  } else if (failed) {
    console.log('\n提示：运行 node lib/version.mjs --write 可把记录值改成实际值。');
    process.exitCode = 1;
  }
}
