---
type: Task
title: Issue 224 验证记录
description: 离线回归、原生会话记忆和未完成的真实 IM 验收分别记录。
tags: [session, testing, openclaw]
---

# 环境与范围

执行者 Codex，2026-10-28，macOS arm64，Node v24.19.0，pnpm 11.19.0。实施基线 `0ca12a03a055ccb766e6126716c51bb6cc6efe1c`，新 worktree `octo-runtime-issue-224`，分支 `feat/224-session-names`。以下原生验证针对本任务 dirty 实现；最终提交 SHA 由 PR 提交列表及审查记录固定。未合并、未部署。

规划准备度 96/100，见[评估](assessment.md)，不表示测试通过。读入规则清单见[context.yaml](context.yaml)。

# 独立 Non-gating Live Acceptance

手动执行 `node .octospec/tasks/224-session-names/verify-provider-live.mjs <provider>`，不接入默认测试或 GitHub status。只创建本次 QA 会话，禁止工具及消息发送；后两轮输入不含标记或历史文本，验证 Provider 自身记忆，不仅检查回执。

| Provider / 实际版本 | 三轮句柄 | 后两轮记忆 | 新逻辑会话 | 结论 |
| --- | --- | --- | --- | --- |
| OpenClaw 2026.9.4 / Gateway v4 | `agent:main:octo-dm-qa224-67988b3a-5866-4f4e-bf3e-a48e0ecff6c5-c1cfaa1b-9a1c-42cc-98db-e2ad533cb8a1` 保持 | 2/2 返回合成 marker | 同名另建独立 key，合计 2 次 create、2 次 describe、4 次 agent | PASS |
| Codex 0.164.0 app-server | `01a18220-ec1e-7ad0-837b-ade360bbb88f` 保持 | 2/2 返回合成 marker | 新句柄 `01a18221-223e-72f2-8703-3d8e5f2b0756`，只在两次 fresh 请求 thread/name/set | PASS |
| Claude Code 2.1.306 | `6656916a-a9c6-4f9f-8fb5-2c5061c27dd8` 保持 | 2/2 返回合成 marker | 新句柄 `44eea011-7cc8-497f-9da4-6d6e57b86bf0` | PASS |

OpenClaw 对不存在 key 的额外真实请求返回 `OPENCLAW_SESSION_NOT_FOUND`；create/agent 总数未增加，不做 fresh fallback。使用本机已运行 Gateway 与临时设备身份，不改 Gateway 配置或已有会话。保留 QA 原生会话作为审查证据，未删除用户会话；本次临时工作目录已清理。

Codex 的两条 QA 原生 session_index 记录均持久化了调用方 thread_name；CC 的两份 QA transcript 均持久化了 custom-title。只读取本轮 QA 会话，不记录凭据或其他用户对话。OpenClaw 名称直接出现在上述原生 key 中。

真实验证修正过两点：Gateway 9.4 不广告 sessions.resolve，改用已广告且源码确认只读的 sessions.describe；CC partial 模式的 final 文本来自 message.delta，验收脚本最初只收 message.update，修正后重新完成全部四轮。初次失败不计为通过。

真实 IM：**BLOCKED**。显式运行 `verify-im-live.mjs`，指定受保护 QA 账号文件中的 token 为占位值，未通过测试凭据检查；`octo-cli auth list` 返回 0 profiles。尚未发送 QA IM、创建话题或连接 Bot；DM/群/话题真实 Kernel→Provider→IM 回读没有执行，不能由上述 Provider 直连结果推定通过。脚本保留供有真实测试凭据时手动运行。

通用 ACP 的名称未应用及 session/load/new 为离线合同回归；本轮没有真实 ACP agent 验收。CodeBuddy/Grok/其他 Adapter 不新增标题映射，限制在双语文档的能力表明示。

# 源码与离线检查

