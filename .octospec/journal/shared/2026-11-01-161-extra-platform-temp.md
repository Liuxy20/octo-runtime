---
type: Journal
title: CLI Extra 测试平台临时目录修复
description: 记录 Issue 161 的 macOS 本地验证、清理事实及最新主线 metadata 审计结果。
tags: [testing, extra]
---

# Issue 161 实施记录

用户「更新代码 提交PR」明确授权交付；最终同步到 `main@28c3ffa2ef685e14ac58d57c2788c9d07b92471c` 后重新构建、类型、lint、命名、格式、目标测试及两类清理验证通过，最新基线两轴复审各 0 项。知识检查器通过 581 个单元，严格字段检查仍为原 15 个历史缺项；本任务 metadata 完整。提交、推送和 PR 引用将记录到 Loop 结果评论，Windows 未验限制写入 PR，不自动合并。以下未提交状态均为当时历史记录。

再次同步到 `main@42102c60103a9b18166c499b0c74a23e0d2295c6` 后，构建/类型检查、顺序 lint、定向测试及正常/失败清理复验通过。当前 572 个知识文档都有 YAML frontmatter，严格必填字段审计仍有原 15 个历史缺项；本地实现不变，未提交或推送，任务保持等待验证审查。

用户随后要求同步最新 main：分支快进至 `88fe84efeabfd6e542153402a4e8e91190f7c9f5`，保留全部本地修复及双方工程日志。重新构建/类型检查、顺序 lint、目标测试、正常/失败清理均通过。当前 568 个知识文档均有 frontmatter，严格四字段检查仍为同一批 15 个历史缺项；最新证据见验证记录顶部，以下初次实施记录仅作历史依据。

在专用分支 `fix/161-extra-platform-temp` 快进至 `main@c35b261b31573bc2f08a16eeced12f18705b2560` 后，目标测试仅增加 `node:os` 的 `tmpdir` 导入，并使用 `mkdtemp(join(tmpdir(), "extra-home-"))`。保留真实 CLI 配置读写和 `t.after` 清理，产品合同及 CI 范围未变。

macOS / Node `v24.22.2` / pnpm `11.19.0` 下构建、类型、最终顺序执行的 lint、命名、格式和目标测试通过。独立临时父目录下，正常退出及指定断言失败均观察到所属夹具创建/删除，父目录为空。Windows 原生验收缺环境未执行，完整测试套件未运行，不能报告全部跨平台通过。

最新主线已补齐原先 7 处缺 frontmatter 文件，仓库知识检查器通过；独立严格审计仍发现 15 个历史文件缺 `description` 或 `tags`。当前检查器的通过只证明其实现的检查范围，不代表新规范所有必填字段完整。本次知识文档字段完整，历史缺项独立列明，未扩大修改范围。

并行构建与 lint 会因 dist 被 clean 或尚未生成而产生类型解析错误；等待 build/typecheck 完成后单独 lint 通过。后续验证按此依赖顺序运行，不以扩张 CI 消除本地执行竞争。

Standards 与 Spec 两轴审查各 0 项发现。实现保留本地未提交、未推送，等待验证审查；详细命令、结果与 metadata 缺项清单见[验证记录](../../tasks/161-extra-platform-temp/validation.md)，目标合同见[规格](../../tasks/161-extra-platform-temp/brief.md)。
