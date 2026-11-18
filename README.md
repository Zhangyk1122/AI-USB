# AI-USB：DeepSeek Harness 便携启动包（Windows x64）

> 本目录只包含一个 Agent：**DeepSeek Harness**。Codex、Claude Code、CC Switch 以及 Mac（Apple Silicon）运行时均已移除。

## 这是什么

一份可以直接复制到 U 盘/移动硬盘的便携运行包：插到 Windows 10/11 x64 电脑上，双击 `dsh.bat`（或在该目录的终端里直接敲 `dsh`）就能启动 DeepSeek Harness 的 Web 界面。目标电脑无需安装 Node、npm 或任何 Agent。

首次启动**不需要 API Key**：启动器不注入、不索取、不保存 Key，Harness 使用自身默认配置；打开 Web 界面后在模型/供应商设置里自行添加即可。

## 快速开始（首次部署）

推荐下载 Release 里的整包（约 265 MB），而不是把开发目录整个拷过去（1 GB，且没有版本标记，之后更新会退化成整包）：

1. 打开 [Releases](https://github.com/Zhangyk1122/AI-USB/releases)，下载最新的 `AI-USB-Demo-win32-x64.zip` 与 `SHA256SUMS.txt`。
2. （建议）在 Windows 上核对哈希：`Get-FileHash .\AI-USB-Demo-win32-x64.zip -Algorithm SHA256`，与 `SHA256SUMS.txt` 比对。
3. 解压到 U 盘根目录，得到 `AI-USB-Demo/`；解压后约 948 MB，U 盘建议 exFAT/NTFS。
4. 插到 Windows，双击 `dsh.bat`（或在该目录终端执行 `dsh`；PowerShell 里写 `.\dsh`）。
   终端打印 `http://127.0.0.1:端口` 后浏览器会自动打开；关闭终端即停止服务。
5. 首次使用在 Harness 的供应商设置里填 API Key，配置保存在 U 盘 `data/harness`。
   以后更新走维护菜单 `4` → `1`，只下载变化的文件。

工作目录默认为 `workspace/`；也可以在启动前用环境变量指定：

```powershell
$env:AI_USB_WORKSPACE = 'E:\your-project'
& 'F:\AI-USB-Demo\dsh.bat'
```

## 目录说明

| 路径 | 内容 |
|---|---|
| `dsh.bat` / `dsh.ps1` | 日常启动入口，直接启动 Harness Web |
| `Windows-Start.bat` | 兼容别名，转发到 `dsh.bat` |
| `使用说明.txt` | 纯文本入门说明，U 盘场景直接打开看 |
| `Windows-Maintain.bat` / `.ps1` | 维护入口：诊断、备份、恢复、更新 |
| `lib/` | 启动器与维护功能（Node ESM 源码） |
| `platforms/win32-x64/` | 打包的 Node 24.17.0、DeepSeek Harness 0.2.1-rc.5，以及 pnpm 12.21.0（供插件安装） |
| `data/harness/` | Harness 的配置、凭据和会话（随盘保存） |
| `data/.portable-id` | 便携标识，用于在本机复用缓存 |
| `workspace/` | 默认工作目录 |
| `backups/` | 备份快照（首次备份时创建） |

## 数据与缓存

- `DSH_HOME` 与 `DSH_AGENTS_HOME` 固定指向 U 盘内的 `data/harness/`，换电脑后配置和会话随盘走。
- 可重建的缓存（npm、Node 编译缓存、临时文件）优先放在本机：
  Windows 为 `%LOCALAPPDATA%\AI-USB-Demo\<ID>\`；本机不可写时自动回退到 U 盘 `data/cache/`，并在启动信息中提示。
- 启动器不设置任何供应商变量；宿主机已有的 `DEEPSEEK_API_KEY` 等变量会按 Harness 自身默认行为处理。
- 简要运行结果写在本机缓存的 `logs/last-run.json`，不记录 Key、会话内容或模型响应。

## 换端口 / 局域网访问

`web` 是默认 profile，它的参数必须写在 `web` **后面**——写在前面会被 dsh 界面层当作“缺少 profile”（`error: --profile <name> is required`）：

```powershell
dsh web --port 8080                 # 换端口
dsh web --no-open                   # 不自动打开浏览器
dsh web --host 192.168.1.50 --port 8080 --trusted-host 192.168.1.50:8080
                                    # 绑定局域网地址，供其它设备访问
```

`--host` 只接受本机某个具体网卡地址，不接受 `0.0.0.0` 这类通配地址。用局域网地址访问时，
Windows 防火墙需要放行该端口，并且可能要给 `/api` 追加 `--trusted-host`。

## 插件

Web 界面的「设置 → 插件管理」里有两类操作：

- **开关随包插件**：12 个 experimental 插件（会话搜索、会话标题、内置终端、语音输入、自动评审、Agent 团队等）已经装在 `node_modules` 里，只是默认关闭。开关不需要网络，结果写进 `data/harness/profiles/<profile>/package.json`，随 U 盘保存。
- **声明式配置**：把 `plugins.example.txt` 复制成 `data/plugins.txt`，逐行写插件别名，启动器每次启动自动应用（只增不减、幂等）。也可以直接用命令行：

```powershell
node lib\plugins.mjs list                 # 查看状态
node lib\plugins.mjs add session-search   # 启用
node lib\plugins.mjs remove terminal      # 停用
```

| 别名 | 插件作用 |
|---|---|
| `session-search` | 会话全文搜索 |
| `session-titles` | 自动生成会话标题 |
| `terminal` | 内置终端面板 |
| `voice-input` | 语音输入（需要麦克风） |
| `cot-translation` | 思维链翻译 |
| `auto-review` | 自动评审改动 |
| `agent-team` | 多 Agent 协作 |
| `plugin-market` | 插件市场入口（Discover） |
| `inspector` | 检查器 / DevTools |
| `tool-worktree` | Git worktree 工具 |
| `badge-skill` | 徽章技能展示 |
| `ralph` | 实验性循环执行 |

- **安装第三方插件**：需要 pnpm。本包已内置 `platforms/win32-x64/pnpm/pnpm.exe`（12.21.0）并自动加进 PATH，目标电脑不需要另装。pnpm 的 store 与全局 bin 指向本机缓存 `%LOCALAPPDATA%\AI-USB-Demo\<ID>\pnpm-store`、`pnpm-home`，不写 U 盘。

experimental 插件由上游标注为不稳定；升级 DSH 版本后建议逐个确认能否加载，开关前先做一次备份。

## 发版流程（打 tag 自动出包）

标签规则：`v0.1.1`、`v0.1.2`……（`v0.1.` 固定，最后一位每发一版加一）。

### 1. 需要新运行时的话，先改版本号

编辑 `BUILD-INFO.json` 的 `versions`：

```json
"versions": { "node": "24.17.0", "deepseek-harness": "0.2.2-rc.3", "pnpm": "12.21.0" }
```

工作流会**按这里的版本**去 npm 和 nodejs.org 下载，不需要改 workflow 文件。

### 2. 本地先验一遍

```powershell
node lib/seal.mjs                  # 重算 RUNTIME-SHA256.json、同步版本与 trimmed
node --test tests/*.test.mjs       # 28 项
node lib/doctor.mjs --verify-hashes
```

### 3. 提交并打标签

```bash
git add -A
git commit -m "release v0.1.2"
git tag v0.1.2
git push origin main --tags
```

### 4. 等 CI（约 3 分钟）

Actions → `build-portable`。全部通过后，Releases 里会出现：

```
AI-USB-Demo-win32-x64.zip      ≈ 265 MB   整包
SHA256SUMS.txt                    校验和
delta-from-<上一版>.zip            增量包（只含变化的文件）
delta-from-<上一版>.json           增量清单
```

### 5. 下载并核对

```powershell
Get-FileHash .\AI-USB-Demo-win32-x64.zip -Algorithm SHA256
# 与 SHA256SUMS.txt 里的值比对
```

### 6. 更新 U 盘

两种方式：

- **在线增量**（推荐）：U 盘插到 Windows，双击 `Windows-Maintain.bat` → `4` → `1`，只下载变化的文件，失败自动回退。
- **手动整包**：下载 zip 解压，只覆盖程序文件（`platforms/`、`lib/`、`dsh.bat`、文档），**不要覆盖 `data/`** —— 那里是你的 Key、配置和会话。

### 7. 回滚

下载上一个 tag 的 zip 覆盖即可；`data/` 不受影响。

### 常见问题

| 现象 | 处理 |
|---|---|
| CI 红在某一步 | Actions 里点开该步骤看日志；本地用同一条命令复现 |
| 想删掉打错的 tag | `git tag -d v0.1.2 && git push --delete origin v0.1.2`，Release 在网页上删 |
| 只想手动跑一次不发 Release | Actions → Run workflow（只上传 Actions 产物） |

## 维护

双击 `Windows-Maintain.bat`，或在终端运行：

```powershell
& '.\Windows-Maintain.bat'
```

菜单提供：统一离线诊断、备份、查看/恢复备份、**从 GitHub 在线增量更新**（或本地目录更新）、恢复中断操作、清理遗留运行记录。细节见 [MAINTENANCE.md](MAINTENANCE.md)。

`BUILD-INFO.json` 里的版本号**在每次启动时自动同步**（从 `node.exe` 和 dsh 的 `package.json` 读取），不需要手动维护。打包新版时用 `node lib/seal.mjs` 一次生成 `RUNTIME-SHA256.json`、版本号和 `trimmed` 日期；`node lib/version.mjs` 只用于单独查看版本。

## 兼容范围

- 仅 Windows 10/11 **x64**。不包含 Mac、Linux、Windows ARM 运行时。
- Harness 界面使用系统浏览器，不需要 WebView2。
- 建议 U 盘容量 8GB 以上；移动 SSD 比普通 U 盘快很多。
- 程序已在目录整体移动（含空格路径）后验证可启动；Windows 端尚未实机运行验证。
- 需要让 Harness 执行 `git` 命令时，请在目标电脑安装系统 Git 并确保在 PATH 中（本包不再附带 PortableGit）。
- 不要在运行中把同一目录同时给两台电脑写入；退出后再安全弹出 U 盘。

## 运行时重建

`platforms/` 体积约 950MB，不进入 Git。如果该目录丢失，可在任意带 Node 24 的 Windows 机器上重建：

```powershell
cd platforms\win32-x64
# 1) 放置 Node 24.17.0 的 node.exe（nodejs.org 官方 win-x64 zip）
# 2) 安装唯一的 Agent
npm install @deepseek-ai/dsh@0.2.1-rc.5 --os=win32 --cpu=x64
# 3) 需要 Agent 执行 git 命令时，另行安装系统 Git 并加入 PATH
# 4) pnpm 为可选：取 pnpm 的 GitHub Release 资产 pnpm-win32-x64.zip，
#    解压到 platforms\win32-x64\pnpm\（含 pnpm.exe 与 dist\）
```

校验哈希见 [RUNTIME-SHA256.json](RUNTIME-SHA256.json)。此前移除的组件可从上游恢复：Codex（`@openai/codex`）、Claude Code（`@anthropic-ai/claude-code`）、[CC Switch v4.0.22](https://github.com/farion1231/cc-switch/releases/tag/v4.0.22)、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 检查与测试

单元测试只需要 Node 24，不依赖 U 盘运行时的平台：

```bash
node --test tests/*.test.mjs          # 含 DSH 启动计划、缓存、锁、备份/恢复/更新事务、版本检测
node lib/doctor.mjs --verify-hashes   # 文件完整性与 SHA256；Windows 上会附带 DSH 版本探针
```

在非 Windows 系统上诊断会提示“当前系统不是 Windows”，这是预期行为（程序只随包提供 Windows 运行时）。已完成的检查见 [VALIDATION.md](VALIDATION.md)。
