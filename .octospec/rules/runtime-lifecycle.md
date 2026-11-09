---
type: Rule
title: 本地身份、生命周期与就绪事实
description: Home、账号与租户 profile 的身份隔离及本地 SDK 生命周期。
tags: ["runtime","identity","lifecycle"]
timestamp: 2026-11-02T11:00:00Z
implementation_baseline: fix/75-cli-lifecycle
id: runtime-lifecycle
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-host-sdk/**", "packages/octo-runtime-executor-kernel/**", "apps/cli/**", "test/*runtime*", "test/embedded-*", "test/kernel-invoke*"]
  touches: ["runtime","identity","lifecycle"]
source: self
supersedes: []
---

# 本地身份与组件生命周期


## 当前实施

2026-11-02 的 [#294 原生装配合同](architecture.md#sdk-原生装配与统一-rpc)已在工作树实施：Kernel 在宿主进程使用注入的 Adapter，普通调用统一 RPC，不再持有执行 worker。

调用进程通过 createKernelService 创建 Kernel，持有服务及 socket，并显式 initialize/status/close/closed；当前边界见[架构](architecture.md)。


宿主拥有 Kernel 服务对象和进程的生命周期；Kernel 在本进程执行并提供 RPC。附加客户端只拥有自己的连接；关闭 iterator 或 socket 不取消已接纳 Run、不停止 Kernel。业务 Gateway 在独立仓库创建自己的 Client。

KernelClient.invoke 在本 client 的 invocations 登记身份；owner shutdown 显式 stopAdmission/drain，使用共享绝对 deadline。每个业务 owner 应建立独立 client，停止 A 不排空 B。低层 submit 所有权由高级调用方管理；取消 ACK、执行终态、业务收尾和进程退出分别确认。

## Runtime Home 所有权与启动校验

[#306](https://github.com/Mininglamp-OSS/octo-runtime/issues/306) 明确：Home 选择和根准备归宿主。KernelService 必填 `home`，initialize 在任何日志、身份、资源所有权和监听启动前统一验证原始输入、绝对路径支持、实际存在/类型/权限、附加文件名和 IPC 预算。SDK 不选择 appId/平台/环境/cwd 默认，不展开 ~、创建根或失败换根；删除 resolveHostHome。Runtime 只在已验证根内创建自己的内部资源。

CLI 是宿主：--home 优先，否则所有平台统一用户 ~/.octo-runtime；由 CLI 准备根。OCTO_RUNTIME_HOME、LOCALAPPDATA、Application Support、XDG 不参与隐式选择。Electron 可按产品设计明确选择这些位置，准备后传入 SDK。既有数据/服务定义不自动移动或重置；继续使用旧位置时显式传 --home。

componentEndpoint 等只计算语法和预算，不证明实际目录可用；预先取得 endpoint 不能绕过服务的必填 Home 验证。attachKernel/acquireEndpoint 的 endpoint-only API 只管理连接/租约，不推断 Home，独立验证实际地址；Core 不提供 Home 服务托管。POSIX 常驻 Kernel 使用 `<home>/executor-kernel.sock`；沿用该实际地址的普通所有权、清理、恢复和预算校验，不引入旧布局兼容机制。

路径预算区分 Unix UTF-8 字节、Windows UTF-16 单元和实际传输，不使用统一260/108或 JS 字符数。Unix 启动用 OS `/usr/bin/getconf` 查询文件系统 PATH_MAX/NAME_MAX，不能从 Provider 专用 PATH 选择查询工具；Windows 使用 Node 扩展路径合同且保留实际 IO 失败。验证完整附加文件名及资源路径；可选日志的元数据/卷预算查询 IO 失败在资源边界整体隔离，遵守 best-effort 合同，不能仅放行少数 errno 后把其他故障改判为 Home 不可用。字符串/静态长度及必需 Home、状态、IPC 校验仍严格执行。CLI 配置/恢复和 Playboard 不提前计算未使用的常驻 IPC，实际连接/绑定前仍须严格校验。模拟平台计算不能代替该平台真实 bind。

Home 失败在启动域用 RuntimeHomeError.diagnostic 报 code、实际 path、resource、operation、必要 systemCode 和宿主 action；长度包含 measured/limit/unit，IPC 长度包含派生 endpoint。ServiceInitializationError 保留 cause/cleanup，CLI 复用投影；不混为 AgentRun 失败，不把无效 Home 通过日志 mkdir 重新创建。完整合同、迁移及来源见 [Home 参考](../../docs/zh-CN/reference/runtime-home.md)。专项保持 test/manual 显式运行，不扩展默认 selector/CI。

## 身份保护

Home 表示本地设备实例的状态边界，machine_id 是安装分组，不是硬件指纹或认证凭据。Runtime/profile ID、业务 Agent/session、Provider session 不可混用。既有 machine、profile、Runtime identity、凭据和配置格式保持不变，不因重启、断线、换进程名称或卸载服务自动重新生成。

身份辅助实现位于 [home.ts](../../packages/octo-runtime-host-sdk/src/home.ts) 和 [identity.ts](../../packages/octo-runtime-host-sdk/src/identity.ts)。宿主可按自己的账号/租户策略使用这些辅助函数，Kernel 启动不以登录或创建身份为前提。Run 7、Context v3 和 identity schema 独立版本化。

## 就绪事实

| 事实 | 依据 |
| --- | --- |
| 身份已存在 | 保存且通过校验的本地身份 |
| Kernel IPC 可用 | status 返回当前 kernel_instance_id |
| 可接纳执行 | execution_ready=true；本进程 Core 已注册且接纳开放，不代表 Provider 探测或认证成功 |
| Provider 可用 | 实际 probe/list 元数据，不证明已认证或本次成功 |
| 执行完成 | 原 Run 的源终态 |
| 清理完成 | ServiceCleanupResult.complete，实际资源均已回收 |

## 启动失败诊断与执行域

启动失败可以早于 Run、Session、Task 或 IPC，就地返回共享启动诊断，不创建 synthetic failed Run，不新增生命周期状态机。复用既有 ServicePhase、execution_ready 和 ServiceCleanupResult；进程存活、Kernel 可接纳执行、外部业务连通性分别描述。

共享 catalog 与安全投影由 Kernel 包维护，Host SDK 和 CLI 使用同一定义。保留既有公共码、原 cause 与 cleanup；新增 typed context 仅记录责任边界已确认的 path/resource/operation/configKey/endpoint/executable/module/systemCode 等事实。已知路径必须进入可读及结构化结果，不从异常正文猜路径或将权限拒绝改写为不存在。spawn ENOENT 也可能来自 cwd；不能仅凭 errno 宣称 executable 缺失。

wrapper、聚合与持久化回读须保留主根因和清理/pending 事实；cause 遍历及读取有界，异常 getter、循环或坏记录不能覆盖原失败。未知原因明确未知并给受控排查动作。动态值同源安全格式化，禁止输出原始异常、配置、环境、stderr 或凭据；回读记录的解释/动作必须从 catalog 重建。恢复建议遵守入口所有权，不能自动执行修复或建议不存在的参数；SDK Home 由宿主选择准备，CLI 只准备自己选择的根。

公共 shape、兼容字段和 English-first 目录见[启动诊断](../../docs/en/guides/startup-diagnostics.md)及[中文目录](../../docs/zh-CN/guides/startup-diagnostics.md)。额外专项在 test/manual 显式运行，不扩大 CI 或默认测试选择器。

## 服务清理

宿主可显式传 finalizeHostResources(deadline)，由 Kernel 在 Core/Run 排空后、释放所有权记录前等待宿主收尾；CLI 在回调内执行 assembly.close。失败必须保留 cleanupFailed 与端点租约，不能先删除证据再报告 Engine 清理失败。只读 serviceProcesses 回调与收尾回调分别表达观察和显式授权，不从引用或快照推导关闭权。

常驻 Engine 与 Kernel/Adapter scope 分开拥有。CLI 的实际服务进程创建 Codex managed owner，先 beginShutdown 停获取与恢复，再关闭 Kernel 释放本地调用/lease，最后 owner.close，合用 5 秒绝对期限。Kernel 初始化失败也执行本装配 owner 的回滚，清理失败独立保留。业务自管的共享 Engine 不随借用 Kernel 关闭；只有业务 owner 可以停恢复或销毁。CODEX_HOME 由宿主显式注入，目录权限、保留、迁移与删除归 Home owner；与 Runtime Home 分开，任何取消/恢复/关闭都不授权清空 Home。详见[架构边界](architecture.md#常驻-engine-所有权细化issue-339)。

close 停止接纳并取消所属调用，在共享截止时间内等待执行、源消费、监听和日志。单项失败仍尝试独立资源，重复 close 等待同一清理操作；不完整结果保留所有权，替换同 endpoint 的 Kernel 前须确认旧实例完整关闭。

初始化观察 signal 和 close：先登记取消意图，取消初始化等待，异步创建后检查停止状态，不得建立迟到端点或报告 ready。ServiceInitializationError 保留 cause 和 cleanup；回滚失败保留资源所有权。close-before-initialize 永久关闭该对象，重复 initialize 复用原 Promise。服务没有 restart，完整关闭后重新构造。服务 status.pid 必须等于调用进程 PID。

取消可能先于启动回滚失败赢得等待竞态。initialize 等待 close 后，若已取得独立的启动回滚 AggregateError，须同时保留首次取消原因和完整回滚异常链（包括原始 errno），不能只保留取消原因与概括的 incomplete 码。普通取消仍保留原 cause；到期后才结束的实际操作不倒改已返回的结果，也不推定其未来成功。显式手动回归与版本边界见 [Issue 237 验证](../tasks/237-windows-kernel-startup/validation.md)。


Kernel 所有关闭阶段共用从 close 起算的 5 秒截止时间。超时只结束等待，未完成的实际操作仍为 incomplete，资源记录或端点删除失败保留租约。SDK 不退出或强杀调用进程；同进程同步阻塞不能由 Promise 超时终止。


Windows 使用 Node.js 和系统已有命令，公共层不引入原生 supervisor，遵守[架构约束](architecture.md#实现语言与原生依赖边界)。宿主被强杀、父进程先退或事件循环同步阻塞时，不承诺退出回调及后代清理必然执行；未完成的 dispose 仍是 incomplete。

宿主动态函数在同进程直接调用，真实 Promise 未结束前仍占容量；超时、取消、账号切换或 scope 更新不能提前释放。SQLite 的创建、连接、迁移和关闭完全归宿主，SDK 不接管数据库。业务消费者只清理自身资源，并等待自己启动的收尾。

## CLI

顶层 `octo-runtime logs` 命令读取 Home/logs/kernel-status-*.log，现行事件为 kernel.ready、kernel.closing、kernel.execution_drained、kernel.start_failed 和 kernel.cleanup_incomplete。旧 worker 日志白名单已删除，不兼容历史 worker 心跳/重启状态。CLI 自动选择 Home/logs，SDK 显式传 logging.directory；Core 排空后关闭共享日志，沿用总关闭截止时间。日志不含执行正文、凭据或原始异常。


start/restart 成功后确认当前 Kernel IPC 就绪，返回同一 service/runtime 状态；就绪不表示 Provider 已认证。

CLI 仅管理 executor-kernel，生命周期入口平铺为 `octo-runtime uninstall/install/start/restart/stop/status/run/logs/recover`。旧 executor-kernel 子命令明确拒绝，不保留兼容别名；adapter list/probe 保持分组。系统服务 argv 使用顶层 run，服务 ID、Home 路径、锁与 status JSON 键保持；升级已有安装须显式 stop/install/start 刷新旧启动参数，install 的 profile/manifest/autostart 按用户原配置显式传入。install 默认开启用户服务自启，仅 --autostart=false 禁用；start 在组件锁内对未安装服务先安装再启动并等待 IPC。restart 未安装返回 3，禁用服务保留 SERVICE_DISABLED。stop 不改自启；uninstall 保留 Home。独立 Gateway 不受 Runtime CLI 控制。

cross-service 沿用既有各平台启用/禁用实现：macOS 的 LaunchAgents 和 disabled override、Linux 的 user unit 与 target enable 链接、Windows 整个用户任务的 Enabled 设置。本轮不迁移 plist 目录或改造 Windows 触发器。均为用户服务，自动激活时机是用户登录/manager 激活，不承诺未登录时运行。

macOS stop/uninstall 及定义替换不能把 bootout 请求已受理视为卸载完成；有界确认旧 job 从原生 manager 消失后才允许返回或 bootstrap。print-disabled 的 true/false 和 enabled/disabled 两种输出均须正确解析。

launchd 的 print 非零不能直接判为停止：仅 exit 113 且明确指出当前 gui 用户域内目标 label 缺失时可作为幂等缺失；其他权限、域不可用、超时和未知诊断须传播错误。初始查询与 bootout 后轮询遵守同一判定，未确认 job 消失不能删除 plist 或继续 bootstrap。print-disabled 失败不能伪造已启用；inspect 查询失败抛结构化错误，CLI 保留 unknown 和稳定诊断，错误快照的自启显示 unknown。JSON 兼容字段 enabled=false 在该错误快照中不代表已确认关闭。安装初始查询失败不能覆盖 plist；定义替换后的失败保留当时磁盘定义，不承诺事务回滚。专项仅手动执行，证据见 [Issue 158](../tasks/158-launchd-query-ownership/validation.md)。

组件 install/start/restart/stop/uninstall 共用按 Home/组件派生的 setup lock，原生修改、就绪等待及最终状态确认均在锁内；同组件并发修改返回 SETUP_IN_PROGRESS，不调用管理器；不同组件不共用锁。start/restart 不把管理器保留的 LastTaskResult/ExecMainStatus 当作本次失败，缺少当前失败证据时保留就绪预算。

systemd/Windows 的停止或删除失败不得静默视为成功；只有原生明确 not-found 可忽略，管理器不可用和权限失败须传播。systemd 删除 unit 前确认 inactive/failed 且 MainPID=0；Windows /End 后有界确认任务不再 running/queued，再删除或 /Run 替换，未确认前保留定义。Windows 非零 /Query 不能直接推定不存在，通过 Task Scheduler 原生 HRESULT 确认，不能依赖本地化错误文字。

Windows 计划任务 XML 使用 UTF-16 声明及带 BOM 的 UTF-16LE 原子写入，sidecar 读取兼容既有 UTF-8，drift 按解码后的正文比较。PowerShell 查询显式输出 UTF-8，保留中文路径与参数；principal/trigger 账号按系统 SID 核对，不能把同一账号的短名、域名或 SID 表示差异误报为 drift。原生 Create/Query/Delete 验证须使用独占任务名，覆盖 ASCII、Unicode/空格路径和 enabled 两种值，并确认最终删除。

原生 schtasks 文本与受控 PowerShell JSON 的编码合同不同：在与 manager 相同的隐藏控制台启动条件下只读查询代码页，按该编码流式解码 stdout/stderr，不能固定为 UTF-8 或 GBK。内部查询与 manager 共用原超时预算，失败不得猜测编码；查询成功可在 runner 内缓存。原命令仍 shell=false 直接执行，保留 argv、退出码、错误 detail 与有界输出，不要求 SDK 调用方传编码。见 [Issue 167 验证](../tasks/167-native-diagnostics/validation.md)。

SID 翻译失败为未知；原文账号相同仍可确认，否则服务状态 unknown 并说明身份查询失败，不报告确定的账号漂移，也不伪装身份匹配。公共 XML renderer 返回文本时必须说明 UTF-16LE BOM 序列化要求。

systemd 的 WorkingDirectory 与 StandardOutput/StandardError 的 append 路径不采用 argv 式去引号或 C 反转义：路径原样写入，仅把字面量 `%` 编码为 `%%`；ExecStart/Environment 继续独立使用参数引号。内部空格、引号、反斜杠及 Unicode 保留；奇数个末尾反斜杠附加保护空格，避免续行，原生 strstrip 随后移除保护空格；偶数个原样保留。路径本身不可无损保留的末尾空格或制表符明确返回 UNSUPPORTED_SPEC，未被裁剪的垂直制表符与换页符保留。重新 install 必须替换旧坏定义并先 daemon-reload，再允许 start；幂等 install 不额外 reload 或 restart。回归除字符串断言外，需通过 Linux 原生解析及显式启用的 user manager 验证真实 cwd 与日志落点。

前台 run 的初始化失败、意外关闭和 closed 拒绝共用幂等终态处理：先解除 signal 监听并取消初始化，再确认清理、记录受控诊断及输出一次失败。意外关闭即使发生在 ready 后也不能只返回退出码；清理异常不吞掉原始初始化失败。正常 signal 停止仍等待清理并保留 incomplete 退出码。

status 汇总当前 Kernel 的系统服务状态和实际 IPC 就绪状态；文本错误写 stderr，JSON 错误写 stdout，均返回非零退出码。

CLI 可执行入口仅为参数解析及校验确认的前台组件 run 选择有界最终退出：命令返回后设置原退出码，250ms 后若仍因残留句柄存活则显式退出。该定时器 unref，正常资源回收后无需额外等待。数据命令、帮助、状态和部署命令必须自然等待 stdout/stderr 刷新，不能以固定 timer 截断慢管道并返回成功。命令类型由既有解析结果通知可执行入口，不能重复猜测参数。最终退出不改变 incomplete 事实；进程退出只属于可执行入口，不进入 SDK 或可导入的 runCli，也不作为同进程同步死循环的强停保证。

Playboard 人工停止采用用户明确授权的本地测试例外：入口接管 SIGINT/SIGTERM 后，按本次 PID 树定向强退，不等待动态模块装配或优雅关闭；正常完成仍等待既有关闭和输出。系统进程查询/终止命令最多等待 2 秒，失败仍非零退出并标记树停止未确认；不把 OS 终止等同于 Run cancelled 或 cleanup complete。具体范围见[临时执行](local-execution.md#临时执行与证据)。

旧 daemon 架构的 1.0.1 列为 deprecated；不支持旧版升级或迁移。已有安装须先停止并移除旧服务，执行 npm uninstall -g @mininglamp-oss/octo-runtime 后重新安装新架构版本并重新配置。npm 卸载不会自动移除系统服务或 Home；遗留数据存在不表示支持迁移。发行时须另行完成 npm registry deprecation，记录实际结果，不能用文档声明替代 registry 操作。

Provider 安装和认证方案始终归 HostApp。SDK 不继承 CLI 的全量 manifest、JSON 配置目录或系统服务约定。详见 [SDK 入门](../../docs/zh-CN/getting-started/sdk.md)。
