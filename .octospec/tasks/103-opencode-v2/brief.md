---
type: Task
title: Issue 103 OpenCode 2 兼容调研与验收规划
description: 基于最新 main 调研 OpenCode 2 原生 ACP 与 JSON CLI，明确拒绝 V1 的合同及真实验收范围。
tags: [adapter, protocol, invocation, interaction, testing, envs, mcp, reasoning]
timestamp: 2026-10-23T00:00:00Z
---

# 目标与阶段

处理 [Issue #103](https://github.com/Mininglamp-OSS/octo-runtime/issues/103)。已完成调研；用户随后授权实施、使用已配置的 OpenCode 2.1.3 / DeepSeek 做真实端到端验证、code-review 后提交 PR 到 main，并授权使用测试 IM 账号。

基线为重新 `git fetch origin main` 后的 `445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`。独立 worktree 为 `octo-runtime-issue-103`，分支 `research/103-opencode-v2`。主 checkout 中 #81 的未提交改动不属于本任务。

2026-10-23 按用户要求 rebase 到最新 `origin/main@cc49c8b4ce2d04fd2389585d00ffcf8806b4af72`，纳入已合并的 #115 安全整改。原始基线和真实验收证据保留，更新后的检查见 [validation](validation.md#rebase-到最新-main)。

## 产品意图与归属

- 业务目标：已安装 OpenCode 2 的宿主能够通过 Runtime 正确执行、续聊、响应审批和取消；不让 V1 因可执行文件存在而被误判为支持。
- 决定权：用户及 issue 明确仅支持 2.x；模型、effort、审批模式、工作目录和续聊意图仍由调用方输入。
- 合同内动作：Adapter 校验实际程序版本，转换原生参数和协议，传递本轮环境、MCP 及输入，返回真实结果并清理所属资源。
- 越界动作：自动安装升级 OpenCode、代办登录、读取凭据推测认证、改写用户配置、替宿主选择模型或重置会话。
- 影响：SDK、CLI 和 Extra 共用同一 Adapter，V1 调用统一失败；不将 IM 默认策略推广到其他接入产品，不新增 Runtime 能力目录。

## 关键合同

### OpenCode 1 必须报 error

用户于 2026-10-23 明确：“如果是1 我应该提示报错 error，opencode1不再支持”。这不是 warning 或兼容降级。

1. 对实际选中的 executable 运行版本检查，包括自定义绝对/相对路径；不以 npm 包名或其他 PATH 项的版本代替。
2. `probe` 对 V1 返回不可用及明确错误原因；直接 `invoke` 即使没有先执行 probe，也必须在启动 `run` / `acp` 前失败。
3. `ask` 与 `full_access` 共用版本门禁，不存在绕过版本检查的传输入口。
4. 建议错误码 `OPENCODE_VERSION_UNSUPPORTED`，文案包含检测到的版本及 `OpenCode 1 is no longer supported; OpenCode 2 is required. Upgrade OpenCode and retry.`。其他非 2.x 版本明确报告仅支持 2.x。
5. 版本超时、命令失败或无法解析明确报告 `OPENCODE_VERSION_DETECTION_FAILED`，不将未知版本当作支持，也不吞成 `version: null` 后继续执行。
6. probe 的结构继续遵循既有 ProbeResult；调用失败沿当前 Adapter/Core 错误链返回，不另造执行或发现协议。CLI 的错误展示和退出行为需在实施时验证。
7. 版本检查使用本次调用的有效环境和 cwd，检查后执行同一已解析路径；不永久缓存以致 PATH 变化或程序升级后沿用旧结论。

### 输入、权限与执行

- 初步保留 `full_access -> JSON CLI`、`ask -> ACP`；CLI 必须验证 `--standalone`，不依赖共享服务是否恰好有本轮环境。最终选择以真实验收为依据。
- `assisted` 当前无已验证原生策略，继续明确拒绝；不擅自改成 full_access。
- 原生权限、配置优先级及显式 deny 必须验证。不能因使用 `--auto` 就宣称覆盖全部限制。
- 新会话控制指令与续聊业务输入遵循现有合同；不把控制指令改成每轮普通用户正文，不从历史补齐 Context。
- 本轮环境独立合并，ACP 环境覆盖从有效请求取得；不修改全局 `process.env`。
- MCP 使用 V2 原生载体并保留用户已有配置；timeout 的语义区分连接目录和工具执行，不混用。
- effort 原生映射或未应用提示必须真实；本轮尚不将 ACP effort setter 记录为已实现。
- 失败、取消和清理分别保留事实；只能发布一次执行终态，不因零退出码或结束一个模型 step 而误报整个任务完成。

### 进程、接口与资源归属

现有拓扑为宿主原生 Kernel -> 内部 worker -> 唯一 AgentExecutor -> OpenCode Adapter -> OpenCode CLI/ACP -> OpenCode 私有服务及工具子进程。显式 direct Core 使用同一 Adapter。宿主组合入口和公共 invoke 接口保持既有设计。

Adapter 拥有本轮 Provider 进程、临时指令文件与传输清理；OpenCode 管自己的会话持久化和认证。Runtime 不接管其数据库，不管理用户已有共享服务。取消须检查本轮私有后代是否实际退出，不能只检查 CLI leader；平台清理限制如实报告。

删除/替换目标为 OpenCode 包内的 V1 配置生成和过时 CLI 参数，不删除用户文件。共享 ACP 或 SDK 仅在确认通用合同缺口时做最小扩展，并验证其他 Adapter 不回归。

## 范围外

不安装或覆盖全局 OpenCode，不改用户认证或配置。提交、推送及面向 main 的 PR 已授权；不发布 npm。图片、预览协议扩展和额外 ACP 能力不会因为上游支持而自动进入本次交付。

## 验收与下一步

调研依据见 [reference.md](reference.md)，执行顺序见 [validation-plan.md](validation-plan.md)。最低支持版本确定为可真实验收的 2.1.3，也是在验收时查询到的最新稳定版；不承诺未测的 2.0.0。最终证据见 [validation.md](validation.md)。

实施需覆盖 V1 拒绝、两种保留传输、工具、多轮、审批允许/拒绝、取消、错误凭据/配置、Provider 与进程失败、并发环境隔离、MCP 和资源回收。真实命令必须经 Runtime 执行，直连 ACP 握手及 fixture 仅为分层证据。

每个场景记录 Runtime commit、实际 executable/version、OS、模型/provider、命令、脱敏证据及通过/失败/未测。认证由宿主和 harness 事先准备，不以特定环境变量存在作为登录前提。
