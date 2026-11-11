---
type: Validation
title: 执行信封清理实现验证
description: 记录本地回归、真实 Provider、双包消费及网络和仓外未验边界。
tags: [context, protocol, adapter, testing, validation]
---

# 环境与范围

2026-11-10，macOS 26.6.2（25G83）、arm64、Node.js 24.22.2、pnpm 11.19.0。源码为 `7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2` 上的未提交修改，独立 worktree 为 `/Users/lvsijia/.codex/worktrees/context-envelope-cleanup/octo-runtime`。基线来自本次成功拉取的 origin/main；原 checkout 未修改。下列结果由当前实现者执行，不是远端 GitHub CI 结果。

规划检查与最新 Gateway 审计已完成；Gateway main@beb804933ff34e75225645a34b1a7fd038c52ad8 仍需自有业务类型/校验/历史与内容迁移，见 [消费者审计](consumer-audit.md)。本任务没有修改该仓库。

## 本地命令与结果

| 检查 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 通过；包含协议生成、全 workspace 构建和根类型检查，最终删除 ContextMcpLocator 后重跑通过 |
| `pnpm lint`、`pnpm lint:names` | 通过 |
| `pnpm format:check` | 通过，未扩大格式或 CI 入口 |
| `pnpm docs:check` | 通过：37 对双语页、75 个 Markdown、10 个 JSON 示例、6 个 Mermaid、8 个公共 Context 示例；4 项文档运行测试通过 |
| `pnpm test:suites` | 1514 项：1453 通过、61 条既有 opt-in/环境用例跳过、0 失败；复用已完成的 build，等价于既有 pnpm test 的构建加套件路径 |
| 最终 protocol/context 与手动相关验证 | 269 项全部通过，覆盖最终 schema/export 清理和新增专项，命令见下方 |
| `node scripts/pack-release.mjs` | 生成 Runtime 与独立 client 两份本地 0.0.0 tgz，未发布 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | 通过：空缓存离线安装、public types、原生 Kernel、SDK recovery probe、CLI Kernel 和卸载保留 Home |
| `OCTO_CLIENT_TEST_VERSION=0.0.0 node --test test/manual/runtime-client-309.test.mjs` | 11 项通过，含 npm/pnpm 离线 client-only/双包安装、类型联编、真实本地服务及协议消费 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过；收尾时再次检查知识元数据、规则索引及本地链接 |
| `git diff --check`、CI diff | 通过；`.github/`、package.json、pnpm-lock.yaml 无 diff |

最终相关验证命令：

```sh
node --test test/manual/context-envelope-348-351.test.mjs \
  test/manual/caller-workspace-core-335.test.mjs \
  test/manual/agentenv-direct-341.test.mjs \
  test/manual/host-execution-346.test.mjs \
  test/context-protocol.test.js test/context-configuration-protocol.test.js \
  packages/octo-runtime-protocol/test/*.test.js
```

新增七项专项均在 test/manual，覆盖：公共删除闭包和旧帧拒绝、任意私有命名、preset 不再豁免 cwd、model-only/effort-only/省略和 sentinel 拒绝、普通 references 整项替换、包内非法值、Claude 三种审批组合、ACP 精确/分组 ID、OpenCode JSON 路径拒绝、Codex 新旧线程模型差异、Claude 缺失或不符原生确认。session evidence 和 plan.updated 仍接受各自合法结构。

验收 A01–A07、A09–A12 在本地通过；A08 的参数映射、缺省与失败路径离线通过，真实环境覆盖见下方。不存在“所有 Provider 和平台已验证”的结论。

## 修正与重验

首轮全量仅 watchdog bookkeeping 用例失败：删除旧 execution.update 后少推进 10ms。改为按剩余记录数推进至原截止点，未修改 watchdog 产品逻辑；全量复验 0 失败。新专项初版使用了不完整 plan.updated payload，补齐其独立合同要求后通过。

删除 inline/reference 后复查到不再被引用的 ContextMcpLocator 及 public/protocol 导出，已一起移除、重新生成、构建，并复验相关测试和两份最终发行包。未保留孤立的业务 locator 类型。

## 独立真实验收：non-gating

