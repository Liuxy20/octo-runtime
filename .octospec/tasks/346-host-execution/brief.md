---
type: Task
title: Issue 346：宿主选择执行依赖，Adapter 负责协议适配
description: 从最新 main 建立独立规划，复用现有元数据与注入接口，明确 executable 选择、执行环境和生命周期的归属。
tags: [architecture, adapter, lifecycle, envs]
---

# 目标与阶段

对应 [Issue 346](https://github.com/Mininglamp-OSS/octo-runtime/issues/346)。2026-11-09 从 main `bf665881` 创建独立 worktree，按用户后续授权完成 spec 后实施；最新 fetch/rebase 基线为 `c7ae0256222fe0956ed6789e552e36aa6a61edf6`（#345），分支 `plan/issue-346-host-execution`。用户明确不需要兼容层，CLI 负责 executable 发现。当前代码、专项和文档均在此 worktree，检查结果见 validation。2026-11-10 用户授权提交、推送并创建目标 main 的英文 PR，禁止自动合并。

统一原则：宿主决定运行哪个程序、在哪个环境运行以及如何维护生命周期；Adapter 声明并实现协议要求，消费宿主明确交付的依赖。覆盖 Codex app-server、OpenCode CLI/ACP、通用 ACP 及其他内置命令 Adapter。统一所有权，不强求统一构造签名或进程模型。

## 产品意图归属检查

| 检查项 | 本任务结论 |
| --- | --- |
| 业务目标 | Desktop、CLI 和其他 SDK 宿主能够控制 Provider 来源，避免 Adapter 随 PATH、cwd 或环境变化另选程序 |
| 决定权 | 安装来源、版本选用、执行位置、账号隔离和 owner 归宿主；协议结构与原生映射归 Adapter；OpenCode 不按版本号准入，升级不要求 Runtime 修改版本名单 |
| 显式输入 | 本地已解析的 command/运行器参数，或 Provider 专用 client/provider/factory；Home 和环境由宿主准备 |
| 合同内动作 | 校验选定依赖、握手、会话与消息转换、调用级资源释放、真实失败报告 |
| 越界动作 | Adapter 扫描 PATH/目录、安装下载、按逐轮环境改选 Provider/Node、隐式替换依赖、关闭借用的共享服务 |
| 其他产品影响 | SDK 显式注入；CLI 在自身装配层保留安装发现便利；Kernel/Core 不读安装配置或执行模块发现 |

## 关键决定

1. 复用 `AdapterMetadata` / `DefinedAdapter` / `HostedAdapterMetadata`；不增加执行依赖目录或功能标签。metadata 的字段职责及可复用方式见[设计](design.md)。
2. 复用现有具体工厂参数、`CommandSpec`、`ProbeResult`、`CodexEngineProvider` 与 ACP client factory。跨所有 Provider 的 Engine 基类、注册中心和统一构造函数均不引入。
3. 本地路径、npm shim、Node runtime 的选择在宿主装配时完成；Adapter 不依据 Run 的 PATH 或 cwd 重选。协议子命令、模型/MCP/审批参数仍由 Adapter 生成。
4. 保留协议配置环境变量，例如 `OPENCODE_CONFIG_CONTENT`；禁止以“取消嗅探”为由删除 envs/MCP 或 Provider 正常配置读取。
5. 缺少默认安装保持对应 Adapter unavailable；明确配置错误不自动改选；短命探针、调用 transport 与共享 engine 的关闭权分开。

## 范围与排除项

本轮交付设计、源码审计、实现、验收矩阵、准备度评分和双轴 code review。内置工厂、CLI 两个入口、底层启动器、公开示例及双语文档一同迁移；删除旧默认实例与默认裸命令，不保留兼容层。

不实现安装器、沙箱、容器平台或远程执行平台；不修改模型目录、业务 Agent 定义、MCP server 命令选择合同、Run/IPC schema 或 Provider 原生协议。#343 已随 #345 合入基线，保留其单个 Codex app-server 与共享生命周期；#346 为 owner 提供稳定绑定，不按请求环境决定 executable。

不扩大 GitHub CI：不改 workflow/job/matrix/trigger/required status/Gate 依赖，也不在既有脚本或默认 selector 中夹带新增专项。专项仅本地或显式手动执行。

## 交付入口

- [设计与逐类改动](design.md)：源码证据、metadata 复用、注入与失败合同。
- [实施顺序和验收矩阵](plan.md)：可观察断言与命令。
- [可执行性评估](assessment.md)：96/100 自评，明确剩余 4 分。
- [方案自审](review.md)、[本轮验证](validation.md)和 `context.yaml`：实际阅读与检查事实。
