---
type: Task
title: "Issue 240：Windows Grok 断流夹具"
description: "建立进程存活时真实 ACP 输出 EOF，并保留原失败、诊断与清理合同。"
tags: [testing, adapter, stream, windows]
timestamp: 2026-11-03T02:00:00Z
slug: 240-windows-grok-disconnect
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/240
---

# 目标与背景

从包含 #295/#297/#299 的 main e6809e92 开始，修复 disconnect 与 disconnect_diagnostic 两项各 5000ms 超时、完整文件不能退出的问题。旧审计只绑定 58332b3，不推定 Adapter 有缺陷。

## 需求归属与关键合同

- 业务目标是恢复可靠 fake Provider 回归；决定权归测试基础设施，调用输入和产品意图不变。
- 首个违反合同的组件是夹具：调用 stdout.end 不证明父进程收到 EOF。先独立证明真实 OS 管道 EOF 和进程存活，再判断生产行为。
- 保留原两个错误正则、零成功终态、5000ms、取消和清理断言；不 skip、伪造 end、延长超时或先杀 Provider。
- 拓扑：测试进程 → Grok ACP 客户端 → 本次 Node fake Provider。测试拥有临时目录，Adapter 拥有 Provider 清理；不恢复执行 worker、不改 Kernel 装配、RPC、公共接口或宿主生命周期。
- Windows stdio 0–2 受 Node/libuv 特殊保护。诊断选择可关闭的额外 OS 输出管道，并在测试 spawn 边界把该真实管道接入 child.stdout；不发合成 EOF。原 fd1 忽略，不向生产加入注入 API。专项显式运行，不扩大默认测试或 CI。
- 多产品行为、SDK/协议/配置/会话默认值不变；不改变执行权限、身份或 Provider 认证来源。

## 范围外

生产代码仅在真实 EOF 证明独立缺陷时考虑；不合并 #238/#241/#242，不关闭 #14。首轮仅本地交付；2026-11-03 用户后续授权提交、推送并创建关联 #240 的 PR，合并仍不在本次范围。不操作其他 checkout、Bot、Home 或用户数据。

## 验收

- 最新 main 完整原文件保存原始 TAP、超时和所属进程现场；基线需外部收尾时明确记录。
- Node24/26 每版修复后连续三轮完整文件；两断流场景真实执行，0 cancelled，命令及所属进程/句柄自然收尾，无外层干预。
- 显式手动专项断言父端 EOF 时进程仍活、随后 Adapter 原诊断失败、退出/close 和管道释放；独立无 Adapter 观察区分 EOF 与进程退出。
- 构建/类型、格式、lint、命名、OKF、diff 检查，ACP/Grok/清理相关回归；macOS/Linux 无环境时明确未验证。
