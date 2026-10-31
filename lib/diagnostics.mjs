import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeChecks, hostChecks, PLATFORMS, failureReason } from './preflight.mjs';
import { portableCache } from './portable-cache.mjs';
import { activeLeases } from './state-lock.mjs';
import { checkAPIs } from './api-diagnostics.mjs';
import { digest } from './maintenance.mjs';
import { buildAgentPlan } from './agent-plan.mjs';

export async function diagnose(root, { online = false, mode = 'cc', agent = 'all', allPlatforms = false, verifyHashes = false, probe = true } = {}) {
  const rows = [], platform = `${process.platform}-${process.arch}`;
  const add = (status, name, detail) => rows.push({ status, name, detail });
  for (const value of (allPlatforms ? PLATFORMS : [platform])) rows.push(...runtimeChecks(root, { platform: value, agent }));
  rows.push(...hostChecks(root));
  let cache;
  try {
    cache = portableCache(root);
    add(cache.local ? 'OK' : 'WARN', '缓存目录', `${cache.root}${cache.local ? '（本机）' : '（本机不可写，回退到 U 盘）'}`);
    const log = path.join(cache.root, 'logs/last-run.json');
    if (fs.existsSync(log)) {
      const last = JSON.parse(fs.readFileSync(log));
      add(last.status === 'failed' ? 'WARN' : 'OK', '最近一次运行', `${last.at} | ${last.program} | ${last.status}${last.reason ? ` | ${last.reason}` : ''}`);
    }
  } catch { add('FAIL', '目录写入', '无法创建缓存或 U 盘数据目录；检查剩余空间和写入权限'); }
  try {
    const leases = activeLeases(root);
    add(leases.length ? 'WARN' : 'OK', '运行状态', leases.length ? `${leases.length} 个活动或其他电脑的运行记录；备份/恢复/更新前请退出程序` : '无活动运行记录');
    if (fs.existsSync(path.join(root, 'data/.runtime/mutex'))) add('WARN', '维护锁', '有操作正在进行，或上次异常退出；确认退出后可清理运行记录');
  } catch { add('WARN', '运行状态', '记录不完整；确认所有程序退出后，用维护菜单清理运行记录'); }
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
    } catch { add('FAIL', 'SHA256', '清单无效或程序缺失；请重新复制完整发布目录'); }
  }
  if (probe && PLATFORMS.includes(platform) && !runtimeChecks(root).some(r => r.status === 'FAIL')) {
    for (const name of ['codex', 'claude', 'harness']) {
      const plan = await buildAgentPlan({ root, agent: name, extra: ['--cc-switch', '--version'] });
      const result = spawnSync(plan.command, plan.args, { timeout: 20000, windowsHide: true, encoding: 'utf8', maxBuffer: 128 * 1024, cwd: plan.cwd, env: plan.env });
      add(result.status === 0 ? 'OK' : 'FAIL', `${name} 依赖加载`, result.status === 0 ? '版本命令运行成功' : failureReason({ code: result.status, errorCode: result.error?.code, stderr: result.stderr || '' }));
    }
  }
  if (online) rows.push(...await checkAPIs(root, { mode, agent }));
  else add('SKIP', 'API 连通性', '离线诊断；在线检查请选维护菜单中的 API 诊断');
  return rows;
}
