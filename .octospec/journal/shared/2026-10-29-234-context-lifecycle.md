---
type: Journal
title: Issue 234 稳定 Context 周期与动态 actor 分离
description: Gateway 局部生命周期修复、本地三 Adapter 输入验证及全局安装记录。
tags: [channel, context, session, testing]
timestamp: 2026-10-29T18:02:00+08:00
source: self
---

18:02 用户要求修复复审 P2，并明确宿主 extra.im 必须在合并前过滤。972ab40 合并后过滤会使合法的 32 个保留项加 1 个业务项先因预算失败；通用 loader 现支持显式来源选择，策略仍由两个 Channel Extra 提供，来源校验后过滤，再按有效项合并及校验。完整配置副本、单次回调、默认合并、原始来源合法性与共享在途/超时/迟到结果保护保持。旧构建复现失败后，新构建完整 Node 2290 通过、91 原条件跳过、0 失败，手动专项77/77、WebUI35/35；build/类型/lint/命名/格式/docs 通过，双轴复审 Standards 0、Spec 0。Octospec lint仍仅Issue137三份既有错误。未扩大CI或安装重启，按授权提交推送并更新PR；详见[验证记录](../../tasks/234-context-lifecycle/validation.md)。

17:41 用户明确 extra.im 整个命名空间由 channel-gateway/channel-wecom 拥有，宿主静态/动态项均忽略，即使本轮没有渠道同名项；可修改规则应由渠道内部按业务合同读取，不新增配置中心接入。全局 octo.control/instructions 保留既有特殊合并。已先回写 rules 和设计，再修改渠道构造边界与稳定说明装配；误配只 warning 记录数量，不阻断 AgentRun，不输出内容；冻结重试复用渠道快照。完整 Node 2381 项中 2290 通过、91 原条件跳过、0 失败，WebUI35/35、手动专项74/74；build/类型/lint/命名/格式/docs 通过。用户授权 commit；本次不全局安装、重启或扩大 CI，原真实群聊验收不冒充本次修复在线验收，详见[验证记录](../../tasks/234-context-lifecycle/validation.md)。

16:34 PR #244远端四个Linux/macOS检查因旧目录覆盖测试空值访问失败，Windows两项成功；已在本地复现并修复已有测试的Schema分支过滤，完整集合相等断言仍保留。用户要求检查其他问题，本地完整WebUI35/35通过，默认Node首次仅剩已知全局octo-cli污染“未安装”断言；用相同Node二进制独占目录重跑完整2381项，2290通过、91原条件跳过、0失败。Context联合260、专项68、Go/Python各434协议fixture，以及类型/lint/命名/格式/docs/native漂移检查通过。产品代码和CI范围未变，用户真实群聊验收状态保持；详见[验证记录](../../tasks/234-context-lifecycle/validation.md)。

16:09 用户授权提交 PR，并明确确认“真实群聊效果我已经真实验收了”。当前实际群聊验收记为通过，由用户吕思佳执行；已安装产物仍为15:59构建，未因文档更新重装。逐场景日志和原生版本未补充，不扩大为全Provider/压缩矩阵实测。目录、brief/design和validation同步验收状态；提交前lint、命名、格式与native生成漂移检查通过，CI范围不变。原配置和在线服务不作额外改动。

16:06 用户要求上面修改同步Octospec和docs架构约束。本轮仅回写文档：架构新增Channel Context生命周期与历史预算，Context/reset/无状态规则统一最近20条、完整messages数组8000 Unicode码点及同次恢复共同预算；修正reset的旧无缺口/下一轮fallback表述和架构中旧产物目录/preset判定。中英文架构、会话指南及Extra说明同步，明确稳定30轮刷新、动态事实、首轮保留自身与正常续接有限省略均归Gateway。docs:check及4/4执行示例通过，diff检查通过；Octospec lint仍仅Issue #137三份既有错误，CI范围未改。未重新build/install/restart，运行版本仍为15:59交付，详见[验证记录](../../tasks/234-context-lifecycle/validation.md)。