27 个固定 OpenClaw commit 来自既有 Issue 40 版本表；`extract-resume-contracts.mjs` 通过 TS AST 生成严格请求字段子集，包括 describe 与两套 patch 字段，各版本 commit、路径及 SHA-256 在 `test-support/openclaw-resume-contracts.json`。不是 27 个真实 Gateway 验收。

初轮全量 2332 项：2234 通过、7 失败、91 跳过。其中 4 项是随机默认名称导致旧 parity 测试比较两次独立 UUID，已改为明确传名称以验证透传；2 项为新增 OpenClaw fixture 断言，已修正；1 项是已有未修改的 verification-command 测试误找到 Node 目录中的全局 octo-cli。本机复制同版本 Node 到无 octo-cli 的隔离目录，单项 8 通过、10 平台跳过，未改产品或该测试。

上述 6 项相关专项重跑 184/184 通过。随后全量 Node 2333 项中 2242 通过、91 平台/环境跳过、0 失败，WebUI 35 项通过；使用同版本隔离 Node 避免全局 octo-cli 污染既有缺失命令测试。此后新增名称边界和 legacy binding 回归分别经 38/38、17/17 专项通过。

`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm docs:check`、`pnpm lint:names`、`pnpm native:check` 通过。知识库 lint 使用临时 PyYAML 环境通过。首次 native:test 因缺少 Python venv 未执行 Python，用 `uv sync` 建好原生工程环境后重跑，Go/Python 45/45 通过。

# 同步 main 与审查

实施提交已 rebase 到最新 `main@5cc600e759daca3cae7eb3521d2e300389e80410`，纳入 Gateway 满载排队和 DSH 最低版本修复。仅知识目录冲突，保留双方任务入口；产品文件自动合并后检查了同代次队列与 reset 交互。

同步后 `pnpm typecheck` 重新构建成功，再运行相同的 `pnpm test:suites`：WebUI 35/35，Node 2362 项中 2271 通过、91 跳过、0 失败。lint、格式、docs:check 均重新通过。未修改既有全局 octo-cli 缺失测试，继续使用同版本隔离 Node。

双轴审查结果见[审查记录](review.md)。Standards 0 项；Spec 1 项 Unicode 分隔符与控制字符的 schema 差异已修复。新增用例在旧 schema 上先失败，修复后 3/3 通过；公开与内部两处 pattern 同步修正，跨语言生成产物重新生成并校验。没有未处理的审查发现。

最后一轮 schema 修复后，Go/Python 再次 45/45 通过；格式、文档、知识库与命名检查通过。提交前 fetch 确认 main 仍为上述固定点，相对该点的 workflow 与默认测试脚本 diff 均为空。

CI 范围约束：没有修改 workflow/job/matrix/trigger/gate，也没有默认开启真实专项。提交及 PR 前再次核对相对 main 的 workflow diff 与实际检查列表。

# PR 229 后续修正：ASCII 名称与三端一致性

以下记录为 2026-10-28 的历史合同与验证结果；名称限制已由下节 2026-10-29 的用户确认取代。

外部评审指出此前正则使用 RE2 不支持的前瞻，实际 Go codec 会拒绝合法名称；旧的 native 45 项没有覆盖 `sessionName`，因此此前通过不能证明该字段可用。本轮修复前直接用原生 driver 验证 `octo-dm-user-123`：Go 返回 false，Python 返回 true，确认 P1。

按用户最新明确要求，`sessionName` 长度 1–256，仅允许 `[A-Za-z0-9-]`。不再支持 Unicode 文本、空白、冒号或下划线，不改变 Provider opaque ID 的格式。公开和内部 schema 使用现有 `not` + `[^A-Za-z0-9-]`，避免前瞻、Unicode 空白语义以及 `$` 对末尾换行的差异；不扩展或特判 native 校验器。

