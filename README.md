# AI-USB：三个 Agent + CC Switch

> 本仓库提交启动器、适配器、维护功能、测试与依赖锁文件。约 4GB 的 Mac/Windows 运行时、用户配置、Key、会话、备份和工作区不进入 Git。**直接下载 GitHub 源码 ZIP 还不能启动 Agent**；下文“复制整个目录即可启动”指已经准备好 `platforms/` 运行时的完整便携目录。各组件版本见 `BUILD-INFO.json`，两套 npm 依赖的固定版本见 `platforms/*/package-lock.json`；目前没有自动构建完整运行包的脚本。

已准备 Mac Apple Silicon（arm64）和 Windows x64 两套程序，包含 CC Switch 4.0.22。三个 Agent 是命令行/Web 版，CC Switch 是配置管理桌面程序。

## 使用

1. 把整个 `AI-USB-Demo` 目录复制到 U 盘，不要只复制启动脚本。
2. Mac 双击 `Mac-Start.command`；Windows 双击 `Windows-Start.bat`。
3. 选 `5` 打开 U 盘 CC Switch。在 Claude Code、Codex、DeepSeek Harness 三个页面分别添加 DeepSeek API 供应商，填入自己的 Key 并保存/启用。
4. 再打开一次主菜单，选 `6` Codex、`7` Claude Code、`8` Harness，读取 CC Switch 保存的配置。切换供应商或模型后，重新启动对应 Agent。
5. CC Switch 模式会把 Key 和供应商配置保存在 U 盘的 `data/cc-switch/` 中。详细步骤见 [CC-SWITCH.md](CC-SWITCH.md)。
6. 主菜单选 `9` 打开维护：统一诊断、分别检查 CC Switch/直连 API、备份恢复、从完整新版目录更新。详见 [MAINTENANCE.md](MAINTENANCE.md)。

日常直接从 U 盘的解压目录启动，不需要压缩，也不需要全局安装 Agent。程序仍在 U 盘；配置和会话随盘保存，可重建缓存优先放在本机。

打开 U 盘版前，需要完全退出电脑上已运行的 CC Switch（包括托盘/菜单栏）。请通过本 Demo 的启动器打开，不要直接双击内部的 CC Switch App/EXE，否则无法带入 U 盘目录设置。

原来的 DeepSeek 直连入口仍在：菜单 `1–3`，启动时私密输入 Key；`4` 检查 API 连通性与模型列表接口。直连模式默认不把输入的 Key 写入文件。两种模式使用各自的数据目录；菜单 `4` 只检查你当次输入的官方 DeepSeek Key，不代表已经验证 CC Switch 中的供应商配置；维护菜单 `2` 可分别检查 CC 配置。

默认操作 `workspace/`，可先把测试代码放进去。不要在首次体验时直接选择重要的生产目录。
也可以在终端指定目录，然后运行启动脚本：

```bash
# Mac：用你实际的 U 盘目录替换下方路径
export AI_USB_WORKSPACE="/path/to/your/project"
"/Volumes/你的U盘/AI-USB-Demo/Mac-claude.command"
```

```powershell
# Windows
$env:AI_USB_WORKSPACE = 'D:\your-project'
& 'E:\AI-USB-Demo\Windows-claude.ps1'
```

直连模式也可以在当前终端提前设置 `DEEPSEEK_API_KEY`，这样不会重复询问。CC Switch 模式使用它保存的 Key、地址和模型，会清除继承的供应商环境变量，避免宿主机旧设置覆盖 U 盘配置。不要把真实 Key 放在聊天、README 或版本控制里。

## DeepSeek 直连方式（菜单 1–3）

| 工具 | 接入路径 | 状态 |
|---|---|---|
| Claude Code | DeepSeek 官方 Anthropic 兼容接口 | 已验证 Mac 程序版本；真实 API 尚待你的 Key 验证 |
| DeepSeek Harness | 官方 DeepSeek provider | 已验证 Mac Web UI 正常启动；真实模型调用尚待验证 |
| Codex CLI | 本地 Responses → DeepSeek Chat Completions 适配器 | 实验性；实际 Codex 的离线工具调用回环已通过 |

选择 DeepSeek 时，底层模型都是 DeepSeek，并不会变成 OpenAI 或 Anthropic 的模型。CC Switch 模式还可以选择其他兼容供应商，各工具分别设置。
Claude 与 Codex 默认模型是 `config/settings.json` 中的 `deepseek-flash`（依据准备时 DeepSeek 官方文档）。
Harness 默认使用其自身提供商/模型配置，在 Web 页面的 Models/模型设置里选择 DeepSeek 官方 API 模型。
先用菜单 4 检查你的账户是否能读取模型列表；模型 ID 以供应商官方文档或 Agent/CC Switch 模型选择为准。如果型号不同，修改 settings.json 中的 model，Harness 则在其页面选择。

