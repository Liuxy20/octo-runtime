---
type: Journal
title: Issue 193 模型目录职责修正与文档更新
description: 记录用户审查后的 Provider/宿主责任决定、典型案例及本次文档交付证据。
tags: [architecture, adapter, documentation]
timestamp: 2026-11-01T02:50:00+08:00
---

# 决策与原因

初次分诊因消费者缺少模型列表，建议通过 Kernel IPC 新增目录操作及生成绑定。用户指出目录未必存在且可能接入各种第三方代理，明确此职责属于 Provider/宿主，并要求把案例写入 spec、架构约束和 docs。

本次撤回原建议。Provider 和实际后端定义原生模型事实；宿主掌握 endpoint、账号和产品选项来源；Runtime 仅承担现有执行适配及真实结果。官方模型目录、Adapter 类型或协议兼容均不能代表任意代理后端的模型集合；不为列表增加扫描凭据、准备认证、探测会话或静态兜底。

这是对 2026-10-16“执行基础设施不得代替产品决策”和“宿主管理 Adapter 支持范围”决策的具体化。新规则明确排除统一模型目录合同，不将既有禁止通用 capabilities 机制误写为此前已逐字禁止所有目录 API。具体 Provider 版本是否有枚举命令不作为永久架构依据。

## 文档与行为边界

