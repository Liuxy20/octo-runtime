---
type: Rule
title: 本地身份、生命周期与就绪事实
description: Home、账号与租户 profile 的身份隔离及本地 SDK 生命周期。
tags: ["runtime","identity","lifecycle"]
timestamp: 2026-10-23T00:00:00Z
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

#71 落实[统一原生服务原则](architecture.md#统一原生服务构造与部署边界)：调用进程直接构造服务并持有 socket，严禁外部 Node 代启。公开合同为 createKernelService/createExtraService 与 initialize/status/close/closed；实现见[服务设计](../tasks/unified-native-sdk-services/design.md)。

#47/#48 联合实现独立 Executor Kernel、Host SDK、独立 Extra 和 CLI 生命周期。旧 daemon app、包、bin、API、CLI 命令组和 AdapterHost 类别名已删除。当前证据与尚待实机验证项见 [实施记录](../tasks/executor-kernel-host-lifecycle/implementation.md)。

宿主拥有 Kernel 和各 Extra 服务对象的创建/关闭顺序；CLI/App 另外拥有部署和宿主进程生命周期。Kernel 仅监督自己的内部 worker；Extra 不负责拉起 Kernel。附加客户端只拥有连接，关闭客户端、消费者 iterator 或 socket 不取消已接纳 Run，不停止服务。统一服务对象提供 initialize/status/close，不提供另起顶层服务的 owned launch/restart。

KernelClient.invoke 在本 client 的 invocations 登记身份；App 与 Extra 使用相同方法。owner shutdown 显式调用 stopAdmission/drain，以绝对共享 deadline 返回 complete/unresolved；SDK 为独立 Extra 各建一个 client，停止 A 只排空 A。低层 submit 的所有权由高级调用方自行管理。执行完成、取消请求 ACK、业务 delivery/dispose 和进程退出分别确认，lost/未知不释放登记。具体语义见[本地执行](local-execution.md)。

## 身份保护

Home 表示本地设备实例的状态边界，machine_id 是安装分组，不是硬件指纹或认证凭据。Runtime/profile ID、业务 Agent/session、Provider session 不可混用。既有 machine、profile、Runtime identity、凭据和配置格式保持不变，不因重启、断线、换进程名称或卸载服务自动重新生成。

身份辅助实现位于 [home.ts](../../packages/octo-runtime-host-sdk/src/home.ts) 和 [identity.ts](../../packages/octo-runtime-host-sdk/src/identity.ts)。宿主可按自己的账号/租户策略使用这些辅助函数，Kernel 和 Extra 启动不以登录或创建身份为前提。Run 7、Context v3 和 identity schema 独立版本化。

## 就绪事实

| 事实 | 依据 |
| --- | --- |
| 身份已存在 | 保存且通过校验的本地身份 |
| Kernel IPC 可用 | status 返回当前 kernel_instance_id |
| 可接纳执行 | execution_ready=true 且 worker ready |
| Provider 可用 | 实际 probe/list 元数据，不证明已认证或本次成功 |
| Extra 已初始化 | 调用进程中的 initialize 完成 |
| 外部业务健康 | Extra 的自定义 JSON 状态 |
| 执行完成 | 原 Run 的源终态 |
| 清理完成 | ServiceCleanupResult.complete，实际资源均已回收 |

## 服务清理

close 关闭接纳并立即取消所属调用；初始化进入可清理状态后，并发等待源调用排空和插件 dispose。插件 disposer 须先等待自己的消费者、保存与投递任务，再清理自己的资源。取消通知不立即封锁注入依赖；插件清理结束或共享截止到期后撤销调用权限，再等待全部实际依赖。单项失败仍尝试独立资源。重复调用等待同一清理操作。失败记录保留所有权；同 endpoint/name 的 Extra 或同 endpoint 的 Kernel 替换必须确认旧实例完整关闭。不同 Home/endpoint 的同名 Extra 独立。

初始化观察 signal 和 close：先登记取消意图，取消 worker readiness，异步创建后检查停止状态，不得建立迟到端点或报告 ready。ServiceInitializationError 保留 cause 和 cleanup；回滚失败保留资源所有权。close-before-initialize 永久关闭该对象，重复 initialize 复用原 Promise。服务没有 restart，完整关闭后重新构造。服务 status.pid 必须等于调用进程 PID。

加载器因初始化失败 abort 插件 signal 时，Extra 服务立即停止 invoke 准入并启动缓存的取消/排空操作，不能等加载器完成 disposer 后再开始；此通知不替换原始初始化 cause。bind Promise 也是服务资源：Kernel 串行等绑定完成后检查取消并回滚；Extra 控制 socket 清理显式等待 bind，清理超时后仍继续回收迟到的监听句柄，结果保持 incomplete，端点租约不提前释放。

