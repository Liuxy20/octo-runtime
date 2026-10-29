---
type: Design
title: Gateway 稳定说明与本轮事实分离
tags: [channel, context, session]
timestamp: 2026-10-29T00:00:00+08:00
---

## 接续历史选择：保守实现

已实施 [接续会话自身输出的保守历史选择](conservative-history-plan.md)：首轮窗口保留自身 Bot；正常 delta 只有明确接续、消息归属和已覆盖证据才排除，补位/恢复/未知一律保留。所有选择、凭据和恢复装配只在 channel-gateway；无法保证回退安全就保留，不改 Adapter、Core、Kernel 或协议。正常完成 final 的位置/内容指纹作最小证据，原 ACK 快速跳过改为同次有界读取；主历史与恢复补充共享原预算并冻结。实施前准备度 96/100，双轴审查、501 项相关回归、build 与全局安装结果见 validation.md；后续已重启 Gateway，2026-10-29 用户确认真实群聊验收通过。

## 后续远端产物方案：P2 暂缓

用户接受由 OpenClaw Adapter 根据连接 URL 判断产物位置，并协调远端文件转换为 Gateway 可读取的 HTTPS 资源；指定 `127.0.0.1`、`localhost`、`0.0.0.0` 为本地主机。最新优先级为 P2，覆盖此前的 P0 提议。本轮仅记录 [架构边界与后续验收](remote-artifact-backlog.md)，在 Adapter 连接解析与最终输出处留 TODO，不实现远端转换，不增加元数据目录或配置，也不改现有连接安全校验。

## 后续验收修正：规则正文与内部状态分离

本地 OpenClaw 产物验收最终修正：实际 MD 附件报 remote-file-unavailable，根因是 Gateway 将 agentSource=preset 直接映射为 artifactPolicy.local=false，尚未检查路径就拒绝。用户明确要求成功 final 的本地 Markdown 路径均按 Gateway 文件系统尝试读取，不能为该场景要求新增配置。删除 local 推断与 localWorkspaceAccessible 模型字段；省略 allowed_roots 不额外限制到工作区，显式配置仍作为宿主限制，空列表拒绝全部。路径实际不存在、不可读或不是常规文件才按实际失败报告，保留 realpath/描述符/大小/类型校验、去重和原生附件文件卡；不从路径自动下载远端产物、不覆盖 OpenClaw workspace。先前拟增加本地 allowed_roots 的办法已撤回，未写入用户配置。可执行性 97/100，以 OpenClaw/Codex/Claude Code 默认跨工作区绝对路径、图片、缺失文件、显式目录和 symlink 限制、伪造 Context、冻结策略及原生卡重试回归验证，新增专项仅 manual，不扩大 CI。

产物指引最终收敛：用户仅要求在“如果最终交付物是本地文件”这一条件下说明资源的 Markdown 输出格式，图片带 !。默认 channel 模式的 artifact-delivery guidance 只保留一条英文格式说明：本地文件用绝对路径 `[label](/absolute/path)`，图片用 `![alt](/absolute/path)`。不再解释上传实现，也不加入“不要上传/发送”或要求调用工具的行为指令，避免影响用户明确要求的 octo-cli ToolCall。上传、路径与大小校验、文件卡、远程 URL 保留均继续由原确定性后处理负责；不扫描目录，不按扩展名或用户关键词切换交付模式。显式 tools 配置的关闭自动交付合同保持。此为文案收敛，准备度 97/100，以既有产物测试和执行回归验证，不扩大 CI。

用户首轮实测发现 group-rules 将 automatic、groupNo、shortId、source、version、status 一并序列化给模型，且指引为中文。期望为英文指引与 CDATA 内的规则原文；群来源必须明确写为 `Octo IM Group's GROUP.md`，话题使用 `Octo IM Group Topic Rules`。

可执行性 97/100：Gateway 保留权威查询与版本游标，提交执行前将自动规则投影成仅含 text 的公开快照。新增通用、显式的 ContextItem `data_format: "text"`，只允许 extra.* 与唯一字符串 text；缺省完整 JSON 不变。Core 按格式渲染，不识别 IM 业务名。同步 JSON Schema、TS 校验、生成的 TS/Go/Python 协议，验证规则撤销、周期、重试和 fresh fallback。专项手动执行，不扩大 CI。共享 Core/协议改动需重新构建并重启 Kernel 与 Gateway 后验收。

