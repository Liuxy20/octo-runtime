---
type: Task
title: Issue 160 无状态探针的结构化状态与错误处理
description: 修复 live stateless 探针的人类文本解析及 CLI 失败被忽略问题。
tags: [testing, stateless]
---

# 目标

处理 [Issue #160](https://github.com/Mininglamp-OSS/octo-runtime/issues/160)：探针必须成功读取结构化状态；CLI 失败须保留原始诊断并停止后续验证。

## 关键合同与归属

- 业务目标是恢复验证工具的可信性；决定权属于探针，CLI 文本默认值与 SDK 合同保持现状。
- 显式输入为已有测试设备的绝对 Home；探针通过 `runCli --home <home> status --json` 查询现有组件，不安装、启动或修改设备。
- 提取可独立验证的状态读取步骤到 `test-support/stateless-live-probes.mjs`，主脚本调用该步骤；它接收现有 `runCli`，不新增公共 SDK API。
- 回调仅收集输出。必须先确认返回码为零，再解析 JSON；失败消息保留 CLI stdout/stderr 和返回码，避免 JSON 解析错误掩盖原始故障。
- 成功响应必须是对象，且包含 Gateway 的 bots 数组，然后继续现有在线检查。无输出、错误 JSON、无效结构都失败。
- 对其他接入产品没有行为影响；不改 Kernel、Provider、CLI 或 Extra 的实现、默认值与资源所有权。

## 范围外

不修复后续执行协议或 CDP 行为，不创建真实 Runtime/Work App 配置，不把受控测试当作真实 IM 或模型联调。

## 验收

1. 使用实际 `runCli` 和受控原生服务后端，成功获取组件 JSON。
2. 非零返回码优先于 JSON 解析失败；原 stdout/stderr 与退出码出现在失败信息中，后续步骤不执行。直接抛出的异常原样传播。
3. 无输出、错误 JSON、null/数组/错误对象、缺失或无效 bots 均明确失败；有效离线列表仍由现有在线断言拒绝。
4. 原脚本的在线连接、精确模型回复、completed 终态、数据库列表和旧库 mtime 断言保留。
5. 运行针对性测试、ESLint、命名、格式、typecheck/build 与 OctoSpec lint；真实完整 live campaign 的执行与未执行边界单独记录。

## 可执行性评估：97/100

本评分是实施准备度，不是线上成功率。需求与验收 20/20、源码与合同定位 20/20、改动边界 20/20、自动化可复核性 20/20、运行环境与交付 17/20。

扣分来自完整 live campaign 依赖已登录 Work App CDP、在线 IM Gateway、真实 Provider；当前不将这些外部前提作为单点修复的自动化前提。已确认当前 CLI 通过 output 返回 JSON 错误并返回非零码，因此先保存输出、检查码、最后解析的顺序可保留原始错误。计划无未决实现决策，达到用户要求的 95 分后进入实施。
