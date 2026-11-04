---
type: Validation
title: "Issue 303：本地验证与前置边界"
description: "记录独立本地修复、Windows 实测、全量对照和未验证项。"
tags: [runtime, ipc, lifecycle, testing, windows]
timestamp: 2026-11-04T07:10:00Z
source: self
---

# 验证状态

以下为 e7958065 上的历史独立验证。后续已在固定 PR #310 head 完成联合验证，最新
结论与未验证项见 [联合验证](joint-validation.md)；保留下文原始结果用于对照。

本地分支 `fix/303-direct-kernel-endpoint`，基线及刷新后的主线均为
`e7958065a250e8ed0986715e4a3fb07a70d885e9`。独立范围检查已收尾；#306 联合整合与
POSIX 真机仍未验。没有 commit、push、PR、公开评论、合并或关闭。

## 环境和隔离

Windows 11 Enterprise x64 build 22621，普通用户（Medium integrity）；PowerShell
7.6.5，Codex CLI 0.163.0。Node 24.19.0 / 26.13.0，pnpm 11.19.0，checkout 局部
`core.autocrlf=false`，不改全局 Git/包管理器配置。冻结安装使用 ignore-scripts 与
本机既有依赖 store，不修改锁文件；完整构建单独执行。

测试 Home/TEMP/TMP/APPDATA/LOCALAPPDATA 均在 checkout 外的本任务独占目录下，
已创建 AppData 子目录。
后续同时显式指定外部 PSModuleAnalysisCachePath。fixture 逐次 mkdtemp 私有目录，
只关闭本次 client/service/原生随机服务任务；不接管在线 Bot。POSIX 专项由测试宿主
明确选择 `/tmp` 下的独占 Home，不是产品运行时替用户切换目录。

## 已执行的阶段结果

| 检查 | 结果 |
| --- | --- |
| main 行为基线 `pnpm typecheck` | exit 0 |
| main 行为基线 `pnpm test:suites` | exit 1；UI 35/35；Node 2302 pass、18 fail、2 cancelled、79 skip，共 2401 |
| 首轮修改后 `pnpm typecheck` | exit 0 |
| 首轮 #303 Node 24/26 专项 | 各 12 pass、0 fail、3 skip |
| 相关回归（端点、SDK 生命周期、client、CLI、#237） | 32 pass、0 fail、1 POSIX skip |
| 中间实现既有全量 | exit 1；UI 35/35；Node 2314 pass、7 fail、1 cancelled、79 skip，共 2401 |
| 初次 lint | preserve-caught-error / only-throw-error 已整改，最终等价范围逐包检查通过 |
| 初次 docs:check / 后续完整重建 | exit 134，实际 `Zone Allocation failed - process out of memory`，不是类型错误通过 |
| 单次调用降低 workspace 并发后 `pnpm typecheck` | exit 0（`pnpm_config_workspace_concurrency=1`，未修改配置文件） |
| 随后 Kernel 定向重建与根类型检查 | exit 0；用于最后所有权/close 回调补强，最终专项继续复验 |
| owner 部分写入故障的重建前控制 | exit 1，确认遗留 owner 未被回滚；故障注入证据，不冒充真实 ACL 拒绝 |
| 扩充专项阶段 Node 24/26 | 各 18 pass、0 fail、6 skip；最终增加关闭描述符未确认保护后继续复验 |
| 最终 Kernel 重建、根 `tsc --noEmit`、Kernel lint | 各 exit 0 |
| 最终 #303 手动专项 Node 24.19.0 / 26.13.0 | 各 exit 0；26 tests，19 pass、0 fail、7 skip |
| 最终相关回归（端点、SDK/client/CLI 生命周期、#237） | exit 0；32 pass、0 fail、1 POSIX skip |
| 最终双语文档/示例 `pnpm docs:check` | exit 0；4 checks pass |
| 最终 `format:check` / `lint:names` | 均 exit 0 |
| `eslint apps packages` 的等价逐目录验证 | 25 scopes、0 failures；同一配置与相同 apps/packages 范围，逐次新进程避免整仓进程 OOM，未改 lint 脚本 |
| 保持全量 selector，显式 `--test-concurrency=2` | exit 1；2200 pass、6 fail、0 cancelled、76 skip；仅汇总 2282，整文件异常退出使部分用例未执行，不是全绿 |
| 产物投递/小时日志/Provider 发现/WeCom 隔离复测 | exit 0；143 tests，138 pass、0 fail、5 skip，补验此前整文件异常中断的范围 |
| OKF 知识 lint | exit 0；637 篇知识文档 / 20 rules；随后仅更新记录，收尾再次检查 |

