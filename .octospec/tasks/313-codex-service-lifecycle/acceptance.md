---
type: Acceptance
title: Issue 313：验收矩阵与证据要求
description: 将服务复用、隔离、交互、异常恢复及 finalization 回归映射到独立验收场景。
tags: [testing, lifecycle, interaction, native, canonical]
---

# 通过标准

所有场景均绑定实施 revision/dirty、OS、Node、Codex 版本、执行命令及场景结果。fake 不能代替真实 Provider，模拟平台不能代替原生 OS，服务恢复不能代替旧调用完成。以下为目标矩阵；本机实际结果见后表及 [validation](validation.md)，partial 不表示完整通过。

| ID | 触发与断言 | 证据层 |
| --- | --- | --- |
| A01 | 两个 Core 注册同一 Codex 描述对象，各有独立 scope；Kernel/direct 均进入 Core；无 global singleton/worker/launcher | fake、静态调用链、包外严格类型 |
| A02 | 同配置连续至少 3 轮含 resume，PID/connectionId/incarnation 相同，initialize=1；各轮 request/queue/signal 不残留 | fake + 真实 Codex direct/IPC |
| A03 | env、executionEnvOverrides、CODEX_HOME、版本/argv、cwd、容量、MCP header/展开值/修订分别变化，隔离服务；相同配置/不同随机 MCP 环境映射仍复用 | fake + 真实 env/MCP；Windows 原生键大小写 |
| A04 | 两个 thread 同时产生输出和审批；交错 start ACK/通知正确归属；同 thread 冲突明确拒绝；同键并发 ensureReady 只启动一次 | fake + 指定版本真实 Codex；M0 必过 |
| A05 | 正常终态、显式 Stop、取消于 thread/turn ACK 前后均不关闭共享服务；A 取消后 B 正常完成；ACK 未知不重试 turn/start/interrupt | fake + 真实两模式 |
| A06 | IPC observer/client 断开和 direct Extra observer.return 均不取消；裸 Core iterator.return 仍定向取消；关闭 Extra A 后 B/宿主可继续调用 | fake + direct/IPC、真实 Codex |
| A07 | approval、结构化 user input、native reply 精确回到原请求；duplicate/expired/wrong owner/wrong turn 均拒绝且无多余写入 | fake + 真实两模式 |
| A08 | MCP elicitation 正常往返；缺 turnId 的请求有可证明因果关联才路由，否则明确拒绝并报告支持限制；未知方法有错误响应 | fake + 真实临时 MCP；不能以拒绝全部正常 elicitation 记通过 |
| A09 | #265 活动 steer、完成后显式同会话补答保留；旧 responder、旧 incarnation 同号 RPC/native ID、迟到 ACK 均不可命中新轮 | fake + 真实 async 手动专项 |
| A10 | 服务 idle 时 kill 自有 PID，期间不发业务请求；观测 unavailable/recovering/new incarnation/ready；之后新轮成功 | **真实 OS kill + fake**；M3/M5 必过 |
| A11 | active turn kill：原调用 failure/unknown，turn/start 次数不增加；恢复后显式新调用成功，原未知控制不重放 | 真实 kill + fake 两模式 |
| A12 | 同时 exit/EOF/stdin error 只触发一个恢复；反复 ready/crash、启动失败验证 5 次/90 秒预算、抖动和 degraded；业务请求不能重置预算 | fake clock + 真实重复故障 |
| A13 | close 发生于 backoff、initialize、迟到 spawn、已 ready；恢复永久关闭，无晚起进程/ready；重复 close 共用结果 | fake + 真实 owned 进程 |
| A14 | 旧进程/后代退出未确认时不启动第二 owner；cleanup incomplete 保留服务 ID、Kernel manifest 和租约；无活动 invocation 也不能 complete | fake 故障注入 + 原生 OS |
| A15 | final_answer 完整且无后续工作/同步交互：stall、ignore-interrupt 两模式在 15 秒后唯一 completed，保留 final/产物；cleanup 独立 pending/failed，迟到事件不改写成功 | fake + Core/Kernel 完整链路；与 #307 澄清一致 |
| A16 | resumed ChannelGateway 生成 HTML 并实际投递，再同会话追问；对比旧/新进程模型的 final item、terminal、interrupt、teardown 时间；不声称证明 #307 根因 | 真实 Codex + im-test 回读 |
| A17 | owner shutdown 同步停恢复、取消所属调用、关闭 owned 服务；Extra close 不关闭服务/宿主数据库；非 Codex Adapter 无 hook 时回归保持 | fake + SDK/Kernel、包外运行 |
| A18 | 服务池第 9 个键、128 等待、总字节、每轮队列、pending/交互/临时通知上限分别命中；慢 A 不阻塞 B，transport 真失败明确影响所有所属调用 | fake 容量/背压 + 本地负载 |
| A19 | 用户取消、真实 Provider error、只有 delta/async、活动工具、未答同步交互或 final 后新工作均不得错误 fallback 成功；失联无合格 final 仍失败/unknown | fake 两模式 + 真实回归 |
| A20 | 包外只安装主包可构造并关闭 direct/IPC；metadata/双语文档一致；本地现有检查通过；workflow、脚本、selector 和实际检查列表相对目标分支无专项扩围 | tgz、文档/类型、本地检查、diff/托管事实 |
| A21 | doctor 文本/JSON 同源，只展示所选实例的常驻 Host/Kernel/独立 Extra/app-server，按实际 PID 合并角色；不包含 turn/thread/Run/调用计数和临时工具。首次调用前无 Provider PID、不因 doctor 启动服务；恢复后显示新 PID/代次，旧清理未确认独列；owner 不可达/PID 重用/平台不足不假报 ready 或完整清理；Schema/生成类型/跨语言解析一致，argv/env/凭据不输出 | 手动 CLI 快照断言 + 真实 owned 服务恢复；direct SDK 读取同源快照，原生平台分别记录 |

