---
type: Verification
title: Issue 69 验收矩阵
description: 将 issue 的公共入口、可靠性、迁移和文档要求对应到可观察断言。
tags: [testing, invoke, ipc, extra, lifecycle]
timestamp: 2026-10-20T00:00:00Z
---

# 验收口径

以下 A01-A32 是原验收定义；本地实际结果与边界逐项记录在 [实施记录](implementation.md)。规划文档本身不算通过证据。自动化使用真实本地 Kernel/worker IPC 和 fake Provider；故障 relay 控制 ACK/订阅/控制回应，分别计数 invoke RPC、Provider 启动、cancel RPC 与输出 seq。竞态通过可控屏障触发，不用随机 sleep 作为唯一证据。

## 公共入口与消费者

| ID | 触发/场景 | 必须观察的通过条件 | 验证位置 |
| --- | --- | --- | --- |
| A01 | 仓外 tgz 消费者从主包 /executor-kernel attach，调用 invoke | 不配置、加载、实例化 Extra；真实 IPC 输出至终态；无私有路径 import | `test-support/public-extra/kernel-invoke.mts`（新增）、`scripts/verify-release.mjs` |
| A02 | 通过 startOwnedKernel 返回的 client.invoke | 同一公共类型和行为；attached.close 不停止服务；只有 owned handle 可 stop/restart | `test/host-sdk-lifecycle.test.js` |
| A03 | 公开类型原生、canonical、变量模式三种调用 | strict、skipLibCheck=false；分别推导 HostFrame、CanonicalEvent、联合；错误跨模式操作用 @ts-expect-error 验证 | 仓外 fixture 同 A01 |
| A04 | Gateway 入口处理请求并交付输出 | 调用实际 Kernel client.invoke；只消费结果做 delivery；自身没有提交/订阅/ACK 查询/游标修复；断流不重复启动 Provider | 新 `test/kernel-invoke-consumers.test.js`、Gateway 回归 |
| A05 | 无关 fixture Extra 带自定义业务依赖运行 | ctx.kernel.invoke，执行至终态；不修改 loader/Kernel/Core 业务字段；没有 Gateway 依赖 | `test/fixtures/invoking-extra.mjs`、`test/host-sdk-lifecycle.test.js` |
| A06 | WeCom、WebUI 和 fixture 同步迁移 | 直接使用同一 client 方法；list、canonical 结果、取消及交互仍可用；旧 port 类型/字段无活动引用 | 各既有 Extra 测试、仓外插件 fixture |

## 输入与输出

| ID | 触发/场景 | 必须观察的通过条件 | 验证位置 |
| --- | --- | --- | --- |
| A07 | native 正常 completed | Provider payload 与输入身份不变、源 seq 连续、唯一 Host 终态；无 canonical 重建 | 新 `test/kernel-invoke.test.js`、`test/native-host.test.js` |
| A08 | canonical completed/failed/cancelled | 正确 CanonicalEvent、既有控制错误传播；正常结束需核对源终态，失败不变成功 | 新 invoke 测试、`test/invoke-parity.test.js` |
| A09 | inputs/contexts、多模态、executionEnvOverrides 并发 | 与 Core 的实际输入相同、顺序/图片不变；signal 不进 JSON；环境逐调用隔离；streamLimits 明确拒绝 | invoke 测试、输入/环境/请求预算回归 |
| A10 | 生成 iterator 不消费、首次 next 前 return | invoke RPC=0、Provider=0、不占登记槽；首次 next 才提交 | 新 invoke 测试 |

## 故障、身份与恢复

| ID | 触发/场景 | 必须观察的通过条件 | 验证位置 |
| --- | --- | --- | --- |
| A11 | 丢弃接纳 ACK，get 恢复成功 | invoke RPC=1、Provider 启动=1；原 key/ref，不改模式或身份 | 扩展 `test/kernel-clients.test.js`，经 invoke 运行 |
| A12 | 接纳 ACK 与所有有界查询失败 | ACCEPTANCE_UNKNOWN 可见、原 key 可取得、未知记录仍占额；不自动重提，不假 cleanup complete | relay + 新 invoke 测试 |
| A13 | 已接收 N 帧后切断连接 | 用同一 ref、after_seq=N 修复；输出连续且无重复，Provider 启动=1 | relay + 新 invoke 测试 |
| A14 | 重放窗口已淘汰、过期、错误 cursor | 原 STREAM_GAP/STREAM_EXPIRED/STREAM_CURSOR_INVALID 可见；无重跑、无“正常结束” | 小窗口 Kernel fixture、clients 回归 |
| A15 | Kernel 实例变化、完整身份错配 | KERNEL_INSTANCE_CHANGED/RUN_IDENTITY_MISMATCH；旧 ref 不控制新 Run | clients/生命周期测试 |
| A16 | 流缺真实终态、控制错误、worker lost | 不因 EOF、cancel ACK 或 Provider result 字样报成功；native lost 保留后报 RUN_OUTCOME_UNKNOWN，canonical 不造 Provider 事件 | invoke 测试、worker supervision |

