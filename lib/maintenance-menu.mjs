import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { diagnose } from './diagnostics.mjs';
import { createBackup, listBackups, restoreBackup, updateFromFolder, recoverTransactions } from './maintenance.mjs';
import { clearForeignRecords } from './state-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = createInterface({ input: process.stdin, output: process.stdout });
async function rows(online = false) {
  for (const row of await diagnose(root, { online, allPlatforms: true, verifyHashes: !online })) console.log(`[${row.status}] ${row.name}: ${row.detail}`);
}
async function directAPI() {
  input.close();
  const command = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Windows-Check-API.ps1')]
    : [path.join(root, 'Mac-Check-API.command')];
  const child = spawn(command, args, { stdio: 'inherit' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
}
try {
  while (true) {
    console.log('\nAI USB 维护\n1. 统一离线诊断（双平台文件、依赖、缓存、上次失败）\n2. CC Switch API 诊断（读取各 Agent 保存的配置）\n3. DeepSeek 直连 API 检查（私密输入 Key）\n4. 备份配置和会话\n5. 查看 / 恢复备份\n6. 从完整新版目录更新（先自动备份）\n7. 恢复中断的更新 / 恢复操作\n8. 清理异常退出或其他电脑的运行记录\n0. 返回 / 退出');
    const choice = (await input.question('选择 [0-8]：')).trim();
    if (choice === '0') break;
    try {
      if (choice === '1') await rows();
      else if (choice === '2') await rows(true);
      else if (choice === '3') { await directAPI(); break; }
      else if (choice === '4') console.log(`备份完成：${createBackup(root)}`);
      else if (choice === '5') {
        const names = listBackups(root);
        if (!names.length) { console.log('暂无备份'); continue; }
        names.forEach((name, i) => console.log(`${i + 1}. ${name}`));
        const number = (await input.question('输入备份编号以恢复，直接回车取消：')).trim();
        if (!number) continue;
        const selected = /^\d+$/.test(number) ? names[Number(number) - 1] : undefined;
        if (!selected) throw new Error('编号无效');
        if ((await input.question('将替换当前配置和会话，并先备份当前状态。输入 RESTORE 继续：')).trim() !== 'RESTORE') continue;
        const result = restoreBackup(root, selected);
        console.log(`恢复完成。恢复前备份：${result.before}\n更换路径后，请先通过启动器打开 CC Switch 刷新目录，再启动 Agent。`);
      } else if (choice === '6') {
        const source = (await input.question('完整新版目录路径（已解压，不要选当前目录）：')).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
        if (!source) continue;
        if ((await input.question('退出本目录所有 Agent 和 CC Switch 后，输入 UPDATE 继续：')).trim() !== 'UPDATE') continue;
        console.log('正在备份、复制并校验新版。完整包较大，请保持终端打开，完成前不要拔盘。');
        const result = updateFromFolder(root, source);
        console.log(`更新完成。配置/会话备份：${result.before}\n旧程序保留在：${result.previousRuntime}\n请退出此菜单后重新打开启动器。`);
        break;
      } else if (choice === '7') { recoverTransactions(root); console.log('中断操作已回退；可重新启动。'); }
      else if (choice === '8') {
        if ((await input.question('确认所有电脑上的本目录程序都已退出后，输入 EXITED：')).trim() === 'EXITED') { clearForeignRecords(root); console.log('运行记录已清理'); }
      } else console.log('选择无效');
    } catch (error) { console.error(`操作未完成：${error.message}`); }
  }
} finally { input.close(); }
