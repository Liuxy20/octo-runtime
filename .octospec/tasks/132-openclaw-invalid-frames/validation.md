---
type: Validation
title: Issue 132 无效帧本地验证
description: 真实 loopback、独立子进程及共享 worker 的执行结果与限制。
tags: [openclaw, testing, validation]
---

# 结论与版本

基于 `148d737d3ee14f0453ae5018c563b08d6b21ec5b` 的未提交实现，满足 [brief](brief.md) 的 A1–A11。本地假 Provider 验证无效消息后同一次请求仍能成功，不代表真实 OpenClaw 模型或远端服务已验收。

主机 macOS，Node `v24.22.2`，pnpm `11.19.0`；worktree `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-ort-38`，分支 `triage/ort-38-openclaw-frames`。生产修改为 OpenClaw `src/gateway.ts`、`src/index.ts`；新测试位于 `test/manual/`、`test-support/`，规划和实施记录为未提交文档。没有提交、推送或创建 PR。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm build` | 通过，源码重新构建全部包与 CLI |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过 |
| `pnpm lint` | 通过；已移除坏 JSON 分支撤除后无用途的私有字段 |
| `pnpm lint:names` | 通过，findings 为空 |
| `node --test test/manual/openclaw-invalid-frames.test.mjs` | 29 通过，进程自然退出 0，无强制退出开关 |
| `node --test test/openclaw-gateway-client.test.js test/openclaw-compatibility.test.js test/openclaw-queue-bounds.test.js` | 156 通过，1 跳过（未开启专用 GC 检查），0 失败 |
| `node --test test/openclaw-runtime-connection.test.js` | 6 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过；系统 Python 缺 PyYAML，使用 uv 隔离环境 |
| `git diff --check` | 通过 |
| `git diff origin/main -- .github package.json pnpm-lock.yaml` | 空，CI 及默认测试入口没有变动 |

## 验收证据

- A1/A2：15 类 null、标量、数组、错误路由字段和破损 JSON 后，合法事件/响应正常分发；合法扩展字段保留，服务端仅收到原 connect 和一次请求。
- A3–A6：握手前后跳过、两个 pending 与中间回执保留；假时钟证明原有限期限不延期；无 RPC 超时请求可等正常结果或显式取消。
- A7：正常 `ok:false`、真实 socket close 及非法 WebSocket opcode 的传输 error 仍失败，未当作普通坏 JSON 吞掉。
- A8：真实 Adapter probe、执行及一次断线对账，日志分别进入工厂或 invocation sink；已接受 agent 不重放。
- A9：真实 Kernel/共享 worker 上 A 收 null 与破损 JSON 后正常完成，B 并发及 C 后续调用成功；Kernel identity、worker PID/generation 均不变。
- A10：1000 条坏帧恰好 20 次采样；同步抛错和异步 reject 的日志 sink 不影响合法结果。
- A11：独立子进程收到 null 后退出 0；stderr 固定诊断不含运行期生成的 canary，stdout 为预期结果。退出清理有独立期限。

首轮专项 28 通过、1 失败，原因为测试误把 Kernel `invoke()` 返回的 canonical event 当作协议 envelope；按当前公开 API 修正断言后 29 通过。首轮 lint 的废弃字段错误也已修复；不沿用失败结论作为通过证据。

## 未执行与边界

未运行真实 OpenClaw/线上 IM、原生 Windows/Linux 和全仓完整回归；未改 GitHub workflows、jobs、触发条件、矩阵、默认测试开关或必需检查。没有创建 PR，因此无新增 PR 检查列表可核验。任意业务 listener 抛错的独立缺陷不在本次规格范围。

## 本轮本地复验

用户要求本地 code-review、verified-review 验证修复并补充任务评论，执行编号 `ORT38-REVIEW-20261101-02`。HEAD 仍为 `148d737d3ee14f0453ae5018c563b08d6b21ec5b`，dirty 为 yes；本轮仅修正审查文档类型并补充记录，生产代码无新增修改。

审查覆盖 14 个变更/新增文件，生产 diff 与所有新增 fixture/test 均逐文件读取，文档核对确认决策、验收和实际结果。规则优先级为用户要求、AGENTS.md 与仓库规则；未纳入 dist/node_modules 等构建或依赖产物。

| 本轮命令 | 实际结果 |
| --- | --- |
| `node --unhandled-rejections=strict --trace-uncaught --test test/manual/openclaw-invalid-frames.test.mjs` | 29 通过，0 失败，进程自然退出 0；开启严格 unhandled rejection 处理后，坏帧/日志失败仍未打断执行 |
| `node --test --expose-gc test/openclaw-gateway-client.test.js test/openclaw-compatibility.test.js test/openclaw-queue-bounds.test.js test/openclaw-runtime-connection.test.js` | 163 通过，0 跳过；上轮条件跳过的 GC 检查此次也通过 |
| `pnpm build` | 通过；保留既有 WebUI 打包告警 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过 |
| `pnpm lint`、`pnpm lint:names` | 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过；元数据修正后重验 |
| `git diff --check` | 通过 |
| `git diff origin/main -- .github package.json pnpm-lock.yaml` | 空；专项验证仅手动执行 |

本轮唯一修复为 `review.md` 的 `type: Task` 改为 `type: Review`；按 AGENTS.md 对指定文档类型进行直接核验后通过。规范审查和规格审查均无未解决项，verified-review 没有发现 medium 及以上产品问题。未执行的真实 Provider、跨平台和全仓回归仍按上节保留，不用此次 192 项通过代替。

## 同步主线后的交付验证

用户明确授权“更新代码提交PR合并进入main”。先提交当前实现，再 rebase 到 `origin/main@dc14c094e123886fda3999e7c1ed779f2d060099`（#280）。只有 `.octospec/log.md` 新记录冲突，已保留双方内容；OpenClaw 生产差异与专项测试均未变化。

同步后源码构建 `pnpm build`、根 tsc noEmit、`pnpm lint` 重新通过。严格模式专项沿用上节完整命令重跑为 29 通过，含 GC 的四文件相关回归为 163 通过、0 跳过。知识检查为 599 个单元、20 条规则、3880 个本地链接（新增交付段落后再次校验）。`git diff origin/main -- .github package.json pnpm-lock.yaml` 为空，没有扩大 CI。

同步后独立 Spec 复核无新增产品问题：#280 的 watchdog 异步交互路径不改变本次坏帧入口的提前 return；RuntimeLog 和 Kernel 调用仍兼容。提交、PR、远端检查与实际合并状态记录在 ORT-38 交付评论；本文件不提前宣称已合并。

## CI 等待期间发现的旧测试合同

PR 获得批准后，四个 Linux/macOS job 长时间停在 Test。补跑本地 `pnpm test:suites`，确认 `test/adapters.test.js` 的既有 Gateway 测试仍断言“破损 JSON 立即失败”；新合同下原请求保持，随后超时触发断言失败，而注册在前的 server.close 清理等待仍打开的 client，导致进程不退出。此前定向验证没有包含该文件，漏掉了这一旧合同冲突。

独立 supervisor 运行 `node --test --test-name-pattern='Gateway client authenticates' test/adapters.test.js`，旧测试在 35 秒内不退出（supervisor 回收并返回 42）；修复后同一命令通过并自然退出 0。修复仅将既有测试改为坏 JSON 后发送同 id 合法 res 并断言成功；将清理合并为先 client.close 再回收 server，增加本测试和请求的有限期限。不新增默认测试项、workflow 或 Gate。

`node --test test/adapters.test.js` 修复后为 58 通过、1 个原生 Windows 项跳过。双轴增量复审各 0 发现。首次全量本地运行另发现 verification-command 的 ENOENT 用例受本机 Node 同目录已安装 octo-cli 影响，独立记录为环境因素，不修改无关实现或掩盖为通过；完整修复后的本地及远端结果以最终任务评论为准。
