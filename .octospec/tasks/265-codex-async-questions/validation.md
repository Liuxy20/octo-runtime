---
type: Validation
title: Issue 265 实施与验证
description: Codex 异步问题的结构保留、活动轮次回传、生命周期、真实 Default 模式及本地回归证据。
tags: [protocol, interaction, adapter, testing]
---

# 旁路补充信息修订验证

## Provider 错误码 IPC 审查复核

最新 head `1cbbdf12` 的 yujiawei review 认为 server.ts 的 provider_rpc_code 与 rpc.ts 的 providerRpcCode 不匹配。核对完整链路后判定为误报：这是两层不同的 IPC，不是同一消息的收发两端。

1. Adapter 抛出 providerRpcCode；worker 的 RpcServer 在 rpc.ts 使用同名字段序列化，Kernel 的 RpcClient 在同文件读取并还原该属性。
2. server.ts 收到还原后的错误，在公开 socket 上转换为 provider_rpc_code；client.ts 的 response 将整个 error.data 保存到 KernelError.data，不经过内部 RpcClient。
3. `pnpm typecheck` 重新构建当前源码通过。`node --test test/manual/codex-async-recovery.test.mjs` 三项全部通过，包含真实 worker/Kernel socket 边界及最终 `error.data.provider_rpc_code === -32602`，并非直接调用内存 mock。

本次增加两处边界注释，将回归改为逐项断言公开字段、数字值及不泄露内部 camelCase 别名；没有改生产字段或行为，也没有扩大 CI。无需将两套不同协议误改为同一命名。

## WebUI 与企微行为对齐

用户明确三个内置 Extra 均忽略 async 控制、保留正文及旧同步交互。企微与 Gateway 已实现过滤；本次补 WebUI 的 RawRunPresentation，在推进原游标后过滤配对的 async requested/resolved，不生成 interaction.upsert 或交互快照项。集合按单 Run 有界保存，不进入通用 SDK 或改变原始 SSE 协议。

- `node --experimental-transform-types --test test/manual/codex-async-webui.test.mjs`：5 项通过；覆盖正文、游标、无/有期限、重复请求、与同步 question/approval/elicitation 交错，以及容量边界。专项保留 manual，不接入默认 CI。
- WebUI build（包括前后端 TypeScript）与原有 test:ui 的 35 项通过；Standards/Spec 双轴各 0 开放发现。定向 ESLint、Prettier 和知识检查通过。打包仅有现有依赖 use-client/chunk-size 提示，无构建失败。
- 三渠道联合显式验证：`node --experimental-transform-types --test test/manual/codex-async-webui.test.mjs test/manual/codex-async-wecom.test.mjs test/manual/codex-async-gateway.test.mjs test/im-wecom.test.js`，21 项通过，0 失败/跳过。
- 企微及 Gateway 沿用上一节独立验证，不新增异步表单或响应入口；公共 AsyncQuestionReply 能力仍供选择接入的宿主使用。

## 企业微信 P1 修复

远端评审针对 `86e5be40` 确认企微误登记 async 事件、发布必然失败的 `/respond` 命令。修复在登记、秘密输入取消、提示和 projector 之前成对过滤，仅保留普通正文；同步问答、审批和 full_access 逻辑保持。

- `pnpm --filter @mininglamp-oss/octo-runtime-extra-channel-wecom build` 通过。
- `node --test test/manual/codex-async-wecom.test.mjs test/manual/codex-async-gateway.test.mjs test/im-wecom.test.js`：16 通过、0 失败/跳过。
- 新增企微手动专项覆盖无期限/显式期限、重复事件、与同步请求交错、原正文交付，以及 async 秘密问题不触发取消；使用本地 WebSocket，不宣称真实企微验收。
- 本轮读取所有 Extra 源码交互消费者，Gateway 已有配对过滤；未发现第三个直接登记该事件的 Extra。WebUI/自定义宿主需按其公开协议消费方式判断，不能由此承诺全部第三方 UI 已兼容。
- Standards 找到新测试固定凭据占位值，已改为运行期随机生成；Spec 无确认缺陷。专项仍位于 manual，不扩大默认测试或 CI。

## 最新 main 集成复验

提交 `22ca96b4` 推送后发现 main 已至 `28c3ffa2ef685e14ac58d57c2788c9d07b92471c`。合并主线，手工保留 Schema/运行时 async 与 responseRequired 两份合同、output 规则与日志；全部生成物重新生成。下列证据对应该合并工作区（22ca96b4 加 main 与冲突修正），而非只引用合并前通过：

