---
type: Review
title: agentEnv 双轴与五轴审查
description: 独立 Standards 和 Spec 复审、问题关闭及质量检查。
tags: [review, architecture, security, lifecycle]
---

# 审查边界

用户指定 code-review（mattpocock/skills）和 code-review-and-quality（addyosmani/agent-skills），已全局安装到 Codex 并执行。分别使用独立 Standards 与 Spec 审查者。Runtime 基线 bf9ff6b599b0e325362698acd3cebd9ac1363467；Gateway 基线 16d7421；均包含未提交差异与新文件。当前 API 增量还对照实施前归档，区分已存在的拆仓改动。本次没有新 commit 或 PR，不冒称三点 diff 含已提交代码。

## Standards

最终 **approve，未关闭 0 项**。已关闭：

1. Required/P1：旧 registry 记录的 rejected/cancel 可能删除复用同一身份的新调用。加入对象身份保护及回归；变异测试证明保护失效时测试能发现。
2. Required/P2：中英文 IPC 文档残留版本 1。改为 2，独立复核。
3. Required/P2：环境规则残留 Gateway 使用独立 executionEnvOverrides 的旧描述。改为 agentEnv/envs，并区分内部 Core/低层覆盖，独立复核。

4. Required/P1：候选包同版本重新打包后，锁生成脚本可能复用旧 integrity。改为定向更新两个候选并核对真实 hash/正式下载地址；独立临时目录中用两个不同字节的同版本归档复验通过。

四参数平铺为用户明确要求，不按 Data Clumps 启发式改回 request 外壳。生产测试不提供旧 API 兼容层。独立 Standards 专项 Runtime 4 项、Gateway 2 项通过。

## Spec

最终 **approve，未关闭 0 项**。已关闭：

1. Required：未首次消费的句柄 throw 没有释放登记。覆盖 return/throw 的提交前释放与容量回归。
2. Required：Windows 大小写别名可能覆盖可信凭据。按实际平台环境键身份删除旧值再追加可信值；保持调用者对象不变。

已核对四参数接口、环境/业务边界、同步 ID/快照、invocationId 定位中断、原生取消由 Adapter 内部适配、标识概念文档和真实模型 parts 断言。独立 Spec 专项 Runtime 4 项、Gateway 27 项通过。

## 五轴

- 正确性：覆盖预提交、ACK 未知、终态与观察关闭；取消受理不伪装执行完成。
- 可读性：Gateway 统一在 kernel-input 形成公开调用，业务渲染移出 Core；公开参数职责分离。
- 架构：执行只依赖公开 client；没有 Extra/渠道插件框架回流 Runtime，协议信封格式保留。
- 安全：业务历史不能变成执行配置；环境不拼入模型，凭据按平台身份覆盖，展示整体剔除 agentEnv。
- 性能：沿用有界 registry、队列、历史预算和清理截止；新增快照有协议大小限制。没有声称做吞吐基准。

最终发行验证已由主代理补齐，见 [实际证据](validation.md)。尚未发布和真实平台缺口不是通过测试可以替代的结论。

## COMPREHENSION

1. 改了什么：SDK 平铺输入/业务会话/Provider 会话/执行环境，Gateway 自行编译业务材料，Runtime 仅执行；interrupt 控制本 client 的单次 invocation。
2. 为什么：消除业务上下文、环境配置和 Adapter 选择混在一起的边界；避免会话级取消误伤其他轮次和 Provider 原生 ID 泄露。
3. 如何证明：双仓完整回归、真实 npm 包外消费、独立审查、失效保护变异测试及双语示例；真实模型/平台服务仍单列未验。


## PR 329 增量复审（基线 00bd48d）

远端提出取消状态、MCP 旧参数指引和 Codex native ID 上限三项意见。本轮修复前两项，并运行独立 Standards / Spec 审查：各 0 个未关闭问题。Standards 独立执行新增 6 项专项全部通过；Spec 为源码和测试覆盖检查，未声称执行测试。

- 取消在途进入 submitting，ACK 后确认 cancelled；失联进入 unknown，恢复后不能重放。INTERACTION_NOT_ACTIVE 确认 invalidated；observe 的 user_cancelled 事实映射 cancelled，迟到 RPC 不覆盖源流事实。
- 两语言 MCP 指南使用 agentEnv/envs；低层 submit/Core 的执行覆盖单列，不恢复 public invoke 的环境参数。
- Codex finding 不是本 PR 回归：主线 bf9ff6b 与 PR 00bd48d 的 app-server.ts 仅有第 2394 行注释差异。已见 ID 集合属于每次 invocation 的独立 CodexAppServerClient，pending 回答后释放，但 seen 保留用于防止原始 requestId 重用导致迟到回复误配。adapter-sdk/native.ts 也保持同一合同。不能将集合改成仅 pending 而移除安全边界。独立审查相关 4 项测试通过；超长单轮的累计上限若要调整，需要另行设计身份与生命周期。

该结论是本地技术复审，不代表 GitHub 外部审查已批准；分支保护和审批要求保持原样。


## 用户澄清后的配置边界复审（基线 bf8d6f63）

用户明确不同意 agentEnv 跨轮全量签名，要求将架构责任及条件写入文档。本轮没有加入环境绑定指纹，也没有把 providerEpoch 改为必填。对新 P1 的处置依据是用户确认的合同：SDK 防护显式身份/代次，宿主授权新执行的配置；不承诺识别隐藏的环境绑定变化。外部评审仍需按此合同重新核对，未声称审查已批准。

- **Standards：approve，Required 0 / Optional 0。** 对照当前实现确认配置捕获、二次回调不替换配置、活动回答与续跑分离；中英文一致，省略 epoch 不伪装绑定安全。
- **Spec：未解决 0。** 允许业务显式选择配置，同时保留权限/恢复限制；无新增执行行为或过度约束。

两位审查者仅检查文档差异与当前源码，未执行构建。完整 agentEnv 变化导致 stale 的回归测试不符合此次已确认需求，因此未添加；也不以文档修改宣称所有外部应用已实现正确的绑定失效管理。