- [规格](../../tasks/193-adapter-model-catalog/brief.md)记录决策、文件落点与 A1–A8 验收，旧分诊标注为已被取代。
- 权威规则回写到[架构](../../rules/architecture.md#模型目录归-provider-与宿主以-issue-193-为例)和 [Adapter](../../rules/adapter-metadata.md#模型目录不是-adapter-发现元数据)，双语 docs 同步责任、例子和 IPC 范围。
- 保留 CodeBuddy 等必要的原生模型校验和确认，不将“无自建目录白名单”扩大成绕过原生协议；显式选模、默认值、effort 及生命周期不变。

## 验证记录

| 检查                              | 实际结果                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git diff --check`                | 通过                                                                                                                                                                                                                    |
| 本次 Markdown 链接及标题锚点      | 11 份文件、736 个链接、110 个锚点，0 错误；复用 `scripts/lib/developer-doc-links.mjs` 的 `auditDocumentLinks`，包括未跟踪的 brief、triage 和 journal                                                                    |
| 本次 OKF frontmatter 及 YAML 解析 | 5 个新增/修改 OKF 单元及 context.yaml 通过；规则 frontmatter 未变，索引一致性无新增问题                                                                                                                                 |
| 双语代码块及 Mermaid 数量         | 两组架构/IPC 页面一致；没有增加可执行示例或修改图形                                                                                                                                                                     |
| 改动范围                          | 12 份文件均为 docs/.octospec 下的 Markdown 或 YAML 记录；相对 HEAD 的 `.github` diff 为空，无产品代码、schema 或绑定变化                                                                                                |
| 完整 OKF lint                     | 使用已有 `/tmp/octo-2-spec-venv/bin/python .octospec/scripts/lint.py` 执行，未通过：#267 的 brief.md、validation.md、journal 共三份文件缺少 frontmatter；均已通过 `git show HEAD:<path>` 确认是基线既有问题，本次不修改 |
| 默认开发文档检查入口              | `node scripts/check-developer-docs.mjs` 因本 worktree 缺少 prettier 依赖未能执行；默认 python3 也缺少 PyYAML。未安装或修改依赖，采用已有 Python 环境及相同的链接检查器完成本次所需检查                                  |

链接检查器从已有 `octo-runtime-issue-263` worktree 加载依赖；执行前使用 `cmp` 确认其 `scripts/lib/developer-doc-links.mjs` 与本分支完全相同，检查目标为本 worktree 的全部新增/修改 Markdown，而非其他分支内容。双语检查使用同一既有 prettier Markdown parser。

初稿曾对照 A1–A7 完成核对；此处仅为当时记录，不代表后续 A9 已验证。当前 A1–A9 的完整逐项证据见[最终验收记录](../../tasks/193-adapter-model-catalog/validation.md)，A8 的附件及阶段写回仍以 Loop 记录为准。

本次未运行 Provider/模型或功能测试；未修改产品代码、schema、生成绑定或 CI，未提交、推送或创建 PR。完整 OKF 检查的三项既有失败和默认文档入口的依赖缺失不表述为通过。

基线：`a5a32835882deab5e2364b559dd06bf1675c1335`；分支 `feat/193-adapter-model-catalog`，文档未提交。

## 后续反馈：Provider dependency 可供 Extra 使用

用户进一步明确，边界清晰并不妨碍 Provider 提供 dependency 能力供 Extra 使用。此次在架构案例、Extra 规则、brief 和双语 Extra 指南补充 Extra → 宿主注入的 dependency → Provider/外部服务：Provider 或集成模块可以实现函数，用户也可自定义 lambda；宿主装配，具体 Extra 定义并消费业务依赖。

案例同时覆盖查询模型目录和向外部服务发布业务结果。已有业务依赖入口时，用户仅需提供实现；通用框架不自动发现或调用任意函数。本次不新增实际模型查询/发布接口，不暴露 worker Adapter 实例，不新增 Kernel 业务 RPC；发送、重试、确认、取消和截止均由具体业务合同明确，现有注入、实际在途和关闭机制继续生效。

增量文档验证：全部 14 份新增/修改 Markdown 的 782 个链接、117 个锚点检查通过，0 错误；架构、IPC 和 Extra 指南三组双语代码块和图形数量一致；`git diff --check` 通过。完整 OKF lint 仍仅报告上述 #267 三项基线 frontmatter 问题，未新增问题；无代码或 CI 变化。更新版 brief 上传与阶段结果以本次 Loop 评论为准。

## 最终澄清：宿主直接传递或通过 Extra dependency 传递

用户再次明确，核心是业务数据传递与 Kernel 无关。已修正文档重心：宿主可以直接查询 Provider 或向外部服务传递数据，也可以在业务由 Extra 承载时注入 dependency 供其调用。两条路径均不经过 Kernel，Extra 是可选方式，不要求 Provider 新增 dependency 机制；复用 Provider 集成函数只是可选的实现来源。

本轮同步修改 brief 的 D8/A9、架构规则、Extra 规则、双语架构/IPC/Extra 指南及变更日志。仅修正文档表述，无代码、示例代码块或 CI 变化。对全部新增/修改 Markdown 重跑链接与锚点检查，并执行 `git diff --check`；实际结果及最新版 brief 附件记录在本轮 Loop 评论，完整 OKF 检查的既有三项失败和默认入口依赖限制仍保留，不宣称已修复。

## 纯文档 PR 交付验证

用户已授权提交、推送和创建纯文档 PR。分支已同步 `origin/main@42102c60`，索引与日志冲突保留双方记录；产品代码、公共协议、生成绑定和 CI 均无差异。主线已修复此前 #267 的 frontmatter 问题，故旧记录中的失败不再代表当前版本。

完整 OKF lint 通过：571 个单元、20 条规则、3567 个本地链接；本次 14 份 Markdown 的链接与锚点检查通过，外链未作网络验证。架构、IPC、Extra 指南三组双语代码块和图形数量一致，`git diff --check` 通过。复用已有 Python 环境和相邻 worktree 的同内容链接检查器，不安装或修改依赖。默认文档检查入口因本 worktree 无依赖未执行，不等同于完整 docs:check 通过。额外尝试全部变更文件 Prettier 检查时发现既有排版差异；文档不在现有 format:check 范围内，保留原有段落和示例排版，不扩大格式修改范围。

按 code-review 进行规范与规格两轴审查，各 0 项问题。本次仅文档验证，不运行功能或真实 Provider 测试，不自动关闭原 issue，不合并。最终提交版本与 PR 链接写入 Loop 交付评论，避免在提交内自引用。

## PR 审查与 CI 修正

远端审查指出最终验收缺少 A9 显式证据：已补充独立 `spec.yaml` 和具有完整 OKF YAML frontmatter 的 [review.md](../../tasks/193-adapter-model-catalog/review.md)、[validation.md](../../tasks/193-adapter-model-catalog/validation.md)，逐项覆盖 A1–A9。原知识文件已有 frontmatter，独立 YAML 合同此前未交付，本轮补齐。

公共 `KernelClient.list()` 与 Core `AgentExecutor.list()` 的区别已沿源码及本机临时 Kernel 实测确认；公共 IPC 经 worker 调用 `describe()`，返回真实探测信息。双语 IPC 和架构规则补充此区别。真实已运行 Kernel 的 Adapter 列表脱敏后已发布到 [PR 评论](https://github.com/Mininglamp-OSS/octo-runtime/pull/284#issuecomment-6553089993)，请求重新审查，不将此证据解释为模型目录或模型调用成功。

CI 运行 `41271393276` 的六个矩阵任务均被本次 docs 新增 fragment 链接阻断，Gate 随之失败；此前替代检查只验证链接存在和锚点有效，没有复现默认检查器对 fragment 的禁令，属于验证入口遗漏。将双语架构/IPC 的相关链接改为整页链接，保留检查器和 CI 范围不变。

分支快进至 `82a88313` 后，本地使用 frozen lockfile 补齐缓存依赖，无依赖文件变更；`pnpm build`、完整 `pnpm docs:check` 通过（18 对页面、37 Markdown、22 JSON、16 Mermaid、12 Context，4 项示例测试全过），完整 OKF lint 通过（586 单元、20 规则、3606 本地链接）。本次 Markdown 链接及 diff 检查通过；最新完整证据见 validation。未执行模型调用、native 或全量运行时测试；远端结果按修正提交重新确认，不沿用历史失败或提前声称通过。

## IPC 摘要一致性补正

最新审查已认可实现路径与规格，指出方法表、wire 返回值表仍保留旧的纯元数据描述。按实际合同统一双语文档这两处摘要，明确公共列表包含可用性、不可用原因、路径和版本，同时保留 Core `list()` 是另一入口及 probe 不证明登录/模型权限的限制。仅文档修改；交付前重新运行完整 `pnpm docs:check`、OKF lint 和 `git diff --check`，结果随交付说明记录。

用户明确对外供 Extra 使用的是 `KernelClient` 服务。公共 IPC 文档已收敛为一个合同，不再让消费者辨认 Core 内部同名方法；内部调用区别仅在架构和审查证据保留。公共合同明确列表仅覆盖当前 Kernel 已装配的 Adapter，包含真实 probe 字段，不代表模型目录、登录或账号权限。

本轮验证通过：完整 `pnpm docs:check`（18 对页面、37 Markdown、4 项示例测试）、OKF lint（586 单元、20 规则、3608 本地链接）及 `git diff --check`。此次仅四份文档/记录变化，无实现或 CI 修改。该结果对应本轮文档修正，远端 CI 按推送后的新提交确认。
