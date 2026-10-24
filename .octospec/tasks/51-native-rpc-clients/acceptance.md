---
type: Acceptance
title: Issue 51 Go/Python互操作验收矩阵
description: 以共享正反样例、真实 Kernel、故障计数、平台证据和仓外产物验证 Go/Python SDK。
tags: [protocol, schema, ipc, native, invoke, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 证据口径

2026-10-24 已完成 Go/Python SDK/demo 的本机基础实施，逐项已有证据和剩余项见 [implementation](implementation.md) 与 [contract-diff](contract-diff.md)。以下保留完整验收断言，不因已通过的 demo 缩减门槛。规划文档检查与产品验收分开。协议/行为用同一批权威 fixtures/scenarios，逐项在 TS reference、Go、Python 执行；语言特殊生命周期另加单测。自动化使用真实 TS Kernel + 隔离 worker + fake Provider，不能称为真实 Provider 联调。平台 IPC 使用本机真实 socket/pipe，不能以模拟 pipe 或交叉编译代替。

每个 case 的 artifact 至少含：case id、OS/arch、SDK/toolchain/version、Kernel commit/instance、schema/behavior hash、endpoint 类型、原 key/ref、最后连续 seq、upstream invoke/Provider start/cancel/respond 次数、最终错误或 Host 终态、registry unresolved、transport 清理结果和耗时。成功证据同时检查事件和副作用计数；不输出正文或凭据。证据文件落入运行参数指定目录，在 `implementation.md` 汇总。按 2026-10-24 用户决定，native 不接入 GitHub CI；跨平台验收通过手动执行取得证据。

## 合同与编解码

| ID | 操作/输入 | 必须观察的结果 | 执行入口目标 |
| --- | --- | --- | --- |
| A01 | 枚举全部 8 method，检查每个 params/result/notification/error `$ref` | 无缺失/重复/宽泛替代已知结构；所有引用可解；RPC 目录与实际 dispatch 相同 | codegen + kernel-ipc-contract |
| A02 | InvokeInput 全字段/环境/两类 interaction roundtrip | TS 与 Go/Python同一合法性结果；signal/functions 不进 wire；streamLimits 明确 KERNEL_STREAM_LIMITS_UNSUPPORTED | protocol suite |
| A03 | absent/null/false/0/空 string/list/object，含 value:null 和合法空 contexts.items | 不合法 null 拒绝；合法零/空/false 不被省略；可选三态 roundtrip 不混同 | 每语言 codec +共享 fixtures |
| A04 | seq/generation/requestId 的 min/max/越界/小数、bool 伪整数、NaN/Infinity | 已知字段范围一致；Python True 不能充当 1；max safe integer 保真 | protocol suite |
| A05 | native payload/providerSession/value 含未知嵌套、null、数组、超 53 位 JSON 数字 | native codec 对收到的 opaque JSON 不投影、不经 float64 丢精度；已知身份仍严格；穿过 TS 的样例按 TS 实际输出校验，不声称恢复其已舍入精度 | protocol roundtrip +独立 TS wire case |
| A06 | UTF-8 多字节拆块、emoji、孤立 surrogate、非法字节、CRLF、转义换行 | 有效串完整；非法字符明确错误不替换；发送 LF；无正文断行 | raw-byte relay + codec |
| A07 | 输入字段额外扩展、未知 Context item、Provider 扩展、严格 ref 多字段 | 开放对象保留；忽略消费不等于已应用；严格控制对象按合同拒绝，不放宽权限 | protocol +真实 Kernel |
| A08 | 伪造/错 id、result/error 同时存在、缺 jsonrpc、未知通知、未知错误字符串、batch | 错 envelope/未知关键通知失败；新错误码及 data 可被报告；无错误帧被当成功 | raw-byte relay |

## 生成再现

| ID | 操作/输入 | 必须观察的结果 | 执行入口目标 |
| --- | --- | --- | --- |
| A09 | 完整 schema 连续生成两次，三 OS 生成 | 相同文件集合和字节，无路径/时间/随机值；代码有 generated 标记、octo-runtime Schema commit 与输入/生成器 SHA-256；未提交输入明确标为未固定 | generate --check + hash artifact |
| A10 | 修改小 Schema 新增可选字段/方法/结果，修改共享状态参数 | Go/Python model、wrapper 和行为常量输出相应变化；手写 transport 无 method/state 分支 | codegen.test |
| A11 | 修改/删除生成文件、增加遗留产物、未知 Schema 关键字 | 本地 --check 非零；生成器在不支持时零部分写入 | codegen.test |
| A12 | 只安装语言包，移走 native/codegen 和 schema 目录 | codec/client/invoke 全部正常，不调用生成器、Node 或文件 Schema loader | package suite |

## 执行与故障

| ID | 操作/故障 barrier | 必须观察的结果 | 执行入口目标 |
| --- | --- | --- | --- |
| A13 | 构造未消费；首次消费 status/list + invoke | 消费前零连接/登记/Provider start；消费后 1 invoke/1 start，receipt 完整；status/list 与 TS 一致 | interop suite |
| A14 | native/default，按序 text/image +独立 env，成功终态 | HostFrame 身份和 payload 保留；同轮唯一执行；图片字节完整，env 不进入模型/日志；mode 不变 | interop + fixture capture |
| A15 | canonical，正常/Provider failure/取消三种结束 | 高层只输出合法 CanonicalEvent，Host error/gap 依 TS 报错；高级 subscribe 仍可读真实终态；不制造成功 | interop suite |
| A16 | 完全或部分写出 invoke 后丢 ACK | 原 key/instance 查询；invoke/start 各 1；最多 3 get/10 秒修复，原 receipt/stream 续接 | relay ACK barrier |
| A17 | ACK 丢失且原 get 不可得/查询错身份/服务重启 | ACCEPTANCE_UNKNOWN 或确切 identity/instance 错误；unknown 保留登记，不再 invoke | relay + instance restart fixture |
| A18 | 收到 seq=N 后切断原订阅两次，再恢复 | 只以原 ref/after_seq=N 续读，最终连续且无重复；invoke/start 仍 1；累计恢复次数不重置 | relay seq barrier |
| A19 | 续流三次失败/10 秒到期、窗口被淘汰、终态 TTL 过期、未来 cursor | 分别有界终止、STREAM_GAP、RUN_NOT_AVAILABLE/当前实际过期码、STREAM_CURSOR_INVALID；无合成新流 | relay + HostRunService fixture |
| A20 | 改 ref 每一个身份字段、旧 generation、旧 instance | get/subscribe/cancel/respond 均拒绝错误引用；原 Run 不被取消或回答 | interop mutation cases |
| A21 | 同 runId 再 invoke；重复 invocationId；相同 RPC id 的不同连接 | Run 重复为 RUN_ALREADY_ACCEPTED；client 同 invocation 冲突在 I/O 前拒绝；RPC id 是连接内关联，不是业务幂等键 | interop + raw connection |
| A22 | write 前取消，包括 status 等待后和 connect 后未 write 的 barrier | invoke/start 0；本地原因保留；无迟到提交/登记泄漏 | relay request barrier |
| A23 | write 后、ACK 前取消/deadline，同时丢 ACK | 原身份恢复后 cancel 最多 1；仍读 Provider session update/终态尾流；ACK 不是完成 | relay + cancellation fixture |
| A24 | cancel ACK 丢失或回应到达前断线 | OPERATION_OUTCOME_UNKNOWN 优先于本地 abort；cancel 不自动重发；执行结果可以独立查询 | control ACK barrier |
| A25 | iterator close/client close/Python Task.cancel | 只停观察，cancel=0，兄弟 client 能继续原 Run；socket/task/线程不累计 | interop +语言生命周期单测 |
| A26 | 两类 pending 交互，合法答复；重复/过期/错 mode/越权方法/扩大权限答复 | 原请求正确完成且 respond=1；非法响应被原边界拒绝；不能变新 invoke 或绕过审批 | fake 原生/标准交互 + Kernel |
| A27 | respond/native.respond ACK 丢失并并发取消 | 控制结果未知、不重发答案、不改目标；原错误不被本地取消掩盖 | relay response barrier |
| A28 | worker lost，native 与 canonical；terminal 后帧/无 terminal EOF | native 先原 lost 帧后 RUN_OUTCOME_UNKNOWN；canonical 核对 lost；无法确认保留原错；missing terminal 不成功 | worker failure + raw-byte relay |
| A29 | 已消费终态后 get/subscribe；缺口时 terminal 仍可单独查询 | get 保留独立终态；after=latest 的合法订阅可耗尽；缺历史仍报 gap，不能拿 snapshot 跳过缺帧假装完整流 | HostRunService + interop |
| A30 | local cancellation 与正常终态/明确错误同时发生 | 依既有错误优先级：具体 source/control 错优先；只有正常耗尽才抛本地取消原因；未知不能变已完成 | barrier +共享行为场景 |

## 有界资源与交付

| ID | 操作/输入 | 必须观察的结果 | 执行入口目标 |
| --- | --- | --- | --- |
| A31 | 最终请求 32 MiB 边界 ±1，接收行 40 MiB+64 KiB 边界 ±1，半包/无 LF 超限 | 请求含最终 envelope+LF 计数；超过时不 write；接收超限在 JSON.parse 前拒绝；残行非成功，partial write 正确处理 | byte fixture + transport unit |
| A32 | 暂停消费者、持续大帧、服务写阻塞及重放压力 | 队列/未解析字节保持声明上限，背压/断线/续接或 gap 真实；无无界 buffer，兄弟调用保持可用 | slow-reader scenario +高水位计数 |
| A33 | client 32 连接/128 登记/4 路取消与查询、server 64 连接/16 订阅边界 | 计数按真实在途；超额明确失败；unknown/lost 占额；正常终态和真实 I/O 结束才释放 | saturation + registry tests |
| A34 | owner stopAdmission/drain 并发/重复、ACK pending、16 paused streams | 首次总 deadline 不延长；无新增订阅；confirmed 终态才 complete；unknown/lost unresolved；deadline 后无新 I/O | lifecycle suite |
| A35 | 关闭/失败循环 100 次，Windows pipe read/write 中取消 | client 无遗留 socket、goroutine/task、executor 作业或 handle 增长；OVERLAPPED completion 后释放；Kernel/其他 client 保持运行 | transport stress + native platform |
| A36 | Go/Python × macOS/Linux UDS × Windows pipe | 每格实际 Kernel 连通、流/控制/故障/清理通过；真实 OS/arch/工具链证据，非交叉编译或 skip | 6 格平台矩阵 |
| A37 | 各语言最低版本/当前版本 build/test、仓外独立产物、无客户端 Node | Go binary、Python wheel/sdist 可独立使用；生成源已入包且无仓库路径依赖 | 本地工具链验证 + package suite |
| A38 | TS build/install/test、npm offline tgz、检查 workflow 与安装链 | 原 TS Runtime 不要求 native 工具链；TS 回归通过；GitHub workflow/Gate 不执行 native 检查 | 原 TS 检查 + workflow diff |
| A39 | 文档/示例、兼容/版本/分发/手写边界检查 | 最短 invoke、取消/交互、advanced 原语、unknown、服务独立所有权、两包版本及生成流程可执行；中英用户文档一致 | docs checks +例子真实运行 |
| A40 | Go/Python接真实支持 native 的 Adapter，各跑 native/canonical/取消/交互 | 保存实际 Provider/Kernel 版本与终态；每语言证据独立，未触发的真实交互标未验；fake 结果不替代真实调用 | opt-in live harness |

## 平台矩阵

macOS arm64 的 Go/Python 已各通过 45 项基础/故障/demo/包外测试；A31-A35 的完整压力和竞态断言仍待验。Linux/Windows 尚无实际执行结果。M6 本地验证对每格再细分 minimum/current toolchain。CPU 架构按 runner 实际记录，不由 macOS arm64 推断 Windows arm64 支持。

| 语言 | macOS UDS | Linux UDS | Windows named pipe |
| --- | --- | --- | --- |
| Go | 基础 45 项/包外通过；完整压力待验 | 待验：A13-A35/A37 | 待验：A13-A35/A37，含实际取消 I/O |
| Python | 基础 45 项/包外通过；完整压力待验 | 待验：A13-A35/A37 | 待验：A13-A35/A37，含 pywin32 completion/thread/handle |

A01-A12/A39 是TS/Go/Python 三客户端共享合同门禁；A40 的真实 Provider 先在可用受保护测试机器逐语言运行，两种输出及交互分别记录，不要求凭据进入公共 CI。macOS/Linux 的 transport-specific 分支替换 Windows-specific 测试，不把共同协议/行为场景跳过。

## Issue 覆盖与完成条件

| Issue 要求 | 验收映射 |
| --- | --- |
| 完整语言中立 IPC、InvokeInput/环境/交互，无 JS 活对象 | A01-A08/A39 |
| schema/template 生成模型、方法及高层流程，确定性与 CI | A09-A12/A38 |
| listing/invoke/receipt/stream/get/resubscribe/cancel/respond | A13-A30 |
| 省略/null/空值、opaque、扩展、身份/权限 | A02-A08/A20-A21/A26 |
| 接纳未知、断线窗口、Kernel restart、不重复执行 | A16-A19/A23-A24/A27-A30 |
| malformed/truncated/oversized/slow-reader/bounded/closed cleanup | A06/A08/A25/A31-A35 |
| Go/Python平台证据、独立二进制及客户端无 Node | A36-A37/A40 |
| Run 7/Context v3、不改现有执行约束、TS 回归与文档 | A02/A07/A14-A15/A26/A38-A39 |

最终交付要求每项有代码位置和证据链接，不能只打勾。必测平台、生成/构建或互操作失败时 issue 保持未完成；真实 Provider 未验范围在完成建议中显式列出，不能靠准备度评分豁免。最终关闭 issue 和发布另按用户授权执行。
