---
type: Task
title: Gateway 恢复测试的外部 Kernel 依赖与独立清理
description: 将 Kernel 作为外层 fixture 提供的 RPC 依赖，验证 Gateway 独立关闭，并修复任一收尾失败跳过其他资源的问题。
tags: [testing, lifecycle, extra]
---

# 目标与依据

测试 channel-gateway 时，executor-kernel 是外部执行依赖。Gateway 负责渠道行为和自己的连接，不创建、不停止、不重启 Kernel。测试环境可以拥有这两个服务，但必须分别管理它们。

本规格根据用户“测试 channel-gateway 时 executor 应该是 dependency”的反馈重写，替代[首版规格](brief-v1.md)。原始问题仍为 [Issue #233](https://github.com/Mininglamp-OSS/octo-runtime/issues/233) / ORT-68：测试环境关闭 Gateway 报错后，异常跳过 Kernel 的独立回收。该控制流缺陷存在，但不是 Gateway 对 Kernel 的生命周期控制，也不能据此判定生产服务缺陷。

当前基线：`origin/main@42102c60103a9b18166c499b0c74a23e0d2295c6`（首次第二版实施基线为 `7fd022cd`，已 rebase）；分支 `fix/233-recovery-teardown`；worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-233`。新版实施结果见[验证记录](validation.md)的第二版及最新主线复验章节，首轮历史结果不沿用。

## 测试职责

| 层次 | 应验证 | 不应承担 |
| --- | --- | --- |
| Gateway 单模块测试 | 渠道输入、调用参数、结果投递、依赖不可达时的自身行为 | 构造真实执行引擎、验收 worker 自恢复、控制 Kernel 启停 |
| 本次 Gateway 恢复集成测试 | 经真实 RPC 依赖恢复处理新消息；关闭 Gateway 不影响共享 Kernel | 把 Gateway close 与 Kernel close 组合成一个产品生命周期 |
| 外层测试 fixture | 准备真实 Kernel、IM fixture、测试所属进程；测试结束后逐项回收 | 将清理权限交给被测 Gateway；修改生产部署策略 |

本次只整理受影响的恢复测试和直接支持代码，不重写全仓 Gateway 测试。已有单模块测试可以注入 fake 执行依赖；本次集成测试保留真实 Kernel + fake Provider，不能用 fake Kernel 替代进程独立性证据。

## 已确认的边界

- Kernel 服务与其 worker 是两种资源，worker PID 不能当作 Kernel PID。
- Gateway 只知道指定 endpoint，使用现有 KernelClient RPC 合同。不得获得 Kernel 服务对象、所属进程句柄、启动/关闭函数或 fixture disposer。
- Gateway 可以按既有合同停止接纳、取消和排空自己的调用；不得停止 Kernel、其他客户端或其他 Extra 的无关调用。
- Kernel 是否由某个 SDK 宿主在其自身进程构造，仍由宿主选择。本次不修改生产 SDK 部署 API，也不把特定测试拓扑推广为所有 SDK 产品的强制部署要求。
- 统一服务规范要求每个服务入口直接调用公共原生服务工厂，不要求 Gateway 与 Kernel 一定同进程。测试专用进程入口不属于产品 launcher，不导出为 SDK API，不恢复已删除的 startOwnedKernel/startNativeComponent。
- 本次不修改生产 Kernel、Gateway、RPC 协议、重试间隔、未知执行结果语义或 CI 范围。

## 测试环境与资源所有权

本次集成测试选择独立进程，以证明 Gateway 仅借用依赖：

```text
外层测试运行器（唯一环境所有者）
  ├─ Kernel dependency fixture → Kernel 服务进程 K → worker
  ├─ Gateway fixture → Gateway 宿主进程 G
  │                      └─ KernelClient ── RPC ──> K
  └─ 独立探针客户端 ───────────────── RPC ──> K
```

1. 外层先登记 Kernel 进程、退出事件和清理动作，再等待其就绪，将 endpoint 和独立探针接口传给测试；Kernel disposer 仅留在外层。
2. Gateway fixture 只收到 endpoint、渠道配置、fake IM 地址和必要环境值，不 import 或调用 createKernelService。每个测试使用私有目录和独占 endpoint，避免共享全局服务或机器配置。
3. CLI 模式以现有 CLI run 入口运行 Gateway；SDK 模式使用测试专用宿主入口，在 G 内直接 import Gateway 模块并调用 createExtraService。SDK Gateway 宿主入口不创建 Kernel，也不调用 CLI。
4. Kernel dependency fixture 可以通过独立的测试入口在 K 内直接构造 createKernelService，使用既有 fake Adapter/worker；其启动、状态、故障操作与关闭都由外层管理。两种模式使用同一 RPC 契约，分别断言 G、K、worker PID。
5. SDK 恢复夹具默认不额外启用文件日志线程；文件日志生命周期由既有专项负责。实施核对发现现有 statusOutput 必须同时配置文件日志目录，因此测试专用模块透明转发 Gateway 入口与日志回调，使用现有 extraStatusRecord 白名单捕获渠道状态；不改变业务或服务生命周期，不声称覆盖 SDK statusOutput sink。若场景必须启用文件日志，须独立确认其关闭，不得用已知 lost 结果放行 logs incomplete。
6. 收尾分为两个明确阶段：先关闭 Gateway 并观察 Kernel 独立性，再由外层结束整个环境、回收 Kernel。Gateway 的关闭结果不决定外层是否有权或是否需要回收 Kernel。

## 关闭与失败合同

### Gateway 独立关闭

正常关闭 Gateway 时，记录其关闭返回值与进程退出结果。在外层对 Kernel 发任何关闭信号之前，使用独立客户端确认 Kernel PID、实例身份未变，完成一次新的执行。无关客户端在途调用也应继续到真实终态。不能只检查 PID 存活，也不能用 Gateway 自己的连接充当独立探针。

Gateway 关闭失败、RPC 断开、主体断言失败均不触发产品侧 Kernel close。它们只产生测试失败或诊断，由外层在结束测试环境时清理自己拥有的资源。

### 外层环境收尾（#233）

- 每个已取得资源登记独立 cleanup，登记早于可能失败的初始化等待；回收过程逐项捕获错误，不能因为 Gateway 超时、探针失败或任意清理错误而漏掉 Kernel、worker、客户端及 IM fixture。
- 正常先关闭 Gateway，再结束 Kernel；这是测试环境的回收顺序，不是二者的产品依赖关系。不得依赖多个 after hook 的隐式顺序保证回收。
- CLI 使用 SIGTERM，测试专用原生宿主通过私有 IPC 消息调用 close，均保留 7000 ms 关闭宽限；仍存活则尝试 SIGKILL，之后独立最多等待 3000 ms 退出。发送失败、信号抛错或返回 false 后仍进行有限退出确认，再处理下一个资源。
- kill 成功、管道关闭和 client.close 均不等于所属进程已退出。记录组件、PID、阶段、exitCode/signalCode 和原始 errno；未确认退出明确报告 incomplete，保留仍可能使用的目录及路径。
- 测试主体原始失败单独保存，包括 falsy 抛出值。只有主体失败时保留原值；有清理失败时用 AggregateError 聚合，原始失败在首项及 cause 中，清理错误按发生顺序保留，最终测试输出逐项可见。

### RPC 结果与资源事实分开验收

| 事实 | 在本次测试中的含义 |
| --- | --- |
| 主动杀 worker 后 lost / RUN_OUTCOME_UNKNOWN | 该请求结果未知，必须记录且不能重放；不直接证明进程或连接泄漏 |
| 该场景 SDK close 的 runs incomplete | 仅在明确注入 worker 丢失、已观察到对应 lost/unknown 且资源独立性与退出确认通过时，作为预期诊断；不得声称 close.complete:true |
| Gateway 自有 socket、线程、日志等资源未关闭 | 实际资源问题，不能因 runs unknown 放行；保留具体阶段与结果，测试失败 |
| SIGTERM 超时、强杀失败、所属进程退出确认超时 | 环境回收失败；即使后续兜底成功，也保留错误并让对应故障子测试失败 |

普通正常关闭、未注入 worker 丢失的场景，仍要求 Gateway 关闭完整。仅被刻意制造为结果未知的调用可按上表单独验收；不是忽略所有 complete:false。Gateway close 的错误和不完整事实不能改变 Kernel 的独立生命周期。

实施观察边界：CLI 前台宿主只公开聚合退出码，不输出原生 close 的资源列表。主动 worker 丢失后允许记录其既有退出码 5，但不能把它解释成仅 runs incomplete 或日志完整；本测试对 CLI 验收进程回收及独立 RPC，精确资源分类由独立 SDK 宿主回传结果验收。未注入 worker 丢失的正常 CLI 关闭仍要求退出码 0。CLI 日志关闭的独立现有回归另行执行，不扩大本次生产 API。

## 验收条件

### A1：依赖装配正确

CLI 与 SDK 的集成环境都记录 G、K、worker 三项 PID，确认互不相同。Gateway 入口只装配 Gateway，所有 Kernel create/stop/kill 代码均属于外层 fixture 或其独立 Kernel 入口。测试通过 RPC 取得执行结果；不增加产品启动器、进程内替代调用或新的 SDK 参数。

### A2：关闭 Gateway 不影响 Kernel

显式手动专项分别覆盖 CLI Gateway 正常停止、异常退出/强杀，以及 SDK Gateway 原生 close 后退出：关闭前由独立客户端启动一个无关调用，关闭后该调用仍完成；Kernel PID 与实例身份不变，独立客户端还能成功执行新请求。记录证明后，外层才关闭 Kernel 并等待其 worker 退出。

### A3：保留恢复场景并准确报告依赖故障

原离线启动、WS 断连及 active worker loss 后新工作恢复的断言继续保留。worker loss 明确标记为集成测试对外部依赖注入的故障，由外层测试驱动，不归 Gateway 单模块生命周期测试。验证既有请求不会被自动重放、新请求可执行、无关 Kernel 服务不因 Gateway 关闭而退出；分别记录 lost/unknown 和实际资源回收，不再要求已丢失请求产生已确认成功结果。

保持既有默认恢复测试的两种入口和场景数量。新增独立性与故障收尾断言通过手动专项运行，不能隐式扩大默认 CI 执行。

### A4：Gateway 超时仍回收所有环境资源

在显式本地手动专项中，外层暂停自己登记的 G（macOS/Linux SIGSTOP），确认 K 仍可响应独立 RPC。关闭 G 时保留真实 7000 ms 期限，验证 SIGKILL 被尝试、G 退出及超时错误可见；在 Kernel 环境收尾前再次确认 K 仍可执行新请求。即使独立性断言或 Gateway 清理报错，最终仍尝试并等待 K 和 worker 退出。

子测试预期因关闭超时失败，外层只有同时观察到预期错误、独立 RPC 成功和全部所属 PID 退出才通过。手动外层有独立 90 秒运行期限，记录实际测试进程 PID，对本次资源提供有界兜底；兜底介入不能满足被测路径的退出验收。兜底自身也逐项执行并聚合错误，不能覆盖原始失败。禁止按名称批量终止进程。

### A5：错误路径和检查

手动确定性覆盖：Gateway close 同步抛错/拒绝后仍执行 Kernel fixture 回收、SIGTERM/SIGKILL 抛错或 false、退出确认超时仍处理其他资源、部分启动失败、主体与收尾同时失败、falsy 主体抛出值。无需真实进程承担不可回收故障。

预期落点：修改 `test/recovery-dual-mode.test.js`，在 `test-support/` 分离 Kernel dependency fixture 与 SDK Gateway 宿主入口，调整本任务 `test/manual/recovery-teardown*` 专项。上轮混合 helper 是否保留取决于职责拆分，不应为了保留已有代码继续合并两个服务的所有权。

实施阶段安装匹配最新 lockfile 的依赖并构建，然后运行：

```sh
pnpm build
node --test test/recovery-dual-mode.test.js
node --test test/manual/recovery-teardown.test.mjs
pnpm lint
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
git diff origin/main -- .github package.json pnpm-lock.yaml
```

按最终改动检查格式、知识元数据及对应已有回归。新增专项保留在 `test/manual/`，不增加 workflow/job/矩阵/触发器/必需检查/gate，也不经默认脚本或测试开关加入专项执行。结果必须绑定源码 SHA/dirty、平台、命令、RPC 探针与 PID 退出事实；未执行如实记录。macOS/Linux 信号证据不代表 Windows 通过；不请求真实模型或线上 IM。

## 本次重写的处理结果

- 保留原需求：所有环境清理得到尝试，退出有界，原始错误保留，显式故障注入与正常恢复回归，不扩大 CI。
- 纠正首版：Gateway 测试不再直接创建、关闭 Kernel；不再把任意 RPC 未知结果当成资源未回收；不再把同进程装配当作该集成测试的固定前提。
- 纠正此前沟通：不能仅因生产 SDK 允许同进程构造，就断言架构规范整体错误。当前规范已禁止 Gateway 关闭共享 Kernel；本次重点是把这个所有权合同落实到测试边界。需要补充的是测试组织说明，不是全仓生产架构迁移。
- 首轮代码未提交，在本次实施中按新版调整；旧验证只对旧基线和旧实现有效，不沿用为本规格通过证据。

## 审查事项

已确认：Kernel 是 Gateway 的外部依赖，Gateway 不拥有其生命周期；本次集成测试用独立进程和独立 RPC 探针证明这一点。无必须补充的业务输入。

规格阶段实现准备度自评 **97/100**：职责与范围 20/20、所有权与拓扑 20/20、失败语义 19/20、可观察验收 20/20、实现落点与环境 18/20。SDK 专用测试宿主的握手与自然退出、未知 Run 之外的实际清理结果已在实施阶段验证，具体边界见验证记录；不修改生产 close 合同，不自动提交、推送或创建 PR。
