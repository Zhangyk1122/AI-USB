import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const PLATFORMS = ['darwin-arm64', 'win32-x64'];
export function requiredFiles(platform, agent = 'all') {
  const win = platform === 'win32-x64';
  const files = [win ? 'node.exe' : 'node'];
  if (['all', 'codex'].includes(agent)) files.push('node_modules/@openai/codex/bin/codex.js', win
    ? 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'
    : 'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
  if (['all', 'claude'].includes(agent)) files.push(`node_modules/@anthropic-ai/claude-code-${platform}/${win ? 'claude.exe' : 'claude'}`);
  if (['all', 'harness'].includes(agent)) files.push('node_modules/@deepseek-ai/dsh/lib/bin.js');
  if (['all', 'cc-switch'].includes(agent)) files.push(win ? 'cc-switch/cc-switch.exe' : 'cc-switch/CC Switch.app/Contents/MacOS/cc-switch');
  if (win && ['all', 'claude'].includes(agent)) files.push('git/bin/bash.exe', 'git/cmd/git.exe', 'git/usr/bin/msys-2.0.dll');
  return files;
}
export function runtimeChecks(root, { platform = `${process.platform}-${process.arch}`, agent = 'all', nodeVersion = process.versions.node } = {}) {
  const rows = [];
  const add = (status, name, detail) => rows.push({ status, name, detail });
  if (!PLATFORMS.includes(platform)) {
    add('FAIL', '系统架构', `${platform}；本包支持 Apple Silicon Mac 和 Windows x64`);
    return rows;
  }
  add('OK', '系统架构', platform);
  add(Number(nodeVersion.split('.')[0]) >= 24 ? 'OK' : 'FAIL', 'Node 版本', nodeVersion);
  for (const file of requiredFiles(platform, agent)) {
    const full = path.join(root, 'platforms', platform, file);
    let good = false;
    try { good = fs.statSync(full).isFile() && fs.statSync(full).size > 0; } catch {}
    add(good ? 'OK' : 'FAIL', '程序文件', `${platform}/${file}`);
    if (good && platform.startsWith('darwin') && (file === 'node' || /(?:\/codex|\/claude|\/cc-switch)$/.test(file))) {
      try { fs.accessSync(full, fs.constants.X_OK); }
      catch { add('FAIL', '执行权限', `${file} 不可执行，请检查 U 盘挂载权限或重新复制程序`); }
    }
  }
  return rows;
}
export function assertRuntime(root, options = {}) {
  const failures = runtimeChecks(root, options).filter(r => r.status === 'FAIL');
  if (failures.length) throw new Error(failures.map(r => `${r.name}: ${r.detail}`).join('\n'));
}
export function hostChecks(root, { exec = execFileSync, hostPlatform = process.platform } = {}) {
  const rows = [];
  if (hostPlatform === 'darwin') {
    try { exec('/usr/bin/git', ['--version'], { timeout: 5000, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); rows.push({ status: 'OK', name: '系统 Git', detail: '可用' }); }
    catch { rows.push({ status: 'WARN', name: '系统 Git', detail: '不可用；涉及 Git 的任务需要先准备系统 Git' }); }
  }
  if (hostPlatform === 'win32') {
    try {
      const script = `$p=Get-Item -LiteralPath $env:AI_USB_DIAG_ROOT;$v=Get-Volume -FilePath $p.FullName -ErrorAction Stop;$v.FileSystem`;
      const type = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 10000, encoding: 'utf8', windowsHide: true, env: { ...process.env, AI_USB_DIAG_ROOT: root } }).trim();
      rows.push({ status: /FAT32/i.test(type) ? 'WARN' : 'OK', name: 'U 盘文件系统', detail: `${type}；exFAT 的速度和兼容性仍需实盘测试` });
    } catch { rows.push({ status: 'WARN', name: 'U 盘文件系统', detail: '未能读取；请在磁盘属性中检查' }); }
    try {
      const script = `$roots=@('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients','Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients','Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\EdgeUpdate\\Clients');$v=Get-ChildItem $roots -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.name -match 'WebView2' -and $_.pv };if($v){'installed'}else{'missing'}`;
      const found = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, encoding: 'utf8', windowsHide: true }).trim() === 'installed';
      rows.push({ status: found ? 'OK' : 'WARN', name: 'WebView2', detail: found ? '检测到系统运行时' : '未检测到；CC Switch 界面打不开时需安装微软 WebView2 Runtime' });
    } catch { rows.push({ status: 'WARN', name: 'WebView2', detail: '检测失败；这只影响 CC Switch 图形界面' }); }
  }
  return rows;
}
export function failureReason({ code, signal, errorCode, stderr = '' }) {
  if (errorCode === 'ENOENT') return '程序或依赖缺失；运行统一诊断检查文件';
  if (errorCode === 'EACCES' || errorCode === 'EPERM') return '执行权限或安全策略阻止启动；检查挂载权限、系统拦截提示';
  if (/EADDRINUSE|address already in use/i.test(stderr)) return '端口被占用；退出原有实例或为工具选择其他端口';
  if (/401|authentication_error|invalid.api.key/i.test(stderr)) return 'API 认证失败；检查当前供应商的 Key';
  if (/429|rate.limit|insufficient.*(balance|quota)/i.test(stderr)) return 'API 额度、余额或频率限制；检查供应商账户';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(stderr)) return '网络或接口不可达；运行 API 连通性检查';
  if (/WebView2/i.test(stderr)) return 'WebView2 运行时异常；检查系统组件';
  if (signal || code === 130) return '进程被中断或终止';
  return `程序退出码 ${code ?? '未知'}；查看此终端上方的原始报错，再运行统一诊断`;
}
