# Provider 支持范围

[English](../../en/reference/providers.md) | [文档目录](../README.md)

Provider 是实际执行 Agent 任务的程序，例如 Codex 或 Claude Code。Adapter 负责将 Runtime 输入转换为对应 Provider 的调用。应用通过 `octo.execution/adapter` 选择 Adapter，并在执行机器上安装、登录对应 Provider；Runtime 不会自动下载这些依赖。

安装、账号配置、Codex Computer Use 和 CodeBuddy/WorkBuddy 共享额度见 [Harness 安装配置](../guides/harnesses.md)。Runtime 服务命令和 `octo-cli` 依赖见 [CLI 安装与调用](../getting-started/cli.md)。

下表记录当前源码中的 Adapter。使用前还需确认实际 Provider 版本和账号配置可用，不能只根据 Adapter 已注册就认定能够执行。

| Adapter type                                                    | 原生传输           | 公开输出模式       | 逐轮 MCP                        |
| --------------------------------------------------------------- | ------------------ | ------------------ | ------------------------------- |
| `codex`                                                         | app-server         | native + canonical | stdio + HTTP                    |
| `claude-code`                                                   | stream-json        | native + canonical | stdio + HTTP                    |
| `dsh` | DeepSeek Harness SDK JSON-RPC stdio | canonical | 不支持逐轮配置 |
| `acp`、`hermes`、`kimi-code`、`mcode`、`qodercli`、`qoderclicn` | ACP                | canonical          | stdio；原生声明支持 HTTP 时可用 |
| `opencode`                                                      | OpenCode CLI       | canonical          | local stdio + remote HTTP       |
| `codebuddy`                                                     | Provider CLI       | canonical          | 不支持                          |
| `openclaw`                                                      | Gateway            | canonical          | 不支持                          |
| `zcode-gui`                                                     | GUI runtime client | canonical          | 不支持                          |
| `antigravity`                                                   | Provider CLI       | canonical          | 不支持                          |
| `grok-build` | Grok CLI ACP stdio | canonical | stdio；广告支持时使用 HTTP；最终 `${` 字面量拒绝 |

Grok Build 使用共享 ACP client，每次调用启动一个 CLI 进程。已在 macOS arm64 验证 1.0.67 的文本流和跨进程会话续聊。认证、配置和验证限制见 [Grok adapter](../../../packages/octo-runtime-adapter-grok-build/README.md)。

DSH 固定支持 0.2.1-rc.3，只接受显式 full_access。文本增量在原生消息提交后提供；安装、Desktop 发现、恢复与取消边界见 [DSH adapter](../../../packages/octo-runtime-adapter-dsh/README.md)。

表中的 MCP 列表示通过本轮 `octo.execution/mcp` 配置连接的能力。Provider 自己已有的 MCP 配置是另一种配置来源。可选字段和使用限制见 [MCP 指南](../guides/mcp.md)。

## 原生交互的支持范围

Codex Driver 负责初始化、thread 创建或恢复、本轮 turn、中断和清理。应用使用 native 模式时，可以回复受支持的待处理审批、追问和信息补充请求，但不能另外启动 turn，或通过该接口管理任意账户、thread 和全局配置。当前不支持 `item/permissions/requestApproval`。

Claude Code 目前支持 `can_use_tool` 相关交互，其他控制方法需要逐项确认实现。统一的回复方式见[输出与控制](output-and-control.md)。

## 模型和工作模式

模型 ID 和推理强度取决于 Provider 及其版本。Runtime 提供 `low`、`medium`、`high`、`xhigh` 四档 effort，由 Adapter 转换为 Provider 的设置；Provider 不一定原生支持四个不同等级。

省略 actmode 会保留 Provider 自己的模式行为，不会主动重置。显式选择了不支持的设置时，调用会报错。

## OpenClaw 的配置差异

OpenClaw 使用 Gateway 中已有的 Agent，需要显式提供 `provider_agent_id`，例如 `main`。工作目录由该 Gateway 管理，不接受通过本轮调用传入非空环境变量。

其他由 Runtime 准备执行配置的 Provider，通常使用本轮解析出的本地 workdir。工作目录本身不限制文件系统或网络权限。

图片输入、sandbox 和会话恢复还取决于具体 Adapter 和 Provider 版本，详见[各 Adapter README](../../../packages/README.md)。文档测试使用测试用 Adapter；真实 Provider 的联调范围见[维护与验证](../maintenance.md)。

来源：[Codex](../../../packages/octo-runtime-adapter-codex/src/index.ts)、[Claude Code](../../../packages/octo-runtime-adapter-claude-code/src/index.ts)、[ACP](../../../packages/octo-runtime-adapter-acp/src/index.ts)、[OpenCode](../../../packages/octo-runtime-adapter-opencode/src/index.ts)、[Adapter 注册](../../../packages/octo-runtime-adapter-sdk/src/index.ts)。
