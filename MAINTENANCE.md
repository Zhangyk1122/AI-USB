# 便携运行与维护（DeepSeek Harness / Windows x64）

整个 `AI-USB-Demo` 文件夹复制到 U 盘后，双击 `dsh.bat` 即可从 U 盘启动 Harness（`Windows-Start.bat` 是转发到它的兼容别名）。日常启动不需要压缩、解压或预装任何组件。

维护入口 `Windows-Maintain.bat` 提供诊断、备份、恢复、更新和运行记录清理。API 的模型、地址和 Key 属于 Harness 自身配置，维护菜单不读取也不修改它们。

## 数据和缓存

| 内容 | 位置 |
|---|---|
| Node、DeepSeek Harness | U 盘 `platforms/win32-x64/` |
| Harness 配置、凭据、会话 | U 盘 `data/harness/`（`DSH_HOME`、`DSH_AGENTS_HOME`） |
| 默认工作区 | U 盘 `workspace/`，或自己指定的 `AI_USB_WORKSPACE` |
| npm、Node 编译缓存、临时文件、简要运行诊断 | 本机 `%LOCALAPPDATA%\AI-USB-Demo\<ID>\` |
| 配置与会话备份 | U 盘 `backups/` |

`data/.portable-id` 随盘保存；同一台电脑上换盘符或移动文件夹仍能命中原来的本机缓存，更换电脑则在新电脑重建。本机缓存目录不可写时，启动器回退到 U 盘 `data/cache/` 并提示。

这里只重定向工具支持的缓存与临时目录，不移动整个 Agent HOME；系统临时文件、浏览器记录等仍可能留在宿主机。

## 诊断

维护 `1` 执行统一离线诊断：

- 运行时文件是否齐全（`node.exe`、`@deepseek-ai/dsh/lib/bin.js`）
- U 盘文件系统类型（FAT32 会提示转为 exFAT/NTFS）
- 随包 pnpm 是否可用（可选；缺失只给 WARN，此时插件管理只能开关随包插件）
- 缓存目录、运行锁、未完成的事务、最近一次退出原因
- `RUNTIME-SHA256.json` 校验（菜单内默认开启）
- BUILD-INFO 记录的版本与运行时实际版本是否一致（启动时会自动同步，这里用于复核）
- Windows 上额外运行一次 `dsh --version` 探针

状态含义：`OK` 通过；`FAIL` 明确失败；`WARN` 需进一步确认；`SKIP` 当前环境无法自动验证。

命令行等价入口：

```powershell
.\platforms\win32-x64\node.exe lib\doctor.mjs --verify-hashes
.\platforms\win32-x64\node.exe lib\doctor.mjs --no-probe
```

诊断不联网、不发起模型推理、不输出 Key。

## 备份和恢复

1. 先退出由本目录启动的所有 Harness 窗口（维护锁会阻止运行中备份）。
2. 维护 `2` 备份 `config/`（若存在）与 `data/` 中的持久数据；排除本机缓存、U 盘缓存、运行锁，以及任意 `tmp`/`cache`/`logs`/`node_modules` 目录（这些目录可能含 Windows 联结点，不会被复制）。
3. 每份备份是普通目录 + SHA256 清单，先写临时目录、校验通过后才成为正式备份，不压缩、不跟随外部链接。
4. 维护 `3` 选择备份并输入 `RESTORE`：先验证备份，自动创建 `before-restore` 备份，再替换配置和会话。`workspace/` 不会被覆盖。
5. 备份内含原有 Key 与会话，按私密数据保管；防丢盘需另存到别的盘。

## 更新

维护 `4` 接受一个**已准备好、已解压的完整新版目录**（不是 npm 包，也不是 GitHub 源码目录），不会自动下载。

1. 新版目录必须与当前目录彼此独立，且包含 `platforms/win32-x64`、`RUNTIME-SHA256.json`、`lib/`、`dsh.bat`、`dsh.ps1`。
2. 退出本目录启动的所有 Harness 窗口，输入 `UPDATE`。
3. 流程：校验新版布局与 SHA256 → 创建 `before-update` 备份 → 复制到暂存目录并再次校验 → 事务式替换 → 旧程序保留在输出的 `previous` 路径。
4. 任一步失败都不会替换旧程序；替换阶段异常会自动回退。

发生断电或强制终止后，先确认程序已退出，再用维护 `5` 回退未完成操作，或用维护 `6` 清理遗留运行记录。旧程序目录不会自动删除，确认新版本正常后手动清理。

## 验证边界

缓存、锁、备份/恢复/更新的成功与失败路径均有临时目录测试；Windows 实机运行、真实 U 盘（exFAT）性能和真实模型调用仍需对应环境验证。