- typecheck/build、lint、format、docs、native:check 通过，Go/Python 各 434 个既有协议 fixture 通过。
- 相同全量 Node 文件集、本地并发 8：2480 总数，2389 通过、91 跳过、0 失败。
- 本任务离线 45 项、真实 Default 4 项再次全部通过；主线新增自动审批及配置快照专项合计 24 项通过。
- 两个 reviewer 按 origin/main 重新核对冲突处：各 0 新发现。主线 full_access 自动审批、非审批 responseRequired 校验与每轮一次配置快照保留；新 Run 仍复用同一 invoke 路径。
- `.github`、package.json、lockfile 相对 origin/main 差异为空，未合并文件列表为空。日志位于 `/tmp/ort84-supplement-merge-*.log`。

## 修订实施证据

源码：`59bed1986c66657f5a7318acbb51d361d914cbf3` 加本轮未提交变更，macOS arm64、Node 24.22.2、codex-cli 0.164.0；执行人为本会话 Codex。新版 brief.md 替换首版“晚填失效”。Work App UI/子模块及真实 IM 未修改或验证，Gateway 继续忽略 async。

- `pnpm typecheck`、根 tsc、lint、lint:names、format:check、docs:check 通过。native:gen 已同步，native:check 通过；Go/Python 各 434 个既有权威 fixture 通过。
- 手动离线：`node --test test/manual/codex-async-supplement.test.mjs test/manual/codex-async-questions.test.mjs test/manual/codex-async-recovery.test.mjs test/manual/codex-async-gateway.test.mjs test/manual/codex-async-codecs.test.mjs`，45 通过、0 失败、0 跳过；包含 11 项新旁路专项。覆盖两种 required-resume 失败点禁止 fresh fallback、默认无期限、取消、正常完成后新 Run、snapshot 经 Kernel 重启、未知 steer 不续跑、惰性 expiry/reset。
- 真实 non-gating：`node --test test/manual/codex-async-supplement-live.test.mjs test/manual/codex-async-live.test.mjs`。最终源码重验四项全部通过：两项运行中选择/自定义 steer，两项结束后选择/自定义新 Run；同 Provider session resumed、模型实际复述答案、run.completed 单独断言。第一次四项也通过，最终证据以 live-final 日志为准。
- 完整回归：WebUI 35 通过；Node 全量 2480 项，2389 通过、91 平台/环境跳过、0 失败。首次默认并发时唯一失败为既有 OpenCode 2.0.0 fake 版本探测达到 2 秒期限；没有修改旧测试或该 Adapter，最终同一全量文件集用 `node --test --test-concurrency=8 test/*.test.js packages/octo-runtime-protocol/test/*.test.js` 重验通过。沿用同一 Node 的临时隔离安装目录，避免既有缺安装测试发现机器相邻 octo-cli。没有修改默认脚本或 CI 并发。

合计显式手动 49 项通过（45 离线、4 真实），0 失败/跳过。最终 Standards/Spec 各 0 开放发现，外部 watchdog P1 已修复。相对 main 基线的 .github、package.json、pnpm-lock.yaml 差异为空，无 CI 范围变化。知识检查与交付引用在 Loop 结果评论记录。

日志：`/tmp/ort84-supplement-{typecheck-final,manual-45,live-final,node-final,native,docs-final,lint-final,format}.log`。fixture after 关闭其 Kernel/worker/临时目录，客户端关闭不代替取消或模型消费确认。

以下是首版历史验证，不覆盖当前旁路合同。

# 首版 PR 交付验证

用户已授权本地审查、修复、提交、推送并创建目标为 main 的 PR。2026-11-01 同步主线至 `4a0f53b50723422d90f051944ae19eb28f60712a` 后，合入本次实现并按新增要求处理 Gateway：在 ImTask 入口成对忽略 async 问题交互，不创建卡片或操作入口、不暂停模型等待钟，保留正文与同步行为。未向 Provider 自动代答或取消。

按最新 main 独立重做 Standards/Spec 审查。Standards 0 项，Spec 2 项 P2（Core 失效错误码、可变表单共享）修复后均关闭；详见 [review.md](review.md)。新人工专项 `test/manual/codex-async-gateway.test.mjs` 验证无同步等待和已有同步等待两种情况；源 async resolved 不误解除同步等待。最终定向 Core/Kernel/Codex/native/Gateway **107 项通过**。

