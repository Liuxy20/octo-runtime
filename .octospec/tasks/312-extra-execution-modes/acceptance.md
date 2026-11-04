---
type: Task
title: Issue 312：验收矩阵与证据要求
description: 将输入选择、控制隔离、清理、内置 Extra 及包外交付映射为可观察的验收场景。
tags: [extra, lifecycle, ipc, invoke, stream, testing]
---

# 验收矩阵

以下是原验收场景定义；实际 pass/not run/限制逐项记录在[验证记录](validation.md)。本轮已实现并执行 macOS Node、真实 Codex 和包外消费者验证，Windows/Linux 原生及外部业务 App 未运行；不将 fake Channel 结果描述为真实 IM 联调。

| ID | 场景与触发 | 通过依据 | 实施位置/阶段 |
| --- | --- | --- | --- |
| A01 | direct/ipc/legacy 三种合法配置；unknown、null、missing、mixed、显式 undefined 及伪 executor | 严格 TS 正例/反例与运行期结论对应；混用在资源分配前拒绝，不能悄悄选分支 | M1/M3；类型 fixture + service 专项 |
| A02 | direct 宿主无 home/endpoint/默认 CLI 配置 | initialize、invoke、close 可用；确认没有 Kernel client、执行 bind/lease、Runtime Home 根/身份创建；实例是传入的同一对象 | M3/M5；进程/文件系统与装配观测 |
| A03 | 新 IPC、旧 endpoint，指定 Kernel 暂不可达及随后恢复 | 使用同一个现有客户端实现；保留现有不可达/恢复行为；无 spawn/install/restart/Kernel close | M3；独立 Kernel fixture |
| A04 | native/default、canonical、变量模式；正常/失败执行 | 原输入完整；严格返回类型；progress、源身份、连续 seq、真实终态；不重复 invoke | M2/M4；两种模式共用场景 |
| A05 | 用户取消、signal；接纳前取消、接纳竞态、终态后取消 | 只取消原调用；ACK 与终态分离；保留 IPC 显式 Stop 重试/未知结果，不自动重试副作用 | M2/M3；可控接纳 fixture |
| A06 | canonical/native 交互；过期/重复/未知/跨 scope/错误模式 | 正确回答回到原 Adapter；响应载荷保持；越界在转发前拒绝，不能控制 B 或宿主调用 | M2/M4；同步交互 fixture |
| A07 | 两 Extra 共享 Core；宿主另有一次调用；关闭/回滚 A | A 的 owned calls 有清理结果；B/宿主调用继续，Core 可接受后续调用；未调用 Core.shutdown | M1/M2/M3；共享并发 fixture |
| A08 | 同 Core 同名、不同 Core 同名、同 endpoint 同名/不同 endpoint；失败后替换 | direct 键为对象身份/name，IPC 键为规范化 endpoint/name；完整关闭后可重建，失败保留冲突；64 Extra/128 scope 调用上限有效 | M2/M3；身份/容量边界 |
| A09 | observer 提前 return、暂停或完全脱离；Gateway WS 断开 | Core cancel 计数不增加；已接纳工作由 pump 继续；WS 恢复不重复提交；显式 cancel 仍有效 | M2/M4；两模式/真实 Gateway fixture |
| A10 | 帧数、单帧字节、单 Run 字节和共享窗口；慢消费者追不上 | 中央预算有效；窗口落后明确报 gap，执行可继续；不静默丢失后成功；源超限真实失败；无 observer 专属无界队列 | M2；边界与计数测试 |
| A11 | terminal 已到但 finally 未完成/失败、next 永不返回；receipt 错误/拒绝接纳 | direct 使用本次 owner 清理凭据；close 不提前 complete；失败不因第二次 return/close 变成成功；未接纳不误控原 id | M1/M3；清理失败 fixture |
| A12 | initialize 抛错/取消/并发 close；close-before-init；迟到 bind；依赖 Promise 未结束 | 保留原 cause 与 cleanup；共享 4 秒预算不重置；尾写权限到插件结束/截止；incomplete 不释放名称/租约；迟到资源仍回收 | M3；service 生命周期专项 |
| A13 | WebUI 查询 Adapter、host 关闭 Core、probe 超时/未结束 | direct list 用 describe；报告实际探测与接纳状态，不发模型 turn；实际 probe 仍在途使关闭 incomplete；无伪 Kernel 字段 | M1/M3/M4；状态与查询 fixture |
| A14 | Gateway/WeCom/WebUI；旧第三方 Kernel 专属插件 | 三个内置模块仅使用通用接口并跑两种模式；async question 原过滤保持；旧插件 IPC 可运行，严格 TS 收窄示例通过，direct 错用有回滚证据 | M4/M5；真实模块而非 toy 插件 |
| A15 | 仓库外只安装 tgz，公共 Codex/Extra/Core/Host 导入；direct 与独立 IPC hosts | skipLibCheck=false 编译和运行通过；无私包/软链/hoisting 假定；IPC 正确准备 home；全部关闭结果核对 | M5；#296 出口 |
| A16 | 真实 Provider/测试 Channel、平台差异、外部 HostApp；双语文档及 CI 范围 | 每类独立 revision/版本/证据；缺项显式列出；示例符合实现；workflow 与实际检查范围无扩大 | M5；人工专项和交付复核 |

## 测试分层

- **Node 离线**：fake Provider 与 loopback 渠道，验证确定性合同、错误和竞态；不可表述成真实 Provider 或线上 IM 通过。
- **包外发行**：隔离工程只依赖主包 tgz，记录 SHA-512、源码 SHA/dirty、Node 版本、实际安装文件和编译设置。fake Provider 装配验证与真实 Codex turn 分开。
- **真实 Provider / Channel**：使用宿主已有、仓库外受保护配置，记录实际 harness 版本与测试环境；IM 按现有 `https://im-test.deepminer.com.cn/` 测试环境合同。此计划不授权发送业务消息；需要发消息时使用当时明确授权的测试场景。证据不含凭据或聊天正文。
- **平台**：macOS/Linux 验 Unix socket/目录所有权，Windows 验 named pipe、地址冲突与清理。模拟平台分支、child.kill 或 POSIX 成功不能替代 Windows 原生证明。
- **外部宿主**：Electron 或其他业务 App 的打包、初始化和退出独立记录。缺环境不阻断库内规划，但不得列为已验收；若作为某次发布必需场景则在该发布前补齐。

## 每项证据格式

实现 revision（含 dirty）、平台/Node/Provider 版本、命令、场景前置条件、观察结果、取消 ACK、执行终态、单次清理/本地资源结果、限制及结论。使用 pass / fail / blocked / not run，不用“基本通过”。

close 返回 complete 的证据同时核对所属执行、插件、实际依赖、控制监听与日志。IPC 不把本地 close 描述成整个 Kernel 全局清理；direct 不以 terminal、空集合或 Core 全局 shutdown 代替本次调用清理凭据。

提交实现变更前，以记录的目标分支 SHA 对比 `.github/workflows/`、默认 selector、scripts/pack gates 和实际 PR check runs。专项显式手动运行，禁止通过现有 job 或 `test/*.test.js` 默认 glob 隐式扩大专项 CI。
