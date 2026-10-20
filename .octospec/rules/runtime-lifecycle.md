---
type: Rule
title: 本地身份、生命周期与就绪事实
description: Home、账号与租户 profile 的身份隔离及本地 SDK 生命周期。
tags: ["runtime","identity","lifecycle"]
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/69-kernel-client-invoke
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

#47/#48 联合实现独立 Executor Kernel、Host SDK、独立 Extra 和 CLI 生命周期。旧 daemon app、包、bin、API、CLI 命令组和 AdapterHost 类别名已删除。当前证据与尚待实机验证项见 [实施记录](../tasks/executor-kernel-host-lifecycle/implementation.md)。

宿主拥有 Kernel 和各 Extra 的创建/停止顺序。Kernel 仅监督自己的 worker；Extra 不负责拉起 Kernel。附加客户端只拥有连接，关闭客户端、消费者 iterator 或 socket 不取消已接纳 Run，不停止服务。显式 owned handle 才拥有 stop/restart。

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
| Extra 已初始化 | 独立 runner 初始化完成 |
| 外部业务健康 | Extra 的自定义 JSON 状态 |
| 执行完成 | 原 Run 的源终态 |
| 清理完成 | CleanupResult.complete，而非仅 processExited |

## owned 清理

stop 关闭接纳，取消自己的调用，执行 dispose，回收受管进程，并返回清理事实。单项失败仍尝试其他资源。重复调用等待同一清理操作。失败记录保留所有权；同名 Extra 或 owned Kernel 的替换必须检查旧实例完整关闭。

初始化期间同样观察 owner 断连和停止：先登记取消意图，取消 worker readiness，异步创建返回后检查停止状态并回滚，不得在清理完成后建立迟到端点或报告 ready。spawn 后启动失败以 ComponentStartError 保留 cause 和 cleanup；Extra 初始化失败的 disposer、进程或函数池未完整清理时保留失败名称。Kernel restart 失败后的 stop 必须报告替换实例的清理事实，不得返回旧实例的成功结果。原生 IPC status.pid 必须对应本次新建进程。

Extra runner 为异步初始化和关闭保留 4 秒共享清理预算，另设从 stop 开始计时的 4.5 秒最终退出兜底。owner 断连时兜底必须保持引用，不能因插件子进程 unref 而提前自然退出；POSIX 回收本 runner 的独立进程组。未完成的 dispose 仍是 incomplete，不因强制退出改为成功，端点租约仅在所有清理成功后释放。Kernel 的 manifest 或端点删除失败也保留租约。runner 内部定时器要求事件循环可调度；owner 同时消失且 Extra 同步死循环的回收需要独立 supervisor，当前未实现该保证。

宿主动态函数留在宿主进程，真实 Promise 未结束前仍占容量；超时、取消、账号切换、断线或 scope 更新不能提前释放。宿主同步阻塞函数不能由 IPC 代理隔离。

## CLI

两组固定命令为 executor-kernel 和 channel-gateway，分别提供 uninstall/install/start/restart/stop/run。首次 install 默认不自启，重复安装省略选项保留原值；--autostart=true/false 显式修改。start/restart 要求已安装，不隐式安装、启用或控制另一组件。stop 不修改自启；uninstall 保留 Home 和用户数据。

status 汇总原生服务状态、Kernel 可用性和 Extra 状态。run 前台组件意外退出时 CLI 返回失败；SIGINT/SIGTERM 时等待清理，未完整清理返回 5。服务 ID 和端点按规范化 Home 与组件派生。

旧 daemon 架构的 1.0.1 列为 deprecated；不支持旧版升级或迁移。已有安装须先停止并移除旧服务，执行 npm uninstall -g @mininglamp-oss/octo-runtime 后重新安装新架构版本并重新配置。npm 卸载不会自动移除系统服务或 Home；遗留数据存在不表示支持迁移。发行时须另行完成 npm registry deprecation，记录实际结果，不能用文档声明替代 registry 操作。

Provider/插件安装和认证方案始终归 HostApp。SDK 不继承 CLI 的全量 manifest、JSON 配置目录或系统服务约定。详见 [SDK 指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。
