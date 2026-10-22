---
type: Task
title: Issue 95 Grok Build ACP 适配器
description: 基于固定 Grok CLI 版本验证 ACP，并接入 CLI 与源码 SDK 的现有执行合同。
tags: [adapter, protocol, invocation, context, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 目标

对应 [Issue #95](https://github.com/Mininglamp-OSS/octo-runtime/issues/95)，在最新 `origin/main@102fb9caf995d9eb1ac53acaf5b91922be4f023d` 建立独立 worktree，尝试实现 `grok-build` 的 ACP 接入。用户要求先收集 Grok Build 使用资料并补充 OctoSpec reference；来源与实测见 [参考资料](reference.md)。

分支 `feat/grok-build-acp`，工作目录 `octo-runtime-grok-build-acp`。用户授权调查、文档、实现及验证，随后追加授权 rebase 最新 main、提交、推送、创建 PR 并合并 main；未授权发布。GitHub issue/PR 和 commit 使用英文；其他协作文档使用中文。

## 产品意图与责任归属

- 业务目标：CLI 和 SDK 宿主可选择 Grok 的原生 coding harness，保留其工具执行与会话行为。
- 宿主拥有模块选择、模型/模式/强度、审批策略、工作目录、环境及会话续用决定权。省略可选项不补产品策略，不继续最近会话。
- Adapter 负责原生进程、认证握手、参数映射、协议转换、交互往返和资源回收；Core、Kernel、Channel 不出现 Grok 专属分支。
- 显式输入按现有 InvokeRequest 与 Context v3 传递；凭据不进入 prompt、argv 或诊断。harness 的登录、授权及凭据来源由使用者、宿主与 harness 负责，Runtime 不检查专属认证环境变量或凭据文件，不推断登录状态。
- CLI 默认目录携带新模块；源码 SDK 仍由宿主直接 import 并注册，不要求 manifest，不为其他 SDK 产品自动加载 Grok。
- 用户追加约束：适配器只命名为 `grok-build`；新增行为不得改变其他 bot 的 ACP 执行，包括其他 `grok-build` 调用。通用 ACP client、通用 adapter 和 SDK 审批桥不做本需求的行为扩展，特殊逻辑留在新包内。

## 关键合同

1. 新包 `@mininglamp-oss/octo-runtime-adapter-grok-build`，type `grok-build`。通过共享 ACP client 调用 `grok --no-auto-update agent --no-leader stdio`，不直接调用模型 API、不改写持久配置。
2. 只根据真实 `initialize` 广告顺序选择受支持的非交互 ACP 认证方法；harness 自行解析凭据并验证可用性。缺命令、无受支持握手方式、真实认证拒绝及不兼容版本如实失败，不要求某种认证来源，不代办登录或自动切换认证方式。认证成功与模型可调用分别验证。
3. 支持 canonical，准确声明 protocolSupport；首版不实现 native Driver。不新增 capabilities registry 或 executionFeatures。
4. 明确新建和显式恢复，返回 provider session；缺失会话遵守已有恢复合同，不能把任意认证/网络错误当作会话缺失。
5. 映射 cwd、输入、控制指令、环境、模型、MCP；模式和强度依据固定版本的真实载体处理。不能表达的选项按既有合同拒绝或返回未应用事实。
6. 审批复用既有交互桥，处理取消与迟到响应；未实现的 Provider reverse request 明确失败，不能静默挂起或自动回答。
7. prompt 的匹配响应才是 Provider 结束依据；每次唯一终态，完成清理后 Host 才可暴露终态。退出、断流和清理失败不可冒充成功。

## 范围外

不增加 headless streaming 第二传输，不安装/升级 Grok，不修改用户 auth/config，不改变通用宿主装配或会话业务策略，不发布 private workspace 包。

## 验收

- 固定 `grok 1.0.67 (2fe064390d07)` 记录 macOS 的握手、认证、只读文本流和跨进程会话续聊；无法通过的步骤记录真实原因。Linux/Windows 未执行即标未验。
- fixture 覆盖初始化/认证、参数映射、文本/思考/工具/用量、审批、错误、结束、会话新建/恢复/缺失、取消、断流和清理失败。
- 并发运行同一 adapter 的两个 `grok-build` 调用与通用 ACP 调用；原生 session/request ID 相同时仍按调用路由。错误回复、失败和取消不得结束其他调用；环境与 cwd 不串用，结束后旧交互失效、调用 ID 可重新使用。
- 验证 CLI 默认清单和发行依赖包含新模块，源码 SDK 直接注册并执行。
- `pnpm build`、`pnpm typecheck`、`pnpm lint`、相关 adapter/host 测试；共享合同改动运行完整回归。验证实际发行包，不能以 workspace import 代替。
- 检查 OctoSpec frontmatter、索引、链接；已有 checker 对 `docs/` 的冲突单独记录。

## 进度

已完成资料与 reference、canonical adapter、CLI 默认注册及 SDK 原生注册示例。用户开启代理后，固定版本真实文本流和跨进程续聊通过，SDK 手动验证也通过。自动回归和离线发行包验证通过，结果见[收尾记录](../../journal/shared/2026-10-22-95-grok-build-acp.md)。真实工具、MCP、图片及其他平台仍未验。用户已授权 PR 交付与合并；按 main 的评审与 CI 保护规则执行。
