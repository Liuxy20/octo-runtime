# Executor Kernel

Kernel 提供本地 JSON-RPC、独立 worker 监督以及有界 Run 源窗口。它只维护 worker 的进程生命周期，不加载 Extra、读取业务存储或调度 Loop 业务。

## 公开入口

消费者从主发行包 /executor-kernel 导入 attachKernel、KernelError、serveWorker 及相关类型；本 workspace 仅为内部实现。

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";

const client = attachKernel({ endpoint });
try {
  for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) consume(event);
} finally {
  client.close();
}
```

普通 App、owned.client 和 Extra 的 ctx.kernel 使用同一个 invoke(input, environment?)，无需安装或加载 Extra。输入仍是 InvokeInput 的 inputs/contexts；首次 next 才提交。省略模式或 native 返回 HostFrame，canonical 返回 CanonicalEvent，变量模式返回联合类型。完整示例见 [SDK 指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。

高级调用方可明确使用 submit 返回完整 RunRef，再 get/subscribe；cancel(ref)、respond(ref)、respondNative(ref) 校验 Kernel instance 和完整执行身份。这些低层调用的所有权由调用方自行管理，不进入 invoke 登记。命令被接纳不等于执行完成，完成以源终态为准。

## 取消、观察和 owner 清理

- caller signal 在写请求前取消时不提交；写出后仍按原身份取得回执，然后请求一次取消。原订阅继续接收尾事件，正常耗尽后抛出实际 signal.reason。传输、控制 ACK 未知等具体错误优先保留。
- cancelInvocation(invocationId, reason?)、respondInteraction 和 respondNativeInteraction 只控制本 client 登记的 invoke；未登记或其他 client 的身份拒绝。取消返回 accepted，不能解读成 Provider 已 cancelled。
- iterator.return、退出迭代、subscription signal 和 client.close 只停止本地观察，不隐式 cancel。已接纳 Run 可由其他 client 按原 ref 继续观察。
- owner 显式调用 invocations.stopAdmission()，再 invocations.drain({deadline: Date.now()+4000, reason}) 请求取消并核对原终态；返回 complete/unresolved。deadline 是与业务 dispose 共用的绝对时间，重复 drain 共享首次操作。
- snapshot 只复制身份、阶段、取消状态、游标和错误码，不保存输入/输出正文；在途与未知记录均计入 128 个额度。确认 completed/failed/cancelled 才释放，lost 返回 RUN_OUTCOME_UNKNOWN，清理保持 incomplete。
- 排空查询和取消并发各不超过 4，不创建逐 Run 重放订阅。执行终态不代表 delivery 或存储完成，owner 继续等待业务 onDispose 后才释放资源。

executionEnvOverrides 逐次传递；signal 仅在本地。Kernel 当前 wire 不支持 environment.streamLimits，显式传入会拒绝 KERNEL_STREAM_LIMITS_UNSUPPORTED。直接 Core 支持该本地预算，且主动关闭其执行 iterator 会取消执行；Kernel 的观察关闭语义不同。

每个连接只提交一条 UTF-8 LF 结尾 JSON-RPC 请求。invoke ACK 与订阅分离，Kernel 独立消费源；ACK 丢失只查询原身份，不重新 invoke。重放沿原 stream/after_seq 继续，缺口、过期和实例变化明确失败。合同见 [wire Schema](../octo-runtime-protocol/schema/kernel-ipc.schema.json)。

## worker

worker 实例化唯一 AgentExecutor。执行通道为 stdio NDJSON；独立 Node IPC 的 ping/pong 由 worker 主循环响应。1 秒检查、5 秒失联，启动就绪预算 15 秒。失败先回收受管进程组，再按 250/1000/4000 ms 退避，60 秒窗口最多三次替换。稳定 60 秒后重置预算。耗尽后 Kernel 保留 status，拒绝新执行。

worker 丢失时，未完成 Run 产生一次 lost 终态；已接纳的完成终态保持原样。新 worker 只接纳新 Run，不重放旧请求。进程清理失败禁止替换。进程身份清单仅用于回收孤儿，不保存业务执行历史。

## 容量与平台

中央源窗口默认每 Run 32 MiB / 4096 帧，全局 128 MiB / 128 Run，终态 TTL 120 秒。最多 64 连接、16 订阅，写入 drain 等待 5 秒；客户端最多 32 个在途连接。按异步迭代消费，不增加无限生产队列。

POSIX socket 为 0600；仅持有本实例端点租约才能移除 socket。Windows 使用命名管道。POSIX 清理按受管 PGID，Windows 使用有界 taskkill /T；原生平台和父进程先退出后的后代回收证据必须单独核对。

测试入口：[Kernel clients](../../test/kernel-clients.test.js)、[监督](../../test/kernel-worker-supervision.test.js)、[源窗口](../../test/host-run-service.test.js)。