最终空值决策：群聊只携带群规则，子区同时携带父群规则和子区规则。空字符串、纯空白及 404 缺失文档不省略模型项，正文统一为 `NO RULES`，同时通过 guidance 撤销旧规则；只用 trim 判断空白，非空正文原样保留。沿用首轮/周期/版本或状态变化的调度，不改为每轮全量注入。恢复输入采用相同空值语义。

用户补充输入分隔：存在模型 Context 时，结束注释后空一行，增加 `<!-- Query Input -->`，再空一行放入本轮调用输入。Core 统一处理普通文本、多模态和显式恢复输入；不改写调用方正文或图片，不因该注释改变权限。

## 触发信息补充可读身份

最新频道字段决策：`conversation.id` 是入站消息的原始频道 ID，`conversation.type` 只取 `dm`、`group`、`group_topic`，分别表示私聊、群、群子区；不使用 direct/topic。子区的 conversation.id 保留完整频道 ID，父群与子区短 ID 分别留在 group.id/topic.id，避免混淆频道和会话绑定。变更限于 Gateway 自动 message-trigger，不改公共 Invocation 的 conversationId/conversationKind。准备度仍为 97/100，以三种频道精确结构断言和真实只读子区校验验收。

用户进一步指出 message-trigger 的原始 actorId/source/mention ID 缺少群名、子区名、发送者姓名/类型、接收 Bot 和触发时间。最终格式保留结构化 JSON；guidance 只用一句英文说明字段。conversation 表示私聊/群/子区及相应名称、ID，sender 表示当前真实发送者的 UID、名称和 human/bot/unknown，recipient 表示当前 Bot，sentAt 使用 WuKong 入站消息的秒级时间转换为系统时区及显式偏移的 ISO 时间，mentions 只描述当前真实 @ 信息。未知名称/时间为 null，不从昵称、ID 后缀或消息正文推断身份。

可执行性 97/100：属于 Gateway 的固定本轮输入准备，限于已准入消息；不改准入、Core、公共协议、稳定说明周期和出站通知规则。身份通过同 Bot 的只读 users/batch 同时查询发起者、接收 Bot 及有界 @ 目标；子区详情已包含父群名，只需一次范围详情查询。触发事实补全最多两个并行查询，共用 5 秒预算，关闭 429 自动重试、限制响应大小；后续确需装配历史时，可另用一次有界批量查询补全未缓存的历史发送者。用户进一步明确 API 失败不得影响后续 AgentRun：补充信息失败独立降级为 null/unknown，不再换接口补查或重试，不要求模型修复；外部取消继续传播。不增加跨 Bot 缓存或后台轮询，群规则权威读取沿用原合同。专项在 manual 中验证真实 API、名字/身份匹配、空值、假名、时间单位、取消和冻结重试，并确认 HTTP/网络/JSON 失败后仍进入 AgentRun；不扩大 CI。

## 后续决策：身份缓存与结构化历史

模型侧缺口说明最终决策：删除自动 `extra.im/history-gap`，不再单独暴露 status/earlierMessagesOmitted。提交模型前按整个材料列表投影，将实际缺失/读取失败/预算省略事实合并为 `extra.im/history.payload.note` 的一句英文；正常完整或成功空结果无额外说明，无正文但存在异常说明时用 messages:[]。宿主 extra.im 项按后续命名空间归属决策忽略，其他宿主项保持原样；冻结重试使用原模型快照，转换应幂等。内部 history-gap 材料、预算降级、准备状态与游标保留，note 不能当作已交接正文。可执行性 97/100，主要风险是预算与交接证据误关联，使用真实请求快照和既有失败/重试/游标回归验证；不改 Core、协议、Adapter 或 CI。

消息时间最终决策：自动 history.messages 每条增加 `sentAt`，使用原消息时刻、系统实际时区与显式 UTC offset 的 ISO 8601（如本机 Asia/Shanghai 的 `2026-10-29T13:36:53.000+08:00`），message-trigger 同样处理。不能硬编码 +08:00 或强制 UTC Z；偏移按消息时刻计算，支持负偏移、非整点偏移和夏令时。原 API/WS 为秒，解码历史内部仍为毫秒，由调用处明确单位，不猜测或接受错单位时间。修正历史 API 将缺失时间补为 Date.now 的既有行为，解码 timestamp 改为 number/null；缺失、无效或超出平台秒级范围均输出 null。引用和转发中的消息使用自身时间，不能继承外层时间；正文截短或省略仍保留 sentAt。时间计入既有 8000 Unicode 码点的完整 JSON 预算，因此实际条数可能减少，不扩大窗口。顺序仍按 message_seq，绝不按未知时间重新排序。准备度 97/100，以真实 API 只读验证与秒/毫秒、时区/DST、无效值、嵌套、截断和缺口回归验证。JSON 示例以 Asia/Shanghai 时区展示。