15:59 根据用户最新要求，历史窗口最终提高到最近 20 条、完整 messages JSON 最多 8000 Unicode 码点；保留消息结构、身份时间和保守过滤，不新增配置。查询规划和格式化复用同一条数常量，原有边界测试更新为 19/20/21，服务端返回 25 条仍选最近 20。相关回归 501/501、build/lint/格式/docs/diff 检查通过，无 CI 范围变化。已打包、全局安装并在空闲时重启 Gateway：构建 `2026-10-29T07:56:57.902Z`，PID `36647`，6/6 Bot 在线、内核可用、任务/队列为空且无错误。安装的两修改模块与编译产物一致，6000 字符正文完整保留、超长 JSON 精确截断至 8000，25 条输入保留最近 20 条。未改配置、reset、提交或推送；产物哈希和验收边界见任务验证。

15:50 用户决定先直接把完整历史 messages JSON 预算从 1500 提高到 3000，保持最多 15 条及现有结构，不引入参与者表、字段压缩或新配置。格式化器、原有断言、当前规则与中英文文档已同步；相关回归 501/501、build/lint/格式/docs/diff 检查通过，无 CI 范围变化。重新打包并全局安装，构建 `2026-10-29T07:47:40.896Z`；安装模块与编译产物匹配，实测 2000 字符正文完整保留、超长 JSON 精确截断到 3000 码点。空闲重启 Gateway 为 PID `27606`，6/6 Bot 在线、内核可用、任务/队列为空且无错误。未改配置、reset、提交或推送；详细版本和产物哈希见任务验证。

15:35 用户要求重启 Gateway，空闲检查后成功执行。PID `78649 → 16097`，六个 Bot 全部 online，内核可用，任务/队列均为 0，无错误；新进程核实使用 Node 24 全局入口，构建 `2026-10-29T07:27:42.116Z` 的保守历史修改已加载。未改配置、reset 或重装服务定义，人工群聊验收待用户执行。

15:32 用户授权开始修改、code-review、build/install 后，保守历史选择已实施并全局安装。单独准备度 96/100，产品只改 Gateway；正常耗尽且 completed 后的 final 正文及关联文件卡经成功位置和内容指纹核对才在普通接续省略，首轮/reset/补位/未知等保留。同次原窗口和预算拆为主历史/恢复补充，两个 Codex fallback 在实际 turn/start 输入均取回已排除消息，不重复当前 query。Standards/Spec 双轴审查无未解决问题，职责注释建议已修正；相关回归 501/501（新手动专项 25 项）及 build/类型/lint/docs/diff 检查通过。Octospec lint 仅 Issue #137 三份既有错误，未扩大 CI。

版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T07:27:42.116Z`。tgz SHA-256 `1d2b8b8967c363b98c66eac10e0a6d1ce8d073f8f09f04904799ac8701902c0f`；八份全局安装模块与编译产物匹配，全局模块冒烟通过。此次未重启服务、改配置、reset 或提交/推送，常驻 Gateway 尚需重启才加载新构建。人工群聊验收未完成，见 [验证记录](../../tasks/234-context-lifecycle/validation.md) 与 [双轴 review](../../tasks/234-context-lifecycle/conservative-history-review.md)。以下为早先规划和交付记录。

15:08 用户报告新子区历史重复出现自身 MD 文件卡与上一轮正文，确认当时仅继续 Octospec 规划、策略尽量保守，并限定只在 channel-gateway。已新增 [保守历史规划](../../tasks/234-context-lifecycle/conservative-history-plan.md)，同步 brief/design/assessment 与渠道规则、目录：首轮窗口保留自身消息，正常连续 delta 才可按具体输出归属及覆盖证据有限排除；补位、reset/new、fallback、失败/未知、过期/淘汰及缺凭据均保留。不以 UID、正文或 URL 全面去重，不改 Core/Kernel/协议/Adapter，不继承原 97/100 评分自动实施。列明当前 localOutputSeqs 仅能证明发送位置、混合 gap 未逐条排除、无请求快速路径和本轮 fresh fallback 恢复的风险，设计 CH-01 至 CH-13 验收；无法在 Gateway 内保证的路径默认保留。当时产品源码、测试、安装和运行服务均未修改。

15:10 用户询问代码改动应较小，规划已明确最小改动优先：复用既有会话与输出位置，少量适用条件和逐消息筛选；无证据直接保留，不为覆盖更多场景新增历史管理系统。文档检查仅剩 Issue #137 三份既有 frontmatter 问题，没有新增文档/链接错误；git diff --check 通过。本轮未运行行为测试，未改产品源码或部署。

14:48 用户要求重启，已在确认 Gateway 工作和队列为空后依次重启 Kernel 与 Gateway。Kernel/worker/Gateway 新 PID 为 `78466/78468/78649`，内核就绪、Gateway 可连接内核、6/6 Bot 在线、工作与队列为零且无错误。进程命令使用刚安装的全局目录；未启动未安装组件、未改配置或重置会话。既有服务定义 drift 未变。

14:46 按用户要求重新编译、正式打包并全局安装，均成功。版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T06:45:36.583Z`，tgz SHA-256 `d39cb91ee8b20b9f46c3a9f46ea86f8b31fadd2882a86ee46a891d060de48b03`。全局入口版本及七份关键文件哈希匹配，安装包 OpenClaw Adapter 导入成功。本次未重启服务，未修改配置、提交或推送；远端能力仍为 P2 待办。详细证据见[验证记录](../../tasks/234-context-lifecycle/validation.md)。