Kernel 所有关闭阶段共用从 close 起算的 5 秒截止时间；Extra 复用插件的 4 秒单调预算（若继承更早截止则从其约束），各阶段不重置。超时只结束等待，未完成的实际操作仍为 incomplete，不释放冲突名称或端点租约。Kernel 的 manifest 或端点删除失败也保留租约。SDK 不退出或强杀调用进程；宿主进程的最终退出和系统部署归 CLI/App。任意同进程同步死循环不能由 Promise 清理或超时机制终止。

保留 #72 的有界业务排空合同：插件取消沿 signal 继承 4 秒单调时钟清理预算，不因稍后进入 dispose 重置；该预算包含在服务关闭期限内。原调用订阅保持到消费收尾完成或共享截止，取消 ACK 不代替终态/消费确认，失败 ref 不无条件删除。不新增 ExtraContext 字段，不改变普通调用方 abort 合同。旧独立 runner 的 4.5 秒强制退出仅属历史实现，不适用于调用进程内的服务对象。

Windows 使用 Node.js 和系统已有命令，公共层不引入原生 supervisor，遵守[架构约束](architecture.md#实现语言与原生依赖边界)。宿主被强杀、父进程先退或事件循环同步阻塞时，不承诺退出回调及后代清理必然执行；未完成的 dispose 仍是 incomplete。

宿主动态函数在同进程直接调用，真实 Promise 未结束前仍占容量；超时、取消、账号切换或 scope 更新不能提前释放。SQLite 的创建、连接、迁移和关闭完全归宿主，SDK/Extra 不接管数据库。插件只清理自己的连接等资源，disposer 必须等待自己启动的业务尾部。

## CLI

Extra新增 `logs [--lines 1..10000] [--follow] [--json]`，默认200条，JSON为NDJSON。只读取当前Home对应Extra的独立状态系列，最近三份最多4MiB，重建白名单记录；不得读普通执行日志或链接到外部文件。日志路由先于配置解析、模块载入及管理器操作。空日志stderr提示并成功；参数/权限错误非零；follow跟随轮转并在Ctrl+C释放监听。CLI前台Extra向stdout写状态，最多128条/1MiB，背压不阻塞服务，恢复后报告丢弃数量。后台镜像不依赖manager的stdoutPath，不引入shell wrapper。

start/restart 成功结果复用本组件 status 的查询与格式化：展示服务、自启、IPC、Manager、PID、Worker/Extra 业务状态和服务定义路径；JSON 保留 component/action 并提供同一 service/runtime 数据。启动成功不等同于 Bot 已连通，业务状态沿 Extra 自身接口反馈。

CLI 遵循[面向普通用户的产品默认值](architecture.md#cli-面向普通用户的产品默认值)，为 executor-kernel 与每个已配置 Extra 提供 uninstall/install/start/restart/stop/status/run；内置 Extra 名为 channel-gateway、channel-wecom、webui。裸组件显示用途、配置/启动入口和命令帮助。install 默认注册并开启本组件自启，首次和重复安装相同；只有显式 --autostart=false 才禁用，再次普通 install 恢复开启。start 在组件锁内检查安装状态，未安装时自动注册本组件并开启自启，向 stderr 打印安装及启动阶段进度，随后启动并等待 IPC 就绪；安装失败不继续启动，--json 的 stdout 只保留最终结果。已安装时保留服务定义及自启设置；restart 未安装返回 3。显式禁用时 start/restart 保留 cross-service 的 SERVICE_DISABLED 并提示 install --autostart=true，不安装或控制另一组件。stop 不修改自启；uninstall 保留 Home 和用户数据。两个自启服务或多个 Extra 不依赖启动顺序；Extra 先启动可报告 Kernel 不可用，Kernel 后续上线时沿现有 client 恢复可用状态，不创建替代 Kernel。

cross-service 沿用既有各平台启用/禁用实现：macOS 的 LaunchAgents 和 disabled override、Linux 的 user unit 与 target enable 链接、Windows 整个用户任务的 Enabled 设置。本轮不迁移 plist 目录或改造 Windows 触发器。均为用户服务，自动激活时机是用户登录/manager 激活，不承诺未登录时运行。

macOS stop/uninstall 及定义替换不能把 bootout 请求已受理视为卸载完成；有界确认旧 job 从原生 manager 消失后才允许返回或 bootstrap。print-disabled 的 true/false 和 enabled/disabled 两种输出均须正确解析。

组件 install/start/restart/stop/uninstall 共用按 Home/组件派生的 setup lock，原生修改、就绪等待及最终状态确认均在锁内；同组件并发修改返回 SETUP_IN_PROGRESS，不调用管理器；不同组件不共用锁。start/restart 不把管理器保留的 LastTaskResult/ExecMainStatus 当作本次失败，缺少当前失败证据时保留就绪预算。

systemd/Windows 的停止或删除失败不得静默视为成功；只有原生明确 not-found 可忽略，管理器不可用和权限失败须传播。systemd 删除 unit 前确认 inactive/failed 且 MainPID=0；Windows /End 后有界确认任务不再 running/queued，再删除或 /Run 替换，未确认前保留定义。Windows 非零 /Query 不能直接推定不存在，通过 Task Scheduler 原生 HRESULT 确认，不能依赖本地化错误文字。

Windows 计划任务 XML 使用 UTF-16 声明及带 BOM 的 UTF-16LE 原子写入，sidecar 读取兼容既有 UTF-8，drift 按解码后的正文比较。PowerShell 查询显式输出 UTF-8，保留中文路径与参数；principal/trigger 账号按系统 SID 核对，不能把同一账号的短名、域名或 SID 表示差异误报为 drift。原生 Create/Query/Delete 验证须使用独占任务名，覆盖 ASCII、Unicode/空格路径和 enabled 两种值，并确认最终删除。

SID 翻译失败为未知；原文账号相同仍可确认，否则服务状态 unknown 并说明身份查询失败，不报告确定的账号漂移，也不伪装身份匹配。公共 XML renderer 返回文本时必须说明 UTF-16LE BOM 序列化要求。

systemd 的 WorkingDirectory 与 StandardOutput/StandardError 的 append 路径不采用 argv 式去引号或 C 反转义：路径原样写入，仅把字面量 `%` 编码为 `%%`；ExecStart/Environment 继续独立使用参数引号。内部空格、引号、反斜杠及 Unicode 保留；奇数个末尾反斜杠附加保护空格，避免续行，原生 strstrip 随后移除保护空格；偶数个原样保留。路径本身不可无损保留的末尾空格或制表符明确返回 UNSUPPORTED_SPEC，未被裁剪的垂直制表符与换页符保留。重新 install 必须替换旧坏定义并先 daemon-reload，再允许 start；幂等 install 不额外 reload 或 restart。回归除字符串断言外，需通过 Linux 原生解析及显式启用的 user manager 验证真实 cwd 与日志落点。

前台 run 的初始化失败、意外关闭和 closed 拒绝共用幂等终态处理：先解除 signal 监听并取消初始化，再确认清理、记录受控诊断及输出一次失败。意外关闭即使发生在 ready 后也不能只返回退出码；清理异常不吞掉原始初始化失败。正常 signal 停止仍等待清理并保留 incomplete 退出码。

status 汇总原生服务状态、Kernel 可用性和每个已配置 Extra 自身 status；单组件 status 只查询该组件。服务状态失败独立呈现，不阻止其他组件查询。默认输出紧凑文本，业务状态、Bot 健康和任务/队列/会话等计数继续展示；--json 使用缩进 JSON 保留完整公开状态，需脚本读取的旧 status 调用显式添加 --json。extraget 保留紧凑完整 JSON，playboard 保留 NDJSON。文本错误写 stderr，JSON 错误写 stdout，并返回非零码；异常正文可能含凭据，只输出稳定错误码、受控 cause_code、原生管理器命令名及退出码、排障提示和日志目录。run 前台组件意外退出时 CLI 返回失败；SIGINT/SIGTERM 时等待清理，未完整清理返回 5。服务 ID 和端点按规范化 Home 与组件派生。

CLI 可执行入口仅为参数解析及校验确认的前台组件 run 选择有界最终退出：命令返回后设置原退出码，250ms 后若仍因残留句柄存活则显式退出。该定时器 unref，正常资源回收后无需额外等待。extraget 等数据命令、帮助、状态和部署命令必须自然等待 stdout/stderr 刷新，不能以固定 timer 截断慢管道并返回成功。命令类型由既有解析结果通知可执行入口，不能重复猜测参数。最终退出不改变 incomplete 事实；进程退出只属于可执行入口，不进入 SDK 或可导入的 runCli，也不作为同进程同步死循环的强停保证。

旧 daemon 架构的 1.0.1 列为 deprecated；不支持旧版升级或迁移。已有安装须先停止并移除旧服务，执行 npm uninstall -g @mininglamp-oss/octo-runtime 后重新安装新架构版本并重新配置。npm 卸载不会自动移除系统服务或 Home；遗留数据存在不表示支持迁移。发行时须另行完成 npm registry deprecation，记录实际结果，不能用文档声明替代 registry 操作。

Provider/插件安装和认证方案始终归 HostApp。SDK 不继承 CLI 的全量 manifest、JSON 配置目录或系统服务约定。详见 [SDK 指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。
