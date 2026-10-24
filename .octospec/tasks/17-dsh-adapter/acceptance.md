---
type: Task
title: Issue 17 DSH 实施审查与验收
description: macOS 本机 Desktop、公开 SDK/CLI、发行包及真实 IM 证据，明确 DM 和 Windows 未通过项。
tags: [dsh, testing, review, lifecycle]
timestamp: 2026-10-24T00:00:00Z
---

# 基线与环境

基线 `67e2e509ed7a5be03255c76810cdd791b79475ab`，分支 `feat/17-dsh-adapter`。最终代码由本记录所在提交标识。macOS arm64、Node 24.19.0、pnpm 11.19.0；Desktop/runtime 0.2.1-rc.3、Desktop commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`、SDK wire 0.0.1，profile sdk / deepseek-account / deepseek-flash。不安装、修改认证或覆盖用户 profile。

95/100 是实施前准备度自评，见 [assessment.md](assessment.md)，不作为交付完成率。当前实现支持已固定版本和显式 full_access，未声称跨版本、实时逐 token、交互审批或原生 Windows 已验收。

# 可复现检查

| 检查 | 结果和边界 |
| --- | --- |
| pnpm build；tsc -p tsconfig.json --noEmit | PASS，含 CLI、公共导出和协议生成 |
| pnpm lint；pnpm lint:names；pnpm format:check；pnpm docs:check | PASS，文档示例真实编译，双语入口检查通过 |
| Node DSH 定向测试 | 25 项 PASS，覆盖结构、边界、错误、取消、清理、会话、日志及下述修复回归 |
| 全量 pnpm test:suites | Node 1771 项，1731 PASS、40 个环境跳过；WebUI 35 PASS；无失败 |
| node scripts/pack-release.mjs；仓外离线安装 tgz | PASS，单发行包无隐式 Provider 下载；公开 SDK 导入并通过独立 worker 调用真实 Desktop |
| 发行包 CLI Kernel | PASS，隔离 Home 启动、probe dsh 可发现版本、KernelClient 真实执行完成；关闭已确认 |
| node scripts/verify-dsh-live.mjs | PASS，真实首轮/同 ID 持久恢复、文件写入及工具事件、缺失会话恢复失败、真实 provider 错误、取消/兄弟任务/后续恢复；close.complete=true、pendingResources=[] |

输入包括 Unicode/CRLF；fault fixture 覆盖 enqueue 无 receipt、无 terminal、空回答、异常 EOF、无效 JSON、冲突序号、初始化/请求 deadline、版本不符、原始行和队列超限、清理失败及晚到取消。容量原因码保持共同分类。真实 SDK 版本仅在 durable assistant/message 提交时发布 compact stream；增量重放和快照对账不证明逐 token 实时输出。

# 在线 IM 验收

测试 endpoint 为 `https://im-test.deepminer.com.cn`。两只既有专用 User Bot，核对身份及共享 Channel_QA_ 群成员后执行；群 fingerprint `d010c2b3cd5a`。凭据从受保护外部文件读取，未写入仓库或验收日志。仅向专用测试会话发送验证文本。测试使用既有 Octo CLI 和 Gateway，生产 Gateway 没有 DSH 特殊分支。

命令（凭据文件由环境变量指向）：

```sh
OCTO_CHANNEL_QA_ACCOUNTS=/protected/qa-accounts.md node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm
OCTO_CHANNEL_QA_ACCOUNTS=/protected/qa-accounts.md node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm --cli
```

SDK-hosted 与 CLI-hosted 两条真实路径均 PASS：群 @ 回复落入原会话；缺少 @ 的消息没有调用；后续轮恢复同一 Provider 历史并读回随机 marker；真实工具启动；进度卡、终态卡及错误卡收到后端 ACK；停止时同一卡片 ID 收敛且文本读回；注入缺失 executable 得到公共 OH-ADP-3002；活动工具期间 unload 取消、兄弟任务继续、Kernel 保持 ready；reload 后新的真实 DSH 调用成功。测得 stop 分别约 136 毫秒和 198 毫秒，仅为本机两次观测，不是性能保证。

