import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildAgentPlan } from './agent-plan.mjs';
import { assertRuntime, failureReason } from './preflight.mjs';
import { acquireLease } from './state-lock.mjs';
import { portableCache, recordRun } from './portable-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [agent, ...extra] = process.argv.slice(2);
let bridge, lease, cacheRoot;
try {
  assertRuntime(root, { agent });
  lease = acquireLease(root, agent);
  cacheRoot = portableCache(root).root;
  const plan = await buildAgentPlan({ root, agent, extra });
  bridge = plan.bridge;
  console.error(`AI USB Demo | ${agent} | ${plan.mode} | ${plan.platform}\nWorkspace: ${plan.cwd}`);
  console.error(`Cache: ${plan.env.AI_USB_CACHE_DIR}${plan.env.AI_USB_CACHE_LOCAL === '0' ? ' (本机不可写，回退到 U 盘)' : ''}`);
  // Preserve the real terminal for interactive Agent UIs. Only capture stderr when it was already redirected.
  const captureErrors = !process.stderr.isTTY;
  const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: plan.env, stdio: ['inherit', 'inherit', captureErrors ? 'pipe' : 'inherit'] });
  let stderr = '', exitSignal;
  child.stderr?.on('data', chunk => { process.stderr.write(chunk); stderr = (stderr + chunk.toString()).slice(-16384); });
  child.once('spawn', () => lease.child(child.pid));
  // Child shares the terminal process group; keep the parent alive for bridge cleanup.
  const interrupted = () => {};
  const terminated = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', terminated);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { exitSignal = signal; resolve(code ?? (signal ? 130 : 1)); });
    });
    const reason = process.exitCode ? failureReason({ code: process.exitCode, signal: exitSignal, stderr }) : undefined;
    recordRun(cacheRoot, { program: agent, mode: plan.mode, status: process.exitCode ? 'failed' : 'ok', code: process.exitCode, signal: exitSignal, reason });
    if (reason) console.error(`\n启动诊断：${reason}\n可从主菜单的维护入口运行统一诊断。`);
  } finally {
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', terminated);
  }
} catch (error) {
  console.error(`AI USB Demo: ${error.message}`);
  if (cacheRoot) recordRun(cacheRoot, { program: agent, status: 'failed', reason: error.code ? failureReason({ errorCode: error.code }) : '启动准备失败；查看终端提示并运行统一诊断' });
  process.exitCode = 1;
} finally {
  if (bridge) await bridge.close();
  lease?.release();
}
