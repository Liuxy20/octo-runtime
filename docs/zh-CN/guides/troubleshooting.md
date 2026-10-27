# 故障排查

[English](../../en/guides/troubleshooting.md) | [文档目录](../README.md)

先记录错误码和相关 `runId`、`invocationId`，再按下表定位问题。提交后的连接失败不一定意味着任务没有执行，重试前应查询原执行。日志中只记录必要元数据，避免输出输入正文、密钥或替换后的 MCP 认证 header。

## 服务无法连接

使用 `octo-runtime channel-gateway logs --lines 200 --json` 读取服务状态，添加 `--follow` 观察连接和重试转换，Ctrl+C退出。仅包含Extra生命周期、Kernel可用性和连接状态，不含聊天正文、session/run/message标识、模型输出、工具参数或凭据。命令只读 `<home>/logs/extras/<extra>-status-<UTC小时>.log`，Kernel离线或模块配置损坏时仍可读取；最多读取最近三份中的4MiB，每份上限100MiB。空日志成功并向stderr提示。

CLI Extra同时将状态写stdout。原生SDK默认静默，可在绝对路径 `logging.directory` 旁提供 `logging.statusOutput(record)`；文件与有界stdout均尽力诊断，不阻塞恢复。Gateway首次暂态离线及后续暂态断线等待5、10、15秒，之后每15秒；Retry-After可延长。合法服务端 DISCONNECT 默认重连，包含 reason 12、滚动更新和未知断开码；明确认证、权限、封禁及协议错误仍停止。握手未知服务端原因、HTTP 超时/冲突/限流/5xx 及未知服务故障默认重试，只有明确认证/配置/协议错误停止。5/10/15 秒仅是旧连接回收后的等待；静默断网每 25 秒检查、超过 90 秒无包才发现，还需鉴权握手，不能保证 20 秒内上线。IM在线不证明执行或投递成功。

| 现象或错误码                    | 处理步骤                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `KERNEL_UNAVAILABLE` 或连接失败 | 确认 endpoint 正确、Kernel 已初始化、客户端使用相同 OS 账号。检查 `status().execution_ready` 和 worker 状态。`attachKernel` 不会启动服务。 |
| worker 状态 `recovering`       | Kernel 保持本地监听并串行重试。三次快速尝试后，每次继续等待15秒；修复worker环境后可自动恢复执行，无须重启Kernel。 |
| `WORKER_RESTART_EXHAUSTED`      | 清理或所有权未确认，自动替换已阻断。先排查旧worker与所有权记录，再恢复服务；替代worker不会恢复旧执行。 |

## 输入被拒绝

| 现象或错误码                   | 处理步骤                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context 结构、重复项或大小错误 | 用 `InvokeInput.check` 校验参数，检查 schema、32 项 / 64 KiB 限制，以及重复的 namespace/name。字段格式见 [Context 参考](../reference/contexts.md)。 |
| `CONTEXT_PLAN_MISMATCH`        | 检查顶层 workdir、模型和审批设置是否与 Context 一致，修正冲突值。                                                                                   |
| `INVOKE_REQUEST_TOO_LARGE`     | 减少发送的正文或图片，或改用可通过工具读取的资源引用。32 MiB 上限还包含 base64、恢复图片和协议包装。                                                |
| 输出模式不支持                 | 按 [Provider 支持表](../reference/providers.md) 选择模式。只支持 canonical 的 Adapter 需要显式设置 `protocol_mode: "canonical"`。                   |
| `CONTEXT_ENVS_UNSUPPORTED`     | OpenClaw 不接受本轮非空环境变量。移除这些设置，改为部署 Gateway 时配置。                                                                            |
| MCP 配置或连接失败             | 按 [MCP 排查表](mcp.md) 检查连接方式、字段支持、环境变量、同名服务和认证。                                                                          |

## 输出或会话恢复失败

| 现象或错误码                                               | 处理步骤                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `STREAM_GAP`、`STREAM_EXPIRED`、`STREAM_CURSOR_INVALID`    | 检查原 ref 和最后连续序号。原输出已缺失、过期或读取位置无效时，向应用报告无法继续读取，不要通过再次 invoke 补读输出。 |
| `KERNEL_INSTANCE_CHANGED`、`RUN_IDENTITY_MISMATCH`         | Kernel 实例或执行标识与回执不符，停止使用旧 ref，由应用决定是否发起新任务。                                           |
| `OPERATION_OUTCOME_UNKNOWN`、`RUN_OUTCOME_UNKNOWN`、`lost` | 操作或执行结果无法确定，可能已经生效。记录未知状态，不要自动重试可能修改外部系统的操作。                              |
| 续聊或重置后缺少背景                                       | 检查保存的 providerSession 和返回的恢复结果。按 [续聊步骤](context-and-sessions.md) 补充本轮背景或恢复历史。          |

## 服务关闭未完成

`close()` 返回 `complete=false` 时，检查 `errors` 和 `pendingResources`，确认哪些调用、应用函数或资源尚未结束。根据实际操作继续等待或报告清理失败，不要立即创建占用同一 endpoint 的服务。

Agent 执行完成后，如果用户仍未收到消息，还应检查 Extra 的投递结果和应用存储。执行成功只说明执行本身完成，不代表消息已经发出或数据已经保存。

不要通过删除 Home、身份配置、凭据或数据库来尝试通用修复。更多执行状态说明见[输出与控制](../reference/output-and-control.md)，测试范围见[维护与验证](../maintenance.md)。