显式运行 `OCTO_ACTMODE_PROVIDERS=codex,claude-code,opencode,grok-build node scripts/verify-actmode-live.mjs`。脚本使用宿主工厂、普通无工具提示词和已有 Provider 认证，不发送 IM 消息、不读取输出凭据。版本和最小结果保存在 [live-results.json](live-results.json)。

| Provider / 版本 | 场景与事实 |
| --- | --- |
| Codex 0.164.0 | plan 新线程、default 续接、模式省略续接均 run.completed，返回 MODE_PASS，无模式未确认诊断 |
| Claude Code 2.1.306 | plan 新会话、省略续接均 run.completed，返回 MODE_PASS，无 permission-mode-unconfirmed 诊断 |
| OpenCode 2.1.3 | plan 成功；初版脚本对原生 default ID 的成功假设被正确拒绝（ACP_MODE_UNSUPPORTED）。按包合同修正脚本后，独立重跑 plan/省略续接均 run.completed、MODE_PASS |
| Grok Build 1.0.67 | 首次 plan 在首帧预算超时，不能记为真实模型通过。诊断调用在约 7.7s 完成 initialize/authenticate、7.9s 完成 session/new 和 session/set_mode；模型 prompt 等待至 45s 主动截止，run.cancelled，close 及 Core shutdown 确认为 complete/closed |

用户补充 Grok 依赖翻墙。结合模式 RPC 已被接受、卡在模型响应的观察，将 Grok 标记为网络/代理环境受限，真实模型执行未通过；不据此改写 Adapter 模式语义。诊断不保存认证参数或 prompt 原始传输。session/prompt 在取消时结束不算模型执行成功。

脚本在 finally 检查 Executor shutdown.cleanup=complete，并关闭 Codex owner；实际运行未出现清理失败。Codex/Claude/OpenCode 的成功终态只证明本次执行完成，不构成跨 Provider 的统一模式确认。原生参数内容由本地捕获测试核验；没有重新建立 ExecutionEvidence。

OpenCode 复验命令：`OCTO_ACTMODE_PROVIDERS=opencode node scripts/verify-actmode-live.mjs`。既有脚本文件名保留，但输入已是包私有字段，输出不再消费公共 actmode evidence。

## CI 与未验项

相对 origin/main，workflow、job、矩阵、触发、必需状态、Gate 依赖及 package scripts 未变。既有 CI check / verify-windows-release / gate 范围保持原样。新增专项、真实调用和独立 client 验收均为本地手动；发行脚本仅删去已失效的公共 actmode 断言。

Windows/Electron 实机、真实 OpenClaw、其他 ACP 派生 Provider、IM 与仓外 Gateway 联调未运行。独立 Gateway 迁移未完成，不能宣称可直接升级。limits.enforcement 与 runtime selection 不在改动范围内。

未提交、推送、创建 PR、合并、部署或发布。实现者自查见 [review](review.md)。

## code-review 与 autofix 复验（2026-11-10）

按用户明确请求执行两轴独立 review。Standards 1 项 P3、Spec 2 项 P2 全部修复并由原审查者复核关闭，详细原因与范围见 [review](review.md)。两项 Spec 回归在修复前均失败，修复后八项本地专项全部通过。

- `pnpm typecheck`、`pnpm lint`、`pnpm docs:check` 复验通过。
- `pnpm test:suites`：1513 项，1452 通过、61 跳过、0 失败。比上一阶段少的 1 项是随 PublicObjectMaterial 删除的旧业务 Schema 测试，不是跳过失败测试。
- `node --test test/manual/context-envelope-348-351.test.mjs`：8 通过、0 失败；新增注册类型覆盖测试仍只在本地手动运行。
- `node scripts/check-developer-docs.mjs --scope current`：161 文档、1682 链接、39 锚点，0 错误。
- Schema、生成类型和 public 入口已清除 PublicObjectMaterial/object_materials；三个无消费者私有 interface 已删除。
- 两份发行包重新打包并复验；结果与本节一起记录，旧包不替代最终导出验证。
- 本轮没有重新请求真实模型；ACP 修复只影响工厂覆盖 metadata.type 的自定义注册，已有内置 Provider 命名不变。Grok 的网络限制保持原记录。

