# 验证记录（2026-10-31）

## 已验证

- Mac Apple Silicon，使用打包的 Node v24.17.0。
- Codex CLI 0.166.0、Claude Code 2.1.316、DeepSeek Harness 0.2.1-rc.5 均可打印版本。
- 三个 Mac 启动器在整个目录被真实移动到“带空格的新路径”后，仍可启动打印版本。
- Harness Web 在 127.0.0.1 动态端口启动，使用 cookie/token 完成访问，网页返回 HTTP 200。
- 5 项适配器测试通过：历史工具结果、namespace、custom tool、SSE、上游错误、接口鉴权等。
- 实际打包的 Codex CLI 完成离线回环：请求 → 桥接器 → 模拟 DeepSeek 返回 shell 工具调用 → 执行 echo → 工具结果回传 → 最终回答，共两轮请求。
- Windows Node.exe 与 GitHub PortableGit 下载包的 SHA256 分别与官方发布清单/资产 digest 一致。
- Windows Node、Claude、Git、Bash 的 PE 文件类型为 x64。
- Windows npm 原生可选依赖按 win32/x64 安装；跨平台打包时跳过在 Mac 上执行 Windows 安装钩子，保留发布包预编译产物。
- Windows 包包含完整 PortableGit 2.56.0.4（Git Bash），7-Zip 解压正常结束。
- npm bin 符号链接转换为普通文件/相对导入包装，避免复制到 exFAT 时依赖符号链接。
- Shell 启动器 bash -n 和 JavaScript 语法检查通过。

## CC Switch 集成

- 已打包官方 CC Switch 4.0.22：macOS 通用 App（本 Demo 启动器限定 Apple Silicon）和 Windows x64 Portable。
- 两个发布 ZIP 的 SHA256 与 GitHub Release 资产 digest 一致；Mac App 通过 `codesign --verify --deep --strict`；两个平台附带 MIT 许可证。
- 新增管理器启动器和三个 CC 模式 Agent 启动器，Mac/Windows 主菜单新增选项 5–8。
- 三个实际打包的 Mac Agent 均可通过 CC 启动器输出版本，无需 Key。
- 8 项 CC 配置检查 + 原有 5 项桥接测试，共 13 项通过：两种模式目录隔离、配置字节保持、继承环境变量清理、缺失配置提示、移动到带空格目录后的路径刷新、保留未知设置及数据库、宿主机目录覆盖保护、单实例保护、Windows 启动计划。
- 实际 Mac Codex 在 CC 模式下，从 `config.toml` 和 `auth.json` 读取设置，通过本地模拟接口完成两轮请求及 shell 工具回环，配置保持不变。
- 实际 Mac Claude 在 CC 模式下，从 `settings.json` 读取模型、接口地址和 Key，调用本地模拟 Anthropic 流式接口并得到预期结果，配置保持不变。
- 实际 Mac Harness 在 CC 模式下，从 CC 风格的 `profiles/web/cordis.patch.yml` 合成配置，包含预期供应商与模型，profile 补丁保持不变。
- Mac 上检测到已有宿主机 CC Switch，管理器按预期停止并提示退出已有实例；未关闭或修改该实例。未启动第二个 GUI，所以未验证界面中保存供应商的实际操作。
- `doctor.mjs` 包括 CC Switch 在内的双平台必需文件检查通过；运行时 SHA256 重新核对一致。

## 便携维护优化

- 主菜单新增 `9`，Mac 维护菜单的显示、离线诊断和退出已通过真实终端检查；Windows 增加对应入口及本机缓存 Node 的更新执行方式。
- npm、Node 编译缓存、临时目录和 XDG 缓存通过启动环境指向本机；稳定 ID 支持移动目录后复用缓存，目录不可写时回退 U 盘。原配置与会话目录保持随盘。
- 新增 14 项测试，连同原 13 项共 **27 项通过**。覆盖缓存移动/回退、配置和会话逐字节备份恢复、缓存/临时链接排除、备份损坏与非法路径拒绝、活动程序阻止维护、恢复失败回退、事务恢复、更新前自动备份、更新保留数据/工作区、错误候选拒绝和更新替换失败回退。
- API 诊断使用本地模拟服务验证 CC 三个 Agent 的保存配置、认证失败、超时、缺失模型列表接口、拒绝重定向、缺失凭据/损坏配置提示及凭据不进入诊断输出。未调用真实供应商。
- 修改后实际打包的 Mac Codex、Claude、Harness 仍通过原有 CC 风格配置离线集成，三个 CC 启动器也均可正常输出版本，简要运行结果写到本机缓存。
- 双平台必需文件及原有运行时 SHA256 核对通过；Mac Shell 与新增 JavaScript 语法检查通过。
- 已在真实 Demo 目录创建并校验配置/数据备份；恢复和程序更新只在临时测试目录进行，没有覆盖用户的真实配置或替换现有版本。

## 尚未验证（维护优化同样适用）

- 未提供真实 DeepSeek API Key，因此没有进行真实对话、计费、长上下文或完整编码任务验收。
- 没有 Windows 实机，Windows 端只做打包、二进制与文件完整性检查，未实际运行。
- 未在真实 U 盘/exFAT 上测试速度、权限和各工具的跨系统会话恢复。
- Codex 适配器是有限文本/工具调用兼容层，不是完整 OpenAI Responses 协议实现。
- CC Switch 真实界面配置与真实模型请求；尤其未验证 CC Switch 的所有代理、OAuth、MCP 和跨平台会话功能。
- CC Switch 的 Windows 界面依赖系统 WebView2 Runtime，该组件未随盘打包。

测试使用独立临时配置，不读取用户现有的 ~/.codex、~/.claude 或 ~/.dsh 中的认证。直连启动器默认不主动保存输入的 Key；CC Switch 模式按用户的管理操作把供应商、Key 和 Agent 配置保存在 `data/cc-switch/` 中。
