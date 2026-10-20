---
type: Verification
title: Issue 69 统一 Kernel invoke 实施与验收
description: 记录公共接口、消费者迁移、取消与 owner 排空的实现证据和未验范围。
tags: [invoke, ipc, extra, lifecycle, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 实施结果

用户在规划评审后明确要求“开始实施”，按 [设计](design.md) 执行。工作树为 `feat/69-kernel-client-invoke`，基线 `fae6333632010602506774b0648b639b70d25e22`；实现尚未提交，没有新的实现 SHA。环境为 macOS arm64、Node 24.19.0、pnpm 11.19.0。规划 96/100 是可执行性评分，不是测试覆盖率或产品完成概率。

KernelClient 现在提供与 Core 同类型的 invoke，附加 App、owned.client、三个内置 Extra、无关 fixture Extra 和 CLI Playboard 均使用该入口。SDK 注入实际 ctx.kernel，删除 extra-port、ExtraAdapterHost、ctx.adapterHost 和 ImExecutionPort。取消按 invocationId 返回 accepted，交互复用原完整 ref；submit/get/subscribe/control 保留给高级调用方。

同一个 client 登记最多 128 个身份/控制元数据，包括在途和未知调用；不存正文或输出历史。caller signal 请求取消并允许尾流，source 具体错误优先。iterator/client 关闭不隐式取消。owner stopAdmission/drain 共用绝对 deadline，以最多 4 个取消和 4 个查询核对原终态，不增加逐 Run 订阅；lost/未知/未确认保持 unresolved。真实终态释放记录，但仍等待业务 dispose，清理失败阻止替换。

## 实施中确认的细节

- 不在 Kernel 重复解析或提前校验 Core 的输入。首轮全量回归发现提前校验拒绝尚待 Core 补默认值的合法 OpenClaw 输入，已移除重复校验，相关 Playboard 回归恢复。
- canonical 在 Host control error 时通过同一 get 查询原终态；确认 lost 则报告 RUN_OUTCOME_UNKNOWN。查询失败保留原控制错误，不造 Provider 事件。native 仍保留原 error/lost 帧，再报告未知。
- get 可以使接纳未知记录重新关联原 ref 并核对终态；完整 key、Kernel instance、stream 和协议身份仍校验。未提交的调用在 owner 关闭接纳后不能迟到写入。
- 取消队列有界，deadline/close 同时终止已脱离登记的在途取消 IO；终态确认后不能留下只等 ACK 的连接。重复取消不重发副作用，控制 ACK 丢失后可由后续真实终态确认清理。
- 本次没有修改 wire Schema、Run 7 或 Context v3。Kernel 对 environment.streamLimits 明确拒绝；直接 Core 保留该本地选项及执行 iterator 关闭即取消的差异。
- M0-M5 的本地实现与验证已落地，M4 的其他平台执行仍待验。额外迁移 Playboard，是因为源码中还存在同样的 submit/subscribe 组合；不依赖仍未合并的 PR #65。

# 验收对应

以下“本地通过”只表示该环境的自动化断言，不能推广到真实 Provider、IM 客户端或未运行的平台。

| 项 | 本地证据与实际范围 |
| --- | --- |
| A01 | tgz 仓外 kernel-invoke.mts：无 Extra attach/invoke，真实 IPC 原生与 canonical 至终态 |
| A02 | 仓外 host.mts 直接 owned.client.invoke；SDK 原 owned/restart/attached 所有权回归 |
| A03 | 仓外 strict、skipLibCheck=false，三重载正向与 @ts-expect-error 反向检查 |
| A04 | kernel-invoke-consumers：Gateway 注入实际 client、ACK 丢失，结果完成 presentation/reply；无提交/订阅代码 |
| A05 | 无关 invoking-extra 与包外 public-extra 通过 ctx.kernel.invoke；业务依赖代理回归 |
| A06 | Gateway/WeCom/WebUI 全量测试；公共 Extra fixture、活动代码删除扫描 |
| A07 | native real IPC 原身份、连续 seq、原 Provider payload、唯一 completed |
| A08 | canonical completed/cancelled、交互与失败/超时 Playboard、Core/RPC parity 回归 |
| A09 | Kernel real IPC 有序 text/image/text 与并发环境隔离；Core parity、输入/环境测试；本地 streamLimits 拒绝 |
| A10 | 未消费 iterator.return 与预 abort：RPC=0、登记=0 |
| A11 | ACK relay、原 key get 恢复；invoke RPC=1、starts 文件只记一次 Provider 启动 |
| A12 | ACK 与 get 全部断连：ACCEPTANCE_UNKNOWN 优先于 abort；保留身份且 drain incomplete；恢复 get 后释放 |
| A13 | 断开 seq=2 前的订阅，原 after_seq=1 恢复；最终连续、Provider=1 |
| A14 | 5000 帧实际淘汰窗口产生 STREAM_GAP，Provider=1；relay 另覆盖 expired/cursor 错误原码传递 |
| A15 | 完整 ref/generation 低层回归、owned restart 拒绝旧实例、高层错误透传 |
| A16 | 实际终止 worker：native 保留 lost 后未知，canonical 报未知且不造 completed；缺终态/控制错误回归 |
| A17 | 预 abort、status 回应屏障与第二条 socket connect 后/首次 write 前三处取消，invoke 未写出 |
| A18 | 已写 invoke、ACK 前 abort 与丢 ACK 恢复：原身份、自动 cancel 一次、尾 cancelled、实际 reason |
| A19 | 自定义 reason、尾流和 signal listener 释放；Core 取消/清理既有回归 |
| A20 | 同一 invocationId 并发显式 cancel 一次；未登记/其他 client 控制拒绝；接纳不冒充终态 |
| A21 | cancel 和 respond ACK 丢失同时 abort：OPERATION_OUTCOME_UNKNOWN、不重发、不被 AbortError 覆盖 |
| A22 | iterator/client 关闭 cancel RPC=0，另一 client 仍观察原 Run；低层订阅所有权回归 |
| A23 | native/canonical pending interaction 按 invocationId 回答、跨 client/重复/终态拒绝；真实 Adapter 桥接回归 |
| A24 | 真实 Extra A、Extra B、直接 App invoke 并行；停止 A 后 B/App/Kernel 保持，停止 B 仍不影响 App |
| A25 | 已接受但 ACK 未回时 owner drain 可查询/取消；已 return/暂停 iterator 仍能排空 |
| A26 | 未返回接纳与受 signal 约束的挂起查询按绝对期限返回 unresolved；SDK 原 4 秒/4.5 秒回滚回归 |
| A27 | 重复 drain 同一 Promise/首次期限；lost 不完整；cancel ACK 未知但真实终态可完成；确认后取消 IO 释放 |
| A28 | 128 个含在途/未知元数据，重复与第 129 个拒绝；终态释放；snapshot 复制隔离且无正文 |
| A29 | 24 个并发控制/查询单元测试上限各 4；真实 16 个暂停订阅和第 17 个观察失败全部排空，无新增订阅 |
| A30 | 真实 Extra 源终态后等待异步 delivery；业务 dispose 失败返回 incomplete；原资源清理回归 |
| A31 | public 导出、SDK/Extra/Core/Kernel 指南与现行规则同步；旧名称只留删除说明或基线历史 |
| A32 | 本地 build/type/lint/format、Node/UI、tgz、OKF/diff 检查；Windows 新专项已加入 CI，平台执行仍待验 |

# 验证命令与边界

实际命令：pnpm install --frozen-lockfile --ignore-scripts；pnpm typecheck；pnpm lint；pnpm lint:names；pnpm format:check；专项 Node 测试；pnpm test:suites；node --expose-gc --test test/context-loader.test.js test/openclaw-queue-bounds.test.js；node scripts/pack-release.mjs；node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz；uv run --with pyyaml python .octospec/scripts/lint.py；git diff --check。

最终命令结果和计数在 [验证 journal](../../journal/shared/2026-10-20-kernel-client-invoke.md) 记录。构建保留 dirty 标识；未使用 --require-clean，也未伪造干净提交。当前为本地实现与验证，没有 commit/push/PR、发布、服务安装、真实模型调用或 IM 消息发送。

Windows Pipe 新增测试加入既有矩阵，但本机未运行 Windows/Linux CI；默认套件的 10 个条件跳过涉及实际 Provider、Windows 路径和显式 GC，其中两个 GC 条件测试已开启 GC 补测通过。真实 Gateway delivery、第三方宿主迁移和 #30 的最终卡片/文本交付仍由各自验收，不能由本次 fake Provider 的 IPC 结果推断。
