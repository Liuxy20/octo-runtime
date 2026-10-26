# ZCode GUI Adapter

[English](README.md) | [包导航](../README.zh.md)

拉起 ZCode Desktop 自带的 app-server（`zcode.cjs app-server --stdio`），和它做双向 NDJSON 交换。会话、文本、工具、终态消息变成 `CanonicalEvent`。它说的是 ZCode 的私有协议，不自动化 Electron 窗口，也不依赖 ACP server。

## 什么时候用它

- 机器上装了 ZCode Desktop，能找到它自带的 app-server。
- 你能接受用 ZCode 自己配好的模型；这条路径没有单次调用的选模。
- 你想让 ZCode 和其他 Provider 走同一条 Core 或 Kernel 路径。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { zcodeGuiAdapter } from "@mininglamp-oss/octo-runtime-adapter-zcode-gui";

const executor = new AgentExecutor();
executor.register(zcodeGuiAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "zcode-gui" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| Adapter 类型 | `zcode-gui`                                                  |
| 导出         | `zcodeGuiAdapter`、`createZcodeGuiAdapter`                   |
| 发现顺序     | `ZCODE_BIN`、PATH、已知的 ZCode Desktop 安装路径             |
| 命令         | 自带 app-server 的 `--stdio` 模式                            |
| 输出         | 仅 canonical 事件                                            |
| 审批         | `ask` 与 `full_access` 走本次调用的交互桥；`assisted` 被拒绝 |

## 限制

- 验证过的 app-server 路径不支持单次调用选模；用 ZCode 里配置的模型。
- `ZCODE_BIN` 选的是可执行文件，不是模型。
- Runtime 偏好会关掉不支持的内存、搜索和自动提问行为。不支持的用户输入请求按原生映射拒绝；原生 Cron 被关闭，因为 Runtime 没有实现它的自动化宿主回调。
- 不要因为桌面 UI 里有某个功能就推断这里也支持。
- 工作目录和权限回复不是操作系统隔离。
- ZCode 的登录由宿主准备；凭据不会被写进 prompt 或项目文件。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
