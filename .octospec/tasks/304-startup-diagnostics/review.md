---
type: Review
title: "Issue 304：共享诊断交付检查"
description: "启动域、公开兼容、资源责任与安全边界的实现自查。"
tags: [startup, review, lifecycle, security]
timestamp: 2026-11-04T12:17:00Z
source: self
---

# Issue 304：共享诊断交付检查

## 需求与承重合同

- 共享 catalog、typed context、主根因和安全 formatter 由 Kernel 维护；Host/CLI 使用同一实现，公开 host/executor-kernel 两个入口支持程序化消费。
- 构造、initialize、聚合回滚、CLI foreground/后台失败回读覆盖 IPC 之前的失败；复用 ServicePhase/cleanup，没有 synthetic Run、新状态机或自动恢复。
- 已整合 `6fe5b5fc` 的 Home/直接端点合同；不恢复 SDK 隐式 Home、旧端点检测、独立执行 worker 或迁移层。
- 原异常、cause、外层初始化消息和 CLI 退出码选择保留。RuntimeHomeError 的路径属性及 CLI startup/cleanup 有兼容投影；规范 JSON 与两项必要分类映射明确写入双语指南。
- 实际资源边界决定 HOME_* 分类；插件自己的缺失文件仍为 ENOENT，spawn 缺失不建议 mkdir。日志纯配置校验由共享入口处理，IO best-effort 行为继续保留。

## 安全与复杂度

只白名单投影稳定码、已确认资源和清理事实，不执行异常 getter/toJSON，不从异常 prose 推断路径。遍历上界、cycle、aggregate、未知和大输入有专项。相同净化用于文本/JSON，持久化文案从 catalog 重建。最近失败文件有大小上界、独占临时写入和 no-follow/文件身份检查；写盘失败不替换原错误，Home 路径失败不补建根。

没有新增业务配置、环境或 stderr 转储，没有网络/LLM 解释步骤、身份重置或无关进程清理。锁文件、CI、默认测试选择器没有变动。测试 canary 在运行时生成，公开文档和 PR 不附本机绝对路径或凭据。

## 证据与结论

Node24/26 的相关 133 项回归、公开 tgz 类型/运行消费、WebUI 35 项和静态检查通过，详见 [validation](validation.md)。全量发现的 4 项 Playboard 展示回归已修复并经最终相关回归确认；剩余 2 项 OpenClaw 重启失败在干净 main 同样复现。知识 lint 与最终 diff 检查通过，不将全量声明为全绿。

按已注入 architecture/protocol/lifecycle/local-execution/extras/context/input/output/stateless/engineering/collaboration 逐项复核，目前无待修正功能发现。未运行的 macOS/Linux、Electron、真实 Provider/IM 只作为明确限制，不由 fake 或 Windows 计算结果代替。

## 2026-11-05：PR #314 复审

逐项验证三个 reviewer 的四个具体问题，均确认成立；未照搬额外建议。原 `de708b05` 产物上的专项为 8 fail / 1 pass，失败断言不输出随机凭据正文。

| 问题 | 验证与最小修正 |
| --- | --- |
| Jerry-Xin：URL userinfo 在空格、双引号、`<`、`>` 处只过滤前段 | 真实 manifest → CLI 失败与记录复现；完整 URI 标量净化，存在分隔歧义、复合或截断时整体隐藏 |
| Jerry-Xin：缺失裸 Adapter 包在注释边界之前失败 | 真实 CLI 返回原 ERR_MODULE_NOT_FOUND 但缺少已知 module；把解析移入现有 CLI 装配边界，仍先解析整个选中集合再导入/构造，保留原异常和退出码 |
| mochashanyao：data 模块的可恢复载荷进入诊断 | base64 与 percent-encoded 模块经真实 CLI 复现；仅在诊断投影隐藏完整内联载荷，不改变实际 import 能力 |
| yujiawei：多词、逗号、分号敏感赋值仅过滤前段 | SDK 字段及真实 CLI 模块路径覆盖文本、JSON、保存及回读；没有可靠结束语法时隐藏赋值后的余段，包括带引号的值 |

与 main `de3ff37a` 的冲突只发生在 ExtraService 两处，保留 #315 已合并的 direct/IPC 装配及可选 Home 判断，叠加既有诊断 wrapper/context。没有修改 Core、执行模式、默认 selector、CI 或依赖。主线引入的文件不计作本次额外修复范围；最终相对 main 的 diff 只保留 #304。

新增 9 项显式手动回归，普通包/文件路径、长畸形 scheme 复杂度和解析先于导入的顺序同时保留验证。复验结果见 [validation](validation.md)。
