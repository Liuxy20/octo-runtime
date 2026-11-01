---
type: Validation
title: 单次 AgentRun 配置快照本地验证
description: 记录更新主线后的复现、配置一致性验证、相关回归及未验边界。
tags: [invocation, ipc, stream, testing]
---

# 验证结果

## PR 交付更新

用户在实现结果审查后授权“提交 PR → main”，包含提交及推送。交付前再次 fetch，并快进到 `origin/main@88fe84ef`；新增主线提交仅改入门文档、文档示例及其任务记录，生产代码、依赖和本专项与已验证版本相同，无冲突。原实现阶段记录保留下文，不把当时未获授权误解为当前禁止提交。PR 链接与最终提交 SHA 写回 Loop，源码与专项验证结论仍适用。

## 实现阶段记录

2026-11-01，本地修复及验证完成，待用户审查。基线为 `4a0f53b50723422d90f051944ae19eb28f60712a`，工作区含未提交的实现、手动专项和知识文件。未提交、推送或创建 PR。

环境：macOS arm64，Node.js `24.22.2`，pnpm `11.19.0`。测试使用真实 Kernel/worker/client IPC 及受控本地 Adapter，无真实模型、凭据或远程服务请求。独立 worktree 为 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-136`。

## 修改与验收对应

- server 在调用 submit 前读取一次配置，使用原有 probeOptions 校验，复制并冻结选项及有效流策略。transport 不再读取配置。
- 合并后的输入进入 HostRunService 原有预算检查，流策略经已有 environment 传给 worker、队列和源窗口；HostRunService 公共合同未改。
- 新专项及本地 Adapter 位于 `test/manual/136-configuration-*`，不匹配默认 `test/*.test.js`；package scripts、默认开关与 `.github` 无差异。

## 已执行

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，锁文件未修改 |
| 修复前 `pnpm build` | 通过 |
| 修复前 `node --test --test-name-pattern='A1/A2' test/manual/136-configuration-snapshot.mjs` | 按预期失败：配置回调执行 2 次，断言要求 1 次；fixture 完成回收 |
| 修复后 `pnpm typecheck` | 通过，含全 workspace 构建 |
| `pnpm lint` | 最终单独运行通过；首次与 typecheck 并行运行遇到构建清理 dist 后的类型解析错误，不作为通过证据 |
| `pnpm lint:names` | 通过，无命名问题 |
| `node --test test/host-stream-policy.test.js test/host-run-service.test.js test/stream-limits.test.js test/invoke-size-budget.test.js test/kernel-clients.test.js test/kernel-invoke.test.js` | 50 通过，0 失败/跳过 |
| `node test/manual/136-configuration-snapshot.mjs` | 5 通过，0 失败/跳过 |
| 改动 TS/JS/JSON 文件的 `prettier --check` | 通过 |
| `git diff --check`、`git diff origin/main -- .github` | 无空白错误；无 workflow 差异 |
| 本次知识文件的 YAML 必填字段及 context YAML 解析 | 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 通过：565 个 OKF 单元、20 条规则、3516 个本地链接；原规划阶段历史格式问题已随最新主线解决 |

手动专项的 5 项顶层测试覆盖：

1. A1/A2：动态 resolver 每轮读取一次，与固定版本控制组的 Provider revision、有效限制及终态一致。完整输出帧实测为 5488 字节，大于 5120 且小于 6144；选中旧版本时返回 HOST_FRAME_TOO_LARGE，选中新版本时 completed。
2. A3/A4/A7：第一轮等待期间修改原配置并发起第二轮，前者两次输出都保留旧快照，后者使用新配置。原对象及其选项/策略没有被框架冻结；list 返回新版本，重放和取消不增加读取次数。取消后确认源终态 cancelled。
3. A5：静态配置、动态 undefined 回退、动态结果缺项、无配置、宿主覆盖输入、保留未覆盖选项以及输入/原对象无修改。
4. A6：resolver 抛错、null 配置、非字符串 Provider 选项、数组选项、非法限制及合并后请求超限均拒绝，worker invoke 计数保持不变，Provider 启动计数不变；兄弟调用和下一合法调用完成。
5. A5：省略 Adapter 时使用 codex，两个 runtimeId 分别取得对应 revision 和限制。

每个 Kernel 复用 kernelFixture 的幂等关闭，检查 ServiceCleanupResult.complete 后删除所属临时目录。测试期间未产生清理失败。首次专项中的 list 断言误用内部字段 `probe.version`，已改为公开 `providerVersion` 后重跑通过；生产 list 行为未改。

## 验证限制

未运行全仓 `pnpm test`；本次没有公共协议或跨包 API 变更，按范围执行上述相关回归。Windows 原生、真实 Provider、真实 IM 和交互响应专项未执行，不从本地 fixture 结果推断这些场景已通过。未触发远端 CI 或新增任何 CI 检查。双轴审查见 [review.md](review.md)。