最新主线重建 `pnpm typecheck` 通过；最终 Core/Codex 包重建及根 tsc 通过。lint、names、format、docs、native:check 通过；Go/Python 既有协议各 434 个 fixture 通过。主线已补齐原有 frontmatter 缺失，本次全库知识检查通过，**565 个单元、20 条规则、3521 个本地文件链接**。本任务 review/validation 元数据已按主线新规则改为 Review/Validation。

最终专项命令在原四文件基础上加 `test/manual/codex-async-gateway.test.mjs`；新增对象隔离回归也在 questions 文件中。公开真实 Default 测试使用 codex-cli 0.164.0、Darwin arm64、Node 24.22.2；操作人为本会话 Codex，源码为上述 main 基线加本分支未提交改动。两个独立会话分别提交选项和自定义答案，单独断言结构表单、Provider 接纳、模型使用及 completed，并由 after 清理 Kernel/worker/临时目录。真实 Work App 和 IM 收发未验，不将 Gateway 离线过滤验证冒充真实 IM 表单验收。

PR 阶段日志使用 `/tmp/ort84-delivery-full.log`、`/tmp/ort84-delivery-manual.log`；类型、文档及 native 记录使用 `/tmp/ort84-pr-*.log`。完整默认套件继续采用临时复制的同一 Node，避免原安装目录 octo-cli 影响既有“未安装”假设；未修改该旧测试或默认入口。

最后两项审查修复后的同一工作区复验：手动专项 **34 通过、0 跳过、0 失败**（含真实 Default 两项）；默认套件 **WebUI 35 通过，Node 2389 通过、91 跳过、0 失败**。最终根 tsc、lint 和全库 format 检查通过，无剩余所需本地验证进程。提交前再次检查差异及知识文件，不沿用旧版本结论。

CI 范围核对：相对固定 main 的 `.github`、package.json、lockfile diff 为空；所有新增专项仍位于 manual 目录，默认 glob 不变。远端 main 的必需状态回读为既有 `CI Gate`。PR URL、提交 SHA、远端实际 checks 和工作流最终状态以 Loop 的交付评论为准，不在提交前虚构。

# 原实施阶段验证

以下记录对应同步 main 前的原实现版本和当时授权，不代表当前仍未授权提交。

## 版本与范围

