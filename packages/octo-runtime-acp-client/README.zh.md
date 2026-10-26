# ACP Client

[English](README.md) | [包导航](../README.zh.md)

ACP 子进程的 JSON-RPC 2.0 / NDJSON 传输层：请求关联、每个会话一条 update 队列、权限回复、取消、有界缓冲。它只说 ACP——把原生 update 变成 `CanonicalEvent` 是 Adapter 的事。

## 什么时候用它

- 你要给一个已经支持 ACP 的 Provider 写 Adapter。
- 你只想要 wire 层；`createAcpAdapter` 会把这一层包成完整的 Adapter。
- 不是 ACP 的 JSON-lines CLI，应该用 Adapter SDK 里的 JSON CLI helper。

## 走一轮 ACP

```ts
import { spawnAcpClient } from "@mininglamp-oss/octo-runtime-acp-client";

const client = spawnAcpClient({ command: "hermes", args: ["acp"], cwd: process.cwd() });
try {
  await client.initialize();
  const { sessionId } = await client.newSession({ cwd: process.cwd() });
  for await (const update of client.prompt(sessionId, "Say hello.")) {
    if (update.type === "session/update") console.log(JSON.stringify(update));
  }
} finally {
  await client.close();
}
```

## 调用顺序

1. `initialize()`——ACP 握手，必须在任何会话调用之前。
2. `newSession({ cwd, model? })` 或 `loadSession(sessionId, { cwd? })`——显式的 Provider 会话。
3. `prompt(sessionId, text | content[])`——持续吐 update，直到关联的那条响应回来。
4. `close()`——放在 `finally` 里，失败之后也要 await。

需要原始参数时，用 `acpNewSessionParams`、`acpLoadSessionParams`、`acpPromptParams` 构造。

## 这里的"结束"指什么

- `session/prompt` 的 JSON-RPC 响应才结束这一轮，并带回结果和用量。通知流安静下来不等于完成。
- `cancel(sessionId)` 只是发通知，不确认执行已停、资源已释放。
- 提前关闭 prompt 迭代器也不算取消。

## 权限

传 `permissionHandler` 来应答 `session/request_permission`。不传时，客户端挑第一个 reject/deny 选项，没有就挑最后一个选项，一个选项都没有就返回取消——演示够用，别当策略。更严格的审批语义归 Adapter。

## 限额

默认单请求 300 秒、`session/load` 600 秒、prompt 八小时。队列、单条消息大小、行缓冲都有界；留给诊断的 stderr 末尾最多 8192 字符，不是完整 Provider 日志。

## 导入与分发

private workspace 包，没有独立的公开子路径。

## 延伸阅读

- [实现](src/index.ts)、[通用 ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
- [Provider 矩阵](../../.octospec/guides/providers.md)。
