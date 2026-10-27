---
type: Task
title: "Task: 88-native-codex-home"
description: "修正 Codex 命令测试的原生 Home 断言，保持产品和 SDK 合同不变。"
tags: [testing, adapter, envs]
timestamp: 2026-10-27T10:00:00Z
slug: 88-native-codex-home
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/88"
---

# Task: 88-native-codex-home

## Goal

仅修正 `test/adapters.test.js` 中 Codex 默认目录断言及其隔离回归。在 main `bd3c74d8` 的 Windows 真机基线上，HOME/profile 不同、HOME 缺失、CODEX_HOME 为空均使原断言失败；显式非空覆盖通过，命令构造对照四项均通过。

## 产品意图与归属

- 目标是测试准确表达现有合同；Home 选择仍归 Codex Adapter，测试不得改变产品策略。
- 测试显式提供独占 HOME、USERPROFILE 和 CODEX_HOME，通过子进程隔离环境。
- 合同内动作：验证原生命令参数、工作目录、环境传递和 cleanup。
- 越界动作：修改 SDK、Adapter 产品实现、默认目录策略、真实配置或 Provider 启动兼容性。
- 其他接入产品无行为变化，不新增调用参数或依赖。

## Load-bearing list

- envs：非空 CODEX_HOME 优先，缺失或空值按原生 Home 回退。
- testing：HOME 与 USERPROFILE 保持不同，不修改父进程环境，不读取真实凭据。
- adapter：保留 app-server argv、cwd 和 cleanup 断言。

## Out of scope

- 产品源码、公共导出、类型、Schema 和 SDK 接口。
- Issue #83/#84 的真实 Codex executable/发行兼容问题。
- 修改 Issue 正文、合并 PR 或发布版本。

用户已授权提交并创建关联 #88 的 PR；本次本地验收仅要求原生 Windows，其他平台结果如实标记未执行。

## Acceptance

- Windows 原生四种隔离环境均通过；POSIX 保留 HOME 回退和显式覆盖测试，未在本机执行。
- HOME 缺失的 Windows 专属场景不在 POSIX 上借用真实用户目录。
- 完整 adapters 文件通过，并运行格式、lint、命名和类型检查。
- diff 仅包含本 Issue 测试与工程记录。
