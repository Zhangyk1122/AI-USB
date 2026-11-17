import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { diagnose } from './diagnostics.mjs';
import { createBackup, listBackups, restoreBackup, updateFromFolder, recoverTransactions } from './maintenance.mjs';
import { clearForeignRecords } from './state-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  while (true) {
    console.log('\nAI USB 维护（DeepSeek Harness）'
      + '\n1. 统一离线诊断（程序文件、缓存、运行状态、版本探针）'
      + '\n2. 备份配置和会话'
      + '\n3. 查看 / 恢复备份'
      + '\n4. 从完整新版目录更新（先自动备份）'
      + '\n5. 恢复中断的更新 / 恢复操作'
      + '\n6. 清理异常退出或其他电脑的运行记录'
      + '\n0. 返回 / 退出');
    const choice = (await input.question('选择 [0-6]：')).trim();
    if (choice === '0') break;
    try {
      if (choice === '1') {
        for (const row of await diagnose(root, { verifyHashes: true })) console.log('[' + row.status + '] ' + row.name + ': ' + row.detail);
      } else if (choice === '2') {
        console.log('备份完成：' + createBackup(root));
      } else if (choice === '3') {
        const names = listBackups(root);
        if (!names.length) { console.log('暂无备份'); continue; }
        names.forEach((name, index) => console.log((index + 1) + '. ' + name));
        const number = (await input.question('输入备份编号以恢复，直接回车取消：')).trim();
        if (!number) continue;
        const selected = /^\d+$/.test(number) ? names[Number(number) - 1] : undefined;
        if (!selected) throw new Error('编号无效');
        if ((await input.question('将替换当前配置和会话，并先备份当前状态。输入 RESTORE 继续：')).trim() !== 'RESTORE') continue;
        const result = restoreBackup(root, selected);
        console.log('恢复完成。恢复前备份：' + result.before);
      } else if (choice === '4') {
        const source = (await input.question('完整新版目录路径（已解压，不要选当前目录）：')).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
        if (!source) continue;
        if ((await input.question('退出本目录所有 Harness 窗口后，输入 UPDATE 继续：')).trim() !== 'UPDATE') continue;
        console.log('正在备份、复制并校验新版。完整包较大，请保持终端打开，完成前不要拔盘。');
        const result = updateFromFolder(root, source);
        console.log('更新完成。配置/会话备份：' + result.before + '\n旧程序保留在：' + result.previousRuntime + '\n请退出此菜单后重新打开 dsh.bat。');
        break;
      } else if (choice === '5') {
        recoverTransactions(root);
        console.log('中断操作已回退；可重新启动。');
      } else if (choice === '6') {
        if ((await input.question('确认所有电脑上的本目录程序都已退出后，输入 EXITED：')).trim() === 'EXITED') {
          clearForeignRecords(root);
          console.log('运行记录已清理');
        }
      } else console.log('选择无效');
    } catch (error) {
      console.error('操作未完成：' + error.message);
    }
  }
} finally { input.close(); }
