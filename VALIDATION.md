# 验证记录（精简版：2026-11-15）

## 本次改动

由“Mac arm64 + Windows x64 双平台、Codex + Claude Code + Harness 三个 Agent、CC Switch 配置管理”精简为：

- 只保留 **DeepSeek Harness**（`@deepseek-ai/dsh` 0.2.1-rc.5）
- 只保留 **Windows x64** 运行时与启动脚本
- 删除 CC Switch 及其全部便携隔离逻辑、Codex 的本地 Responses 适配器、API 诊断入口
- 内置 pnpm 12.21.0（`platforms/win32-x64/pnpm/`），并把 pnpm store 与全局 bin 重定向到本机缓存，支持在 Web 插件管理里安装第三方插件
- 启动时**不再索取注入 API Key**，Harness 使用自身默认配置

## 已在本机（macOS）验证

- 目录结构与文件级检查通过：`platforms/win32-x64/node.exe`、`@deepseek-ai/dsh/lib/bin.js` 存在。
- 单元测试 **37 项全部通过**（Node 24.17.0）：
  - DSH 启动计划：`DSH_HOME`/`DSH_AGENTS_HOME` 指向 `data/harness`、默认参数为 `web`、不注入任何 Key、非 Windows 主机被拒绝并给出可操作提示
  - 本机缓存命中/移动目录复用/不可写回退
  - 锁：运行中禁止备份、维护互斥、遗留记录清理
  - 备份/恢复：逐字节保存、缓存与临时链接排除、损坏清单与路径穿越拒绝、恢复前自动备份
  - 更新：暂存后二次校验、失败自动回退、旧程序保留
  - 失败归因日志不含原始 stderr 与凭据
- `lib/doctor.mjs` 在非 Windows 上正确输出 `WARN 当前系统` 与 `SKIP DSH 依赖加载`，程序文件检查符合预期。

## 尚未验证

- **Windows 实机未运行**：启动脚本、`node.exe`、`dsh web` 与浏览器访问尚待在 Windows 10/11 x64 上实测。
- **真实 DeepSeek API 未调用**：Key 由用户后续在 Harness 界面自行配置，本次未做任何真实推理。
- 真实 U 盘 / exFAT 上的启动速度、权限与长路径表现未测试。
- 本机（macOS）无法执行 Windows 二进制，因此“复制到 U 盘即可启动”这一端到端链路需要你在 Windows 上确认。

## 已知限制

- 只认 Windows x64；其他平台启动会直接报错退出，而不是静默失败。
- 不再附带 PortableGit；需要 Git 任务时由目标电脑的系统 Git 提供。
- `platforms/` 约 950MB，不进入 Git；重建方法见 README。

## 更新机制验证（2026-11-18 起，CI 在真实 Windows 上执行）

| 版本 | CI | 产出 |
|---|---|---|
| v0.1.0 | 全绿 | 整包 265 MB |
| v0.1.1–v0.1.3 | 全绿 | 整包 + 增量（曾短暂使用增量方案） |
| v0.1.4 起 | 全绿 | 只发整包 + SHA256SUMS.txt（已切换为全量包方案） |

方案演进：早期用「整包 + 增量链」，实测增量仅 8–40 KB。但增量链需要下载上一版、比对两棵树的文件哈希、维护逐跳链与边界回退，复杂度高；最终改为**全量包方案**——每个 Release 只发一个完整 zip + 校验和，更新器每次下载最新包、校验 SHA256、事务式替换，data/ 与 workspace/ 永不改动。

过程中由 CI 暴露并修复的缺陷：

1. `new URL(import.meta.url).pathname` 在 Windows 上返回 `/D:/...`，导致 `createRequire` 锚点非法、CLI 入口判断失效；改用 `fileURLToPath`。
2. 增量清单把检出目录里的 CI 产物当成包内文件；已在白名单中排除，并增加包外路径拒绝。

