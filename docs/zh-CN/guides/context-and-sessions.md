# 提供背景资料与继续会话

[English](../../en/guides/context-and-sessions.md) | [文档目录](../README.md)

## 业务材料

将本轮需要的材料放入 `contexts.items`。可以使用以下类型：

- `octo.content/inline`：直接提供文本，例如用户选中的一段文档。
- `octo.content/references`：提供资源地址和读取方式，例如文档 ID 及可读取它的 MCP 工具。
- `extra.<domain>/<name>`：提供应用自己的结构化数据，例如 `extra.project/selection`。

完整调用见 [Inputs 与 Contexts](../concepts/inputs-and-contexts.md)。Runtime 按 item 顺序将 `guidance` 和 `payload` 组织成背景文本，不会自动提取业务字段或生成摘要。

使用资源引用时，应用还需要提供可用的读取工具，例如已配置的 MCP 工具或已安装的业务 CLI。Runtime 不会自动获取引用的正文；能否读取由工具和服务端权限决定。

`guidance` 用来说明材料的用途，仍属于普通背景文本。即使在其中写上“system”或“SOUL”，也不会变成 Provider 的会话指令。会话指令应使用经过应用授权的 `octo.control/instructions`。

## 图片

将图片数据放在 `inputs` 中。共享的 [imagePart 函数](../../examples/image.mts) 可读取图片文件，生成包含 base64 数据、字节数和 SHA-256 的图片对象。

按消息顺序组织数组，例如先放“总结这张图”的文本对象，再放图片对象。所选 Adapter 必须支持图片输入；不支持时调用会失败，不会自动将图片转换为文字。大小限制见 [InvokeInput](../reference/invoke-input.md)。

## 本轮环境

使用 `octo.execution/envs` 为本轮执行设置环境变量。`payload.env_variables` 是 `{key, value}` 对象组成的数组。值可以是空字符串；变量名重复、名称非法或值包含 NUL 字符时，校验失败。这些变量不会被拼进模型文本，但仍保存在本次提交的 Context 对象中。

如果应用需要在 Context 之外传递环境变量，将 `executionEnvOverrides` 放在 `client.invoke(input, environment)` 的第二个参数中。这些值会覆盖 Context 中的同名变量。具体结构、优先级和限制见 [InvokeInput](../reference/invoke-input.md)。

这两种方式只作用于本轮执行，不修改全局 `process.env`，也不更新已经运行的 Provider。OpenClaw 不支持通过本轮调用传入非空环境变量；使用 OpenClaw 时，应在部署 Gateway 时配置环境。

## 会话续接

`sessionId` 是应用自己的会话 ID。Provider 还有自己的会话信息，保存在 `providerSession` 中。继续对话需要保存并再次提交后者，不能只复用 `sessionId`。

1. 消费 canonical 输出时，从 `session.update` 事件的 `payload.providerSession` 读取会话对象。
2. 保存整个对象，包括 Provider 的扩展字段。
3. 下一轮提交相同的业务 `sessionId`、保存的 `providerSession` 和 `continuityMode: "continue"`。
4. 检查返回会话中的 `resumeOutcome` 和 `contextInputVariant`，判断是否恢复成功，还是退回了新会话。

如果应用使用 `sessionGeneration` 或 `providerEpoch` 防止旧请求覆盖新会话数据，续聊时也需要保留这些字段。

新建 Provider 对话时，使用 `continuityMode: "fresh"`，并省略 `providerSession`。

部分 Adapter 支持在恢复失败时退回新会话。应用可以通过 `freshFallbackModelInput` 或 `freshFallbackModelInputParts` 提供新会话需要的历史内容。Runtime 不会替应用查询和重建历史。若恢复必需的历史图片已不可用，设置 `freshFallbackImagesUnavailable: true`，避免在缺少图片时继续该恢复流程。

需要更换会话指令时，由应用新建或重置 Provider 会话。

## 为下一轮准备 Context

应用自行决定下一轮发送全部背景、仅发送变化内容，还是不发送背景。Runtime 不会根据 session 或内容 hash 补回省略项。

如果需要固定的默认配置，使用 [Context 配置合并](../reference/contexts.md)；如果通过 Channel Gateway 接入，使用 [Extra 的 `loadContexts`](extras.md) 在每轮调用前读取最新业务数据。这两种机制都不会自动恢复聊天历史。

来源：[输入准备](../../../packages/octo-runtime-executor-core/src/invoke-input.ts)、[renderer](../../../packages/octo-runtime-executor-core/src/model-input.ts)、[环境](../../../packages/octo-runtime-adapter-sdk/src/environment.ts)。
