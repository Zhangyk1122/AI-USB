import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractZip } from './lib/zip.mjs';
import { applyFileDelta } from './lib/updater.mjs';

const [root, zipFile, jsonFile] = process.argv.slice(2);
const delta = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const extracted = path.join(root, '.delta-files');
await extractZip(zipFile, extracted);
const transaction = path.join(root, 'backups/.transactions/verify');
fs.mkdirSync(transaction, { recursive: true });
applyFileDelta(root, extracted, delta, transaction);
console.log('已应用', delta.files.length, '个文件，删除', (delta.deleted || []).length, '个');

let bad = 0;
for (const item of delta.files) {
  if (item.path === 'BUILD-INFO.json') continue;
  const expected = execFileSync('git', ['show', 'v0.1.2:' + item.path], { encoding: 'buffer' });
  const actual = fs.readFileSync(path.join(root, ...item.path.split('/')));
  if (Buffer.compare(expected, actual) !== 0) { console.log('  不一致:', item.path); bad += 1; }
}
const info = JSON.parse(fs.readFileSync(path.join(root, 'BUILD-INFO.json'), 'utf8'));
console.log('BUILD-INFO.release =', info.release, '| trimmed =', info.trimmed);
console.log(bad ? '结果: FAIL（' + bad + ' 个文件不一致）' : '结果: OK — 所有增量文件与 v0.1.2 逐字节一致');