## 用户追加的临时删除闭包 lint

临时脚本位于 `/tmp/octo-envelope-lint.bBwNmu/check.mjs`，SHA-256 `73994a8a5bd621c1d60eca038bcd6272a9e212d496c5278aa4d67ed7594c94df`；不进入仓库、package scripts 或 GitHub CI。复跑命令为 `node /tmp/octo-envelope-lint.bBwNmu/check.mjs "$PWD"`，前提是当前工作树已构建并生成 dist/release 下两份 0.0.0 包。报告位于同目录 report.json；first-run.log 保留首次非零退出的发现，final-run.log 保留修复后结果。临时目录可能被操作系统清理，此处保存结论与范围，不作为永久测试入口。

脚本以 TypeScript AST 检查删除的标识符、字面量、旧 item 构造和顶层字段；读取 JSON 样例及 Schema，检查删除定义、ContextItem 精确属性、model 必填项、catalog、悬空引用；加载六个实际公开入口，并验证默认值、旧事件/字段拒绝、未知私有命名与普通 references 整项替换。每次先清空自身临时解包目录，再扫描两份最终 tgz 中本仓拥有的实现与声明，并对照源码 Schema；不扫描第三方依赖。

初次扫描得到 12 条结果，对应 6 处源码位置：

- 四个真实验证脚本 verify-dual-protocol-live、verify-stateless-live、verify-openclaw-bounds-live、verify-openclaw-compatibility-live 仍构造旧 octo.execution/agent，已删除。四个脚本通过 node --check；未因此重新发起真实模型请求。
- 公共 failure.ts 仍硬编码 Codex 的 finalizationTimeoutMs、appServerRequestTimeoutMs 私有配置路径，构建及双包中重复暴露。现移除公共诊断中的两个私有路径提示，错误分类及不可重试语义保持，公共 limits 提示保持；参数与现有默认/非法值行为写入 Codex 两份包 README，既有 failure 测试同步校验。

最终 0 项发现、退出码 0：252 个源码/脚本/测试支持/样例文件条目、306 个构建文件、421 个打包文件、91 个当前文档代码块、4 份 Schema。另人工核对测试中的 39 处相关文本：拒绝旧字段、验证 opaque payload、迁移断言及既有 fixture/脚本名不代表保留公共语义；生产 invoke-input 的 agentSource 字符串仅在旧字段拒绝清单，脚本对此作精确路径豁免。旧历史文档及迁移正文不按生产合同计入残留。

修复后重新通过 pnpm typecheck、pnpm lint、pnpm docs:check；全量 1513 项中 1452 通过、61 既有跳过、0 失败。context-envelope 与 host-execution 两组手动回归共 24 项通过。重新打包后 Runtime verify-release 全部通过，client 包外 11 项通过；format:check 通过。知识 lint 通过（753 个 OKF 单元、20 条规则、3510 个本地链接）；当前开发文档 161 份、1682 链接、39 锚点、0 错误。CI workflow/package.json/pnpm-lock.yaml 无 diff，无新增范围。

## 旧回执与投影整组删除复验（2026-11-10）

按用户追加授权，删除 ContextPreparationReceipt、RunContextProjection 的完整 Schema、生成类型及公开导出。旧 workspace 手动套件中的专属 Schema 用例和旧回执类型断言一并删除，其他现行 workspace 用例保留；顺手移除该测试构造器中已经无效的旧 agent item。现有 context-envelope 删除断言改为验证两个定义整体不存在。未新增默认测试或 CI 入口。

