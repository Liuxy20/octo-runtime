---
type: Task
title: Issue 339：常驻 Engine 生命周期与 Adapter 架构边界细化
description: 明确常驻 Engine、协议适配、调用资源和 Home 数据的所有权，规划 CLI 托管与 SDK 业务自管两条路径。
tags: [architecture, adapter, lifecycle, ownership, documentation]
---

# 目标与阶段

来源：[Issue #339](https://github.com/Mininglamp-OSS/octo-runtime/issues/339)及 2026-11-09 用户追加说明。本次属于**架构边界细化**，以依赖常驻进程的 Codex app-server Adapter 为首个实施对象；不将所有 Adapter 改造成常驻服务。

已完成独立 worktree 与 95 分规划，用户随后授权不做兼容层直接实施，并要求 code-review、同类问题子 review、autofix 后提交 PR 到 main；不包含合并或发布。此次同步维护中英文架构正文、模块对象生命周期、SDK/CLI 和包说明。规划评分见[评估](assessment.md)，实际检查见[验证](validation.md)。

## 产品意图与决定权检查

| 检查项 | 合同 |
| --- | --- |
| 业务目标 | Electron 业务团队复用已有常驻 Engine，通过默认或自定义 Adapter 接入 Runtime，不交出 Engine 生命周期；CLI 默认体验保留 |
| 决定权 | 实际宿主选择、创建并维护 Engine owner；业务宿主选择并注入 CODEX_HOME，维护目录权限、数据保留和删除策略 |
| 显式输入 | 已构造的 Adapter、Engine 访问依赖、宿主确定的 Home 及执行配置；agentEnv 不携带存活对象或销毁权 |
| 合同内动作 | Runtime 接纳、路由、取消自身调用；Adapter 转换协议和释放本调用资源；托管模块按宿主授权监督 owned 进程 |
| 越界动作 | 注册即获得 Engine 销毁权；借用者重启共享进程；SDK 隐式选择或创建 CODEX_HOME；停进程时删除 Home 或认证数据 |
| 其他接入产品 | CLI 在服务宿主装配默认托管对象；Electron 原生 SDK 装配，不执行 CLI；逐轮子进程及远端 Adapter 保持原执行模型 |

## 实施前基线

初始 main 基线 `157fabb7d680df1ee72d9d9e5ed40cfc6c22b336` 中，Codex scope 同时持有配置服务池和调用状态，Core shutdown 会回收服务进程，缺少 CODEX_HOME 时回退用户 ~/.codex。实施期间同步至 `d5aeae707fcda0b138b360136f164c085c9a5e87`，保留 #337 调用方提示词/工作目录变更；本次已经拆分上述所有权，当前行为与证据见[验证](validation.md)。

## 关键合同

1. Adapter 注册只建立执行与协议关系，不隐式转移 Engine、共享连接、Home 的所有权。
2. 默认 CLI 在实际运行 Kernel 的服务进程创建托管对象。start 命令的短命客户端不持有服务资源；Playboard 自己拥有本次装配。进程监督代码可复用，不能为此恢复执行 worker 或要求 Electron 通过 CLI 启动。
3. Runtime 不限制 Adapter 的构造方式、参数数量/类型/顺序或注入形式，类、工厂、闭包和直接对象均可；只约束注册结果的执行合同。宿主可向黑盒 Engine 专用 Adapter 传任意具体 client、配置、连接池、回调及其他依赖，不要求 client-only、统一 options 或通用 Engine 接口。Codex 专用访问依赖不能推广为所有 Adapter 的构造前提；CLI manifest 工厂约定也不限制 SDK 构造。
4. Core scope 可以继续拥有 invocation、交互路由、订阅和租约，不因此拥有 Engine；借用路径的 scope.close 不执行进程终止或全局连接关闭。
5. 宿主必须显式注入 CODEX_HOME；CLI 可以在宿主层保留现有默认选择。SDK 和 Adapter 不再回退其他 Home，不自行决定目录准备、权限修复、迁移、重置或删除。Home 的所有者和进程的所有者可以不同。
6. Home、Runtime Home、Provider session、进程 incarnation 和调用身份分别表达不同事实。停止进程或释放租约不删除 Home；Home 权限检查不证明已登录，也不构成同 OS 账号下的安全沙箱。
7. 保留配置兼容分池、定向取消、原交互路由、代次隔离和无副作用重放合同。借用 Engine 不可用时如实失败，恢复策略由 Engine owner 决定。
8. docs 必须覆盖模块职责、持有对象、创建者、最终关闭者、借用边界、失败与关闭顺序；同时解释当前实现和目标差异。不能只改 API 示例或将未实施目标写成既有能力。
9. 不扩大 GitHub CI；专项本地显式执行，不增加默认测试 selector、workflow、job、矩阵、触发器、必需状态或 Gate 依赖。

## 交付与范围外

交付：[方案与所有权表](design.md)、[实施与文档计划](plan.md)、[95 分评估](assessment.md)、[验收与验证](validation.md)、实际读取清单 context.yaml，以及 docs 中英文架构更新。

实施验收覆盖默认托管、业务借用、共享消费者、CODEX_HOME 注入、失败回滚、无重放，以及非 Codex 的任意构造依赖扩展示例；详细条目见[计划](plan.md)。本次不引入通用 Engine 注册平台、统一构造函数或 Engine/client 基类、新 transport、全局 daemon 扫描、业务身份/凭据管理、Home 自动迁移、额外原生运行时或专项 CI。实际通过与未验边界分别记录，不把规划分数作为测试证据。
