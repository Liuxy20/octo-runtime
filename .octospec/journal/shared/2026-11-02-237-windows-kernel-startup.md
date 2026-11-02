---
type: Journal
title: "Issue 237：原生取消恢复与回滚错误竞态"
description: "区分历史 worker 缺陷、当前恢复证据与取消先结算导致的回滚诊断丢失。"
tags: [windows, lifecycle, ipc, testing, octospec-learning]
timestamp: 2026-11-02T10:58:00Z
---

# 结果

基于 main@84e025053b93e8f23063ef702441925a5007138d，普通用户 Windows11 build22621，Node24.19.0/26.13.0。原两文件在基线各三轮5/5；历史 worker、setWorker 与监督路径已由 #295 移除，旧 replacement.initialize 及 rename EPERM 原因仍未知。

新增手动验收确认当前同 endpoint/state 新构造服务可经 RPC 初始化、执行并关闭；pre-abort、owner建立后取消、bind中 signal/close、超时后迟到bind、初始化失败及真实回滚失败保护均覆盖。最终增强组合两版各三轮13/13，扩展各52/52。

## 学习与修复

取消先赢 Promise.race 不代表实际回滚已结束。原 Service.initialize 在 close 后仍只包装首次取消原因，丢失 startKernelServer 已保留的回滚聚合异常。两版确定性 EPERM 注入回归各7过1败；产品仅调整 Service 的错误装配，使原取消原因、不同启动失败和回滚 errno 同时可追踪，清理结果、截止和owner继续真实保留。

本次更新 [生命周期规则](../../rules/runtime-lifecycle.md)，提醒初始化在等待关闭后合并已确认的独立错误链，不事后改写超时结果。没有把注入 EPERM 当作 Windows 文件锁复现，也没有把原生测试通过写成旧架构已复测。

逐场景证据与关闭条件见 [验证](../../tasks/237-windows-kernel-startup/validation.md)，范围与方案见 [brief](../../tasks/237-windows-kernel-startup/brief.md)。未执行共享 macOS/Linux、真实 Provider/IM、Windows10、Electron、发行安装或全仓默认测试。#237 建议合入后按当前合同和历史路径替代事实处理；#14 不关闭。提交、推送及任何远端写入留待用户安排。

附加文档工具测试9过2败，均为普通用户创建symlink的EPERM环境前提失败；实际当前文档链接审计与OKF检查通过。保留失败证据，不改权限或扩大本项修复。

## 后续 PR 授权

用户在本地交付后明确要求“提PR”。刷新上游 main 仍为84e02505，产品与专项无新增行为改动；采用现有 Liuxy20 fork 的独立分支向上游 main 提交，关联 Refs #237、Refs #14，不自动关闭 Issue。提交身份使用当前 GitHub 账号的公开身份及 noreply 邮箱；不修改全局 Git 设置。合并和共享平台验收不在此次创建 PR 的授权内。
