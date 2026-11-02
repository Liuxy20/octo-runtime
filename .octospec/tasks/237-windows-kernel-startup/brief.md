---
type: Task
title: "Issue 237：Windows 原生 Kernel 启动取消与替换验收"
description: "将历史 worker 故障映射到现行原生服务合同，复现并验证取消回滚、所有权和新实例恢复。"
tags: [windows, runtime, lifecycle, ipc, testing]
timestamp: 2026-11-02T10:50:00Z
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/237
---

# 目标与基线

从最新 origin/main 的独立 checkout 验证 #237；基线 `84e025053b93e8f23063ef702441925a5007138d` 包含 #295 与 #297。先验证，只有当前合同存在可定位违约才最小修复，不为 diff 制造产品代码变更。

## 业务与决定权

取消启动后宿主必须能够确认旧服务清理事实，再构造新服务复用同 endpoint/state 并执行。此为 Runtime 自有生命周期责任；宿主显式提供 endpoint、stateDirectory、Adapter 和取消 signal。不补模型、会话、重试或配置策略，不影响其他产品默认值。当前尚未确认最先违约组件；从实际原因链定位，不预设管道、文件锁或 ACP。

## 承重合同与拓扑

- 宿主原生构造 KernelService，注入实际 Adapter；服务和 Core 在宿主进程。普通执行经 kernel.client → Named Pipe RPC → Kernel → Core → Adapter。
- 服务持有所属 Core、Run、连接、endpoint 和原生 ownership 记录；Adapter 管本轮资源，宿主依赖仍归宿主。Windows acquireEndpoint 不创建 POSIX lease 文件，不伪造此项通过证据。
- signal/close 取消后不得迟到 ready；初始化原 cause、回滚 incomplete、所有权保护及首次关闭结果保持。完整关闭后新构造，不要求原实例 reopen。
- 历史 worker、setWorker、监督和 worker manifest 路径已由 #295 删除；原生 ownership 持久化仍有 rename，不能由路径删除推断全部 Windows IO 风险消失。

## 范围与验收

1. 普通用户 Windows 11、checkout 外隔离 Home/TEMP/TMP，Node24/26 各运行原两文件组合至少三轮，保留全部日志。
2. 显式手动场景验证 pre-abort、owner 建立后取消、bind 中 signal/close、迟到 bind、原始初始化失败、真实回滚失败保护；记录 cause、cleanup、状态、所有权和实际时序。
3. 新服务复用相同 endpoint/state，实际通过 RPC 执行 fake Adapter，再完整关闭；所属 Adapter 资源释放，兄弟服务及宿主仍可用。
4. 相关构建、类型、lint、命名、格式及现行生命周期/ownership 回归，知识元数据与链接检查。
5. 交付 validation/review/journal、可审查 patch 和本地证据；按当前合同证据给出关闭建议，明确历史根因、架构替换和平台缺口。

## 不在范围

不恢复 worker/API，不修改公共 SDK/协议，不增 CI、默认测试入口、workflow/job/矩阵或 Gate。#238/#240/#241/#242、真实 Provider/IM、Electron、Windows10、发行安装及 #14 总验收不并入。只使用本聊天资源；不改其他 checkout、在线 Bot、身份或配置。不提交、推送、评论、建 PR、关闭或合并。

上述远端写入限制对应首次本地交付。用户随后明确要求“提PR”，据此授权本分支提交、推送至现有 fork 并向上游 main 创建 PR；不包含合并或直接关闭 Issue。PR 使用 Refs #237、Refs #14，保留关闭条件及未执行的共享平台回归。

## 已确认的当前缺陷与最小修复方案

两版 Node 的当前原组合三轮均通过，但新增手动回归均为 7 pass / 1 fail：signal 取消先赢得 Service.initialize 的 Promise.race，startKernelServer 随后执行失败回滚并形成包含 EPERM 的 AggregateError。Service 在 await close 后仍只将 race 的取消错误作为 cause，已确认的回滚原因链被丢弃。非取消初始化失败能保留该聚合链，故最先违约点是 Service 的错误装配，而非 Named Pipe、rename 或 ACP。

仅在 close 后已经观察到独立 AggregateError 时，用 AggregateError 保存首次失败与启动回滚异常；原始对象及 errno 不变，普通取消和正常错误 cause 不变，ServiceInitializationError/ServiceCleanupResult 签名不变。保持 5 秒截止与所有权保护，不提前释放。截止之后才发生的结果仍未确认，不事后将 incomplete 改为成功。