用户进一步确认历史指引只约定总体意图目标，不规定具体做法。history-instructions 收敛为一句英文：结合相关前文理解当前意图、遵循最新相关修正、不因旧任务出现在历史中就重新执行。删除六句中的操作案例、工具调用、加载流程与重复解释；不指定何时查询或澄清，由模型结合材料判断。历史不完整时仅在 history 中补充事实说明，不向模型下达补查步骤。Gateway 的内部缺口、水位、读取与交接合同保持。此为指导目标收敛，准备度仍为 97/100，本地验证窗口/交接/重试及周期载体，不将 fixture 结果冒充真实模型行为验证。

用户明确要求 UID/Bot ID 查询可使用 10 分钟内存缓存，并指出历史缺乏消息边界、history-gap 暴露了大量内部元数据。该要求纳入本任务，不新增 worktree 或 CI。可执行性 97/100，增加的风险是缓存隔离与历史游标交接，以下述明确边界和本地回归验证。

- GatewayTransport 拥有独立的身份缓存；同 Bot 当前消息与历史消息共用，键包含 API、Bot、Space、UID，最多 2000 项，超限淘汰最早写入项。固定 600000ms TTL 不因读取续期，不落盘、不共享全局状态、不建立定时刷新。成功获得的姓名/类型才缓存，失败与未找到不缓存；不缓存入站 actor、原消息时间、权限或 GROUP.md。
- 原 users/batch 查询只查询未命中 UID，仍限制每批 200；历史最多新增一次有界身份批量查询，失败不阻断、不重试、不换接口。当前消息先经过原准入，不以缓存替代鉴权或出站通知成员核验。10 分钟内姓名/类型变更可能延迟体现，符合用户接受的边界。
- history 使用 `{messages:[{uid,username,sentAt,content}]}`。用户进一步确定 text 同样属于 content，统一为 `{type:"text",text:"..."}`，不保留顶层 text/特殊 content 双轨格式。数组由旧到新，保持同一人的连续消息与正文换行；username 仅来自可信身份 API，缺失为 null。
- content 类型：text 放纯文本；image/file/document 放已有资源地址和 read=false；reply 分别保留 quote 的 UID/姓名/content 与当前回复 content；forward 保留 messages 中每条来源和 content；rich-text 用有序 blocks 保留图文顺序。嵌套引用/转发始终为历史材料，不构成当前 actor 或执行授权，不使用自报 from_name/users 作为可信姓名，不自动下载图片/文件或再查被引历史。
- 每条结构化正文最多 4 层、128 节点、12000 文字码点，再受整个消息数组最多 8000 Unicode 码点、最多 20 条的限制。不串子区、不含当前触发消息。普通文本超预算保留 UID/姓名并缩短正文尾部，设置该条 truncated=true；特殊内容整体放不下时使用 `{type:"omitted",reason:"history-budget"}` 并保留身份与截断标记，不截断 URL 或伪造已读。查询到的图片地址不等于图片已被模型看到。
- Gateway 保留历史的 source、automatic、上界和范围用于预算降级与交接。执行快照投影时，自动 history 只保留 messages 与必要的 note，不再输出独立自动 history-gap。指引简要说明顺序/空姓名/截断，不向模型暴露序号、内部模式、游标或修复命令。
- 交接证据单独保存在本地 prepared 对象中，只有最终实际提交的快照仍包含该自动历史时才推进游标；预算删除历史、失败、同代次冻结重试不能凭精简数据错误确认已交接。宿主 extra.im 不参与历史构造，其他宿主项不投影。Core、协议和 Adapter 不增加 IM 业务逻辑。

# 状态与时机

在既有有界 session binding 中增加小型稳定说明状态（用户任务轮次及待刷新标记），同代次排队共享对象；reset/new 更换对象，旧任务不得回写新代次。正常轮开始准备时只计算计划，实际第一次交给执行前推进一次轮次；同次执行自动重试和同代次冻结卡片重试不推进。准备失败仍有首轮资格。成功耗尽执行源且本轮实际携带稳定说明后清除待刷新；失败或结果未知保留待补，不将 ACK 当作已应用。