## 全量失败的辨别

基线不仅有历史两项 OpenClaw 失败：还出现 PowerShell ACL 查询超时、DSH 初始化超时、
临时文件 rename/unlink 锁定、前台超时、原生任务状态 unknown 等。中间全量减为 7 fail/
1 cancelled，但多出一次 WeCom 心跳停止计数断言；不能将新现象直接归为历史问题。

两轮 OpenClaw typed/untyped legacy 的恢复失败与 `ORPHAN_CLEANUP_INCOMPLETE` 一致，
本任务不绕过已有恢复保护。Windows 管道名、service ID、服务 XML/环境、Provider 与
WeCom 客户端代码均未改变。原生计划任务失败位于 stop/uninstall hook 的
`MANAGER_UNAVAILABLE`；PowerShell 文件保护失败为测试 10 秒查询截止。需依据最终
受控并发的同一全量 selector 与隔离结果辨别，不宣称两轮必需全量已经全绿。

受控并发全量仍失败六项：原生 Windows 中文 Home/autostart=false 的任务状态、小时
日志并发子进程 OOM、产物投递整文件异常退出、两项 OpenClaw 未确认清理、Provider
测试临时 exe 的 EBUSY。日志记录 Zone / Worklist 内存不足。随后四个相关文件隔离
执行全部通过（138 pass/5 skip），没有修改这些业务模块来掩盖失败。不能把隔离通过
相加伪造一次完整通过；部分失败的完整系统根因未在 #303 内认定。

原生测试遗留的本任务随机 task 与 Home-hash CLI task 已使用原 backend 按精确 ID
逐一卸载，并 inspect 确认 `not_installed`；最终本任务 Temp 下无原生任务夹具残留。

## 验收证据的界限

- Windows 真实本地 Named Pipe/RPC：创建、同 Home 冲突、attach、独立 Extra、状态、
  CLI status/doctor/recover、重复 close、兄弟 Home 隔离、中文空格、超过 260 UTF-16
  单位 Home 和原始哨兵状态保留。
- Windows 真实文件系统上的旧租约协议控制：旧文件/owner/`.runs` 保留、未知或大记录
  拒绝、并发准入、死且匹配 marker 的 owner 恢复、nonce 改变不释放、部分写入回滚、
  回滚失败与原拒绝同时保留、描述符关闭未确认仍占有 owner。IO/close 失败为显式注入。
- 合成 darwin/linux 参数只证明路径派生、编码与固定 21 字节节省；不证明 Unix bind。
- 七项跳过：#306 实际验证边界未落地一项，POSIX 真实 bind/旧新过渡/两种陈旧 socket
  所有权/关闭后替换文件/真实 unlink 权限拒绝共六项。本机未发现可用 Docker CLI；
  WSL launcher 不能列出可用分发，仅返回安装帮助，未新装子系统。无 macOS/Linux 实机证据。
- CLI 默认 Home、冲突平台环境、SDK 必填/存在/ACL 与最终预算验证归 #306；不复制其
  私有草案。最终需按实际落地 API 刷新、补旧兼容租约的文件系统预算并完整复验。
- 没有真实 Provider/IM、Electron 真机或发行包部署；本任务不因此修改线上实例。

## 最终收尾

最终代码通过定向构建/根类型、同范围逐包 lint、双语文档、专项与相关回归、格式和命名
检查；既有全量的失败与中断如上保留。main 再次刷新仍为 e7958065，#306 仍 OPEN，
因此不复制其草案、不声称本分支完成联合合同验收。前置落地后的具体整合步骤见
[自查](review.md)，包括兼容租约的文件系统预算与实际 Home 校验/目录准备边界。

本任务只交付本地可审查 diff 与记录，尚未提交。CI workflow/job/matrix/trigger/Gate、
默认 test selector、包管理器/锁文件与在线实例未修改。最终导出包含新增文件，并用
独立临时 Git index 检查链接和补丁，不改变用户真实 index。

依据：[Node IPC](https://github.com/nodejs/node/blob/v24.22.2/doc/api/net.md#ipc-support)、
[当前 Node 内置 libuv close](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/unix/pipe.c)、
[builtin ESM 活绑定](https://github.com/nodejs/node/blob/v24.22.2/doc/api/module.md#modulesyncbuiltinesmexports)。
Node 源码审计与 Windows 文件协议控制均不替代 POSIX 真机执行。
