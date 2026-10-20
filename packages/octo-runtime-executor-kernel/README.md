# Executor Kernel

Kernel 提供本地 JSON-RPC、独立 worker 监督以及有界 Run 源窗口。它只维护 worker 的进程生命周期，不加载 Extra、读取业务存储或调度 Loop 业务。

## 公开入口

消费者从主发行包 /executor-kernel 导入 attachKernel、KernelError、serveWorker 及相关类型；本 workspace 仅为内部实现。

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";

const client = attachKernel({ endpoint });
const { ref } = await client.submit(input);
for await (const frame of client.subscribe(ref)) consume(frame);
client.close();
```

submit 返回完整 RunRef；close 或退出订阅只关闭连接。cancel/ref、respond/ref、respondNative/ref 校验 Kernel instance 和完整执行身份。命令被接纳不等于执行完成，完成以源终态为准。

每个连接只提交一条 UTF-8 LF 结尾 JSON-RPC 请求。invoke ACK 与订阅分离，Kernel 独立消费源；ACK 丢失只查询原身份，不重新 invoke。重放沿原 stream/after_seq 继续，缺口、过期和实例变化明确失败。合同见 [wire Schema](../octo-runtime-protocol/schema/kernel-ipc.schema.json)。

## worker

worker 实例化唯一 AgentExecutor。执行通道为 stdio NDJSON；独立 Node IPC 的 ping/pong 由 worker 主循环响应。1 秒检查、5 秒失联，启动就绪预算 15 秒。失败先回收受管进程组，再按 250/1000/4000 ms 退避，60 秒窗口最多三次替换。稳定 60 秒后重置预算。耗尽后 Kernel 保留 status，拒绝新执行。

worker 丢失时，未完成 Run 产生一次 lost 终态；已接纳的完成终态保持原样。新 worker 只接纳新 Run，不重放旧请求。进程清理失败禁止替换。进程身份清单仅用于回收孤儿，不保存业务执行历史。

## 容量与平台

中央源窗口默认每 Run 32 MiB / 4096 帧，全局 128 MiB / 128 Run，终态 TTL 120 秒。最多 64 连接、16 订阅，写入 drain 等待 5 秒；客户端最多 32 个在途连接。按异步迭代消费，不增加无限生产队列。

POSIX socket 为 0600；仅持有本实例端点租约才能移除 socket。Windows 使用命名管道。POSIX 清理按受管 PGID，Windows 使用有界 taskkill /T；原生平台和父进程先退出后的后代回收证据必须单独核对。

测试入口：[Kernel clients](../../test/kernel-clients.test.js)、[监督](../../test/kernel-worker-supervision.test.js)、[源窗口](../../test/host-run-service.test.js)。