无需新增 store 方法：既有 save/read 序列化新增可选状态，默认 Memory 上界保持；宿主 store 应保留完整 binding。缺失状态以尚未记录初始化解释，不新增升级 session 兼容流程。配置校验与 schema 一致，轮数使用安全整数。

# 材料装配

## PR #244 后续：渠道命名空间归属

用户明确整个 extra.im 由 channel-gateway/channel-wecom 拥有，覆盖此前保留宿主同名 history 等约定。宿主静态配置与动态 loadContexts 的 extra.im 全部忽略，再由渠道构造；没有自动项的普通轮也不透传宿主项。稳定规则的可修改来源应在渠道内部按业务合同读取，不新增配置中心接入。全局 octo.control/instructions 保留现有特殊合并，其他合法宿主项保序保留。命名空间决定权和过滤策略均在 Channel Extra；通用 Host SDK loader 只提供显式选择入口，默认合并语义、协议、Core 和 Adapter 不变。

可执行性 98/100：Gateway 的 build_im_contexts 和 WeCom 的 buildContext 在宿主输入进入渠道材料前过滤 extra.im；Gateway dispatcher 统一清除外来稳定说明后按刷新计划生成，避免同名项抑制默认说明及错误清除待刷新标记。historyRetry 跳过重建，保留完整冻结快照。专项手动验证静态/动态碰撞、任意保留项、首轮/普通轮/周期/新 Provider/fresh fallback/冻结重试、全局指令顺序及输入不变；仅更新受合同变化影响的既有断言，不扩大 CI。

复审 P2：972ab40 在 contexts.load 完成后过滤，32 个宿主保留项加 1 个动态业务项会先触发合并预算，违反仅 warning 的合同。修复准备度 98/100：通用 mergeConfiguredContexts/createContextLoader.load 增加可选、同步的来源选择函数，每个来源先保留原有合法性与容量校验，选取后再执行原整项替换和最终预算；默认调用完全不变，通用代码不包含渠道命名空间。两个 Channel Extra 显式传入过滤函数，按两个来源实际忽略项累计 warning 数量。回调只执行一次、收到原完整配置，过滤仍在原 operation 及取消检查内，不另建池或重调宿主函数。手动补测双渠道静态/动态 32+1、单来源合法但合并超字节、真实业务超限仍失败、原输入不变及默认 loader 不过滤；不扩大 CI。

Gateway 的固定规则在请求装配处统一生成：`mention-instructions` 只含稳定说明，默认 `artifact-delivery` 只约定本地交付物的 Markdown 输出格式，`history-instructions` 只约定历史理解的总体意图目标。计划刷新时进入普通 Context；其余轮次仅供显式 fresh fallback 恢复输入使用，不进入普通续聊。

`message-trigger` 是真实消息的简短事实项，payload 包含 conversation、sender、recipient、sentAt、messageId、mentions；guidance 只用一句英文描述字段，不授予出站通知权限。身份批量查询最多 200 个 UID，发送者和接收 Bot 优先；超过查询上限的 @ 目标仍保留真实 UID，名称和类型标未知。失败不换接口补查，不按 @ 人数增加请求。history guidance 缩成一句材料说明，缺失事实合并为 history.note，原固定意图阅读原则放入稳定规则。

静态和动态宿主项先忽略整个 extra.im 命名空间，其他合法项完整保留。Gateway 的所有渠道材料由自身生成；不得从宿主同名文本扩大权限或改变注入时机。投递策略始终按真实可信配置计算，即便本轮没有 artifact 提示也继续正常交付。冻结卡片重试保存和复用该策略，避免重新读取配置改变原请求合同。

原 `addRulesRecovery` 接受所有本轮省略的恢复 Context，保留原 inputs/图片；普通续聊没有这些省略项，新 Provider 回退输入显式补齐。控制指令初始语义不变，不修改通用渲染或三个 Adapter 的注入策略。

# 格式与接入

只调整 Gateway 自有指引分段及数据形状，Core 原有真实换行保持。三种 Adapter 通过现有原生传输 fixture 核对收到的文本，而不是仅验证 Gateway 的请求对象。全局安装通过仓库 pack-release 脚本打包，避免 workspace 链接泄漏；先记录当前全局入口，构建产物后 npm install -g 对应 tgz，核对 `--version` 和 config-schema。安装不等于已运行服务自动更新，真实活跃进程状态另行检查并报告。