新增一份 30 项共享名称 fixtures，JS 运行时与 AJV、Go、Python 共同消费；两种 wire 均覆盖。用例包括省略、合法字母数字及连字符、1/256/257 字符边界、空白、中文、emoji、U+FEFF/U+0085、换行及控制字符、非法类型。名称 JS 专项 8/8 通过；原生 Go 与 Python 各 418 项协议 fixtures 通过（各新增 60 项名称输入）。构建与类型、生成产物校验通过。

最终全量：WebUI 35/35；Node 2372 项中 2281 通过、91 跳过、0 失败；Go/Python 原生套件 45/45。lint、格式、文档、知识库及 native 生成检查通过。以 `971017d` 为固定点的双轴补充复审均无未解决问题；规范审查另行独立运行 Go/Python 各 60 个名称输入，需求审查独立运行 JS 8 项，均通过。真实 IM 与 ACP live 的未验收范围维持前述记录，本次没有重复声称真实验证或扩大 CI。

# 2026-10-29：调用方名称兼容与完整续聊复审

完整 PR 固定点 `dcca46fb0eaaa3be675432321f704de92dbdbce0`，审查 head `5514d832b7b5e1a11a6f63cb391283a3119d645e`。三个最新远端 review 指向同一 Gateway P1：地址是 opaque 值，直接拼入名称可能包含下划线、中文或超过 256 字符；前次仅收紧消费者而未验证生产者，导致请求在 Core 校验处失败。新增真实调用 `prepareInvokeInput` 的渠道回归，在旧实现上两项均失败后修复。

用户确认公共名称仅限制非空白、长度与控制字符。当前长度为 1–256 Unicode 码点，允许标点、中文及文本中空格，拒绝 C0/DEL/C1 控制字符。TS、公开/内部 schema 和生成代码同步；显式空白集合对齐 TS trim，避免三端 `\s` 差异或 RE2 前瞻。38 项共享名称 fixtures 覆盖两种 wire；Go/Python 各 434 项协议检查通过。Gateway 在调用方内截短展示片段至各 80 码点、替换控制字符并保留完整随机后缀；旧非法名称可修复，不改变业务 session、generation、scoped binding 或原生句柄。渠道测试涵盖长 DM/群/话题地址、标点/中文、控制字符、跨轮、旧坏名修复及 `/new`。

规范审查另复现一项 P1：复用原生 session 时，派发前收到的旧无 runId 审批被本轮接纳。官方本机 OpenClaw 2026.9.4 的 exec-approval 实现允许 runId 缺失并广播 null；旧本地审批桥关闭不会删除原生 pending。新增回归在旧实现上返回 `stale-broadcast` 而不是本轮 `native-1`。修复后派发前的旧 ID 有界登记并过滤后续重播；本轮派发后新的无 runId 实时审批仍可处理。若旧无 runId 审批在派发后首次出现、此前快照及广播均未见，或并发共享同一 key，原生字段不足以严格判定归属；本修复不承诺消除这种歧义。新的真实人工审批操作没有执行，审批验证为实际 Adapter/bridge 加 native client 替身。

全量本地 Node 2375 项：2284 通过、91 跳过、0 失败；WebUI 35/35；Go/Python 原生套件 45/45。`pnpm typecheck`、lint、命名、格式、docs、native 生成校验通过。全量继续使用同版本隔离 Node 规避既有全局 octo-cli 污染。两个独立审查者复核均无新的高置信度可修复缺陷：规范审查独立运行 targeted 10/10 和各原生 codec 76 名称输入；需求审查独立运行名称/渠道 19/19、审批 7/7。

通过手动入口 `verify-provider-live.mjs <provider> 'qa224:dm_中文-1'` 重验三家 Provider：OpenClaw 2026.9.4、Codex 0.164.0、CC 2.1.306 各三轮同句柄、后两轮记忆 2/2，同名 fresh 独立句柄；OpenClaw 缺失 key 仍明确失败且不派发 agent。首轮句柄分别为 `agent:main:qa224%3adm_%e4%b8%ad%e6%96%87-1-c37a32fc-455e-48f9-9c29-3acd81afc18d`、`01a1837b-e865-76f3-9673-be66d829f8e5`、`f48d54a3-1ed2-4a22-b8e3-1608c3b83718`。不操作已有用户会话、不发送 IM；本次未额外检查 CC 持久化标题，不能把前轮标题检查算成当前名称的证据。真实 IM 和通用 ACP 验收限制不变。

