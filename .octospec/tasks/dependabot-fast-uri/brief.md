---
type: Task
title: 修复 fast-uri Dependabot 告警
description: 定向升级 AJV 的 URI 解析依赖并验证协议校验不受影响。
tags: [security, dependencies, testing]
---

基线：origin/main@3f83ecf4607c658fba7664caa6ccb2787ab92baa（2026-11-09）。

处理 Dependabot #3、#4、#5、#6，将 fast-uri 3.1.8 定向 override 到 3.1.9。
仅调整依赖配置与锁文件；保持既有 CI 范围。验收包括冻结锁文件安装、
实际 AJV 依赖解析、协议校验相关测试及本地依赖审计。
用户已授权提交、推送并创建目标为 main 的 PR；合并未授权。
