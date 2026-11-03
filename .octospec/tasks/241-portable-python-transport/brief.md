---
type: Task
title: "Issue 241：Windows Python transport 测试可移植模拟"
description: "修复缺失 Unix API 的异步模拟，并按真实背压阶段验证超时与清理。"
tags: [testing, ipc, python, windows]
timestamp: 2026-11-03T09:54:06Z
slug: 241-portable-python-transport
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/241"
---

# 目标与背景

从最新 main `1956b46ec531d840658faaf8dd9258c363045807` 独立 checkout 修复 #241。
Windows 11 build 22621、普通用户、Python 3.11.9 的当前基线为六个方法，四通过、两个方法报错，共三条 subTest/方法 error。
Unix API 在 Windows 缺失，create=True 默认建立同步 Mock；另一个 patch 未允许缺失。
历史 AsyncMock 对照还暴露外层两秒等待包含四 MiB 请求的同步校验，须复现并定位，不能机械增加超时。

## 产品意图与责任检查

- 业务目标：使已有测试真实验证错误码、背压和清理，决定权归测试合同。
- 显式输入：原请求、两个 explicit_close 场景与 Unix/Windows 分支；保留原断言。
- 首个违约组件：测试模拟和同步；生产 SDK 不适配错误 Mock。
- 合同内动作：显式异步 Mock、允许缺失属性、确定性观测写入阶段、任务结果取回。
- 越界动作：修改公共签名、导出、配置、生产行为、worker 架构或 CI 范围。
- 其他产品：生产代码和接入语义不变，无产品默认策略变更。

## 关键合同

- ipc：KERNEL_TIMEOUT / CONNECTION_CLOSED、两条平台路径、连接/缓冲清理断言保留。
- testing：真实非读取 loopback peer 与实际背压；错误和取消任务必须取回。
- isolation：独占 checkout/分支，测试 Home/TEMP/配置在所有 checkout 外，不接管 Bot。

## 范围与验收

- 修改限于 transport 测试及所需工程记录；不新增默认 gate。
- Windows Python 3.11.9 完整 transport、Python 单元和适用 native 互操作通过。
- Python 3.12.14 追加验证，显式记录两个 close 子场景、两条平台路径和任务/资源清理。
- 执行仓库规定适用检查与 OKF lint；失败记录归属，未验平台明确写未验证。
- 首轮交付本地 diff 与脱敏证据；随后用户明确授权提交、推送并创建关联 #241 的 PR。仅以 Closes #241 关联该子单，Refs #14 保留总验收；不合并或手动关闭 Issue。
