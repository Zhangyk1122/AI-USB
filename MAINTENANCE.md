# 便携运行与维护（DeepSeek Harness / Windows x64）

整个 `AI-USB-Demo` 文件夹复制到 U 盘后，双击 `dsh.bat` 即可从 U 盘启动 Harness（`Windows-Start.bat` 是转发到它的兼容别名）。日常启动不需要压缩、解压或预装任何组件。

维护入口 `Windows-Maintain.bat` 提供诊断、备份、恢复、更新和运行记录清理。API 的模型、地址和 Key 属于 Harness 自身配置，维护菜单不读取也不修改它们。

## 数据和缓存

| 内容 | 位置 |
|---|---|
| Node、DeepSeek Harness | U 盘 `platforms/win32-x64/` |
| Harness 配置、凭据、会话 | U 盘 `data/harness/` |
| 插件启用清单（可选） | U 盘 `data/plugins.txt` |
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

维护 `4` 有两种方式：

```
4. 更新（在线下载完整包 / 本地目录）
   1) 检查并在线更新（下载最新完整包）
   2) 从本地完整目录更新
   0) 返回
```

### 在线更新（推荐）

1. 先退出所有 Harness 窗口（运行中的租约会让更新被拒绝）。
2. 菜单 `4` → `1`，先显示「当前版本 / 最新版本」。
3. 有新版时输入 `UPDATE`，流程为：
   - 下载最新 `AI-USB-Demo-win32-x64.zip`（约 265 MB）
   - 用 `SHA256SUMS.txt` 校验下载包；不符立即中止，不改动任何文件
   - 解压到本机缓存，校验包内必需文件与平台
   - 创建 `before-update` 备份，事务式替换程序文件
   - 任一步失败按 journal 逆序回退
4. 完成后重新启动 `dsh.bat`。

命令行等价：

```powershell
node lib/update.mjs --check   # 只检查
node lib/update.mjs --yes     # 直接更新
```

> 更新只替换 `lib/`、`tests/`、`platforms/` 与根目录程序文件；`data/`、`config/`、`workspace/` 永远不会被改动——
> 即使整包里带了这些路径，也会被白名单过滤掉。
> 整包更新前还会校验包内必需文件，缺件直接中止。
>
> 插件位置：随包插件本体在 `platforms/win32-x64/node_modules/@deepseek-ai/`，第三方插件装在
> `data/harness/profiles/<profile>/node_modules/`（U 盘），pnpm 内容仓库在本机缓存（可重建）。
> 更新不会动这些目录，因此插件的启用状态和已装插件都保留。

### 从本地目录更新

适用于没有网络、或需要回退到某个已下载的整包：

1. 新版目录必须与当前目录彼此独立，且包含 `platforms/win32-x64`、`RUNTIME-SHA256.json`、`lib/`、`dsh.bat`、`dsh.ps1`。
2. 退出所有 Harness 窗口，输入 `UPDATE`。
3. 流程：校验布局与 SHA256 → `before-update` 备份 → 复制到暂存目录并再次校验 → 事务式替换 → 旧程序保留在 `previous`。

### 中断处理

发生断电或强制终止后，先确认程序已退出，再用维护 `5` 回退未完成操作，或用维护 `6` 清理遗留运行记录。事务目录不会自动删除，确认新版本正常后手动清理。

## 验证边界

缓存、锁、备份/恢复/更新（整包下载、SHA256 校验、事务替换与回退）的成功与失败路径均有临时目录测试；Windows 实机运行、真实 U 盘（exFAT）性能和真实模型调用仍需对应环境验证。
