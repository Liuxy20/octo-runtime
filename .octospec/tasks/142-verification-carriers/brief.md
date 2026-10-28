---
type: Task
title: "Issue 142：Windows 命令载体兼容"
description: "兼容标准 npm 包装器的验证脚本和已复现 Provider 启动路径，保持公共 SDK 合同。"
tags: [testing, integration, adapter, envs]
timestamp: 2026-10-28T05:00:00Z
slug: 142-verification-carriers
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/142"
---

# Issue 142：Windows 命令载体兼容

## 目标

Windows 上 npm 安装入口存在，但无 shell 的裸命令启动报 ENOENT，显式 .cmd 报 EINVAL。将标准 npm 包装器转为其声明的 JS/原生载体，保持独立 argv；缺失安装、未知载体和非零退出仍可区分。

## 范围与合同

- 八个验证脚本、十三处 npm/octo-cli 调用及错误包装。
- 已复现的共享 JSON-lines/ACP、Codex、Grok ACP 启动入口及对应 probe；通过私有模块复用同步解析。
- 使用本轮 PATH/cwd 和环境变量身份规则，不执行任意 batch，不修改 process.env，不跳过损坏的首选安装。
- 保持公共 SDK 签名、配置、根包导出、协议和依赖版本。内部子路径不从 SDK 主入口或 public/ 重导出。
- 保持原 ChildProcess、stdio、退出/取消/关闭合同，不新增服务或上层接入步骤。

## 范围外

- 其他 Windows 权限、文件锁、进程回收或 Provider 协议问题。
- 其他验证脚本、业务 API/IM 行为、全局安装及未复现的集成路径。

## 验收

- 标准 npm JS 与原生包装器、探测返回路径、空格/中文路径、精确参数和独立 env/cwd 回归通过。
- fake Provider 经默认 Codex/Claude Adapter 完成；ACP/Grok 保持同步创建、握手、关闭和后续调用。
- 缺失/未知/损坏入口、数字非零及取消后 PID 确认保留。
- 构建、类型、格式、lint、命名与相关测试；公开声明不变；打包与包外导入/调用通过。
- 真实版本/probe 独立标记 non-gating；不以 fixture 或版本查询代替模型/IM 验收。失败和未执行项见[验证记录](../../journal/shared/2026-10-28-142-command-carriers.md)。
