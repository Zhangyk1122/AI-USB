import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeChecks, hostChecks, PLATFORMS, failureReason } from './preflight.mjs';
import { portableCache } from './portable-cache.mjs';
import { activeLeases } from './state-lock.mjs';
import { digest } from './maintenance.mjs';
import { buildAgentPlan } from './agent-plan.mjs';

export async function diagnose(root, { verifyHashes = false, probe = true } = {}) {
  const rows = [];
  const add = (status, name, detail) => rows.push({ status, name, detail });
  for (const platform of PLATFORMS) rows.push(...runtimeChecks(root, { platform }));
  rows.push(...hostChecks(root));
  let cache;
  try {
    cache = portableCache(root);
    add(cache.local ? 'OK' : 'WARN', '缓存目录', cache.root + (cache.local ? '（本机）' : '（本机不可写，回退到 U 盘）'));
    const log = path.join(cache.root, 'logs/last-run.json');
    if (fs.existsSync(log)) {
      const last = JSON.parse(fs.readFileSync(log));
      add(last.status === 'failed' ? 'WARN' : 'OK', '最近一次运行', last.at + ' | ' + last.program + ' | ' + last.status + (last.reason ? ' | ' + last.reason : ''));
    }
  } catch {
    add('FAIL', '目录写入', '无法创建缓存或 U 盘数据目录；检查剩余空间和写入权限');
  }
  try {
    const leases = activeLeases(root);
    add(leases.length ? 'WARN' : 'OK', '运行状态', leases.length ? leases.length + ' 个活动或其他电脑的运行记录；备份/恢复/更新前请退出程序' : '无活动运行记录');
    if (fs.existsSync(path.join(root, 'data/.runtime/mutex'))) add('WARN', '维护锁', '有操作正在进行，或上次异常退出；确认退出后可清理运行记录');
  } catch {
    add('WARN', '运行状态', '记录不完整；确认所有程序退出后，用维护菜单清理运行记录');
  }
  const txnBase = path.join(root, 'backups/.transactions');
  if (fs.existsSync(txnBase)) for (const name of fs.readdirSync(txnBase)) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(txnBase, name, 'journal.json'))).state === 'installing') add('FAIL', '未完成操作', '请先在维护菜单选择“恢复中断操作”');
    } catch { /* staging may not have reached the replacement step */ }
  }
  if (verifyHashes) {
    try {
      const hashes = JSON.parse(fs.readFileSync(path.join(root, 'RUNTIME-SHA256.json')));
      for (const [name, expected] of Object.entries(hashes)) {
        if (!name.startsWith('platforms/') || name.includes('..') || name.includes('\\')) throw new Error('invalid path');
        add(digest(path.join(root, name)) === expected ? 'OK' : 'FAIL', 'SHA256', name);
      }
    } catch {
      add('FAIL', 'SHA256', '清单无效或程序缺失；请重新复制完整发布目录');
    }
  }
  const filesOk = !runtimeChecks(root).some(row => row.status === 'FAIL');
  if (!probe) add('SKIP', 'DSH 依赖加载', '已按参数跳过版本探针');
  else if (process.platform !== 'win32') add('SKIP', 'DSH 依赖加载', '需要 Windows 环境；请复制到 Windows 电脑后运行诊断');
  else if (!filesOk) add('SKIP', 'DSH 依赖加载', '程序文件不完整，先修复文件');
  else {
    const plan = await buildAgentPlan({ root, extra: ['--version'] });
    const result = spawnSync(plan.command, plan.args, { timeout: 30000, windowsHide: true, encoding: 'utf8', maxBuffer: 128 * 1024, cwd: plan.cwd, env: plan.env });
    const version = (result.stdout || '').trim().split('\n').filter(Boolean).pop();
    add(result.status === 0 ? 'OK' : 'FAIL', 'DSH 依赖加载', result.status === 0
      ? '版本命令运行成功' + (version ? '（' + version + '）' : '')
      : failureReason({ code: result.status, errorCode: result.error?.code, stderr: result.stderr || '' }));
  }
  return rows;
}
