# 执行环境、业务历史与会话

[English](../../en/guides/context-and-sessions.md) | [文档目录](../README.md)

应用持有可复用 agentEnv，调用时传入独立快照。它描述怎样执行，不保存历史消息。业务历史、群规则和资料选择由独立 Gateway/应用处理，然后作为本轮 inputs 提交；Runtime 不要求 extra.im、XML 或其他业务格式。

应用也拥有启动提示词。在调用 Runtime 前，将需要的文本作为普通输入 parts 放到前面，与业务文本和图片的相对顺序保持。Runtime 不提供通用 system/developer 提示词字段，不赋予受信角色，也不添加提示词或分隔符。

| 路径 | 调用方责任 |
| --- | --- |
| 新建 Provider 会话 | 在主输入中提供本轮需要的全部提示词和材料。 |
| 续接 Provider 会话 | 显式决定携带、刷新或省略应用提示词；Runtime 不根据会话身份替应用决定。 |
| 续接失败后的新会话 fallback | 提供包含提示词、恢复历史和图片字节的完整 fallback 文本/parts；Runtime 不重建或补入。 |
| 重试同一份已准备输入 | 复用冻结内容，不再次前置相同提示词；观察恢复不等于新调用。 |

modelInput 覆盖文本轮次时，须已包含需要的提示词；freshFallbackModelInput 和 freshFallbackModelInputParts 同理。历史图片无法恢复须声明不可用，不静默丢失。MCP 和环境变量仍属于执行配置，不能进入提示词正文。

此次迁移删除 `octo.control/instructions`、`controlInstructions`、对应 payload 类型和指令 helper，没有兼容别名；旧项/字段即使为空也拒绝。独立 Channel Gateway 仍使用旧项，须另行迁移后再采用本次 Runtime/client 版本；本仓改动不代表 Gateway 端到端兼容。Run 7、Context v3、IPC 2 和 Adapter transport 2 保持原编号，npm 版本由既有发行流程选择。

sessionId 是应用会话标识。只重复 sessionId 不会恢复 Provider；应用须保存 session.update 里的完整 providerSession 并显式传回。Provider 扩展字段不能丢失，也不能从业务会话 ID 重建 providerSession。

工作目录也归调用方。每次本地调用（含续接和显式 fresh recovery）都传入选定且已存在的绝对路径；Runtime 不分配随机目录、不继承 cwd，也不重建已删除的目录。恢复时目录消失仍以 `WORKDIR_NOT_FOUND` 失败，改选或准备其他目录须由应用决定。删除 workspace `mode`，使用仅含 path 的 payload。调用方自建临时目录与普通工作区遵守相同生命周期：执行结束并确认自有清理完成后才能删除。Runtime Home、日志与 IPC 分别管理，详见[目录错误与外部 Agent 例外](../reference/invoke-input.md)。

一次会话可以有多次调用，每次使用不同 invocationId。停止按钮绑定 run.invocationId，通过同一 client.interrupt 精确定位；延迟的停止请求不能转投该会话的下一次调用。Core 将中断传给拥有该执行的 Adapter；Adapter 对接原生 turn/interrupt、查询中断或进程取消能力。调用方不需要知道 Provider 的 turnId。

reset 是业务动作，不等于取消。应用更新 sessionGeneration/providerEpoch 并隔离旧更新。Gateway 保留这一代次隔离、有限历史窗口和显式恢复输入；执行失败/观察断流/投递失败不能自动授权重放。

owner 关闭先 stopAdmission，再在共享截止内 drain 和业务收尾，最后 client.close。取消 ACK、执行终态、业务投递、Adapter 清理分别确认。

参见[标识与所有权](../concepts/identifiers.md)、[输入](../reference/invoke-input.md)。
