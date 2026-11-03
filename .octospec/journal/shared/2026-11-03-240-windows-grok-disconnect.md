---
type: Journal
title: "Issue 240：Windows Grok 断流夹具真实 EOF"
description: "用独占可关闭输出管道验证存活 Provider 断流，保留原诊断及清理路径。"
tags: [testing, windows, adapter, stream, octospec-learning]
timestamp: 2026-11-03T02:07:00Z
source: self
---

# 变更与证据

e6809e92 基线原文件两断流各5000ms超时，65秒后仅回收本次测试树。修复不改生产：测试启动边界给夹具独占fd3，把真实OS管道接到child.stdout；夹具关闭该句柄但继续存活，原Grok EOF监听触发所属清理。

Node24.19.0/26.13.0各连续三轮完整文件28/28；手动无Adapter观察各3/3；ACP/生命周期扩展各69/69。全部修复后命令自然结束、没有外层终止；原错误正则、5000ms及取消/清理断言保留。完整范围见[validation](../../tasks/240-windows-grok-disconnect/validation.md)。macOS/Linux未运行，不以Windows通过替代。

# 可复用结论

stdout.end/destroy或fs.close返回不能证明父端EOF。先从父端观察真实输出EOF，同时独立核对PID仍存活，再判断Adapter是否有缺陷。物理fd1与测试装配的ACP输出管道必须明确区分；不能靠进程退出或合成end事件替代。追加到engineering规则；本次专项仍显式手动运行，不扩大CI。

基线外部收尾、Adapter所属清理和测试命令自然结束是三种不同事实。通过记录中Provider收到SIGTERM来自已有Adapter owner，不能描述为外层未终止就等于Provider自行退出。
