---
type: Task
title: Issue 242：显式报告符号链接测试前提
description: 保留普通文件断言，仅将实际无法创建符号链接的独立场景报告为未执行。
tags: [testing, windows, security, delivery]
timestamp: 2026-11-03T04:10:00Z
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/242
---

# 目标与背景

最新基线 `e6809e92b6ea88eb00106e236584fbfb1c9ce6e1`。开工核对 #242 仍 OPEN，时间线无关联 PR。历史证据显示六项夹具 EPERM、两项安全检查静默 return；本项是测试结果可信度修复，不是已确认产品安全漏洞。

## 决定权与关键合同

- 目标是让测试报告准确反映断言是否执行；测试拥有临时目录及夹具，能力依据实际 symlink 创建结果。
- 显式输入为测试独占的目标、链接路径和 file/dir 类型；仅夹具创建阶段 Windows EPERM 属于已证实的能力缺失。
- 合同内动作：最小复用 helper、拆分独立子用例、明确 skip 原因；普通文件、目录类型、容量、部分上传成功等断言继续执行。
- 越界动作：修改产品保护、吞产品 API 的 EPERM、junction/mock 替代 symlink、修改系统权限、扩大 CI、重做 #240/#238/#241/#140。
- SDK/CLI/Extra 产品策略、公共 API、协议、配置及其他接入产品行为不变。

## 验收

- 在 Node 24/26 原生 Windows 重跑四个完整文件，绑定版本、SHA/dirty、原始 TAP 和 V8 覆盖率。
- 两项静默返回消除；缺能力时只跳过真正依赖 symlink 的用例/子用例并说明原因。
- 能力存在时不按平台无条件跳过，保留真实路径、越界拒绝、文件类型及目标不变断言。
- 受控注入分别验证能力报告与其他错误传播，不冒充原生正向验收。
- 正向 Windows symlink 环境若不可得，明确未验证、#242 尚不满足关闭条件；#14 保持独立。
- 执行格式、lint、命名、类型/构建、治理 lint 与相关回归；交付本地 diff 和证据，不提交/推送/发布。

## PR 交付阶段

用户后续明确授权提交 PR。沿用已验证的代码与范围，提交并推送至本人 fork，向 main 创建关联 #242 / #14 的草稿 PR；使用 Refs，不自动关闭尚缺正向验收的 Issue，不合并。