不需要 OpenAI Key 或 Anthropic Key，也不需要作者运营的第三方中转站。
下载准备阶段使用官方 npm、Node.js 和 GitHub 发布源；直连模式默认访问 DeepSeek 官方 API，CC Switch 模式按你选择的供应商配置访问。
“联网即用”仍取决于你的网络能访问 api.deepseek.com，以及 Key 有效、账户余额/权限充足。

## 数据与环境

- `platforms/darwin-arm64/`：Mac Node 和三个 Agent。
- `platforms/win32-x64/`：Windows Node、三个 Agent、PortableGit/Git Bash。
- `data/codex/`：独立 CODEX_HOME。
- `data/claude/`：独立 CLAUDE_CONFIG_DIR。
- `data/harness/`：独立 DSH_HOME 和 DSH_AGENTS_HOME。
- `platforms/*/cc-switch/`：对应系统的 CC Switch 程序。
- `data/cc-switch/controller-home/.cc-switch/`：U 盘 CC Switch 数据库、供应商与界面设置。
- `data/cc-switch/agents/`：CC Switch 管理的 Codex、Claude、Harness 配置与会话目录。
- `lib/bridge.mjs`：Codex 适配器，只监听 127.0.0.1，动态端口、随机本地鉴权 token。
- `workspace/`：默认工作目录。
- `backups/`：带 SHA256 清单的配置/会话备份；更新和恢复前自动备份。
- 本机用户缓存 `AI-USB-Demo/<ID>/`：npm、Node 编译缓存、临时目录、简要运行诊断；不将整个 Agent HOME 移到本机。

启动不需要全局安装 Node、npm 或这三个 Agent。Mac 使用系统 Bash；如果要执行 Git 操作，目标 Mac 还需要可用的系统 Git（本 Demo 未附带 macOS Git）。Windows 自带 PowerShell 作为启动入口，Git Bash 已打包。CC Switch 的 Windows 界面需要系统 WebView2 Runtime；多数 Windows 10/11 已具备，缺少时仍需补装该系统组件。
运行和会话的核心目录指向 U 盘；系统临时文件、系统钥匙串、终端/浏览器记录和工具自身的其他缓存，不保证全部随盘或完全不落宿主机。
不要把运行中的同一目录同时给两台机器写入；退出 Agent 后再安全弹出 U 盘。

## 兼容范围

- 这份 Demo 不包含 Intel Mac、Windows ARM 或 Linux 运行时。
- 建议容量至少 16GB。跨 Mac/Windows 可先用 exFAT 测试；移动 SSD 比普通 U 盘更合适。
- macOS 需要系统允许启动这些程序；Windows 可能受单位执行策略、终端管控和安全软件限制。
- macOS/Windows 共享的是目录与配置，不代表每个 Agent 的所有会话都能无差异跨平台恢复。
- Windows 文件与原生依赖已准备，但尚未在 Windows 实机运行验证。
- 保留各依赖的许可证文件；二进制是否可再分发受各自许可证/条款约束。

## Codex 适配器的边界

这是一份兼容性 Demo，不是完整 Responses API 服务。
支持文本、函数工具调用、custom/apply_patch 输入包装、工具结果回传、namespace 工具名称映射、SSE 事件、基础用量和错误。
不支持图片/音频、OpenAI 托管 web_search、远端 Responses 状态、previous_response_id、完整推理块或完整平台功能。
已将 Codex 托管网页搜索关闭。上游回答收齐后转换成 SSE，等待时有心跳，并非逐 token 真流式。
工具调用与模型行为仍可能因为第三方模型兼容性而不同；不要把离线模拟测试当作真实 API 全功能验收。
直连模式启动时会重写 Demo 自己的 data/codex/config.toml，以更新动态桥接端口，不改你原来的 ~/.codex。CC Switch 模式不会启动这个适配器，也不会由本 Demo 重写 CC Switch 管理的 Codex 配置；服务协议与需要的转换由所选供应商和 CC Switch 决定。

## 检查与测试

Mac 终端，在本目录执行：

```bash
./platforms/darwin-arm64/node lib/doctor.mjs --all-platforms --verify-hashes
./platforms/darwin-arm64/node --test tests/*.test.mjs
./platforms/darwin-arm64/node tests/cc-switch-integration.mjs
CODEX_TEST_BIN="$PWD/platforms/darwin-arm64/node_modules/.bin/codex" ./platforms/darwin-arm64/node tests/codex-integration.mjs
```

离线测试使用假 Key 和模拟回复，不发送工作区到真实模型。Windows 也可以用 `platforms\win32-x64\node.exe lib\doctor.mjs` 检查文件。
具体已完成的检查见 VALIDATION.md。

## 参考来源

- https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code
- https://api-docs.deepseek.com/guides/anthropic_api
- https://github.com/deepseek-ai/deepseek-harness
- https://github.com/farion1231/cc-switch/releases/tag/v4.0.22
- https://developers.openai.com/codex/config/advanced/

准备时 OpenAI 文档站返回 Forbidden，因此 Codex 配置和兼容性以本地实际 CLI 测试为依据；不是已取得 OpenAI 对 DeepSeek 的官方支持承诺。
