---
type: Review
title: Issue 242 本地交付自查
description: 核对测试能力处理边界、规则符合性、未执行断言和关闭条件。
tags: [testing, windows, security]
timestamp: 2026-11-03T04:12:00Z
---

# 复核结论

本地 diff 符合 [brief](brief.md) 的范围；实现可审查，正向 Windows 验收仍有环境缺口，不能宣称 #242 已完整验收。

- helper 的 catch 只包住一次原生夹具 symlink 调用，产品 API 与断言都在其外。只有 win32 + EPERM 变为显式 skip；file/dir 均使用真实符号链接类型，没有 junction、mock 或普通文件替代。
- 六个原失败入口与两个静默返回场景均有明确的能力依赖结果；混合场景的普通断言保留，symlink 目标保护、realpath、越界及文件类别断言保留并在适用处增加目标不变检查。
- Node 24/26 原生缺失能力结果及覆盖率一致；受控 helper 成功仅证明控制流，不能证明产品保护。其他创建错误仍失败；没有按平台整文件跳过。
- 已核对 runtime-architecture、runtime-channel、runtime-session-reset、runtime-engineering、commit：产品职责、SDK/协议/配置合同、生产源码、用户状态、CI 范围无变化。仅回写一条可复用测试能力规则。
- 格式/静态/构建与治理检查、迭代失败、Node 26 内存分配失败及串行复测均如实记录。全仓格式失败限于 711 个未修改 CRLF 文件；没有为变绿批量格式化或放宽断言。
- 新增 Markdown 的 type/title/description/tags 与 context.yaml、链接经过治理 lint；diff 检查无空白错误，无新增凭据值或无关产物。手动专项脚本留在 checkout 外。

剩余验收：具备 file/dir symlink 能力的原生 Windows、Node 24/26，四个完整文件和八场景断言/覆盖率证据。其他平台及全仓测试没有本轮执行；详细边界见 [validation](validation.md)。用户后续已授权提交 PR，按草稿交付保留验收缺口，不自动关闭 Issue 或合并。
