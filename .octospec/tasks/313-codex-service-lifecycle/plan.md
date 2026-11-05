---
type: Plan
title: Issue 313：分阶段实施与验证计划
description: 将协议核验、服务绑定、逐轮路由、恢复和清理拆成可独立验收的工作步骤。
tags: [adapter, lifecycle, testing, architecture]
---

# 执行顺序

已按用户“开始实施”授权推进。M1-M4 的代码及本机离线验证完成；M0/M5 已有 macOS 真实协议、direct/IPC、MCP 与 doctor 证据，跨平台、实际 IM、Electron 尚未完成；M6 同步规则、双语文档和实际结果。下表保留原退出条件，完整通过情况以 [验收](acceptance.md) 和 [验证](validation.md) 为准，无新 CI。

| 阶段 | 具体改动位置 | 交付与退出条件 |
| --- | --- | --- |
| M0：固定原生协议合同 | `test/manual/` 下新增服务协议探针；复用本机生成的 0.164.0 schema 和公开文档 | 真实 owned stdio 服务验证单次初始化、多轮 resume、多 thread 交错、定向 interrupt、nullable elicitation、thread/unsubscribe 和配置换值；A02/A04/A08 关键能力明确。失败先修订设计，不能将推测带进 M2 |
| M1：绑定服务作用域 | Adapter SDK `src/index.ts`、Core `src/index.ts`、现有 Kernel teardown | 可选 createExecutionScope 合同、原子注册、scope 单独清理及服务遗留 ID；两个 Core 注册同一描述对象不共享 scope。非 Codex Adapter 行为不变。A01/A17 离线通过 |
| M2：拆客户端与轮次 | Codex `src/app-server.ts` 拆 `service.ts`、`turn.ts`；`index.ts`、`mcp.ts`、`stdin-writer.ts` | 服务持有进程/transport，turn 持有状态；私有兼容键及稳定 MCP 环境名；共享 writer 按 owner 撤销。A02-A09/A18 离线通过，所有 turn finally 无 service close |
| M3：恢复与 shutdown 竞态 | Codex 服务状态机、进程清理、Core beginShutdown/close | idle/active death 单飞恢复、代次失效、有限重试、关闭中迟到 spawn 回收；A10-A14 通过。不存在等待下一次 invoke 才恢复的分支 |
| M4：#307 结果与清理分离 | Codex finalization、Adapter SDK 最小本地事实、Core 终态与 cleanup 凭据、必要消费者 | eligible final 后 15 秒 fallback 成功；正/反例和两模式竞态通过。A15/A16 通过；不以 service 复用代替 finalization 修复 |
| M5：诊断、端到端与回归 | scope/Core 常驻进程快照、既有 Kernel status/共享 Schema 与生成类型、CLI doctor、`test/manual/` 专项和包外消费者 | doctor 文本/JSON 只列所选实例的常驻进程，A21 通过；fake、真实 Codex、im-test、原生平台证据分层；本机 owned 进程 kill/recover 明确通过。全部相关检查按下文执行；不得将缺环境记通过 |
| M6：知识与交付整理 | 受影响 `.octospec/rules/`、双语 SDK/输出/Provider/doctor 文档、包 README、validation/journal | A01-A21 均有结果；规则、示例与实际代码一致。后续若获提交/PR 授权，使用英文内容、配置作者及 Codex trailer，并检查目标分支 workflow diff 与实际 checks |

## 删除与迁移映射

| 现有行为 | 目标替换 |
| --- | --- |
| invoke → new CodexAppServerClient → spawn | scope 服务池 acquire/ensureReady → 新 turn handle |
| invocation finally → client.close → stdin.end/process cleanup | turn.release → 终态/退订/路由清理；owner close → service.close |
| invocation signal → 整个 writer 停止/进程回收 | 原 owner 条目撤销 + 原 turn interrupt |
| 单 client activeThreadId/activeTurnId | 服务路由索引 + 各 turn 独立状态 |
| 每轮随机 MCP 环境名再建命令 | 语义键先选服务，再一次生成私有进程环境映射 |
| initialize timeout 局部换 child | 同一 service supervisor 的恢复 episode；无业务动作重放 |
| final_answer 后 stall 一律 run.failed | 满足资格后 completed，轮次 cleanup 独立且可 incomplete |
| 原始 Adapter/底层函数隐式短生命周期 | Core 绑定，或明确 scope 所有权；非法裸调用提前拒绝 |

不恢复 worker、manifest loader、CLI launcher、Pod 或 global daemon。保留已合入的 direct/IPC 公共装配和 `/adapters/codex` 入口。

## 检查命令与 CI 边界

实施后的既有检查：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm docs:check
pnpm test:suites
uv run --with pyyaml python .octospec/scripts/lint.py
git diff --check
```

typecheck 已包含 build，无变化时不重复构建。保持既有测试选择器；相关已有测试的 fixture 如需适配新绑定只维护原覆盖，新服务专项放 `test/manual/`，不导入默认 `test/*.test.js`、verify-release 或 CI 步骤。

已新增的显式手动入口如下；路由、恢复、容量和 finalization 集中在同一离线文件，未机械拆成原规划的三个测试文件：

```sh
node --test --test-timeout=20000 test/manual/codex-service-lifecycle-313.test.mjs
node test/manual/codex-service-protocol-313.mjs --run
node test/manual/codex-service-live-313.mjs --mode direct
node test/manual/codex-service-live-313.mjs --mode ipc
node test/manual/codex-service-elicitation-live-313.mjs --run
```

live 脚本的默认行为应拒绝未明确选择的执行模式。脚本只终止自身创建并确认拥有的 child/PID/进程组；不得匹配应用名、全局 codex 或当前 Codex App。凭据由仓库外宿主配置准备，不打印或改写原生配置。

真实 IM A16 使用 `https://im-test.deepminer.com.cn/`，通过显式测试账户触发原生 ChannelGateway，核对 HTML 产物、消息回读和同会话追问。模型和 IM 的外部副作用仅在该显式专项中执行。

提交前核对 `git diff origin/main -- .github/workflows package.json scripts`、默认测试入口及新增测试路径。现有 CI 名称基线包括 Build/test/package 矩阵、Windows release 验证和 CI Gate，以及仓库已有的依赖、历史、Secret Scan、Workflow Sanity 等检查；本专项不增加任何一个检查或 Gate 依赖。尚未创建 PR 时，托管 checks 应写 not applicable，不能声称托管 CI 通过。

## 回退与失败处置

M0 失败先记录版本、原始协议原因和影响，再修订可执行性评分。禁止以新 transport、独立 worker 或每请求新进程绕过主合同。M1-M4 任一阶段失败不进入真实交付，保留失败证据。

代码回退只能恢复所交付代码版本，不能删除 Home、认证、Provider sessions 或用户文件。不能通过静默配置开关回退到有缺陷的 per-invocation 进程模型。上线宿主版本回退和服务重建应由对应宿主执行，旧 Run 不自动重放。