卡片证据是后端 ACK、message ID、卡片状态及消息同步读回，未声称已人工检查 Desktop 客户端像素。原始轨迹不提交；示例归一化结果为 `tool_call.create → tool_call.update → message.delta → run.completed`，失败为 `failure.code=OH-ADP-3002, reasonCode=DSH_EXECUTABLE_NOT_FOUND`；取消为 `run.cancelled`，拥有进程树已回收。

**BLOCKED：DM 与跨 DM/群独立会话验收。** 实际发送被服务端拒绝 `err.server.bot_api.not_friend`，两只 QA Bot 尚非好友；未修改好友关系，已向用户询问是否允许建立该关系。移除 --skip-dm 并使用已建立好友关系的专用账号后，才能计为 DM 通过。fixture 和群聊不能替代此证据。

**未验证：原生 Windows DSH。** 当前机器没有该发行环境；#14 仍需用真实可执行入口验证启动、取消、进程树和打包消费。通用发行包 Windows CI 不能替代真实 DSH Windows 结果。

# Verified Review

采用 verified-review 串行流程：基线工作区干净，审查时仅本任务改动；38 个变更文件，逐文件检查 37 个手写文件，跳过 pnpm-lock.yaml 的语义审查（锁文件只核对 workspace 依赖）。生成物和 dist 不在提交范围。依据 AGENTS、OctoSpec 和既有边界审查，覆盖新包全部源码、公开导出、包/manifest、共同失败分类与日志接线、测试/fixture、实时验证脚本及文档。没有使用平行子 Agent。

已修复且复验的缺陷：

| 缺陷 | 证据等级 | 修复与复验 |
| --- | --- | --- |
| 原生工具参数/结果关联字段与旧假设不符 | reproduced | 使用 JSON 字符串 arguments 和 message.toolCallId；真实工具及文件副作用 PASS |
| 私有 reasoning 缺 canonical provenance | reproduced | 补来源及 exposure；真实 Kernel 与 canonical validator PASS |
| 队列容量失败被后续清理错误覆盖 | reproduced | 首个错误固定；items=1 保留 STREAM_QUEUE_ITEMS_EXCEEDED |
| 版本探针缺 invocation 取消及树回收 | read-confirmed | 独占 spawn 和既有 processCleanup；挂起版本探针取消测试 PASS |
| 非当前/未开始 turn 被接受 | read-confirmed | 显式 active turn 校验；错序 fixture 与真实 Desktop PASS |
| 清理期晚到取消掩盖先前失败 | reproduced | 保留首个失败；晚到 abort 回归 PASS |
| 恢复后沿用旧 cwd | read-confirmed | resume 成功后显式设置并校验本轮 cwd；续聊 fixture/真实 PASS |
| 默认结构化日志丢原生诊断 | reproduced | invocation context 复用已有 RuntimeLog；落盘保留阶段/request/native/PID，凭据 canary 不出现 |
| 发行验证硬编码旧 Adapter 数量 | reproduced | 仓外 verifier 实际报 14 != 13；更新清单数量，并增加 DSH 公共导出/metadata 校验 |
| Windows 发行负例的外层期限早于系统查询预算 | reproduced | CI Node 24 在未安装服务 restart 的 10000 毫秒期限被验收脚本终止；追踪到 Windows inspect 可顺序执行两个各 30000 毫秒的原生命令。Windows CLI 外层改为 75000 毫秒，保留 SERVICE_NOT_INSTALLED 断言，其他平台仍为 10000 毫秒 |

在已覆盖的固定版本/macOS 范围内，没有遗留中等或更高严重性代码发现。DM、Windows、客户端视觉检查仍为上述明确证据缺口。PR 使用 Addresses #17，保持 Issue 开放，不将部分端到端结果标记为全部验收完成。
