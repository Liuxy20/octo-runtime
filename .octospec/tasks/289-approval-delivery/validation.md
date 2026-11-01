---
type: Validation
title: Issue 289 实施验证与验收矩阵
description: 记录审批突发、背压、错误传播、全量回归与真实 Codex 验收及其边界。
tags: [adapter, interaction, protocol, testing]
baseline: 148d737d3ee14f0453ae5018c563b08d6b21ec5b
---

# 本轮状态

用户已追加实施、code-review 和 PR 授权。当前实现基于 `148d737d`。初版与真实验证在该基线的 dirty 实现上执行，随后固化为 `129d4cc8`；审查修复固化为 `5783727f`，修复后的专项与全量检查以该提交执行。操作者为本任务 Codex，日期为 2026-11-01。

已核实最新主线及 Codex 两种输出路径、中央分类器、Core 错误投影、HostControl 校验、既有 fixture 和默认 CI 入口。固定 OctoSpec 缓存由干净的 `octo-spec@d456507bbd37cd4e3ac58671d07b89a61af35579` 恢复。同步脚本仅造成 AGENTS 空行变化，已撤销该工具副作用；同步过程未修改规则正文；本次实施补充了 output-protocol.md 的本地失败附件合同。

环境：macOS、Node `v24.19.0`、pnpm `11.25.0`、Codex `0.162.0-alpha.17.2`。本次 shell 补齐 bundled Node PATH 后，依赖安装与全量 typecheck 通过，lockfile 未变。知识检查使用 `uv run --with pyyaml python .octospec/scripts/lint.py`。

## 已执行结果

- 旧 dist 对照：32 条自动审批在 16 条处停住；本地额度原因被插件 Unauthorized 污染。两条定向测试均失败，重建后通过。
- 初版专项 43/43 PASS；公开 Kernel/worker 两模式另 2/2 PASS，覆盖 256 条写回和并行调用失败隔离。新增 cancel/exit、retained params 及非 Codex 分类隔离后，52 项专项与 33 项相关既有用例合计 85/85 PASS。
- 既有相关回归初次 111/116；修正公开 expiresAt 为原有 10 分钟，保留 EOF 优先关闭后，相关 Codex 两组 34/34 PASS。内部发送期限仍为 30 秒。
- 全量 `pnpm test:suites`：2389 PASS、91 SKIP、0 FAIL（Node 共 2480；另有 35/35 WebUI 测试）。`pnpm typecheck`、lint、lint:names、format:check 通过。首次 lint 与构建并行造成 dist 暂时缺失，已改为构建完成后执行；两个新增冗余类型断言已删除。
- 真实 Codex canonical shell：32 requested / 32 resolved / 32 tools，峰值 20，run.completed，9912 ms；native shell：32/32/32，峰值 27，completed，9540 ms。
- canonical MCP：32 tools，run.completed，14520 ms；native MCP：32 tools，completed，11477 ms。MCP 均无审批请求，不宣称 MCP 审批突发通过。四组最终 cleanupComplete=true。
- live runner 经公共 KernelClient.invoke、真实 worker/app-server，使用既有认证和本次临时只读 MCP；显式 opt-in，不修改 Home/profile/插件/配置。仅删除本次临时资源。

## 确定性验收矩阵

所有新增文件位于 `test/manual/`，不由 `test/*.test.js` 或 `packages/octo-runtime-protocol/test/*.test.js` 默认 glob 命中。fixture 不调用真实模型，不修改用户 Home；运行期生成非功能性凭据数据且不打印值。

