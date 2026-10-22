---
type: Task
title: Issue 40：兼容实现与验证记录
description: 记录实际合同选择、权限回退、取消对账及自动化证据，并区分真实环境待验项。
tags: [openclaw, adapter, invocation, interaction, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 实施范围

用户在评估和细化方案后明确要求“开始实施”。沿用 `research/40-openclaw-compatibility` 独立 worktree 和原创建基线 `88fa71d`，实施产品代码、测试和知识回填。真实 6.11 验证完成后，用户明确接受现有结果为本次合并验收，并授权 commit、PR 及合入 main；当前进入交付检查，按 GitHub 保护规则执行。以下实际记录优先于计划文档中的候选路径与历史阶段描述。

## 已实现

1. `compatibility.ts` 集中解析协议 v4、真实 `server.version`、必要执行方法／事件，精确识别固定源码核对的 27 个标签（原 26 个加用户追加的 6.11），接受 v 前缀并保留 -1/-2。probe、执行、取消恢复及既有断线对账共用解析器；未知版本和裁剪的基础合同在有副作用 RPC 前失败。probe 保持只读。
2. 创建参数推迟到握手后。6.11 和 7.x 只发 key/agentId/model，再 patch 当前会话的 full/off，并确认返回 key、ok 和保存字段后订阅、执行。8.x 起发送原生 permissionMode、创建幂等键及可选 thinkingLevel，不发送已退休的旧权限 patch。agent 的执行幂等键、model、thinking、系统指令和 deliver:false 全部保留。
3. 新版人工通道可用时保持 ask→guarded。人工方法／事件缺失或授权不足时预先评估 full；新版明确声明的 scopes 缺少 operator.admin 时，full 不能执行，创建前返回实际限制。7.x 参数无法区分人工 ask 和自动 reviewer，也没有从 hello 确认 reviewer 的接口，当前采用 `legacy_human_reviewer_unconfirmed` 原因回退 full。这不是对每个旧实例“绝对没有人工 ask”的断言。
4. 每次 ask→full 发送一次现有 provider_diagnostic 通知，记录实际版本、requested ask、effective full_access 和原因。共享审批桥增加默认不改变调用方行为的可选 effectiveApprovalMode；OpenClaw 在第一个审批前设置它，自动响应仍只选择本次 allow-once。原请求、Context、policy hash 和执行身份保留。
5. RPC 原生错误保留 method/code；不保存任意 details。当前没有额外有副作用的探测或错误后自动换参数重试。认证失败、一般 INVALID_REQUEST、超时、未知修改状态均原样失败，不能依据消息子串认定可安全重建。有效的回退在创建前根据合同／通道判定；这落实了计划中的重试边界，没有引入未经验证的错误白名单。
6. agent 最终回执、lifecycle 和 agent.wait 共用终态归一化：accepted/queued/in_flight/pending/running、pendingError 不算结束；无 endedAt 的普通 wait timeout 继续等待；执行 timeout 归因优先于 abort 清理；正常成功 stop 不算取消，非成功 rpc/stop、restart、明确 aborted 才按取消处理。blocked/abandoned 不冒充成功。
7. 取消桥和执行循环共用一次 abort／对账，在确认后关闭连接；修复原队列取消同时触发清理导致重复 abort 的竞态。区分尚未发送与已发送但未收到 ACK，后者也必须对账才能确认取消；abort ACK 与原生成功终态矛盾时明确失败，不伪造取消。既有断线对账读取真实完成／失败／取消，不仅允许恢复为 completed，也不重发 agent。模型步骤 ID 在事件与最终回执间保持一致，pending lifecycle 错误不提前结束步骤。
8. Gateway 客户端在请求前已取消时立即拒绝，修复此前 Promise 不结算的问题；超时释放 signal 监听器，非法 hello 正常拒绝，queued/in_flight 回执继续等待真正最终结果。
9. 交付复核修复晚取消竞态：原生终态先记录／对账，再向消费者输出收尾事件。消费者此时取消不能把真实成功或失败改写成取消，也不重复 abort 已结束的执行。4 条新增回归与原有矛盾取消证据回归通过，详见[评审记录](review.md)。
10. PR #102 外部复核确认客户端 pending 最终内容丢失及已确认取消被旧 wait 关闭错误覆盖，并扩查出迟到 wait 覆盖终态、恢复后步骤结束丢失、对账中资源失败被成功覆盖。中间回执三处共用判定，所有等待结果只填充尚未知的终态；统一发布已开始步骤、消息与 Run 收尾。终态后过滤广播，对账中溢出优先保留原始错误。新增 17 条回归，真实本机 WS 覆盖 pending／running 的最终答案与 usage，以及 aborted／rpc 取消关闭旧等待。完整清单与证据见[PR 复核](review.md#pr-102-外部意见与同类问题)。

## 请求样本与可重复验证

`test-support/openclaw-request-contracts.json` 保存 27 个固定提交的源码散列及四类去重后的严格请求投影。样本由 [extract-request-fixtures.mjs](extract-request-fixtures.mjs) 从 TypeScript AST 机械提取：保留 Runtime 实际发送字段的原始类型、必填和 additionalProperties:false；未发送的上游可选字段在投影中拒绝。它是原 Schema 的更窄子集，不是完整原 Schema 或行为模拟器。生成时检查 create/agent 文件与原始证据散列一致。追加的 6.11 与 7.1 在这三种实际发送请求投影上一致，不代表整个版本语义等价。

```sh
node .octospec/tasks/40-openclaw-compatibility/extract-request-fixtures.mjs /path/to/upstream-cache
pnpm build
node --test test/openclaw-compatibility.test.js test/openclaw-gateway-client.test.js
```

`openclaw-compatibility.test.js` 对每个标签分别执行 ask/full_access，共 54 条严格请求流程：创建／旧权限 patch／订阅／执行顺序、字段、系统指令、幂等、通知、唯一终态和资源释放。另覆盖 probe 与 invocation 版本双向变化、维护标签、未知／缺失版本、权限通道回退、原始身份、创建／patch／订阅失败不执行、ACK 丢失不重放、取消、pending 对账、执行超时以及断线新合同。

`openclaw-gateway-client.test.js` 使用真实本机 WebSocket 对端验证握手、非终态回执、结构化错误、预取消和超时清理。它不是 OpenClaw Gateway 进程。原有人工审批允许／拒绝／过期／外部决策、广播隔离、有界队列、CLI/SDK 连接和 Playboard 测试继续回归。

## 验证状态

PR #102 意见修复后的最新本地验证：默认并发 `pnpm test:suites` 完整通过，Node 1587 通过、35 条件跳过、0 失败，WebUI 35 通过。完整构建／类型、lint、命名、格式、开发文档（4 项）和 diff 通过。17 条新回归覆盖外部两项及扩查三类缺陷，单独全部 OpenClaw 为 113 通过／1 GC skip。下文原交付结果保留为历史记录，新提交的托管 CI 和人工复审单独确认。

交付前同步到 main `102fb9c`，补齐晚取消回归后再次验证：WebUI 35 项通过；完整 Node 套件以 `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js` 执行，1605 项中 1570 通过、35 条件跳过、0 失败。默认并发的两次全量分别遇到 Codex finalization elapsed 超过 4 秒、进程组回收 PROCESS_CLEANUP_TIMEOUT；未改这些模块或放宽断言。Codex 与兼容性定向复跑共 101 项、进程组回收定向复跑 11 项全部通过。保留失败记录，受控并发完整回归和远端 CI 分别作为证据，不将默认命令标成最终通过。

最终验证通过：`pnpm typecheck`（包含完整构建）、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check`（4 项执行测试通过）。构建完成后运行完整 `pnpm test:suites`，WebUI 35 项通过，Node 1596 项中 1562 项通过、34 项平台／环境条件跳过、0 失败。`git diff --check` 通过。

追加 6.11 后再次运行 `pnpm typecheck`（完整构建）和 `pnpm lint`，均通过。全部六个 OpenClaw 测试文件共 93 项，92 通过、1 项需 GC 的条件测试跳过、0 失败；此前全仓结果保留为追加前记录，不冒充新增版本后再次执行的全仓测试。

OctoSpec checker 仍只报原有 `已退出的文档目录仍存在: docs`，不宣称全仓知识检查通过。新增知识文档没有额外元数据、索引或链接错误。

首次全仓测试发现旧 mock 缺少 server.version 和旧 builder 断言提前要求新版 thinkingLevel，已补充合法握手并将参数验证放到实际版本矩阵；相关 70 项 Adapter/Playboard 回归通过。首次 lint 与清理构建并发造成 dist 类型暂不可解析，并发现一处 unknown 字符串转换，已改为显式类型检查；构建完成后的 lint 通过。这些失败不记为基线错误，也不记为最终通过。

## 真实 Gateway 已验范围

只读已有本地连接，以临时执行身份调用实际 Gateway；真实 hello 为协议 4、`server.version=2026.9.4`，不以安装包版本代替握手版本。原有 `verify-openclaw-bounds-live.mjs` 固定文本验证通过：27 条原生事件，接纳早于事件，最终 completed。

新增 `scripts/verify-openclaw-compatibility-live.mjs` 分别验证 full_access、ask、接纳后立即取消：前两者 completed 并收到固定文本，ask 采用 guarded、无权限回退；取消为 run.cancelled，恰好一次 sessions.abort，并经 agent.wait 对账。各场景只创建一次会话、发送一次 agent。白名单证据见 [live-gateway-evidence.json](live-gateway-evidence.json)，不含凭据、会话正文或原始回执。未调用工具、未发送 IM，也未修改全局权限配置。

复测其他实例时，可用 `OCTO_OPENCLAW_QA_CONFIG` 指定测试配置文件，`OCTO_OPENCLAW_QA_URL` 指定测试 Gateway，`OCTO_OPENCLAW_QA_AGENT` 指定已有 Agent；这些变量仅由显式 QA 脚本读取，执行层合同不变。脚本创建测试会话，使用 Provider 已配置的模型；不作为默认测试运行。

用户后续提供并批准的真实 6.11／协议 4 已验证：Adapter probe 只读通过；full_access／ask 回退文本、两种模式的固定 exec 工具和接纳后取消共五场景通过。ask 明确回退 full_access 并发一次通知，每场景只创建一次会话、执行一次 agent、一个终态；取消恰好一次 abort 后 wait 确认。工具命令精确为 printf 固定标记，原生工具成功输出已断言。实际内网地址已脱敏；经测试专用本地 TCP 转发调用，正式远程 WSS 校验保留。源依据、JSON 证据及传输边界见[6.11 验证记录](remote-6.11-validation.md)。

## 后续真实覆盖范围

用户已接受真实 6.11 与 9.4 的代表验证为本次交付验收；下述未执行项保留为后续覆盖，不再作为要求用户补充所有 Gateway 的合并前置条件，也不将其改记为通过。

远程设备配对已由用户批准，6.11 的初始 NOT_PAIRED 阻塞已解除。脚本新增显式 `OCTO_OPENCLAW_QA_TOKEN`、仓库外 `OCTO_OPENCLAW_QA_DEVICE`、只读原生 `--probe`、显式 `--tools` 及白名单证据文件输出；未绕过产品版本解析器。

原始事故服务端 build／trace 未取得；除上述 6.11 和 9.4 已验场景外，7.x、8.x、9.x、10.x 的真实 reviewer、harness、宿主 approval floor 和工具禁止策略仍需分别验收。6.11 的固定工具成功不证明所有宿主策略，9.4 的 ask 文本成功不证明工具人工审批已实测；安装包核对和真实 Gateway 证据分别记录。

S1–S3 的代码和本地替身验证已落实；S4 的真实 7.1、7.1-2、8.1、8.2、9.1、10.5 Gateway 及 CLI／SDK／IM 联调保持开放，当前取得真实 6.11 与 9.4 的代表证据。不能将 54 条替身流程说成 27 个真实版本均已验证。6.11 的旧版执行及单次工具可用目标已验，7.1 的依据由相同请求投影和代表实测补强；宿主最终权限效果仍由真实执行决定。
