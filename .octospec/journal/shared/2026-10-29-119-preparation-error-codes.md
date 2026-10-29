---
type: Journal
title: Issue 119 准备期安全原因修复与验证
description: 独立 worktree 的准备度、原始失败、修复后专项及相关回归记录。
tags: [channel, context, testing]
timestamp: 2026-10-29T00:00:00Z
source: self
---

# 范围与实现

- 需求：[Issue #119](https://github.com/Mininglamp-OSS/octo-runtime/issues/119)。用户授权新 worktree → OctoSpec → 可执行性大于 95 → 实施 → code review → PR；不自动合并或部署。
- 基线：main@dcca46fb0eaaa3be675432321f704de92dbdbce0；分支 fix/119-preparation-error-codes；[brief 与 97/100 工程评估](../../tasks/119-preparation-error-codes/brief.md)。该评分不是实测通过率或成功概率。
- 两渠道仅在准备期 catch 精确匹配两个既有码，以固定安全文本区分目录冲突和规则协议故障，并向既有 onDiagnostic 保留原因码及汇总码。
- 公共接口、FailureEnvelope、OH-* 目录、Kernel、Provider、执行事件、连接状态、默认测试与 CI 保持原范围；新增 Map 各仅两个条目。两个 Extra 保持独立包所有权，不为两条渠道提示新增生产依赖。
- 实现差异：两份产品文件共新增 32 行、删除 8 行。专项包含独立 fixture、两个真实抛出路径和失败恢复，因此验证代码多于产品代码。

# 本地验证

环境：macOS arm64，Node.js v24.19.0，pnpm 11.19.0（通过 npx 显式选择，机器默认 pnpm 为 12.4.1）。worktree 冻结安装 `npx --yes pnpm@11.19.0 install --frozen-lockfile --ignore-scripts` 成功，无 lockfile 变化；构建绑定基线加本次 dirty 改动。

| 检查 | 实际结果 |
| --- | --- |
| 原始基线构建后的手动专项 | 25 项，18 通过、7 失败、0 跳过；失败为双渠道两原因及 Gateway 真实目录、规则、图片消息 Context 故障的提示不符 |
| 修复后 `node --test test/manual/channel-preparation-errors.test.mjs` | 25 通过、0 失败、0 跳过 |
| `node --test test/im-*.test.js test/channel-packages.test.js test/channel-config-bounds.test.js test/context-loader.test.js test/gateway-host-session-store.test.js` | 473 项，472 通过、1 条件跳过、0 失败；跳过为未启用 expose-gc 的 Context heap 检查 |
| `npx --yes pnpm@11.19.0 typecheck` | 包含 workspace build，通过；既有 Vite chunk/use-client 警告未修改 |
| `npx --yes pnpm@11.19.0 lint` | 构建完成后通过；第一次与 clean/build 并行时类型解析失败，串行依赖就绪后重跑消除 |
| `npx --yes pnpm@11.19.0 lint:names` | 通过，无新 finding |
| `npx --yes pnpm@11.19.0 format:check` | 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 任务、规则、journal 记录检查通过；审查记录收尾后再次检查 |
| `git diff --check` | 通过 |

专项断言双渠道 invoke=0、cancel=0、无伪造失败卡片、单次安全回复、原因及汇总诊断、连接仍 online/error=null、调度对象释放。未知 Error、非 Error、带私有后缀的相似码、原型属性名保持通用；既有 Context 诊断及图片专用/通用回复保持。目录例使用真实 dispatcher 的相冲突 Context，规则例使用真实 build_im_contexts/getGroupMd 加本地 fetch 返回畸形版本；两例不读写本机真实业务目录或规则。失败后下一条有效消息可正常 invoke 并返回 answer。

# Non-gating live acceptance

真实 Provider/IM 发信、平台 UI、Windows/Linux 真机与全仓 test:suites 均 **not run**。本项不改变 Provider 行为；新增专项使用真实 Channel 应用实现、真实 Gateway 输入校验与规则读取路径，Transport/Kernel/fetch 为本地 fixture，明确不是外部平台联调。WeCom 两个码均由 buildContext 注入，不代表新增其目录校验或内置规则读取能力。回归中既有 loopback/受控 IPC 不作为实网证明。

# CI 范围

对目标 main 检查 .github/workflows、package.json 与 pnpm-lock.yaml，无差异。新专项放在 test/manual/*.test.mjs，只在显式命令运行，不匹配既有 test/*.test.js 和 protocol 包默认 glob；不增加默认测试开关、workflow/job/matrix/trigger/required status/gate。

基线 GitHub 实际检查包括六个 Linux/macOS/Windows × Node 24/26 job、CI Gate、Secret Scan 和 Update Release Draft。PR 的既有触发和检查需在提交后单独读取，不能以本地通过声明托管检查通过。

# 审查与交付

实现提交 fb299bb，以固定基线 dcca46fb0eaaa3be675432321f704de92dbdbce0 执行两名独立 Agent 的 Standards/Spec 只读审查，均 0 项问题；Spec 轴独立重跑专项 25/25 通过，不与首轮结果累加。详见[两轴报告](../../tasks/119-preparation-error-codes/review.md)。后续只有文档收尾，无产品代码变化。

英文提交保留已配置 author superalsrk / lvsijia@mininglamp.com，并在最终 trailer block 追加一次 Codex co-author。PR 目标 main，合并和部署均未执行；托管 CI 状态由 PR 页面单独报告，不以本地结果替代。
