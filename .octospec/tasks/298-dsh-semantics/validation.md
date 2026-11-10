---
type: Validation
title: DSH 298 Windows 本地验证
description: 记录修复前后消费证据、双 Node 专项、真实握手与全量遗留失败。
tags: [adapter, testing, windows, canonical]
---

# 基线和环境

2026-11-09，Windows 11 企业版 build 22621 / x64，PowerShell 7.6.5，普通用户，Codex CLI 0.163.0。独立 clone `work/octo-runtime`，分支 `fix/298-dsh-semantics`，基线 `157fabb7d680df1ee72d9d9e5ed40cfc6c22b336`。源码版本 0.0.0，构建带 dirty；没有发布修复产物。

验证使用 Node 24.19.0、26.13.0，Runtime pnpm 11.19.0；独立 Gateway 使用 pnpm 11.25.0。原 shell 默认 Node 22.14.0 不作为受支持版本的验收。建议的 Node 24.22.2 zip 实际不是有效 ZIP，改用已确认可运行的 24.19.0，无需修改全局安装。

Runtime 最新稳定 v1.1.12 指向 `4276f6d339461daa88c3215b8024d548eb313cb1`；该 tag 到本次基线的 DSH 两个实现文件无差异。#329 已合并；实施前及 PR 交付前核查时 #298 开放、无评论，没有关联修复 PR。Gateway 源码基线 `7c03559ffee9c8475b31e2ced4c30838d0f6d1b7`，公开 client 1.1.12；GitHub latest release 与 npm Gateway 查询均为 404，不能声称独立 Gateway 已发布。

DSH 官方 SDK 0.2.1-rc.5；实际依赖中的 CLI 同为 0.2.1-rc.5。精确包合同见 native-mapping.md。另获取并比对 rc.4 的 agent-loop 发行 JS，commit → executeToolCalls → step/end 的关键顺序一致。

# 修复前后

证据位于本会话 outputs：before-card.json、after-card.json、after-card-node26.json、card-evidence.html。均为明确标注的 fixture；HTML 只是实际生成卡片数据的审查展示，不冒充产品截图。

同一合成原生输入包含公开说明、两个工具（逆序返回，一个 failed）、child、最终 root 文本。

| 观察 | 修复前 | 修复后 |
| --- | --- | --- |
| 第一次 tool_call.create 时 finalText | 我将检查文件。 | 空 |
| 工具步骤标题 | 模型处理 | 分析并调用工具，部分失败 |
| 最终步骤标题 | 模型处理 | 整理回答 |
| ImRuntime replyFinal 端口调用 | 一次，但正文混入中间说明 | 一次，仅“检查完成。” |
| 工具耗时/状态 | 30ms completed、10ms failed | 相同 |
| root final 混入 child 或 private reasoning | 无 | 无 |

通过未修改的官方 SDK 运行协议 fixture → 实际 Adapter → Core → 独立 Gateway projector / buildReasoningFrame；再以捕获的 canonical 走实际 ImRuntime 的终局选择与 replyFinal 调度。连接器与发送端口被替换，不请求 IM。修复前消费也以 HEAD 原始 TS 编译 JS 复放，结束恢复修改后的构建；源码不回退。不是新模型执行或捕获的真实原生样本。

# 检查结果

