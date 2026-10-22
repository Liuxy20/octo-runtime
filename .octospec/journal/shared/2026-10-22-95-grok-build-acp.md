---
type: Journal
title: Issue 95 Grok Build ACP 本地实现与验证
description: 记录 grok-build 包内的 ACP 适配、调用隔离、资料索引、真实流与续聊，以及发行包验证边界。
tags: [adapter, protocol, invocation, testing]
status: locally-validated
timestamp: 2026-10-22T00:00:00Z
---

# 实施与验证

用户要求从最新 main 建 worktree，尝试 Grok Build ACP 接入，先收集使用资料并建立 OctoSpec reference。
基线为 `origin/main@102fb9caf995d9eb1ac53acaf5b91922be4f023d`，分支 `feat/grok-build-acp`，
worktree 为 `octo-runtime-grok-build-acp`。初次本地验证阶段未提交、推送、创建 PR 或发布。

资料、固定版本和真实 Provider 验证见 [reference](../../tasks/95-grok-build-acp/reference.md)，
范围与合同见 [brief](../../tasks/95-grok-build-acp/brief.md)。

## 实现

- 新增 private workspace 模块 `@mininglamp-oss/octo-runtime-adapter-grok-build`，type `grok-build`，canonical-only。
- 仍用共享 ACP client，每轮拉起 `grok --no-auto-update agent --no-leader stdio`。Grok CLI 拥有原生工具与模型调用；源码仅供字段参考，不成为运行依赖。
- Grok 包负责 ACP 认证握手、私有 session metadata、精确缺失会话判定、model/effort/mode setter、追问与计划 review 映射、用量和结果校验；harness 的登录、授权及凭据准备归使用者与宿主，不把 Provider 分支放入 Core、Kernel 或 Host SDK。
- 按用户追加约束撤回共享 ACP client、通用 ACP adapter、SDK 审批桥及通用取消测试的本次改动，以上文件与当前基线无差异。标准 RPC、更新队列和工具规范化复用既有实现；版本/认证/配置/结果校验及取消时序放在 `grok-build` 包内。
- `grok-build` 的每次调用单独建立客户端与交互桥。包内客户端扩展只观察本进程的 RPC 错误和扩展请求；EOF 结束本客户端并保留 stderr 诊断。权限仍委托原 SDK 桥，原生问题由本调用维护 pending/timer/write acknowledgement，不改变其他 ACP 适配器的交互行为。
- 公开错误保留容量错误的 code 和安全测量字段，继续脱敏环境凭据且不带回原始 cause。
- CLI 默认 manifest、CLI/root 生产依赖和 lockfile 包含新包。源码 SDK 直接 import/serveWorker，示例位于 adapter 的 examples 目录；公开 SDK docs/examples 不依赖 private workspace 包。
- 显式 sandbox 和无法保留的 MCP 字面量拒绝；assisted 不支持。认证、版本与启动错误给出操作提示，Provider 错误按本轮环境凭据脱敏，原始 cause 不带回公开日志。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| pnpm build | 通过；仅既有 WebUI chunk size 提示 |
| pnpm exec tsc -p tsconfig.json --noEmit | 通过 |
| pnpm lint / pnpm lint:names | 通过 |
| 修改的代码、配置和脚本 Prettier；git diff --check | 通过 |
| pnpm test:suites | UI 35 通过；Node 1511 通过、35 跳过、0 失败（共1546项） |
| pnpm docs:check | 双语17对页面、35份Markdown、4项行为测试和示例编译通过 |
| 源码 SDK worker 示例 | 单独严格 TypeScript 编译通过，显式 types=node；不使用 CLI manifest |
| node scripts/verify-grok-build.mjs | macOS arm64，grok 1.0.67，SDK 两轮真实文本流与跨进程续聊通过 |
| node scripts/pack-release.mjs；node scripts/verify-release.mjs 实际 tgz | 离线安装、默认13个适配器、新包导入、公共SDK类型、原生Kernel和CLI流程通过 |
| OctoSpec lint | 仅 main 既有 `已退出的文档目录仍存在: docs`，未改动该规则或删除文档目录 |

fixture 覆盖初始化、认证错误、版本、环境隔离、原生系统 rules、流式正文/思考/工具/用量、model/effort/plan、
stdio/HTTP MCP 载体、显式恢复/精确缺失回退、审批/追问/计划原请求回复、迟到回复、取消、断流、退出、
不完整 prompt result、Host 清理失败抑制成功终态，以及 unsupported sandbox/MCP literal 的启动前拒绝。

