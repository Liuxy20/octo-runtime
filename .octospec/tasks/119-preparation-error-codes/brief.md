---
type: Task
title: Issue 119 准备期安全原因保真
description: 在双渠道准备失败边界保留已定义的目录冲突与规则协议原因，并显示固定安全提示。
tags: [channel, context, testing]
timestamp: 2026-10-29T00:00:00Z
slug: 119-preparation-error-codes
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/119
---

# 目标与责任归属

用户授权独立 worktree、OctoSpec、可执行性大于 95 后实施、本地代码审查及提交 PR。基线为 origin/main@dcca46fb0eaaa3be675432321f704de92dbdbce0，分支为 fix/119-preparation-error-codes。

业务目标是在执行前失败时让宿主与用户区分固定目录冲突、规则协议故障。宿主决定输入和配置，渠道负责准备、既有目录约束与安全反馈，Kernel/Adapter 保持单次执行职责。显式输入仍为现有 Bot 配置和本轮 Context；失败不修正输入、不自动切目录、不替换规则或重新提交。两个 Extra 各自维护渠道准备期提示，不新增跨渠道生产依赖或通用协议中的 IM 业务目录。

## 关键合同与设计

- 复用 IM_AGENT_WORKDIR_FIXED、IM_RULE_PROTOCOL_INVALID；不新增 errCode/errMsg 字段、OH-* 公共分类、FailureEnvelope 字段或公共 API。
- 准备期 catch 使用精确 Map 查找以上两个 Error.message。命中时向既有 onDiagnostic 传原因码，并保持 IM_CONTEXT_PREPARATION_FAILED 汇总诊断。既有 IM_CONTEXT_LOADING_* / IM_CONTEXT_RESULT_* 诊断保持。
- 命中后使用固定文案，分别说明工作目录冲突或规则格式不符合协议，并保留“尚未发起执行”。未知异常不得原样输出；含路径/正文/凭据的错误和带私有后缀的相似码不进入新增白名单。
- Gateway 图片错误及图片通用提示沿用现有行为；在图片消息的 Context 准备失败时，已知准备原因优先，避免误报图片故障。
- invoke=0、cancel=0，不伪造 Provider 事件、Host 终态或错误卡片，不污染连接状态，不改变 session/规则失效与队列释放。
- Gateway 的真实 dispatcher 目录冲突及真实规则读取器畸形返回均在本地验证；WeCom 的规则码用 buildContext 注入，明确不是其内置规则读取实网验收。

## 可执行性评估

实施前工程判断为 **97/100**，不是成功概率或实测通过率。需求与责任 20/20，代码路径定位 20/20，兼容性与安全边界 19/20，可复现和验证计划 19/20，环境与交付 19/20。

依据：两个原因的真实抛出点、两渠道 catch、onDiagnostic 签名和已有测试 fixture 已读取；不涉及持久化、迁移、依赖或协议；Node 24.19.0 和指定 pnpm 11.19.0 可用，GitHub 已登录。剩余不确定性是新 worktree 安装/构建结果、完整相关回归、跨平台及真实 IM 展示，实施后以实际结果替代判断。

## 步骤与验收

1. 在 test/manual/channel-preparation-errors.test.mjs 新建显式手动专项；原代码应在两个原因的诊断/提示断言失败。专项不进入现有默认测试 glob，不改脚本或 CI。
2. 两渠道增加有限原因到固定文本的映射，保持所有未知错误与已有图片/Context 分支。
3. 手动专项覆盖双渠道原因、未知 Error、非 Error、相似码及原型属性名、既有 Context 诊断；Gateway 覆盖真实目录冲突、真实规则格式错误、图片兼容、恢复后下一条正常执行。断言未调用 invoke/cancel、单次安全回复、无私有数据泄露、连接健康和调度释放。
4. 执行 workspace typecheck/build、lint、命名、格式检查，已有渠道/Context/规则相关回归和 OKF 检查。按本任务局部范围运行，不以测试数量代替真实验收。
5. 固定 main 基线，按 code-review 技能执行 Standards 与 Spec 两轴审查，修复有效问题。提交英文 Conventional Commit，保留已配置 author 并追加一次 Codex trailer；英文 PR 到 main，不自动合并或发布。

## 范围外与回滚

不重做 #117/#118 的共享失败投影，不统一所有准备期错误、修改其他业务策略、复制公共 OH-* 错误目录、增加执行重试或改变状态接口。没有真实 Provider/IM 发信及 Windows/Linux 真机验收时明确 not run。CI workflows/jobs/matrix/triggers/checks/gate 及默认测试范围保持原样。回滚仅撤销本分支局部代码与手动专项，不操作 Runtime Home、凭据、配置或用户数据。
