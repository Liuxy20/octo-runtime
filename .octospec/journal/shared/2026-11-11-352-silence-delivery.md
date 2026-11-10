---
type: Journal
title: PR352 已生成静默通知与未来计时分离
description: 记录review发现的wake到take竞态、单槽修复及实际验证证据。
tags: [runtime, silence, race, review]
---

PR352 review 发现静默阈值已达到、通知已生成后，新输出仍可能在 Core take 前清空 pending。独立真实 Core 复现确认基线丢失通知。修复保留已生成事实，新输出只重置未来区间；单槽不得覆盖，Core 优先交付已生成通知，终态/取消/错误仍优先清理。

复用结论已写入[输出规则](../../rules/output-protocol.md)。[专项复核](../../tasks/352-silence-notice-delivery/review.md)和[验证](../../tasks/352-silence-notice-delivery/validation.md)记录原脚本前失败后通过、19 项含真实计时专项、1403 项全量通过及双包验证。专项仍显式手动运行，未扩大 CI。GitHub reviewer 是否重新批准以 PR 状态为准。

后续 CI 在 Windows 的既有 ACL 测试探针耗尽 10 秒预算，Linux/macOS 通过。只调整测试内外层有限期限，保留真实权限断言；独立专项复核与 macOS 对应测试通过，Windows 托管结果另以提交 CI 为准。细节见上述验证记录。