2026-11-01，macOS Darwin arm64，Node 24.22.2，codex-cli 0.164.0。worktree 为 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-265`，分支 `fix/265-codex-async-questions`，HEAD `0bcd89c528018ffd508ca8099c8ac9c6b88de35d` 加本次未提交工作区。没有 commit、push、PR 或部署。

公共 Schema、生成类型和校验器保留消息 delivery/questions，并定义版本化问题请求与响应。Codex Adapter 绑定原 invocation/thread/turn/message，去重并以单次 steer 投递。只有匹配的 RPC 接纳才成功；明确拒绝、结果未知、取消、过期和终态各自报告。Core 的 async 交互不阻塞活动或暂停 watchdog；Kernel 沿原引用路由，传递稳定错误码与限定的数值 Provider RPC 诊断。同步问答和审批路径保持。

# 已执行检查

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过；后续 Kernel/Codex 错误处理修改后重新构建受影响包、根 tsc 检查通过；最终 `pnpm test` 再完整构建通过 |
| `pnpm lint`、`pnpm lint:names` | 通过，无新增命名发现 |
| `pnpm format:check`、`git diff --check` | 通过 |
| `pnpm test` | 通过：WebUI 35；Node 2480 项，2389 通过、91 平台/环境跳过、0 失败 |
| `node --test test/manual/codex-async-questions.test.mjs test/manual/codex-async-recovery.test.mjs test/manual/codex-async-codecs.test.mjs test/manual/codex-async-live.test.mjs` | 最终 31 通过、0 失败、0 跳过，含真实模型 2 项 |
| `node --test test/codex-app-server.test.js test/native-host.test.js` | 首轮 50 通过；最终同样被完整默认套件覆盖 |
| `pnpm docs:check` | 类型、18 对页面结构、文档链接及 4 个公开 SDK 示例测试通过 |
| `pnpm native:gen`、`pnpm native:check` | 3 个受影响生成文件同步，输入和输出摘要一致 |
| `pnpm native:test --suite protocol` | Go/Python 各 434 个既有权威协议 fixture 通过；新增问题字符串专项另显式手动运行 |

普通 Node 安装目录内存在 `octo-cli`，导致既有 `verification-command.test.js` 的“未安装”假设失败：首次默认套件 2388 通过、1 失败、91 跳过，单独复现相同失败；该测试及其实现与 HEAD 一致。本次没有修改它。将同一 Node 二进制复制到 `/tmp/ort84-node.*` 隔离目录，以 `PATH=<隔离目录>:$PATH pnpm test` 重跑完整套件，通过上述 2389 项。此举仅隔离本地测试的 Node 安装位置，不更改仓库代码或 CI。

本地原始汇总日志位于 `/tmp/ort84-full-test.log`、`/tmp/ort84-manual-final.log`、`/tmp/ort84-native-protocol.log`；它们不是持久交付物，本文件保存结果与复现命令。

# 真实 Default 往返

实施第一步以隔离原生 app-server 验证异步通知、匹配 steer 回复、clientUserMessageId 关联 userMessage 和模型实际重复答案，四项均通过。未改变 feature、账号或模式配置。

最终 `codex-async-live.test.mjs` 经公开 Kernel IPC、真实 worker、Codex Adapter 和 canonical 输出运行两个独立新会话。消费端从公开 request 构造字段、选项及自定义标记，不解析正文。分别提交原始选项和自定义答案，两次均观察到 structuredForm、providerAccepted、modelConsumed 为 true，且 run.completed。真实测试仅请求异步问题及本地 sleep8；没有业务写入。Kernel/worker 和测试临时目录均由测试 finally/after 清理；没有把问题、答案、凭据或原生正文复制进诊断记录。

接纳和消费分别验证：公共响应只承诺 Provider 接纳；测试中的后续模型回复额外证明本次样本使用了答案。它不扩大 API 的交付保证。原生 clientId 关联证据来自实施前 probe，公开 API 不暴露额外私有读取接口。

# 验收对应

| 项 | 结果与边界 |
| --- | --- |
| A1–A2 | started/completed、重复消息、原生 messageId、多题/null/空选项和普通文字均验证；损坏结构、超限和冲突明确失败 |
| A3–A5 | 单选/自定义/多题乱序、漏题/未知/重复/空白/超限、并发提交与取消、匹配确认、错误轮次、明确拒绝、写前失败、写后未知、过期和终态顺序通过；同批 RPC 拒绝与终态已补回归 |
| A6 | async 不产生 waiting_input，watchdog pending count 为零；真实轮次继续执行工具；同步控制仍计入阻塞 |
| A7 | 公开 RunRef 断开重连重放相同 ID并可回答；resume 新 invocation、Kernel/worker 重启不能回答旧批次。未知结果不自动重投，既有控制 ACK 丢失回归由默认 Kernel 套件覆盖 |
| A8 | 同步问答、elicitation、approval、ask/assisted/full_access 和 native 既有测试通过 |
| A9 | 真实 0.164.0 Default 两种答案通过；结构化消费端通过，真实 Work App renderer 未测试、未修改 |
| A10 | 构建、类型、lint、默认跨包回归及 Go/Python codec 通过；专项在 manual 目录，未接入默认 glob |
| A11 | 任务文档检查见下；相对 origin/main 的 `.github` diff 为空，相对 HEAD 的 package.json、lockfile、workflow diff 均为空。没有 PR，实际 PR checks 留待授权创建时核对 |

# 知识检查与限制

OctoSpec 全库 lint 的 4 个基线 frontmatter 缺失仍存在：Issue 137 的 brief/review/journal，以及 Issue 246 的 validation；已通过 `git show HEAD` 确认原有，本次不修改。新增任务与知识文件需独立校验，不能把全库 lint 写成通过。

最终重新执行 `uv run --with pyyaml python .octospec/scripts/lint.py`，只报告上述 4 项，未出现本次任务、规则、journal 或链接错误。另以定向脚本检查 Task frontmatter、context YAML、规则引用、索引及 A1–A11 覆盖，通过。

本次真实测试不证明所有 Codex 版本都支持实验性异步消息，也不证明 Work App 已接入。晚于原轮次结束的答案明确失效；没有自动下一轮、持久化问题库或跨 invocation 回答。提交、推送、PR 和宿主子模块升级尚未执行。
