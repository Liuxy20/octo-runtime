# 故障排查

[English](../../en/guides/troubleshooting.md) | [文档目录](../README.md)

构造或初始化失败时，先查阅[启动诊断合同与目录](startup-diagnostics.md)。这类失败可早于任何 Run 或 IPC 端点，直接检查失败调用的 diagnostic 即可。下文执行排障适用于已提交 Run 的情况。

先记录错误码和相关 `runId`、`invocationId`，再按下表定位问题。提交后的连接失败不一定意味着任务没有执行，重试前应查询原执行。日志中只记录必要元数据，避免输出输入正文、密钥或替换后的 MCP 认证 header。

## 服务无法连接

使用 `octo-runtime logs --lines 200 --follow` 观察执行服务诊断。日志不包含聊天正文或凭据。Gateway 的连接与投递诊断由独立 CLI 提供。

渠道连通性、重试策略及投递日志归[独立 Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway)；使用其自己的 CLI 和 Home 排查。渠道在线不代表执行或投递成功。

| 现象或错误码                    | 处理步骤                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `KERNEL_UNAVAILABLE` 或连接失败 | 确认 endpoint 正确、Kernel 已初始化、客户端使用相同 OS 账号。检查 `status().execution_ready`。`attachKernel` 不会启动服务。 |

Kernel 不负责重启宿主进程；SDK 由应用管理，CLI 由原生服务管理器管理。服务进程 `running` 不代表执行就绪，需要检查 `execution_ready`。应修复报告的原因，不删除 Home 或盲目重启服务；状态和日志见 [CLI 运维](../getting-started/cli.md)。

## 输入被拒绝

| 现象或错误码                   | 处理步骤                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context 结构、重复项或大小错误 | 用 `InvokeInput.check` 校验参数，检查 schema、32 项 / 64 KiB 限制，以及重复的 namespace/name。字段格式见 [Context 参考](../reference/contexts.md)。 |
| `CONTEXT_PLAN_MISMATCH`        | 检查 agentEnv.workdir、agentConfig.workdir、模型和审批设置是否与 Context 选择一致，修正冲突值。 |
| `WORKDIR_REQUIRED` | 通过 agentEnv.workdir 或仅含 path 的 workspace item 显式提供已存在的本地绝对目录；CLI 与 SDK 无 cwd 默认值。 |
| `WORKDIR_INVALID` | 使用合法绝对路径，不再提供 workspace mode。 |
| `WORKDIR_NOT_FOUND` | 调用方在调用前准备选定目录；续接/恢复不重建、不分配替代目录。 |
| `WORKDIR_NOT_DIRECTORY` | 提供目录而非文件。 |
| `WORKDIR_UNAVAILABLE` | 检查文件系统访问权限和实际系统错误；不可用不一定代表不存在。 |
| `INVOKE_REQUEST_TOO_LARGE`     | 减少发送的正文或图片，或改用可通过工具读取的资源引用。32 MiB 上限还包含 base64、恢复图片和协议包装。                                                |
| 输出模式不支持                 | 按 [Provider 支持表](../reference/providers.md) 选择模式。只支持 canonical 的 Adapter 需要显式设置 `protocol_mode: "canonical"`。                   |
| `CONTEXT_ENVS_UNSUPPORTED`     | OpenClaw 不接受本轮非空环境变量。移除这些设置，改为部署 Gateway 时配置。                                                                            |
| MCP 配置或连接失败             | 按 [MCP 排查表](mcp.md) 检查连接方式、字段支持、环境变量、同名服务和认证。                                                                          |

## 输出或会话恢复失败

上述 `WORKDIR_*` 原因码沿用公开分类 `OH-ADP-3004`；按异常 `.code`、canonical 的 `payload.code` / `failure.reasonCode` 或 native error control 中的具体码分支。Runtime 在 Provider 执行前校验，但不能消除后续文件系统竞态。OpenClaw 等自有工作区的外部 Agent 可以省略本地覆盖，见[工作目录合同](../reference/invoke-input.md)。

| 现象或错误码                                               | 处理步骤                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `STREAM_GAP`、`STREAM_EXPIRED`、`STREAM_CURSOR_INVALID`    | 检查原 ref 和最后连续序号。原输出已缺失、过期或读取位置无效时，向应用报告无法继续读取，不要通过再次 invoke 补读输出。 |
| `KERNEL_INSTANCE_CHANGED`、`RUN_IDENTITY_MISMATCH`         | Kernel 实例或执行标识与回执不符，停止使用旧 ref，由应用决定是否发起新任务。                                           |
| `OPERATION_OUTCOME_UNKNOWN`、`RUN_OUTCOME_UNKNOWN`、`lost` | 操作或执行结果无法确定，可能已经生效。记录未知状态，不要自动重试可能修改外部系统的操作。                              |
| 续聊或重置后缺少背景                                       | 检查保存的 providerSession 和返回的恢复结果。按 [续聊步骤](context-and-sessions.md) 补充本轮背景或恢复历史。          |

## 服务关闭未完成

`close()` 返回 `complete=false` 时，检查 `errors` 和 `pendingResources`，确认哪些调用、应用函数或资源尚未结束。根据实际操作继续等待或报告清理失败，不要立即创建占用同一 endpoint 的服务。

Agent 执行完成后，如果用户仍未收到消息，还应检查 应用自己的投递结果和存储。执行成功只说明执行本身完成，不代表消息已经发出或数据已经保存。

不要通过删除 Home、身份配置、凭据或数据库来尝试通用修复。更多执行状态说明见[输出与控制](../reference/output-and-control.md)，测试范围见[维护与验证](../maintenance.md)。