| 编号 | 输入与故障注入 | 必须观察到的结果 | 层级 |
| --- | --- | --- | --- |
| A01 | ask/assisted 各 256 个小型合法 approval；再发 257 | 256 pending；257 收到 -32000 + 固定容量原因，无额外可回答 pending；先前 256 保持可响应，无 Runtime 主动 fail；Provider 后续可完成。 | Codex 两模式 |
| A02 | 人工额度满，接受一条；延迟 write 回调，再发新请求/重复回答 | 人工等待降为 255 后可接纳新条目；旧响应 Promise 未完成，重复回答拒绝；回调成功仅一次 resolved。非法回答不释放额度。 | Codex 两模式 |
| A03 | full_access 同一个 stdout 批次突发 32/100/256；hold 第一条回调 | 全部进入 responseRequired=false 流程，无人工额度失败；释放回调后逐条原 ID 写入，一次性 resolved；最后唯一成功终态。 | Codex 两模式 |
| A04 | 连续自动审批 512 条，前批命令仍执行；加入真实 question/elicitation | 写回不等待工具结束；非审批 responseRequired=true，只有合法人工回答才继续；问题使用独立 16 额度。不得模拟单 invocation 改 approvalMode。 | Codex 两模式 |
| A05 | Writable highWaterMark 很小，write=false；交换 callback/drain 顺序 | 在两个条件均满足前不写下一条；callback 成功可先 resolved，只有 drain 不得 resolved；全部响应内容和顺序正确。 | 内部 writer + Adapter |
| A06 | write=true 但 callback 延迟、同步 callback、同步 throw、callback(error) | 不在回调前 resolved；无重入重写/无限递归；错误只结算一次，保持首因，notify 错误不被吞。 | writer + Adapter |
| A07 | 精确等于/超过 byte 与 item 上限；含 Unicode 和 LF；大合法 turn/start | 等于上限可接纳，+1 拒绝；UTF-8 计量正确；32 MiB 合法公共输入不会被小审批预算误伤；持续超限不得 OOM 或无界等待。 | writer + Core |
| A08 | 4096 个 queued 项或 64 MiB；控制保留额仍可用 | 普通队列不能借用控制预留；负响应/interrupt 可入控制额，仍服从 drain；预留自身耗尽产生明确容量错误。用 writer 层避免被 native 已见 ID 4096 先拦截。 | writer |
| A09 | 无 callback/drain 5 秒；持续慢进展使单条达到 30 秒 | 分别得到 STALLED / DELIVERY_TIMEOUT；计时从入队/实际进展边界开始，stdout 通知不能延期；全部 Promise 有界结束。 | writer + 两模式 |
| A10 | cancel/terminal/exit/close，随后迟到 callback/drain | queued 批准不再写；writing 不承诺撤销；未完成交互 invalidated 恰好一次，无迟到 resolved，无重复终态、悬挂回答、timer/listener 泄漏。 | 两模式 + Kernel |
| A11 | RPC timeout 时请求仍 queued；手动/自动回答到期竞态 | 超时的 turn/start 不迟发；不重发；人工决定与投递到期明确区分，不发送批准又补一份超时拒绝。 | Adapter |
| A12 | 每个本地结构化原因 + 插件 stderr Unauthorized；真实 RPC/turn 401 对照 | 本地原因保留且不变为凭据错；真实 401 仍为 OH-PRV-4001；不把 Provider 错误伪装传输错。 | classifier + Core 两模式 |
| A13 | 新允许的 native failure；篡改 code/source/params、旧无 failure、既有容量帧 | 新分支经 schema 与运行时校验通过；篡改拒绝；旧帧与容量白名单仍有效；TS/Go/Python 接收不丢 envelope。 | Protocol + Kernel |
| A14 | 两个并行 invocation，其中一条背压失败；动态 MCP 与权限拒绝 | 只影响故障调用；兄弟调用完成；full_access/untrusted 映射仍在，未知方法/权限扩张/跨调用响应继续拒绝。 | Core/Kernel |
| A15 | 等待人工 params 达字节上限；冻结回答后释放 params；多轮重复创建/关闭 | retainedBytes 正确释放；自动审批不累计完整 params；队列/计时器归零，listener 数恢复基线；有 GC 的测试只报告观察到的内存趋势。 | Adapter |
| A16 | 真实 Codex + Kernel/worker；只读并发 shell 和动态 MCP | 两种模式记录实际突发量/终态/进程清理；无业务侧批处理规避，无误分类；未形成所需突发或 Provider 自身拒绝须明确标注。 | 独立 non-gating live |

每种模式的关键验收以实际 Driver 请求/本地写完成/工具终态分别计数。A03 精确 burst 由 fixture 确定性证明；A16 不以提示词“要求并发”充当实际并发证据。A04 可分别执行 ask 与 full_access invocation，或 full_access 内的自动审批 + 人工问题，不能创造当前不存在的混合审批模式。

## 实施后执行入口

