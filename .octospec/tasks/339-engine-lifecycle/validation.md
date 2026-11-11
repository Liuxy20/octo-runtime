---
type: Validation
title: Issue 339：实现、审查修复与验证
description: 记录宿主 Engine 所有权改造的回归、真实 Codex、包外消费及未验平台，不将规划评分作为测试结果。
tags: [architecture, lifecycle, testing, review, validation]
---

# 基线与范围

2026-11-09，独立 worktree `/Users/lvsijia/.codex/worktrees/issue-339-engine-lifecycle/octo-runtime`，分支 `plan/issue-339-engine-lifecycle`。初始基线157fabb7，实施期间 fast-forward 至最新 main `d5aeae707fcda0b138b360136f164c085c9a5e87`，保留 #337。以下验证针对该基线上的本任务未提交实现，不复用历史 #313 通过记录。原 checkout 未修改。

平台 macOS arm64，Node 24.22.2，Codex CLI 0.164.0。95/100 是[规划自评](assessment.md)，不是实现质量分数。实现及 docs 已完成；review/autofix 见[审查](review.md)。授权交付为 commit/push 与 PR → main，不包含合并或发布。

## 本地检查

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 通过，包含完整 workspace build 与公共导出类型检查 |
| `pnpm lint`、`pnpm lint:names` | 通过 |
| `pnpm test:suites` | 1609项：1548通过、61跳过、0失败；复用前述build，等价于既有pnpm test的执行阶段 |
| `pnpm docs:check` | 公共examples类型、双语文档/链接检查及4项docs测试通过 |
| 显式manual 7文件联合运行 | 136通过、0跳过、0失败，命令见下文 |
| `pnpm pack:release` | 生成Runtime与client tgz，仅本地打包，不发布 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit d5aeae707fcda0b138b360136f164c085c9a5e87` | 离线安装、公共类型、原生Kernel、SDK recovery probe、CLI Kernel、卸载保留Home通过；dirty构建不使用require-clean |
| `node test/manual/codex-service-package-313.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | 独立消费者strict types；direct3轮、IPC3轮、PID复用及owner清理通过 |
| OKF/格式/diff | `uv run --with pyyaml python .octospec/scripts/lint.py`通过：725个OKF单元、20条规则、3386个本地链接；`pnpm format:check`与`git diff --check HEAD`通过 |

手动联合命令：

```sh
node --test test/manual/339-engine-lifecycle.test.mjs \
  test/manual/codex-service-lifecycle-313.test.mjs \
  test/manual/codex-approval-kernel.test.js \
  test/manual/codex-approval-delivery.test.js \
  test/manual/codex-async-questions.test.mjs \
  test/manual/codex-async-recovery.test.mjs \
  test/manual/codex-async-supplement.test.mjs
```

## 真实服务证据

均显式运行，只终止本脚本owner创建的PID；不打印凭据、认证内容或会话正文，不删除实际CODEX_HOME。

| 命令 | 结果 |
| --- | --- |
| `node test/manual/codex-service-live-313.mjs --mode direct` | 5轮；复用PID14102，恢复后PID17560、incarnation3；空闲/活动故障恢复通过，被中断调用失败且无重放，ownerCleanup=true |
| `node test/manual/codex-service-live-313.mjs --mode ipc` | 5轮；复用PID14388，恢复后PID16745、incarnation3；空闲/活动故障恢复通过，被中断调用失败且无重放，ownerCleanup=true |
| `node test/manual/339-engine-sharing-live.mjs --live` | 3轮；两个Core并发借用同一PID48807，Provider session不同；关闭A后B仍成功且PID不变；宿主owner完整回收 |

双Core是关闭权与关联隔离的验证场景，不新增业务部署要求。真实专项没有请求人工审批；交错审批、迟到acquire和坏disposer等失败边界由可控fixture验证。

## 验收映射

| 条目 | 证据与边界 |
| --- | --- |
| A01/A12 | 默认manifest、CLI run/Playboard现有回归；313 doctor专项实际调用CLI，启动前无Engine，启动后文本/JSON读取同一owner_pid；包外CLI启停通过 |
| A02/A10 | 公共SDK及tgz；339初始化失败、逆序回滚、invalid Adapter、坏cleanup shape、有界幂等清理、保留所有权记录通过 |
| A03/A11 | fixture共享Engine/审批关联；真实共享3轮通过，未做真实人工审批交错 |
| A04/A05/A06/A07 | 默认及313/339/async专项覆盖取消、迟到租约、隔离、恢复和无重放；真实direct/IPC故障恢复通过 |
| A08/A09 | 缺失/相对Home拒绝，无SDK默认fallback；冲突覆盖无spawn；临时Home内容和权限前后相同；真实续聊/包外owner关闭通过 |
| A13/A14/A16 | direct Core、Kernel IPC、CLI、Playboard、包外公共接口、双语docs有本地证据；任意类构造函数/闭包黑盒Adapter可注册且不关闭业务client；Electron未实测 |
| A15 | .github、package.json、pnpm-lock.yaml、默认selector与Gate脚本相对main无变更；新增专项留在test/manual显式运行 |

## 首次失败与修复

- review前4项定向回归均失败：无效Adapter漏回滚、依赖清理非逆序、初始化诊断丢失pending/failed信息；修复后通过。第三方malformed cleanup返回值可使closed挂起，新增有界回归后通过。
- 旧package313消费者使用#337前签名；迁移workdir到agentEnv、使用当前公共invoke参数后，strict types和6轮通过。
- 旧审批fixture阻塞写入256/512条，先触发基线已有128条writer上限。改为64条分批背压，保持总审批数和人工256名额；超限/写失败专项保留。现在证明分批累计512成功，不证明一次突发512成功。lost ACK改用持续活跃turn，消除默认20ms完成定时器竞态。136项通过。
- 曾将lint与会清空dist的build并行导致缺失类型产物错误；按构建完成后检查通过，最终结果不计该环境时序失败为代码缺陷。

## 限制

未做Linux/Windows原生Engine生命周期、真实Electron或真实IM联调；模拟平台回归不等同原生验证。已有CI跨平台结果以PR checks为准，不新增专项CI。真实人工审批/elicitation未在本轮调用。GitHub检查、合并和发布状态不由本地通过推定。

本地原始输出位于执行机 `/tmp/octo339-*-final-review.log`、`/tmp/octo339-typecheck-autofix.log`、`/tmp/octo339-live-{direct,ipc}.log`、`/tmp/octo339-sharing-live.log`。这些是临时日志，以上表格是仓库中的持久证据摘要。
