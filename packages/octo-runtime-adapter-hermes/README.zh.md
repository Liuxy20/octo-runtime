# Hermes Adapter

[English](README.md) | [包导航](../README.zh.md)

把 Hermes CLI（`hermes acp`）接到 Runtime：复用通用 ACP Adapter，一次调用跑一轮，Hermes 会话显式创建或续接，原生 update 归一化成 `CanonicalEvent`。Hermes 的安装和登录由宿主负责。

## 什么时候用它

- 运行执行器的机器上已经装好 Hermes 并登录。
- 你想让它和其他 Provider 走同一条 Core 或 Kernel 路径。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { hermesAdapter } from "@mininglamp-oss/octo-runtime-adapter-hermes";

const executor = new AgentExecutor();
executor.register(hermesAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "hermes" } }]
  }
});
```

事件按 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md) 消费；只有 `run.completed` 算成功终态。

## 绑定了什么

| 项           | 值                                                                        |
| ------------ | ------------------------------------------------------------------------- |
| Adapter 类型 | `hermes`                                                                  |
| 导出         | `hermesAdapter`                                                           |
| 命令         | `hermes acp`                                                              |
| 输出         | 仅 canonical 事件                                                         |
| 会话         | 显式续接；`session/load` 返回空结果时视为会话丢失，改用调用方给的恢复输入 |
| 模型         | 用 Provider 广告的 ID；省略则保持 Provider 默认                           |

## 限制

- canonical-only：必须传 `protocol_mode: "canonical"`，Core 默认的 native 不会自动转换。
- 只支持 `ask` 和 `full_access`；`assisted` 在进程启动前就被拒绝。
- 探测只确认 `hermes` 存在，不证明已登录或有模型权限。
- 每次调用拥有自己的 ACP 进程；要 await 清理，不能拿取消回执当清理完成。

## 导入与分发

private workspace 包。发行版没有 Hermes 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Provider 矩阵](../../.octospec/guides/providers.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
