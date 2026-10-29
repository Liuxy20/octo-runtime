---
type: Task
title: Issue 224 双轴代码审查
description: 固定 main 基线并行审查工程规范及需求实现，记录发现与修复证据。
tags: [review, session, testing]
---

# 审查范围

使用 code-review 技能，规范与需求由两个独立审查 Agent 并行检查。固定点 `5cc600e759daca3cae7eb3521d2e300389e80410`，命令 `git diff 5cc600e759daca3cae7eb3521d2e300389e80410...HEAD`；首轮提交 `ac101dc feat(session): support caller names and resume OpenClaw sessions (#224)`。先确认基线有效、diff 非空；后续 schema 修复以工作树 diff 单独复查。

需求来源为 [Issue 224](https://github.com/Mininglamp-OSS/octo-runtime/issues/224) 和本任务 [brief](brief.md)。规范来源为用户 AGENTS 指令、CONTRIBUTING 与 architecture/engineering/protocol/invoke-input/session-reset/openclaw/channel-integration 等已读规则。跳过工具能检查的格式问题；坏味道只作为判断线索，仓库规则优先。

## Standards

0 项发现。调用方命名、Core 唯一默认入口、原生句柄独立、Gateway binding 与 reset 代次保护符合职责边界。协议与生成产物同步，无新增命名 registry；无高置信度坏味道问题。

相对固定点 `.github`、`package.json` 和锁文件无改动。保留 Git 配置作者，英文提交与 Codex trailer 符合用户约束。真实 IM 阻塞与 27 版本源码覆盖均没有表述为全面真实验证。

## Spec

1 项发现，已修复，无未解决项。`protocol.schema.json` 中公开和内部 `sessionName` 的 `.*` 不跨 U+2028/U+2029：运行时接受的合法名称会被 wire 拒绝，分隔符后的控制字符可能反而通过 wire，违背统一校验要求。

两处正则改用 `[\s\S]*`，补充合法分隔符及其后非法控制字符回归。旧 schema 先复现失败；修复后审查 Agent 独立执行名称专项 3/3 通过，生成产物也重新生成。

其余没有高置信度规格偏差。真实 IM 仍 BLOCKED，真实 ACP 尚未执行；这是验收范围限制，不以 Provider 直连通过替代，详见[验证记录](validation.md)。

Standards：0 项；Spec：1 项已修复，当前 0 项待处理。

# PR 外部评审后的追加修复

上述结论仅针对初轮 TS 边界审查。PR 外部评审后来复现 Go RE2 不支持 lookahead、拒绝所有显式名称的 P1；此前原生测试缺少名称 fixtures，漏掉了真实跨语言行为差异。

用户进一步明确名称仅由 ASCII 英文字母、数字和 `-` 构成，本轮据此收紧合同。两份 wire schema 使用现有 `not` 配合非法字符类，无前瞻或语言相关 Unicode 空白。30 项共享 fixtures 在 JS 及两个原生 codec 上覆盖两种 wire；Go/Python 各 418 项通过。最终补充审查以远端原有 head `971017dad79f5ae39f9f581ed33a1f4c78017020` 为固定点，单独核对本次修复。

## Standards 补充结果

审查提交 `58fcfd4`，0 项发现。审查者独立调用原生 driver，Go/Python 各 60 项名称输入通过；确认现有 `not` 实现可拒绝非法字符、接纳合法名称。合同、双语文档与生成产物一致，未新增 native 特判或 CI 范围。

## Spec 补充结果

0 项未解决问题。按用户最新 ASCII 要求审查，公开/内部 wire 与 TS 校验一致，没有末尾换行放过、缺省值改变或原生 ID 改写。审查者独立执行 JS 名称与 InvokeInput 8 项通过，覆盖范围与实际未验收项如实记录。

# 2026-10-29 完整 PR 复审与修复

固定完整 PR 比较命令 `git diff dcca46fb0eaaa3be675432321f704de92dbdbce0...HEAD`，复审 head `5514d83`；本轮修复额外核查 `git diff HEAD`。两个审查 Agent 分别检查规范与需求，沿用上述规范来源及坏味道基线；最新用户决定优先于历史 ASCII 合同。之前的局部检查漏掉生产者与公共合同不匹配，前次“无未解决项”不能代表 Gateway 的任意合法 opaque 地址可用。

## Standards

1 项 P1，已修复。共享 OpenClaw 原生 session 时，派发前旧无 runId 审批会被作为本轮审批；这违背 OpenClaw 规则中不能接纳前一轮广播的要求。原生源码及 Adapter/bridge 回归复现均确认可达。现在过滤派发前旧审批，并在同一有界集合预算内登记旧 ID，防止后续重播。当前新无 runId 实时审批照常处理；独立 targeted tests 10/10，Go/Python 各 76 个名称输入通过。

复核未发现新的高置信度可修复缺陷。原生缺 runId 且旧审批直到派发后才首次可见时，或并发共享 key，仍无法仅凭 sessionKey 确定归属；不宣称全部无 runId 广播均有严格逐轮关联。

## Spec

1 项 P1，已修复。Gateway 直接拼接 opaque 地址，可能违反公共名称字符/长度合同，导致合法私聊、群、话题请求无法到达 Provider。按用户最新明确选择，公共名称允许标点/Unicode 文本；Gateway 自行限长与处理展示片段的控制字符，完整 scoped binding 不变。旧非法或缺失名称修复不切换业务 session、generation 或原生句柄。

独立复核名称/渠道回归 19/19、审批回归 7/7；新用例真实经过 Core 输入准备，覆盖长地址、中文、旧坏名及 `/new`。未新增命名 registry 或其他调用方策略。真实 IM、通用 ACP 尚未验收，不能用离线回归替代。

Standards：1 项 P1 已修复，0 项待处理；Spec：1 项 P1 已修复，0 项待处理。验证范围及原生关联字段限制见[验证记录](validation.md)。

# 延迟首次出现的无 runId 审批：后续纠正与复审

Jerry-Xin 与 yujiawei 针对远端 head `45041cf` 提出了同一 P1：未知旧无 runId 审批可在派发后首次出现，前一轮复审把该授权缺口作为剩余限制保留，结论不充分。先合入 main 至 `fa42979`，再以该已确认有效的 HEAD 为固定点审查 `git diff HEAD` 的修复；完整 PR 基线更新为 `1dd5a09`。用户已知晓合法当前无 runId 续聊审批也会失败的兼容代价。

## Standards

延迟首次出现问题已关闭，无新的高置信度缺陷。未知归属审批在进入交互桥前使队列失败并请求取消，ask/full_access 均不能批准；队列立即清积压，错误不会被后续成功终态覆盖。匹配 runId 与 fresh 独立会话仍正常。独立审批 12/12 通过，CI 范围未扩大。sessions.abort 发出不代表原生终止已确认。

## Spec

0 项待处理。修复不根据 sessionKey、到达时间或不完整 pending snapshot 认定当前轮次，不发送 resolve、不 fresh、不改变权限。已知旧 ID 继续过滤；续聊必须由 Provider 给出匹配 runId，无法证明即明确失败；普通续聊仍复用原生 session。独立审批 12/12 通过。文档明确了合法但缺 runId 的续聊审批不再支持；真实 IM、ACP 和旧 Gateway 审批未全面验收。

Standards：原 P1 已关闭，0 项待处理；Spec：0 项待处理。当前安全规则取代前文保留歧义的旧结论，证据与兼容边界见[验证记录](validation.md)。
