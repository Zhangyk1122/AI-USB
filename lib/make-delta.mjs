import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, diffManifests } from './integrity.mjs';

// CI helper: compare an extracted previous release with the freshly built tree.
const [prevDir, nextDir, outDir, base, release] = process.argv.slice(2);
if (!prevDir || !nextDir || !outDir || !base || !release) {
  console.error('Usage: make-delta.mjs <上一版目录> <新版目录> <输出目录> <base标签> <release标签>');
  process.exit(1);
}
try {
  const before = buildManifest(path.resolve(prevDir));
  const after = buildManifest(path.resolve(nextDir));
  const diff = diffManifests(before, after);
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  const files = [];
  for (const rel of [...diff.added, ...diff.changed].sort()) {
    const from = path.join(path.resolve(nextDir), ...rel.split('/'));
    const to = path.join(out, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files.push({ path: rel, sha256: after.files[rel].sha256, size: after.files[rel].size });
  }
  const delta = { format: 'ai-usb-delta-v1', base, release, files, deleted: diff.deleted.sort() };
  fs.writeFileSync(path.join(out, 'delta.json'), JSON.stringify(delta, null, 2) + '\n');
  console.log('增量 ' + base + ' -> ' + release + '：' + files.length + ' 个文件，删除 ' + delta.deleted.length + ' 个');
  const bytes = files.reduce((sum, item) => sum + item.size, 0);
  console.log('增量原始大小：' + (bytes / 1048576).toFixed(1) + ' MB');
} catch (error) {
  console.error('生成增量失败：' + error.message);
  process.exit(1);
}
