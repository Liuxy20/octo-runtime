# Adapter SDK

常驻资源 Adapter 可提供同步、惰性的 `createExecutionScope({log})`。Core 每次注册独占 scope，绑定调用及回复；取消前同步调用 `beginShutdown(reason)`，再等待 `close({deadline})`，deadline 为 `performance.now()` 绝对毫秒值。服务遗留和失败 ID 独立于 invocation 清理报告；可选 `processes()` 只返回安全常驻所有权快照。turn 释放订阅，scope 只清理自己拥有的调用、lease 和资源。注入的常驻 Engine 与连接归显式宿主 owner；引用不转移关闭权。Adapter 可采用任意构造方法、参数及依赖，CLI manifest 约定不限制 SDK。见[接口](src/execution-scope.ts)及 [Codex 实现](../octo-runtime-adapter-codex/src/service.ts)。

[English](README.md) | [包导航](../README.zh.md)

写 Provider Adapter 用的工具箱：编写输入 `Adapter` 接口、用来校验并冻结定义的 `defineAdapter`，以及每个 Adapter 本来都要重写一遍的机制——子进程流、有界队列、ACP 映射、审批桥、环境与 MCP 映射、日志、清理。编排归 Core，Adapter 只翻译一个 Provider。

## 什么时候用它

- 你要为另一个 CLI 或 app-server 写 Adapter。
- 你要扩展本目录里已有的 Adapter，想复用现成的传输。
- 你要找的不是执行引擎：这个包自己什么也不跑。

## 写一个最小 Adapter

```ts
import { defineAdapter } from "@mininglamp-oss/octo-runtime-adapter-sdk";

export const echoAdapter = defineAdapter({
  metadata: {
    type: "echo",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "echo.canonical", modes: ["canonical"], nativeMethods: [] }
  },
  async *invoke(request) {
    yield {
      protocolVersion: 2,
      type: "message.delta",
      payload: { channel: "final", text: request.modelInput }
    };
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  }
});
```

注册方式和别的 Adapter 一样：宿主使用 `createKernelService({ home, endpoint, adapters: [echoAdapter] })`，直接 Core 里 `executor.register(echoAdapter)`。

`Adapter` 和 `AdapterMetadata` 是编写输入，`protocolSupport` 可选。`defineAdapter()` 和 `createJsonCliAdapter()` 返回 `DefinedAdapter`，其类型保证协议声明必有；省略时默认协议为 `${type}.canonical`、模式仅 `["canonical"]`、原生方法为空。传给 Core 时保留工厂推导出的返回类型。手写 `HostedAdapter` 必须显式填写 `protocolSupport`，注册入口只校验，不补默认值。canonical-only Adapter 的调用方须显式选择 canonical 模式。

## SDK 提供了什么

| 工具                                                                | 省掉了什么                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `defineAdapter(adapter)`                                            | 校验并冻结定义，默认 canonical-only，拒绝不支持的 MCP 与协议用法，reasoning effort 落不下去时发 `run.notice` |
| `createJsonCliAdapter(options)`、`spawnJsonLines(spec)`             | JSON-lines 子进程：stdin 写入确认、反向请求、有界行、退出处理                                                |
| `DriverQueue`、`NativeInteractionBridge`                            | 有界 native 帧流与交互回复                                                                                   |
| `AcpTurnNormalizer`、`AcpApprovalBridge`                            | ACP 更新与权限映射                                                                                           |
| `invocationEnvironment`、`invocationMcpServers`、`assertMcpOptions` | 环境覆盖与 MCP server 映射                                                                                   |
| `RuntimeLogging`、`HourlyLogWriter`                                 | 有界轮转诊断                                                                                                 |
| `mapReasoningEffort`、`reasoningLevelMap`                           | Provider 各自的 effort 档位，包括"不支持"                                                                    |
| `watchLineLimit`、`readBoundedLines`                                | 行与缓冲上限                                                                                                 |
| `sanitizePublicValue`                                               | 展示前剥离不安全字段                                                                                         |

## 接口默认你遵守的规则

- 你拿到的是准备好的 `InvokeRequest`，不是公开的 `InvokeInput`。
- 本地执行接收调用方已准备、经 Core 校验的现有绝对目录；不默认取 cwd，不在续接/fallback 中分配或重建应用工作区。自行管理工作区的外部/preset Agent 与 `metadata.workspace: false` Adapter 可省略本地覆盖；Provider 自有状态与 Runtime 运维状态分别保留。见[工作目录合同](../../docs/zh-CN/reference/invoke-input.md)。
- 按声明及本轮选择的模式输出：canonical 模式返回 `CanonicalEvent`，native 模式返回原生负载与控制输出。native-only Adapter 无须 canonical 转换器。通过内部 `context.protocolMode` 读取已选模式；公共调用方使用 `InvokeInput.protocol_mode` 选择。
- 不支持的设置要看得见。Provider 拒绝或忽略了的设置，不能报成"已应用"。
- 取消必须落到真正的 Provider 操作上，清理必须 await。终态事件或停止迭代都不证明子进程已经退出。

## 导入与分发

private workspace 包。发行版里没有 Adapter SDK 这个子路径。

## 延伸阅读

- [接口与导出](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[ACP 传输](../octo-runtime-acp-client/README.zh.md)。
- 可以照抄的小 Adapter：[Hermes](../octo-runtime-adapter-hermes/README.zh.md)。
- [编写指南](../../.octospec/guides/adapter-authoring.md)、[Adapter metadata 规则](../../.octospec/rules/adapter-metadata.md)。