14:40 用户确认远端 OpenClaw 的产物位置判断及文件引用转换由 Adapter 负责，Gateway 保留交付限制和 IM 投递；指定 `127.0.0.1`、`localhost`、`0.0.0.0` 为本地主机，不能用 agentSource 或 WS 推断。最新优先级改为 P2、场景少、暂缓实施，覆盖此前 P0 提议。已建立 [Issue #243](https://github.com/Mininglamp-OSS/octo-runtime/issues/243)，记录 [待办及未决接口](../../tasks/234-context-lifecycle/remote-artifact-backlog.md)，回写架构/OpenClaw/渠道规则，并在 Adapter 连接解析与 final 出口各留一条 TODO。当前仅文档与注释，不代表远端转换已支持，不需重新 build/install 或重启；父 Issue #234 仍为 P0。

文档及 TODO 校验：Prettier、单文件 ESLint 和 diff 检查通过；Octospec lint 仅剩 Issue #137 三份既有 frontmatter 问题，无新增文档或链接错误。GitHub 核实 #243 为 P2、#234 仍为 P0，CI 范围无差异。

14:20 本地 OpenClaw 实测 MD 被 remote-file-unavailable 拒绝，定位为 Gateway 将 preset 来源直接映射为文件不可读。用户要求 final 本地 Markdown 路径都按实际文件系统尝试，不为其增加配置；已移除产物 locality 推断，默认不额外限制到工作区，原显式目录限制保持，不改变 OpenClaw 工作区。先前拟设置 allowed_roots 的办法撤回，未写入用户配置。

相关回归 476/476、build/类型/lint/docs/diff 检查通过；用户实际 MD 本机读取 2091 字节，stub 上传准备一张文件卡，未真实上传或发消息。正式打包、全局安装并空闲重启 Gateway 为 PID 53073，6/6 在线、Kernel 可用、任务/队列为空，三份安装模块哈希匹配，五份配置哈希不变。构建 `2026-10-29T06:14:55.152Z`，产物 SHA-256 `9c565e48befbd70b1f7460a1b87515a40b2e7d03bb8972a3784422eb5b7679c6`；决策已英文追加 Issue 评论。无提交、推送或 CI 范围变化，真实 IM 验收待用户。

用户进一步指出 agentSource 来源于早期架构，大量破坏性变更后应重新评估。当前引用主要用于工作区默认/校验、preset 目标校验、Adapter 准入和协议传输，与 OpenClaw workspace=false 元数据重复。附件读取已解除依赖，不因引用存在主张保留；字段本身尚未删除。以下为早先记录。

13:59 用户确认将历史缺失说明合并至 history，删除模型侧独立自动 history-gap，现已实施。正常历史仅有 messages，异常按需加一句英文 note；无正文时可用空消息数组。Gateway 内部缺口与游标、预算降级及冻结重试保持，note 不构成正文交接证据，显式宿主项原样保留。准备度 97/100；相关 471/471、build/类型/lint/docs 检查通过，预算夹具因合并少占一个 Context 改为实际字节施压后验证通过。规则、Octospec、示例及英文 Issue 评论已同步。

正式打包及全局安装完成，构建 `2026-10-29T05:55:03.542Z`，产物 SHA-256 `a59217ec3df30db9823a6d6f6b04a1103dc23d5e76fbf2fae6add332afc7082a`。安装模块哈希与构建匹配，直接导入全局包冒烟通过；空闲重启 Gateway 为 PID 36252，6/6 Bot 在线、Kernel 可用、任务/队列为零，五份配置哈希不变。无提交、推送或 CI 范围变化；真实模型群聊待用户验收。下文 13:50 的讨论状态由本次决定取代。

13:50 按用户修正补齐消息时间：历史 messages、嵌套引用/转发和当前触发 sentAt 使用原始发送时刻与系统时区，输出显式偏移，例如 `2026-10-29T13:36:53.000+08:00`；时间未知为 null，不伪造当前时间，截断保留时间。相关回归 470/470、build/类型/lint/docs 检查通过；多时区与夏令时检查、真实测试 API 只读核对通过，未发消息或调用真实模型。已全局安装，构建 `2026-10-29T05:46:37.286Z`，Gateway 空闲重启为 PID 28477，6/6 在线、任务/队列为空，Kernel/worker 保持 72774/72826。六份安装模块哈希匹配，五份配置哈希不变，产物哈希见任务验证。已同步英文 Issue 评论，未提交或改变 CI 范围。

用户询问 history-gap 是否必要；当前评估是内部状态需保留，模型侧独立 Context 可以精简，仅在实际历史不完整时简短说明。当前实现未删除该项，此处记录讨论而非已接受决策。以下为早先记录。

13:36 用户再次要求重新 build/install，全流程构建、打包、全局安装成功，当前构建 `2026-10-29T05:34:35.848Z`。Gateway 空闲重启为 PID 17319，6/6 Bot 在线，Kernel 可用，三份关键模块哈希与构建一致，五份配置哈希不变。未修改产品源码，未重复未受影响的测试，未提交或推送。详细产物哈希见任务验证记录。

13:33 历史指引收敛为三个总体目标：结合前文理解当前意图、遵循最新相关修正、不因历史重现而重启旧任务，删除六句中的具体做法及加载/工具流程。history-gap 保留两个可用性事实字段，不给补查步骤。两个 near-budget 夹具因提示缩短调整填充量后，相关 86/86 回归通过，build/lint/格式检查通过。全局安装并核对实际指引，构建 `2026-10-29T05:30:03.594Z`，Gateway 空闲重启为 PID 14415，6/6 在线，配置哈希不变。Octospec 和 Issue 评论已同步，无提交或 CI 范围变化；真实模型验收待用户。以下为早先记录。

12:52 产物说明收敛为输出格式：如果最终交付物是本地文件，final 使用绝对路径 Markdown 链接，图片带 !。默认 channel 指引不再包含上传实现或指挥/禁止工具调用的语句；后处理与显式 tools 模式保持，用户明确要求 octo-cli 仍按正常 ToolCall 执行。已同步设计、渠道规则及 Issue 评论。48 项相关回归通过，build/lint/格式检查通过，全局安装并验证实际指引。最新构建 `2026-10-29T04:45:26.831Z`，Gateway 已空闲重启为 PID 80709，6/6 Bot 在线，五份配置哈希不变；未改 CI 或提交。下文为早前记录。

12:39 频道字段命名修正已交付：message-trigger.conversation.id 保留原始频道 ID，type 统一 dm/group/group_topic；子区完整频道 ID 与 parent group/topic 短 ID 分别表达。Octospec、渠道规则、示例和文档同步，三种频道断言与真实只读子区验证通过，相关回归 468/468 通过。再次全局安装并重启，最终构建 `2026-10-29T04:36:41.637Z`，Kernel/worker/Gateway PID 为 72774/72826/72889，6/6 在线且空闲，五份配置哈希不变。已英文追加 Issue 评论，未提交或扩大 CI；人工模型验收待用户执行。下文为较早交付记录。

12:28 后续要求已实现并纳入 Octospec：message-trigger 使用一行英文说明，真实 API 补全群/子区与发送者姓名/类型，失败保留 ID 并以 null/unknown 继续 AgentRun；可信 UID/Bot ID 身份在各 Bot 内存中固定缓存十分钟，按 API/Bot/Space 隔离、最多 2,000 项，失败不缓存。历史改为旧到新的 messages 数组，文本也统一使用带 type 的 content，引用、转发、图文顺序分别保留，媒体明确 read=false，不下载。模型可见 history-gap 只含 status 和 earlierMessagesOmitted，内部游标及交接证据不入模型。嵌套与完整 JSON 大小均有界。新增结构示例、缓存与失败专项均在 manual 中显式运行，未扩大 CI。

本轮相关回归 468/468 通过，build/类型/lint/命名/文档/生成源检查通过。真实测试 API 只读验证人和 Bot 身份、群名、子区名通过，未发消息或调用模型。已重新全局安装并重启全部已安装服务，最终构建 `2026-10-29T04:25:48.893Z`，Kernel/worker/Gateway PID 为 63889/63890/64169，6/6 Bot 在线，任务/队列为空，五份配置哈希不变，六个关键模块与全局安装文件哈希一致。真实群聊模型验收待用户执行；下文为早先交付记录。

11:46 后续验收修正：群规则指引明确写为 `Octo IM Group's GROUP.md`，话题为英文 `Octo IM Group Topic Rules`。内部来源与版本只留 Gateway，自动规则通过通用、显式的文本格式将原始 Markdown 放入 CDATA，因此本次后续也修改共享协议和 Core，生成的 TS/Go/Python 同步。群聊只带群规则，子区带父群和子区规则；trim 为空或 404 不省略，输出 `NO RULES` 并撤销旧规则。Context 结束与输入之间加 `<!-- Query Input -->`。最终相关回归 499 通过，Go/Python 各 434 个协议 fixture 和手动文本 codec 验证通过。按用户最新要求再次完整构建、打包、全局安装及全部服务重启，最终构建 `2026-10-29T03:44:46.621Z`，Kernel/worker PID 为 27356/27357，Gateway PID 27481，6/6 Bot online，五份配置哈希不变，全局安装模块联合自检通过。最新决策已追加到 Issue 评论。下文为 10:40 首次交付时的历史记录，后续范围以本段和任务验证为准。

[Issue #234](https://github.com/Mininglamp-OSS/octo-runtime/issues/234) 按用户决策完成：稳定 mention、产物交付和历史阅读规则在首轮与可配置周期注入普通 Context，默认第 1/30/60 轮；每轮 actor/mention 保留为独立的一句话数据说明。规则全文及事实不再混装，历史材料仍按原缺口策略加载，宿主显式 Context 不作通用去重。群规则保持权威查询和版本刷新，周期轮额外重带当前版本。

状态保存在原有有界 binding，排队共享、reset 换对象，准备/展示前失败不消耗首轮；自动及冻结卡片重试不增轮，可信未提交回退，失败刷新待补，成功耗尽源流才确认。普通续聊省略的规则放入既有 fresh fallback 备用输入；卡片重试冻结 Context、恢复输入与真实产物策略。无需修改 Core 或 Provider Adapter，三 Adapter 的续聊输入 fixture 均验证规则与真实换行。

用户授权新 worktree、Octospec 规划、准备度超过 95 后实施、build 和全局 install；未授权提交、推送、PR 或合并。准备度 97/100 是实施前工程判断。相关回归 433 通过，最终专项 13 通过；全仓 Node 2381 项有 1 项本机 `octo-cli` 已安装导致的既有失败，已在未修改主工作区复现，其余 2289 通过、91 跳过。真实 im-test 只读身份、群规则、历史和用户 Key 搜索通过，不冒充真实模型/IM 发信验收。

发行脚本打包的 tgz 已全局安装；源码与安装产物哈希一致。空闲重启 Channel Gateway 后 PID 72716，6/6 Bot 在线，Kernel 可用，5 份配置哈希保持一致。产品代码只在 Gateway，未扩大 GitHub CI，专项手动运行。Octospec 全仓 lint 另有 Issue #137 的 3 份既有文档缺 frontmatter，本次未修改；不声明全仓检查全绿。完整命令、Context 时机表、失败边界及用户验收项见[任务验证](../../tasks/234-context-lifecycle/validation.md)，稳定合同回写[渠道规则](../../rules/channel-integration.md)。