- `pnpm typecheck`、`pnpm lint`、`pnpm docs:check`、`pnpm format:check` 通过。
- `pnpm test:suites`：1513 项，1452 通过、61 既有跳过、0 失败；删除的旧用例原本只属于手动套件，因此默认总数不变。
- `node --test test/manual/context-envelope-348-351.test.mjs test/manual/caller-workspace-protocol-335.test.mjs`：12 通过、0 失败，包含剩余 workspace 类型 fixture 编译。
- Runtime/client 重新打包；`verify-release.mjs` 全部通过，client 包外 11 项通过。
- 临时 lint 新增两类及 model_uses_provider_default/effort_uses_provider_default 的删除检查，移除其范围外豁免。最终 252 源文件、306 构建文件、421 打包文件、91 文档代码块、4 份 Schema，0 项发现。源码/schema/public 正向引用搜索无匹配。
- 当前临时脚本 SHA-256 为 `5c06f22aafbe1cae260bb624ddac9ae0a415c6bbb0540b0e4db32e4c32c8c0df`；本次日志使用同目录 receipt- 前缀，最终报告仍为 report.json。上节摘要对应前一版脚本，保留历史证据。

现行 HostRunReceipt、Host 帧、运行事件、session evidence 不变；无兼容别名。规则、双语升级说明及后续清单已同步。未提交、推送或扩大 CI。

## runtime selection 删除与专项 lint（2026-11-10）

用户明确寻址由业务调用方完成，通过 octo-runtime-client invoke 已选定 Runtime，并追加要求临时 lint 确保删除完整。原计划排除的 runtime selection 因此纳入本次删除：ContextRuntimeSelectionPayload、ResolvedRuntimeSelection、runtime-selection.ts、选择常量与校验器、catalog 条目、RUNTIME_RUN_CONTRACT.routing_schema、offline_behavior/failover 专用合并分支、旧测试/夹具/helper 和公共示例均移除。保留其余版本合同断言，迁到现有 protocol.test；无兼容别名，无新寻址实现。

临时脚本仍为 `/tmp/octo-envelope-lint.bBwNmu/check.mjs`，当前 SHA-256 `89add0d83fc26c18ecf03d9b0539358329f9f42a8ecfc7dd9b0e1aa457458a59`；运行 `node /tmp/octo-envelope-lint.bBwNmu/check.mjs "$PWD"`。在 AST、Schema、六个公开入口和双包检查之外，新增旧文件不存在检查、共享夹具关键词检查、catalog 与 routing_schema 不存在断言、同名未知 item 普通整项替换断言。扫描器自身在内存注入四类代表性残留并确认检出，不修改仓库、不接入 CI。

最终 report.json 和 selection-final-run.log 均为 0 项发现、退出码 0：251 个源码/脚本/支持/样例文件、304 个构建文件、417 个双包文件、91 个文档代码块、4 份 Schema。旧名称仅在删除断言、迁移说明或历史记录中允许出现，通用信封接受 opaque item 不赋予其设备调度语义。

- `pnpm typecheck`（含构建与生成）通过；`pnpm lint`、`pnpm format:check`、`pnpm docs:check` 通过，当前 catalog 示例由 8 个减为 7 个。
- `pnpm test:suites`：1465 项，1404 通过、61 既有跳过、0 失败。比上阶段减少 48 项：38 个 resolved selection 夹具、1 个专属非 JSON 用例、6 个旧设备 Context 样例和 3 个设备 mandatory 样例。通用版本合同用例迁移保留。
- `OCTO_SCHEMA_TEST_VERSION=0.0.0 node --test test/manual/context-envelope-348-351.test.mjs test/manual/schema-ownership-332.test.mjs test/manual/caller-workspace-protocol-335.test.mjs`：18 项通过。首次未传版本时两个归档检查因默认寻找 0.0.332 包失败；明确指定实际本地 0.0.0 归档后通过，未改产品逻辑。
- 重新打包 Runtime/client；Runtime verify-release 全部通过，client 包外 11 项通过。
- 知识 lint 通过：753 个 OKF 单元、20 条规则、3510 个本地链接；当前开发文档检查 161 份文档、1682 链接、39 锚点、0 错误。

仅调用方寻址合同清理，无新增 Provider 行为，不重复真实模型调用。limits.enforcement 保持范围外。workflow/package.json/pnpm-lock.yaml 无 diff，未提交、推送或扩大 CI。

## 后续 enforcement 删除范围

以上 `limits.enforcement` 范围说明记录本阶段决策。用户随后另行授权[删除全局 enforcement 开关及兼容分支](../remove-limits-enforcement/brief.md)；当前合同以该任务和现行规则为准，阶段验证结果不因此改写。