旧 head 的远端检查列表已核对：六个平台/Node 组合中的五项通过，Ubuntu Node 26 构建运行 30 分钟后取消，CI Gate 因此失败；日志未报告名称校验错误，不能据此认定超时由 sessionName 导致。提交前相对目标基线 `.github`、`package.json`、锁文件无 diff；保留原有 CI 范围。

# 2026-10-29：同步 main 与关闭延迟首次出现的审批缺口

用户要求更新 main、处理冲突，并询问 Jerry-Xin 与 yujiawei 同时提出的 delayed first-seen runless P1 如何修复。先快进保留远端已有 `45041cf`，再合入 `origin/main@1dd5a09` 为 `fa42979`。冲突在 `.octospec/log.md` 与 Gateway 文件顶部：同时保留双方日志、名称生成函数以及 main 的准备期安全错误映射，没有重置外部提交。构建/类型通过；渠道/存储/准备错误/Retry-After 手动相关回归 193/193 通过。

两条最新评审均针对同一真实问题：旧审批直到本轮 agent 派发后才首次出现，且没有 runId；上一节的前置快照/旧 ID 过滤无法识别它。此前仅将其写成剩余歧义不足以满足授权边界，本节修复取代上一节“本轮新无 runId 实时审批仍可处理”的无条件说法。回归先在旧实现出现 3 项失败，均将 `interaction.requested` 暴露为本轮事件，而预期为 `run.failed`。

当前决定不再根据时间、snapshot 完整性、toolCallId 猜测归属：续聊派发后首次出现的无 runId 审批在进入队列/交互桥前失败，报告 `OPENCLAW_APPROVAL_RUN_UNVERIFIED` 并沿既有路径请求取消当前 Run；不回复该审批，不切 full_access，不新建 session。ask/full_access 均受此检查。派发前已知旧 ID 及其重播仍忽略；匹配本轮 runId 的审批照常处理；fresh 独立随机 session 仍支持无 runId。取消仅断言发出 `sessions.abort`，不以此声称 Provider 已确认终止。

兼容代价已向用户明确：若原生 Gateway 对合法当前审批也不提供 runId，该续聊审批路径同样失败。普通不触发此类审批的续聊仍复用原句柄。真正兼容这类原生版本需要其提供可靠的逐轮关联；不能以自动放行、换 session 或客户端时钟阈值掩盖缺失信息。

新增/调整审批回归覆盖迟到旧审批在 ask/full_access 下不发布交互、不发送 resolve、一次请求取消；合法当前无 runId 也明确失败；fresh 无 runId 保留；续聊匹配 runId 的人工/自动审批正常。审批 12/12 通过，两位独立审查者分别重跑 12/12 且无新高置信度问题。既有 OpenClaw 合同及连接专项 159/159 通过（增加最后一项 full_access 正例之前的运行）。全量 WebUI 35/35；Node 2381 项中 2290 通过、91 跳过、0 失败。lint、格式、docs、native 生成检查与 diff 检查通过。

知识库全仓 lint 因 main 已有的三份 Issue 137 文件缺 YAML frontmatter 失败：`tasks/137-adapter-protocol-support/brief.md`、`review.md`、`journal/shared/2026-10-29-137-adapter-protocol-support.md`。这些文件相对 origin/main 无差异；本轮不改其他任务的文档元数据，不把此项记录为通过。未重新执行真实人工审批或扩大其他真实验收结论，IM/ACP 限制维持。相对最新 main，workflow、package 脚本和锁文件无 diff，专项继续只在本地显式执行。
