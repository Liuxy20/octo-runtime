# Executor Kernel

[English](README.md) | [包导航](../README.zh.md)

Kernel 是 Electron SDK 和 CLI 的统一执行入口。在宿主进程持有 AgentExecutor、已注入的 Adapter、RPC 端点和有界 Run 事件源。即使业务与 Kernel 同进程，也通过 KernelClient/RPC 调用。

## 原生装配

宿主 import 并构造 Adapter，再提供本地 `endpoint` 和 `adapters`。endpoint 是 Unix socket / Named Pipe，Home 是宿主目录；`componentEndpoint(home)` 将两者连接起来。模块 manifest、解析、动态 import 和工厂调用属于 CLI 等宿主，Kernel 不接收或读取它们。

```ts
import { createKernelService } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

const kernel = createKernelService({
  endpoint: componentEndpoint("/absolute/app-runtime-home"),
  adapters: [dshAdapter],
  adapterConfigurations: { dsh: { providerOptions: { dshBin: "/absolute/dsh/lib/bin.js" } } }
});
await kernel.initialize();
// 使用 kernel.client.invoke，消费到终态；退出先排空 Extra 和业务尾流，再关闭服务。
const cleanup = await kernel.close();
if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
```

构造不做 I/O；实例数组在构造时复制，Adapter 对象本身保留原型、this、闭包和宿主依赖。初始化校验协议声明及重复类型，不自动补默认 Adapter。注册集合固定；不要修改已注册元数据。Kernel 不冻结或销毁宿主持有的任意依赖。

## 职责与流程

| 场景 | 宿主负责 | Kernel 负责 |
| --- | --- | --- |
| Electron | 主进程 import/构造对象、选择 endpoint、创建 Extra、退出协调 | 注册对象、RPC、Run 接纳与执行管理 |
| CLI | 读取/合并 manifest、解析模块、动态 import/工厂、OpenClaw 产品准备 | 接收实例，与 Electron 使用同一服务工厂 |
| 跨进程独立应用（包括 CLI 客户端） | attachKernel、发起和取消自己拥有的 Run、关闭 client；原生 SDK 使用 kernel.client | 维持共享服务和原执行 |
| Provider 子进程 | Adapter 按原生协议创建、控制和确认清理 | 调用 Core 并如实汇总清理事实 |

模块路径、workerEntrypoint、adapterModules、manifest、子进程 env 均不属于 Kernel 装配输入。Kernel 不启动执行 worker，不提供 worker 心跳或自动重启；status 返回 ipc_version、kernel_instance_id、宿主 pid 和 execution_ready，没有虚构 worker 状态。日志通过 logging.directory 显式配置，SDK 不读取 CLI 日志环境变量。

## 调用、观察与取消

`KernelClient -> 本地 RPC -> Kernel/HostRunService -> AgentExecutor -> Adapter` 是标准调用路径。Adapter 对象留在服务进程；RPC 传递调用、控制和事件数据。直接 Core 不替代标准 SDK 接入。

- invoke 开始消费才提交；提交 ACK 仅表示接纳。
- signal 在提交前取消则不提交，提交后取消请求仍消费尾流。
- iterator.return、订阅断开和 client.close 仅停止观察，已接纳 Run 继续执行。
- get/subscribe 使用原身份和原游标；丢失 ACK 只查询，不重复 invoke。
- respond/respondNative 只响应原 Run 的有效交互，取消 ACK 不等于终态。

## 生命周期与故障边界

owner 等待 initialize 后使用 client。close 幂等，closed 返回同一个清理结果。先关自己拥有的 Extra、业务投递与存储，再关 Kernel；attached client 不拥有服务。

关闭先停止接纳、关闭连接，再取消 Core、等待 Adapter 清理和回收 Run/日志/端点。共用 5 秒截止时间，不为每步重启预算。Adapter next 异常可能来自 finally，不能据此证明清理完成；complete=false 保留失败事实和端点所有权证据。stateDirectory 可显式指定恢复记录目录；POSIX 缺省使用 endpoint + .runs，Windows 需显式配置才能保留该记录。

原生 owner 的记录不是模块 manifest。异常退出后不能通过宿主 PID 推断 Provider 子进程已回收；保留 nativeOwner/cleanupIncomplete 证据，操作者确认资源已停止后沿既有 orphan-cleanup 确认流程处理。旧 worker 格式或损坏记录报 ORPHAN_RECORD_UNSUPPORTED 并保留原文件；不提供旧架构兼容、升级或自动清理。

Kernel 与 Adapter 共享宿主事件循环、内存及故障域。RPC 不隔离同步阻塞、process.exit 或 OOM；关闭期限要求事件循环可调度。服务重建产生新 kernel_instance_id，旧 Run 不重放。Adapter 内部 Provider 进程仍由 Adapter 回收。

默认 Run 窗口 4096 帧 / 32 MiB，全局 128 MiB / 128 Run，保留 120 秒；最多 64 连接、16 订阅。它们是有界回放记录，不是业务历史或 RSS 上限。整轮期限默认 24 小时，最多七天。

## 进一步阅读

[SDK 示例](../../docs/zh-CN/getting-started/sdk.md)、[IPC](../../docs/zh-CN/reference/kernel-ipc.md)、[服务实现](src/service.ts)、[RPC 服务](src/server.ts)、[源窗口](src/host-run-service.ts)、[原生装配测试](../../test/adapter-composition.test.js)、[关闭测试](../../test/host-process-close.test.js)。