| 命令 / 场景 | 实际结果 |
| --- | --- |
| Node 24 `pnpm install --frozen-lockfile` | 通过，独立本会话依赖 |
| `pnpm format:check`、`pnpm lint`、`pnpm lint:names` | 通过 |
| Node 24 `pnpm typecheck` | 通过，包含完整 workspace build |
| Node 24/26 `node --test test/manual/dsh-semantics-298.test.mjs test/dsh-adapter.test.js test/dsh-launch.test.js test/dsh-sdk-boundaries.test.js test/cli-dsh.test.js` | 两次各 127 项：122 passed / 0 failed / 5 skipped |
| 手动专项独立再跑 | 11 passed；覆盖多步骤、多工具、多 turn、final-only、chunk/commit/stream 对齐、失败、取消、子会话、重复/冲突 seq、未闭合/错 receipt、重复 commit/finish、字节及 4096 条边界 |
| 真实 DSH `--version` 与 opt-in `test/dsh-native.test.js` | 0.2.1-rc.5；官方 SDK probe/initialize 1 passed / 1 skipped，不请求模型 |
| `python .octospec/scripts/lint.py` | 通过；本任务隔离安装 PyYAML，后续补齐记录后重验 |
| `node scripts/check-developer-docs.mjs --scope current` | 161 文档、1561 链接、38 fragments，0 errors |
| `git diff --check` | 通过 |

专项的五个既有 skip 为两个 POSIX CLI 条件及三个 POSIX 进程组/后代确认条件；不把它们记作 Windows 真机通过。真实原生测试的首项需要额外 PATH shim，因此明确 skip。

PR 交付前的增量：手动 fixture 直接运行判断使用 pathToFileURL，已在空格/中文原生路径探测版本；Node 24/26 各重跑手动专项 11 passed，命中的 Prettier 检查与 Octospec 元数据检查通过。生产实现没有新增变更，不重复整套已记录的检查。

Gateway 默认 TS 7.0.2 构建失败：可选 `@typescript/typescript-win32-x64` 下载未安装，日志保留。为消费验证，使用本会话 Runtime 安装的 TS 6.0.3 对原样 Gateway 源码完整编译，成功后加载实际产物；Gateway 生产依赖仍为其独立安装的公开包，没有 workspace link，也没有更改 Gateway 源码/锁文件。不能把此结果表述成其 TS7 默认门禁已通过。

# 全量失败与归属

第一次 Node 24 `pnpm test:suites`：1608 tests，1533 passed / 12 failed / 63 skipped，226 秒；未将全量记为通过。

最初没有先设置任务专用 TEMP，默认 TEMP 的 8.3 别名及继承 ACL 影响部分断言。这是执行准备失误。随后仅创建并保护本任务 `work/verification-state-298`（在两个 checkout 外），为后续测试设置独立 TEMP/TMP，不修改全局环境或用户 Home。78 项失败文件复跑为 72 passed / 6 failed；MCP/file ACL、Grok/Playboard 路径断言已恢复。

保留的六项：agent-env-invocation 的 3 个 `/tmp/...sock` 在 Windows 被 IPC_ENDPOINT_INVALID 拒绝；OpenClaw CLI 重启的 2 个 ORPHAN_CLEANUP_INCOMPLETE；Windows Codex npm shim 用例的退出 PID 断言 1 项。相关源码和测试均与 HEAD 相同，未改动；暂时恢复 HEAD 的 DSH 构建 JS 后复跑这 21 项仍为 15 passed / 同样 6 failed（baseline-existing-failures-node24.log），随后恢复修复 JS 并重跑 DSH 手动专项 11 passed。不扩大本问题去修复这些路径。

安装初期过早启动检查曾与 pnpm install 竞争而出现 EBUSY，待安装退出后顺序重跑通过；不把该失败误归产品。后续没有并行 build clean 与测试。仅验证本次拥有的资源；完成后按命令行归属检查，无该 checkout 的残留 Node 进程；未停止日常实例或杀全部 Node。

# 未验证与风险

真实 DSH 模型/账号、脱敏真实事件样本、实际 IM 卡片 payload 回读和截图、服务端唯一送达、macOS/Linux、新发行安装均未验证。原生握手不能代替模型 turn。仅工具 concluded 而无后续无工具回答会保守返回 DSH_NO_FINAL_OUTPUT；纯 final 的文本延迟到活动终局，保留 chunk 边界而非承诺实时 final。上游 SDK 解析前内存和完整工具后代清理仍不在本次保证内。

