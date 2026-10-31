# 用 CC Switch 管理 U 盘上的三个 Agent

## 第一次使用

1. 把整个 `AI-USB-Demo` 文件夹放到 U 盘。
2. 完全退出宿主机已有的 CC Switch，包括托盘/菜单栏中的后台实例。
3. Mac 双击 `Mac-CC-Switch.command`；Windows 双击 `Windows-CC-Switch.bat`。也可在主菜单选 `5`。保留它打开的终端窗口。
4. 在 CC Switch 的 Claude Code、Codex、DeepSeek Harness 页面分别添加供应商，选择 DeepSeek 的 API Key 预设，填入你的 Key，保存并启用。同一个 DeepSeek Key 可以用于三个页面；每个 Agent 的选择独立生效。
5. 再打开主菜单，选 `6–8` 启动对应 Agent；或使用下表的独立入口。Harness 启动后，在它的 Web 界面选用已添加供应商的模型。

| 程序 | Mac 入口 | Windows 入口 |
|---|---|---|
| CC Switch 管理器 | `Mac-CC-Switch.command` | `Windows-CC-Switch.bat` |
| Codex | `Mac-CC-codex.command` | `Windows-CC-codex.bat` |
| Claude Code | `Mac-CC-claude.command` | `Windows-CC-claude.bat` |
| DeepSeek Harness Web | `Mac-CC-harness.command` | `Windows-CC-harness.bat` |

DeepSeek Harness 还有账号/OAuth 登录入口；你的方案使用 API Key，在 API 供应商配置中设置即可。模型名称以你的 API 账户可用列表为准，主菜单 `4` 检查官方 DeepSeek 模型列表接口是否可访问。

切换供应商/模型后，退出并重启对应 Agent。使用需要 CC Switch 本地代理的供应商时，保持管理器运行；直接写入配置的供应商无需始终运行管理器。不要用 CC Switch 内部的“打开/安装终端工具”入口来代替本 Demo 的 Agent 启动脚本，这些入口可能找到宿主机上全局安装的版本。

## 配置保存位置

| 内容 | U 盘内的位置 |
|---|---|
| CC Switch 数据库、供应商、Key、设置 | `data/cc-switch/controller-home/.cc-switch/` |
| Codex 配置/认证/会话 | `data/cc-switch/agents/codex/` |
| Claude Code 配置/会话 | `data/cc-switch/agents/claude/` |
| Harness profile、凭据和会话 | `data/cc-switch/agents/harness/` |

这些数据随整个文件夹复制。Key 会落盘，持有该 U 盘的人可能读取到它；本 Demo 未为整盘加密。原来的直连入口仍使用 `data/codex`、`data/claude`、`data/harness`。修改 `config/settings.json` 只影响直连模式，CC 模式的模型和地址在 CC Switch 内设置。

可重建缓存优先放在本机，以上配置、数据库和会话仍在 U 盘。主菜单 `9` 进入维护后，`2` 分别检查 CC 保存的 API 配置，`4` 备份，`5` 恢复。恢复和更新前需要退出所有本目录程序。完整说明见 [MAINTENANCE.md](MAINTENANCE.md)。

更换电脑、盘符或文件夹路径后，**先通过启动器打开一次 CC Switch**，刷新它的两个 Agent 配置目录和 Harness 环境，再启动 Agent。不要在 CC Switch 内改本 Demo 已设置的 Claude/Codex 配置目录，也不要改 CC Switch 自身的数据目录。自行添加的 MCP、脚本或项目绝对路径仍需按新机器调整。

## 如果启动器阻止打开

- “CC Switch is already running”：从已有 CC Switch 的托盘/菜单栏选择退出，再启动 U 盘版。
- “custom data-directory override”：宿主机 CC Switch 曾设置自定义数据目录。该设置优先级更高，启动器会停止，避免写到宿主机数据库。先在宿主机 CC Switch 设置中清除自定义数据目录并退出；启动器不会替你修改宿主机文件。
- “CC Switch configuration missing”：该 Agent 还没有配置。先在管理器中添加并启用供应商，再启动。
- Windows 没有界面且提示 WebView2：补装微软 WebView2 Runtime；本 Demo 未打包该系统组件。

## 版本和验证范围

打包的是官方 **CC Switch v4.0.22**，包含原生 DeepSeek Harness 支持。Mac 和 Windows 下载包的 SHA256 已与 GitHub Release 资产摘要核对，Mac App 签名校验通过，附带 MIT 许可证。

便携目录通过该版本源码提供的 `CC_SWITCH_TEST_HOME` 覆盖实现，并设置 Claude/Codex 目录及 `DSH_HOME`。这个变量在上游属于测试/调试接口，不是稳定的便携 API，因此 Demo 固定了版本；不要直接在 App 内升级后继续假定目录覆盖仍然有效。Windows 的 `portable.ini` 本身不负责迁移数据库。

这里隔离的是 CC Switch 核心数据库及三个 Agent 的配置目录。系统 UI 存储、WebView 缓存、钥匙串、系统临时文件等仍可能留在宿主机。请从本 Demo 启动器进入；直接打开内部的 App/EXE 不会自动使用这些目录覆盖。

已使用打包的 Mac Agent 做离线验证：Codex 读取 CC 风格的配置和认证完成工具调用回环；Claude 读取保存的模型、地址和 Key 调用本地模拟接口；Harness 读取 CC 风格的 Web profile。未调用真实 DeepSeek API。当前宿主机已有 CC Switch 在运行，因此未启动第二个图形实例，也未验证实际界面保存供应商的操作。Windows 尚未实机验证。

源码与发布包：[farion1231/cc-switch v4.0.22](https://github.com/farion1231/cc-switch/releases/tag/v4.0.22)。