以下为执行入口；先构建再测试和 lint。live runner 必须显式 opt-in，否则退出且不发模型请求。

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm typecheck
node --unhandled-rejections=strict --test test/manual/codex-approval-delivery.test.js test/manual/codex-stdin-writer.test.js test/manual/codex-approval-kernel.test.js
node --unhandled-rejections=strict --test test/codex-app-server.test.js test/codex-transport-failure.test.js test/codex-mcp-overrides.test.js test/native-host.test.js test/failure.test.js test/kernel-invoke.test.js
pnpm lint
pnpm lint:names
pnpm format:check
pnpm test:suites
uv run --with pyyaml python .octospec/scripts/lint.py
git diff --check
git diff --name-only origin/main -- .github package.json pnpm-lock.yaml
```

对跨包 native failure 接线运行已有全量离线测试；不调整默认 globs、脚本开关或 workflow 来自动运行本专项。`pnpm typecheck` 已包含 build；通过后不用无改动重复构建。

真实入口：

```sh
codex --version
OCTO_RUN_CODEX_APPROVAL_LIVE=1 node test/manual/codex-approval-delivery-live.mjs
```

live runner 在调用进程原生创建 Kernel 服务，内部 worker 注册此次构建的 Codex Adapter，使用公共 KernelClient.invoke；运行期创建独占短路径 IPC/测试工作目录，沿用已配置 CODEX_HOME 与认证，结束仅清理本次临时资源。不启动 IM、不发业务消息、不改用户插件及配置。动态 MCP 用本地临时只读 fixture；真实 shell 只读测试文件或输出固定无秘密标记。首次实现应分别保存 shell/MCP、native/canonical 的结果，记录未形成 burst 的情形。

若需 Work App 端验收，等 upstream main 合并后由宿主正常更新依赖并重启受影响进程；当前上游 worktree 不直接替换 Work App 的 Runtime。

## 记录格式与完成判定

每项记录执行时间、源码 SHA/dirty、平台、Node/Codex 版本、命令、PASS/FAIL/BLOCKED/NOT RUN、请求/写回/终态计数、资源清理及脱敏证据。没有 Provider 读取 ACK 时只声称本地 write 完成。实现阶段所有阻塞必须如实列出，不能用本计划 96 分替代验收。

历史计划及实施知识检查均已执行，最终结果见交付检查。A01–A16 是验收维度，不是测试通过数。Windows/Linux 真机、GC 长时趋势及真实 Provider 故意拒收未执行；本轮记录 macOS 实测与离线故障注入。专项注入时间阈值缩短，不声称做了 30 秒墙钟压力测试。

## 最终覆盖边界

A01–A06、A10、A12 与 A14 的 Codex 两模式路径由 Adapter/Kernel 用例覆盖；A07–A09 在内部发送器注入小预算和短时限验证，另验证 32 MiB 帧可入队。A11 的未写 RPC 删除通过 writer 取消句柄验证，既有超时用例验证 Adapter 返回；未伪称对全部 RPC 超时交错做穷举。A13 验证 TypeScript 公共接收与篡改拒绝，未新增 Go/Python 真机回放；现有可选字段/Schema 不变。A15 已覆盖保留 params 释放、超额失败和 writer listener 清理，未执行 GC 长时压力。A16 四组真实路径完成，MCP 审批突发未出现。

内部实现将交互的 awaiting_decision/responding 与 writer 的 queued/active 分别归属各自所有者；没有重复存储一套状态枚举。一个 timer 调度较早的无进展期限或绝对投递期限。以上为计划细化，不改变对外合同。

## 审查修复与交付检查

[两轴审查](review.md)初审发现 Standards 1 项 P3、Spec 1 项 P1 和 1 项 P2，全部修复并独立复核关闭。修复后显式专项 56 项加相关既有 67 项，共 **123/123 PASS**。其中包括 512 条人工请求和写入/清理同时失败；Spec 审查者独立复跑 6/6 PASS。更新后的 lint 与 format:check 通过。

最终相对 origin/main 的 `.github/`、根 package.json 与 pnpm-lock.yaml diff 为空。新增专项仅显式运行，不新增 workflow/job/矩阵/触发器/默认测试开关/必需检查。上游 main 再次 fetch 后仍为 `148d737d`。Work App 集成须待上游合并后独立验证。

修复提交 `5783727f` 的最终全量检查：`pnpm typecheck` PASS；`pnpm test:suites` 再次为 Node 2389 PASS / 91 SKIP / 0 FAIL、WebUI 35/35 PASS。OctoSpec lint PASS：595 个 OKF 单元、20 条规则、3856 个本地链接；`git diff --check` PASS。真实四组验收发生在审查修复前，未再次消耗模型请求；新增修复由上述确定性用例验证，不能声称真实 Provider 已故意触发清理失败。

## 主线合并集成

创建 PR 期间 main 合入 `dc14c094`（#280 旁路问题），已合并最新主线。保留 async 问题的 RPC accept/rejected、终态与晚答语义；其 16 条额度与同步问题/elicitation 共用，独立于 256 条人工审批和自动投递。新增两种审批策略下 256 条审批与 async steer 共存，以及同步/异步问题双向额度测试；INTERACTION_PENDING_LIMIT_EXCEEDED 保留明确容量原因。

合并后的 typecheck、lint、format、docs:check 通过；全量 Node 2389 PASS / 91 SKIP / 0 FAIL，WebUI 35/35 PASS。首次额外 codec 验证有 2 项因 worktree 缺少 Python venv 失败；仅在忽略的 native/python/.venv 安装本地包后复验，不修改用户 Python 环境。

PR 标题初次未遵循 Conventional Commit，已改为 `fix(codex): handle approval bursts with bounded response delivery`；标题校验已重新运行并通过。合并提交推送后重新运行现有 CI，检查远端状态，不扩大工作流。

集成复验最终为 **174/174 PASS**，包括本次审批、上游 async 以及相关既有用例；Python venv 缺失已解决，TS/schema/Go/Python async codec 测试通过。合并复核发现的协议错误归因 P2 已修复，新增 3 条 Adapter 验证；Spec 独立复跑 13/13 PASS。该修正后 Codex 包构建、lint、format 检查通过；最终远端 CI 按最新提交重新执行。
