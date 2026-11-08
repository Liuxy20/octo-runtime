# 标识、会话与中断

[English](../../en/concepts/identifiers.md) | [文档目录](../README.md)

这些标识表示不同对象，不能互相替代。普通业务只需保存自己的 sessionId 和 Provider 返回的 providerSession；单次调用句柄的 invocationId 用于精确中断和交互。

| 标识 | 含义与生命周期 | 谁生成/提供，谁保存 | 用途与 wire 名称 |
| --- | --- | --- | --- |
| sessionId | 业务会话，可包含多次执行 | 应用生成并保存；省略时 client 生成，run.sessionId 可读 | 关联业务；wire agent_session_id。不能单靠它恢复 Provider 或停止最新执行 |
| invocationId | 本次调用的控制身份，每次执行一个 | client 默认生成，立即从 run.invocationId 获取；高级内容可显式提供；client 有界登记 | interrupt、respondInteraction；wire invocation_id；不是 Provider turnId |
| runId | 本次执行的业务/追踪 ID | client 默认生成，或应用显式提供并保存 | 日志、业务记录；wire run_id；不代替中断 ID |
| providerSession | Provider 原生会话恢复句柄，含 opaque 扩展 | Provider/Adapter 在 session.update 返回；应用保存整个对象，下轮显式传入 | 真正恢复 Provider 对话；其中 sessionId 由 Provider 提供，与业务 sessionId 不同 |
| sessionName | 可读展示名 | 应用提供；Core 缺省生成 UUID | 仅展示；同名不合并会话，不决定恢复或权限 |
| sessionGeneration | 业务会话代次 | 应用在 reset 时维护；缺省回执为 0 | 拒绝旧代次迟到更新；wire session_generation；Runtime 不决定 reset |
| providerEpoch | Provider binding 的业务版本 | 应用维护；缺省不推断 | 防止旧绑定覆盖新绑定，不是原生会话 ID |
| stream_id | 一条已接纳的执行源流 | Core 接纳时生成，完整 RunRef 中保存 | 续读原流；与 invocationId、Kernel 实例一起核对 |
| seq | 流内连续序号 | 执行源分配，订阅者保存最后已观察值 | after_seq 之后续读；窗口过期或缺口必须显式处理 |
| kernel_instance_id | Kernel 本次启动实例 | Kernel 启动生成；client 保存于 RunRef | 重启后拒绝误用旧引用，不恢复旧执行 |
| JSON-RPC id | 一次网络请求与响应的关联 ID | client 每次请求生成 | 只匹配该 RPC 响应；不是执行身份 |
| interactionId | 当前交互的统一标识 | Adapter/执行源提供，应用从事件读取 | 回答原交互；executionInstanceId 对应 invocationId。原生 requestId 由 Provider 定义 |

例如同一 sessionId=`chat-42` 的两次调用分别得到 invocationId=`A`、`B`；两次可继续使用同一个 Provider session。延迟的停止按钮仍调用 `interrupt("A")`，不能改成停止 chat-42 当前最新调用 B。

`invoke` 创建句柄时确定身份和冻结输入，首次消费才提交。提交前 interrupt 返回 accepted 只说明已阻止本地发送；随后迭代失败可用 isInvocationNotSubmitted 判断。提交后 interrupt 沿原完整引用发送取消，ACK 丢失报结果未知，不自动重试控制或再次执行。取消 ACK 不等于真实终态，终态也不等于所有资源清理完成。

Core 保持统一中断合同，Adapter 绑定自己的原生取消能力（例如 Codex threadId/turnId）；应用不拼接 Provider 协议，也不需要传原生 turnId 给 client。关闭 iterator/socket 仅停止观察，owner 的 stopAdmission/drain/close 管理自己所属的调用。另一个 client 不能用 interrupt 操作本 client 登记；高级低层 cancel(ref) 仍由持有完整 RunRef 的调用方负责。

详见 [Invoke API](../reference/invoke-input.md)、[IPC](../reference/kernel-ipc.md)、[执行和控制](../reference/output-and-control.md)。


## providerEpoch 与 agentEnv 的区别

providerEpoch 表达业务认定的 Provider 绑定版本，不是执行配置签名。agentEnv 每次调用冻结，但同一会话后续调用可以显式使用另一份配置；修改 effort、刷新凭据或调整工作目录不自动要求递增 epoch。若实际替换了 Provider 会话所属的 Adapter、账号或服务端身份域，应用须隔离旧表单与迟到更新。

AsyncQuestionReply 比较 snapshot 与 continuation 的 providerEpoch；使用该字段时须在产生问题时保存原值。两边均省略时比较通过，只表示没有 epoch 防护，不代表 SDK 已确认绑定相同。宿主未使用版本时仍负责使被替换绑定的旧表单失效。完整条件见[续跑配置](../reference/output-and-control.md)。