## 取消与关闭

| ID | 触发/场景 | 必须观察的通过条件 | 验证位置 |
| --- | --- | --- | --- |
| A17 | 预 abort 与 status 响应后、写 invoke 前 abort | 两个屏障位置均 invoke RPC=0、Provider=0；抛实际 signal.reason | relay + invoke 测试 |
| A18 | invoke 已写、ACK 尚未返回时 abort，包括 ACK 恢复 | 原身份仍可追踪；取得 ref 后一次自动 cancel；未知错误优先保留 | relay + invoke 测试 |
| A19 | accepted 后 caller abort，包括自定义 reason | 原订阅保留至尾帧；真实终态不被改写；正常耗尽后抛 reason；无 listener 泄漏 | invoke + Core parity |
| A20 | 显式 cancel/cancelInvocation 与真实完成竞态 | accepted 不等于 cancelled；已完成保持 completed；未登记/跨 client 拒绝；同一取消意图不重复发送 | invoke/clients 测试 |
| A21 | cancel/respond ACK 丢失与 signal 同时 abort | 保留 OPERATION_OUTCOME_UNKNOWN；不被 finally 的 AbortError 覆盖；不自动重试副作用 | relay、invoke/parity 测试 |
| A22 | iterator break/return、subscription signal、client.close | 只关闭本地观察、cancel RPC=0；另一 client 可观察同 Run 至终态；读关闭 client 报 CLIENT_CLOSED | clients + invoke 测试 |
| A23 | canonical/native pending interaction | 同一 client 由 invocationId 路由到原 ref；有效回答一次，错误身份、过期/终态和重复回答拒绝 | native/交互回归、invoke 测试 |

## owner 与容量

| ID | 触发/场景 | 必须观察的通过条件 | 验证位置 |
| --- | --- | --- | --- |
| A24 | 停止 Extra A，B 与直接 App 同时运行 | 只取消 A 的 invoke；B/App/client/Kernel 正常；停止接纳后新 invoke 发 RPC=0 | host-sdk lifecycle |
| A25 | owner stop 发生在接纳、执行、已关闭 iterator 时 | 已接纳者逐一核对真实终态；原消费者可收尾；登记未确认者保留 | lifecycle + invoke 测试 |
| A26 | 接纳/查询/Provider 不退出、4 秒 deadline 到达 | 不先无限等 starting；截止预算后 complete=false、unresolved 含原身份；定时器/新 IO 停止，失败阻止替换 | 新 `test/kernel-invoke-lifecycle.test.js`、runner 回归 |
| A27 | 重复 drain/stop、cancel ACK 丢失、lost | 同一清理操作/首次 deadline；未知/lost 不因 refs.clear 或进程退出变 complete；控制 ACK 未知但后来确认原终态时允许完成清理 | lifecycle + runner 回归 |
| A28 | 128 个登记、重复在途 invocationId、暂停/异常消费者 | 第 129 个和重复 ID 在提交前拒绝；在途/未知占额；已确认终态释放；无正文或输出历史留存 | 新 lifecycle 测试 |
| A29 | 多 Run 排空、订阅接近 16/连接接近 32 | 不新增逐 Run 排空订阅；新增控制/查询并发各 <=4；仍可返回真实清理摘要；不影响其他 owner | 新 lifecycle 测试 |
| A30 | tail 处理、业务 onDispose/资源释放失败 | 源终态不等于 delivery/业务写入完成；按剩余期限等待 onDispose，错误/超时不报完整清理 | host-sdk lifecycle/fixture Extra |

## 交付一致性

| ID | 触发/场景 | 必须观察的通过条件 | 验证位置 |
| --- | --- | --- | --- |
| A31 | 导出、文档和删除扫描 | 旧 port/ExtraAdapterHost/ctx.adapterHost/ImExecutionPort 无活动合同；当前规则/SDK/作者示例全部推荐 Kernel invoke；历史 journal 明标历史 | 全仓 rg、OKF lint、公开声明 |
| A32 | workspace 与安装包完整门禁 | typecheck/build、lint/names、format、Node/UI 回归和 tgz 仓外验证通过；Windows Pipe 上新测试加入既有矩阵 | [实施计划](plan.md)、`.github/workflows/ci.yml` |

## issue 覆盖与证据格式

Issue #69 原验收第 1-3 项对应 A01-A06；owner 跟踪/清理对应 A20/A23-A30；故障合同对应 A07-A23；Core/Kernel 示例、导出和指南对应 A03/A09/A19/A31-A32。

每项记录基线/实现 SHA、OS/Node、命令、测试名、实际断言、结果及未验原因。截图、日志和文档不得包含凭据。自动化不能替代真实 Provider/线上 delivery 证据；#69 的执行入口验收不要求证明 #30 的卡片投递已经完成。

可选真实联验使用 `https://im-test.deepminer.com.cn/` 和受保护凭据，核对一次执行及 delivery 消费结果；不得在本轮规划中发真实业务消息或启动模型。Windows 新增专项未运行前保持待验，不能由 macOS 结果推断。
