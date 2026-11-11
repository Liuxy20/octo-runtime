---
type: Journal
title: Issue 339：宿主 Engine 所有权实现与审查收尾
description: 记录常驻 Engine 与 Adapter scope 拆分、启动回滚和诊断保留，以及显式验证和交付边界。
tags: [architecture, lifecycle, ownership, review, validation]
---

# 实现结论

在main d5aeae70上完成#339架构边界细化。createCodexAdapter只接受宿主提供的Codex provider，不持有全局监督/关闭权；createManagedCodexEngine独立返回owner。默认CLI显式装配和关闭owner；业务SDK自行构造具体依赖。SDK不回退CODEX_HOME，目录权限/数据保留由Home owner维护。通用Adapter构造参数和形式不受限制，CLI manifest与Codex合同均非通用构造要求。

Kernel只读收集宿主进程快照；显式finalizeHostResources在Core排空后、释放持久所有权证据前执行宿主收尾。失败保留cleanupFailed与端点租约。doctor按真实owner_pid展示Engine，不构造Adapter PID节点。

复用结论已回写architecture/runtime-lifecycle/adapter-metadata/local-execution规则及双语docs；模块对象表明确创建者、最终关闭者和借用边界。无兼容singleton或旧启动构造入口，无额外Engine注册框架。

code-review分Standards/Spec独立审查，并执行同类生命周期子review。修复无效Adapter漏回滚、逆序依赖关闭、清理诊断丢信息、脚本漏关闭以及JS disposer坏返回值导致closed挂起；详见[审查](../../tasks/339-engine-lifecycle/review.md)。

本地默认1548项通过、61跳过，专项136项通过；真实Codex direct/IPC各5轮恢复与共享3轮通过，包外direct/IPC各3轮通过。所有专项显式运行，不扩GitHub CI。平台与检查细节见[验证](../../tasks/339-engine-lifecycle/validation.md)。用户授权提交PR到main，未授权合并或发布；规划95分不代表跨平台实测。