首轮全量失败项包含新增 adapter 后的固定目录数量，已同步注册数量；隔离修订撤回了通用取消断言改动。
发行验证发现源码 SDK 示例不能混进公开 SDK 示例目录，移动后仓库外安装与类型验证通过。

真实 CLI 首轮网络重试没有正文，用户开启代理后相同 ACP 路径成功。未把网络等待当作协议不兼容，
也未改变用户的代理、认证或持久配置。真实验证只读且 ask 模式，不自动批准工具。
真实工具/审批/问题/计划、MCP 连接、图片和 Linux/Windows 尚未验收；fixture 不能替代这些原生验证。

## 调用隔离修订

新增并发 fixture：同一 `grok-build` adapter 的两个 bot 与一个通用 ACP bot 同时等待交互；
原生会话 ID 和反向请求 ID 故意相同。向错误调用回答被拒绝；第三个 `grok-build` 调用失败、
取消第一个调用后，另一个 `grok-build` 和通用 ACP 均正常完成。检查进程 PID、环境、cwd、
session/cancel 路由和结束后的调用 ID 复用。另覆盖 EOF 保留 stderr 诊断与容量错误测量字段。

上表全量结果为首次实现的验证记录。隔离修订重新检查：全量 Node 1514 通过、35 跳过、
0 失败（共 1549 项），UI 35 通过；build、类型、lint、命名、格式、文档和实际 tgz 离线安装通过。
真实 SDK 首次复测返回 `run.failed`，当时脚本未记录失败 payload，原因未确认；补充失败诊断后，
重试两轮文本流与跨进程续聊均通过。OctoSpec lint 仍只有既有 docs 目录规则冲突。

## PR 交付授权

用户追加授权将当前实现 rebase 到最新 main、提交、推送、创建 PR 并合并 main。
目标 main 为 `4857d0ea4fe7a056f5bbfb226eec6b92d139a372`（#102）。保留配置的作者信息，
英文提交附带 Codex 协作者 trailer。GitHub main 要求 `CI Gate` 与至少一位评审者批准；
合并遵循仓库保护规则，不绕过评审要求。发行发布未获授权。

rebase 已完成，仅工程日志的新增记录冲突，保留双方内容；共享 ACP client、通用 ACP adapter、
SDK 审批桥和通用取消测试相对新 main 无差异。基于新 main 的全量 Node 1610 通过、35 跳过、
0 失败（共 1645 项），UI 35 通过；类型构建、lint、命名、格式、文档、SDK 示例编译及实际
tgz 离线安装验证通过。第一次全量与其他检查并发运行时，既有 IM 等待和 WeCom 心跳计数两项
失败；所在两文件单独复跑 14 项通过，暂停其他重检查后完整重跑通过，未改动这些测试或生产逻辑。
OctoSpec lint 仍只有既有 docs 目录规则冲突。

## PR 104 认证责任修正

用户进一步明确：所有 Provider harness 的可用性、登录及认证来源归使用者、宿主与 harness，Runtime 不感知凭据来源。外部评审指出 API-key 方式虽已由 harness 广告，旧实现仍因父进程未提供特定变量而拒绝握手；该条件越过职责边界。

删除 adapter 对专属认证环境变量的检查及相应诊断要求，仅按 harness 广告顺序选择受支持的非交互 ACP 方法，由 harness 自行解析并验证认证材料。拒绝后不切换方法、不创建会话。源码与测试不再包含该专属变量名，通用环境透传和敏感值脱敏保留。

基础架构规则、根架构说明、双语开发者架构及 adapter 使用说明同步强调此责任边界。新增 API-key-only、API-key 与交互混合、广告顺序、cached-token-only 和认证拒绝不回退五项回归；测试只使用模拟凭据脱敏，不读取真实凭据存储。

本轮验证：Grok fixture 28 项通过；完整 Node 1615 通过、35 跳过、0 失败（共 1650 项），UI 35 项通过；完整构建与类型、lint、命名、格式、双语文档及 `git diff --check` 通过。共享 ACP client、通用 ACP adapter、SDK 审批桥和通用取消测试仍与 main 无差异。OctoSpec lint 仅保留既有 docs 目录冲突。本轮未重复真实模型调用或发行安装；此前记录的验证结果保留其原有时间和范围。