## 证据字段

### 2026-11-05 实施结果

共同基线：`de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` 加本 worktree 未提交改动；macOS arm64、Node 24.22.2、真实 Codex CLI 0.164.0。离线专项集中于 `test/manual/codex-service-lifecycle-313.test.mjs`，共 26 项通过。所有条目均未使用原生 Linux/Windows 或外部 Electron 作为证据。

| ID | 实际结果 | 证据与剩余项 |
| --- | --- | --- |
| A01 | pass，本机范围 | 两 Core 同描述对象独立 PID/scope、静态调用链；包外公共类型和实例清理 |
| A02 | partial | fake initialize=1、resume/PID；真实 direct/IPC 各五轮含恢复，原生探针并发/resume；未记录独立 connectionId |
| A03 | partial | 完整语义键实现、revision 分池、现有 env/MCP 回归通过；未逐项构造真实身份切换，Windows 键行为未验 |
| A04 | partial | fake 并发输出/审批、ACK 前通知、同 thread 忙拒绝；真实原生协议探针并发输出通过，未测真实并发审批 |
| A05 | partial | fake A 取消不影响 B、原服务保持 ready；真实正常完成复用；真实定向 Stop 和所有 ACK 竞态尚未逐项运行 |
| A06 | partial | 既有观察/Extra 生命周期回归通过；未新增真实 Codex 多 Extra 组合场景 |
| A07 | partial | 并发审批 wrong owner/duplicate 负例及既有交互/native 回归通过；真实审批/user input 全组合未跑 |
| A08 | partial | 真实临时 MCP 完成两次 elicitation 往返；fake nullable 首次活动 thread 路由通过；复用 thread 的 nullable 因果不足明确拒绝，未补完整真实负例矩阵 |
| A09 | partial | 既有 async steer/补答回归保持；专项未执行真实恢复后旧 ID 重用全矩阵 |
| A10 | pass，macOS | direct/IPC 真正 idle SIGKILL，不发业务触发恢复；新 PID/incarnation 后显式续聊成功 |
| A11 | pass，macOS | direct/IPC active SIGKILL，原轮 failed，随后新轮成功；fake 计数确认无 turn/start 重放 |
| A12 | partial | fake EOF-live-child 与 active/idle 故障恢复、静态预算检查；未完整运行 fake clock/真实反复崩溃至 degraded |
| A13 | partial | 恢复中关闭不再 spawn、重复 close 共享执行并观察迟到清理；迟到异步 spawn/全 initialize 竞态未穷举 |
| A14 | partial | 既有 owned 进程组及失败注入用例通过；失败清理保留 ID；原生 Windows leader-first 限制未验 |
| A15 | partial | 既有 stall/ignore-interrupt 两模式及 Core canonical/native 成功不被清理失败覆盖通过；Kernel 全链路 fallback 专项未跑 |
| A16 | not run | 未配置本专项 im-test 测试账户/渠道，未实际投递或回读 HTML，不能宣称 #307 根因已证实 |
| A17 | partial | Core/Kernel owner 清理、两 Core 隔离、无 hook 回归、包外运行通过；真实多 Extra 组合未跑 |
| A18 | partial | 第九服务键拒绝、既有队列/背压容量回归通过；全部上限和慢消费者组合尚未独立压测 |
| A19 | partial | 既有取消/Provider error/finalization 负例通过；未执行每个真实模型反例 |
| A20 | pass，本机范围 | 构建/类型、lint、docs、默认全量、Go/Python、本地 tgz 离线公共类型/运行通过；CI 入口、workflow、scripts、package.json 未扩大；无 PR，托管 checks 不适用 |
| A21 | partial | 实际 CLI 文本/JSON、首次调用前无启动、同 PID 合并纯视图、Core/Kernel 安全快照及生成类型通过；真实恢复 PID 变化通过；跨平台 PID 重用/owner 不可达组合未全验 |

### 记录约束

复用/恢复记录至少包含 serviceId、incarnation、真实 PID、connectionId、initializeCount、spawnCount、turnStartCount、故障观测/ready/interrupt/terminal/cleanup 的单调相对时间。真实 ID 仅进入受控本地执行证据，不进入组件 statusOutput；不保存原始 prompt、answer、tool args、env、MCP header 或认证值。

故障用例同时断言无业务重放和无遗留 owned 资源，不以 kill 返回、pipe destroy 或 leader 退出代替回收确认。断言必须在失败时结束并保留错误，不能吞错误后继续累计通过数量。

macOS arm64、Linux、Windows 分别记录。Windows 无法证明 leader 退出后全部后代回收时保留限制；若具体验收因限制失败，写 failed/blocked，不用平台 skip 冒充通过。外部 Electron 宿主未运行时单独记 not run。