本地验证完成后，用户已追加授权 commit、push 并创建关联 PR。交付前重新 fetch 确认 main 仍为 `157fabb7d680df1ee72d9d9e5ed40cfc6c22b336`；向上游 main 提 PR，以 Refs #298 关联，不自动关闭 Issue。未执行合并、发布或 CI 门禁扩展。本文通过结果对应上述源码基线加本次工作树；正式提交与托管检查结果由 PR 另行记录。

# PR #340 中断候选评审验证

复核对象为评审指定提交 `3a85e069be20ba996972760e5726c5d4684adef9`。修改前先运行评审所述 `assistant/message.interrupted=true → step/end → turn/end.completed`，实际 final 事件为零，finish 报 DSH_NO_FINAL_OUTPUT；原提交已在 step/end 将 interrupted 候选排除。

本轮只增加两项手动回归及 fixture，并更新任务核查记录。生产源码与上述提交逐文件 diff 为空；未合入新主干、未修改 Gateway 或六项遗留失败。

| 验证 | 实际结果 |
| --- | --- |
| 直接 trajectory 的 completed/interrupted 组合 | 无 final，DSH_NO_FINAL_OUTPUT |
| 未修改官方 SDK → Adapter → Core 的同一组合 | 无 final，唯一 run.failed，failure.reasonCode=DSH_NO_FINAL_OUTPUT |
| 构建 JS 负向注入：仅移除既有 `!step.interrupted` | 两项新增回归都失败；finally 恢复原产物 |
| Node 24.19.0 / Node 26.13.0，四个既有 DSH 文件加手动专项 | 各 129 项：124 passed / 0 failed / 5 既有 POSIX skips；手动专项各 13 passed |

独立 Gateway 测试通过 OCTO_GATEWAY_CHECKOUT 显式启用；没有该环境时 skip 是既有手动合同，本轮不把它加入 CI。仍为 fixture 验证，没有增加真实模型或 IM 请求。前述全量失败和真实验收缺口继续有效。

# 2026-11-10 实际 child 活动修复验证

复核 `04bdb746` 的重复 child 终态现象成立，但生命周期分支在修复前基线已相同。官方 rc.5 的 lifecycle factory 为两个合法运行生成不同 runId，实际 SDK notification callbacks 却输出相同 started/finished 载荷；cold resume 会重新 announce 同一 durable session，不能永久屏蔽。以上是锁定发行代码的控制上下文回放，不是真实模型运行。

本轮仅修复当前 DSH adapter 的活动身份/终态配对。活动中重复 started 不重复创建；finished 在本次活动内只发布一次，无新 started 的迟到 child 帧忽略；重新挂载的原生 started 创建新的 canonical 活动代次，seq/digest 和 lineage 保留。没有增加必须出现新 turn 的条件，也没有修改 root final 缓冲或 Gateway。

| 验证 | 结果 |
| --- | --- |
| 五项新增回归运行于修复前构建 | 全部失败，覆盖 ok/error 重复终态、重挂载、SDK/Core 两条 child 路径 |
| Node 24.19.0 与 26.13.0，四个既有 DSH 文件加手动专项 | 各 134 项：129 passed / 0 failed / 5 既有 POSIX skips；手动专项各 18 passed |
| 同一原始 rc.5 factory / SDK callbacks 控制回放 | canonical 由 1 started / 2 finished 变为 2 started / 2 finished；两次 child 文本均接纳，final 事件为零 |
| 重挂载资源边界 | 4096 次重挂载后按原有 object_limit 明确拒绝，不扩张会话 Map 或保存运行历史 |
| format:check、lint、lint:names、typecheck（含完整构建） | 通过 |

本次未修改其他 Adapter、Core、Gateway、CI 或六项基线失败；没有重新执行无关全量测试。真实模型、IM、跨平台验收仍未执行。SDK 未透传 activation ID，跨新 started 边界的旧 finish 不能与当前运行的同载荷 finish 区分；实现只保证已知运行边界内的幂等，不伪造跨运行重放识别能力。
