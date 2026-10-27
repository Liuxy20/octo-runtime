---
type: Task
title: "Issue 64：Windows Provider discovery 测试夹具"
description: "以真实可执行测试夹具修复 Windows 版本探测断言，保持产品接口与实现。"
tags: [testing, adapter]
timestamp: 2026-10-27T09:00:00Z
slug: 64-provider-discovery-fixture
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/64"
---

# Issue 64：Windows Provider discovery 测试夹具

## 目标与背景

基线 main `f421f0ec`；原生 Windows 11、Node 24.22.0 下原测试版本为 null，整文件 1 通过、1 失败。直接 execFile 原 POSIX 夹具返回 ENOENT。仓库外可执行夹具经相同 probe/describe 路径通过全部原断言。

业务目标是恢复确定性测试。测试拥有夹具与临时资源；产品 probe 接收现有 command，按现有合同执行，调用方无需增加参数。

## 关键合同与范围

- 仅修改 discovery 测试和专用测试夹具；Windows 使用系统 C# 编译器，与已有 windows-console 测试基础设施一致。二进制仅留在忽略的测试构建缓存，测试副本随临时目录清理，不进入发行物。
- 保留 POSIX 夹具和真实子进程版本输出；probe、AgentExecutor、公共接口、导出、配置与产品依赖保持不变。
- 不涉及 #83/#84、真实 Provider、服务安装、全局 PATH 或用户配置。
- 不伪造 metadata，不跳过有效断言，不改变超时或错误合同。

## 验收

用户确认本任务仅修复 Windows，以原生 Windows 验收为完成依据；macOS/Linux 本地实测不作为本次交付前置条件。后续已授权提交、推送并创建关联 #64 的 PR。

- 原 focused 命令和整文件在 Windows 通过；实际 stdout 为 provider v1.2.3，probe 与 describe 返回同一夹具路径及版本。
- 精确 --version 参数与多余参数负例有效；空格中文路径、目录/缺失命令、失败/缺少 probe、元数据形状与临时清理保留。
- 按范围执行格式、lint、命名、类型与相关回归；明确 macOS/Linux 本轮未验证。
