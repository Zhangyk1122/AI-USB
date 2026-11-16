import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// This demo ships a single runtime: Windows x64.
export const PLATFORMS = ['win32-x64'];
export const PLATFORM = PLATFORMS[0];

export function requiredFiles(platform = PLATFORM) {
  if (platform !== PLATFORM) return [];
  return ['node.exe', 'node_modules/@deepseek-ai/dsh/lib/bin.js'];
}

function isFile(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0; } catch { return false; }
}

export function runtimeChecks(root, { platform = PLATFORM, nodeVersion = process.versions.node } = {}) {
  const rows = [];
  const add = (status, name, detail) => rows.push({ status, name, detail });
  if (!PLATFORMS.includes(platform)) {
    add('FAIL', '运行时平台', platform + '；本包只包含 Windows x64 运行时');
    return rows;
  }
  add('OK', '运行时平台', platform);
  add(Number(String(nodeVersion).split('.')[0]) >= 24 ? 'OK' : 'FAIL', 'Node 版本', String(nodeVersion));
  for (const file of requiredFiles(platform)) {
    add(isFile(path.join(root, 'platforms', platform, file)) ? 'OK' : 'FAIL', '程序文件', platform + '/' + file);
  }
  // Optional: without it the web plugin manager can still toggle shipped plugins, but not install new ones.
  const pnpm = isFile(path.join(root, 'platforms', platform, 'pnpm/pnpm.exe'));
  add(pnpm ? 'OK' : 'WARN', 'pnpm（可选）', pnpm ? '可在插件管理中安装第三方插件' : '缺少；只能开关随包自带的可选插件');
  return rows;
}

export function assertRuntime(root, options = {}) {
  const failures = runtimeChecks(root, options).filter(row => row.status === 'FAIL');
  if (failures.length) throw new Error(failures.map(row => row.name + ': ' + row.detail).join('\n'));
}

export function assertHost(hostPlatform = process.platform) {
  if (hostPlatform !== 'win32') {
    throw new Error('本 Demo 只包含 Windows x64 运行时，当前系统为 ' + hostPlatform
      + '。请把整个 AI-USB-Demo 目录复制到 Windows 10/11 (x64) 电脑，双击 dsh.bat 启动。');
  }
}

export function hostChecks(root, { hostPlatform = process.platform, exec = execFileSync } = {}) {
  const rows = [];
  if (hostPlatform !== 'win32') {
    rows.push({ status: 'WARN', name: '当前系统', detail: hostPlatform + '；本 Demo 只提供 Windows x64 运行时，请在 Windows 电脑上运行' });
    return rows;
  }
  try {
    const script = '$p=Get-Item -LiteralPath $env:AI_USB_DIAG_ROOT;$v=Get-Volume -FilePath $p.FullName -ErrorAction Stop;$v.FileSystem';
    const type = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 10000, encoding: 'utf8', windowsHide: true, env: { ...process.env, AI_USB_DIAG_ROOT: root } }).trim();
    rows.push({ status: /FAT32/i.test(type) ? 'WARN' : 'OK', name: 'U 盘文件系统', detail: type + '；exFAT 的速度仍需实盘测试' });
  } catch {
    rows.push({ status: 'WARN', name: 'U 盘文件系统', detail: '未能读取；请在磁盘属性中检查' });
  }
  return rows;
}

export function failureReason({ code, signal, errorCode, stderr = '' }) {
  if (errorCode === 'ENOENT') return '程序或依赖缺失；运行统一诊断检查文件';
  if (errorCode === 'EACCES' || errorCode === 'EPERM') return '执行权限或安全策略阻止启动；检查挂载权限、系统拦截提示';
  if (/EADDRINUSE|address already in use/i.test(stderr)) return '端口被占用；关闭已有 Harness 窗口或为它选择其他端口';
  if (/401|authentication_error|invalid.api.key/i.test(stderr)) return 'API 认证失败；在 Harness 的模型设置中检查供应商 Key';
  if (/429|rate.limit|insufficient.*(balance|quota)/i.test(stderr)) return 'API 额度、余额或频率限制；检查供应商账户';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(stderr)) return '网络或接口不可达；检查网络与供应商地址';
  if (signal || code === 130) return '进程被中断或终止';
  return '程序退出码 ' + (code ?? '未知') + '；查看此终端上方的原始报错，再运行统一诊断';
}
