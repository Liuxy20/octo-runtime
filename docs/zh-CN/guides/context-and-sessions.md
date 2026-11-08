# 执行环境、业务历史与会话

[English](../../en/guides/context-and-sessions.md) | [文档目录](../README.md)

应用持有可复用 agentEnv，调用时传入独立快照。它描述怎样执行，不保存历史消息。业务历史、群规则和资料选择由独立 Gateway/应用处理，然后作为本轮 inputs 提交；Runtime 不要求 extra.im、XML 或其他业务格式。

sessionId 是应用会话标识。只重复 sessionId 不会恢复 Provider；应用须保存 session.update 里的完整 providerSession 并显式传回。Provider 扩展字段不能丢失，也不能从业务会话 ID 重建 providerSession。

一次会话可以有多次调用，每次使用不同 invocationId。停止按钮绑定 run.invocationId，通过同一 client.interrupt 精确定位；延迟的停止请求不能转投该会话的下一次调用。Core 将中断传给拥有该执行的 Adapter；Adapter 对接原生 turn/interrupt、查询中断或进程取消能力。调用方不需要知道 Provider 的 turnId。

reset 是业务动作，不等于取消。应用更新 sessionGeneration/providerEpoch 并隔离旧更新。Gateway 保留这一代次隔离、有限历史窗口和显式恢复输入；执行失败/观察断流/投递失败不能自动授权重放。

owner 关闭先 stopAdmission，再在共享截止内 drain 和业务收尾，最后 client.close。取消 ACK、执行终态、业务投递、Adapter 清理分别确认。

参见[标识与所有权](../concepts/identifiers.md)、[输入](../reference/invoke-input.md)。
