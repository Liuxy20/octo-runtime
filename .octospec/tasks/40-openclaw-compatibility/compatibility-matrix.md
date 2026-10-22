---
type: Task
title: Issue 40：OpenClaw 版本合同矩阵
description: 逐发布标签记录创建字段、协议号和证据等级，避免从新版推断旧版支持。
tags: [openclaw, adapter, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 范围和证据口径

截至 2026-10-22，GitHub 官方 latest Release 为 [v2026.10.5](https://github.com/openclaw/openclaw/releases/tag/v2026.10.5)，发布时间为 2026-10-18T21:47:25Z。下面覆盖官方标签列表中从 7.1 到该版本的 26 个非 beta 标签，加用户提供并已实测的 6.11，共 27 个；包括带 -1/-2 和 .33/.34/.35 的标签。不由此承诺中间未列出的 6.x 版本。标签名称不自动证明 npm 渠道或用户实际运行 build 与其一致。

- S：已读取该固定提交的原始源码，核对协议号、创建字段及主调用字段。
- V：本地原始创建 Schema 校验，使用合成请求；不运行 Gateway。
- U：用户反馈，未由本轮独立复测。
- F：从固定上游 AST 提取实际发送字段的严格请求投影，并以替身完成 ask/full_access 请求流程。当前全部 27 行均已取得 F；不表示真实 Gateway 或原生 harness 验收。
- L：本轮真实 Gateway 调用。6.11 的 probe、文本、固定 exec 和取消，以及 9.4 的 full_access／ask 文本及取消通过；其他行的 L 未执行。L 也不代表所有工具／harness 均已验收。

字段列表示 sessions.create 是否声明 permissionMode / idempotencyKey / thinkingLevel。三项均在 6.11 和 7.x 缺失，8.1 起均存在。所有行的协议号均为 4。所有行的 AgentParamsSchema 均声明 model / thinking / extraSystemPrompt / idempotencyKey。这些结论不表示每个字段在全部 harness 中语义相同。

| 标签       | 固定提交与创建 Schema                                                                                                                                     | 三个创建字段 | 原调研证据        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------- |
| 2026.6.11  | [e085fa1](https://github.com/openclaw/openclaw/blob/e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2/packages/gateway-protocol/src/schema/sessions.ts#L242)       | 均缺失       | S、L（追加验证）  |
| 2026.7.1   | [2d2ddc4](https://github.com/openclaw/openclaw/blob/2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4/packages/gateway-protocol/src/schema/sessions.ts#L245)       | 均缺失       | S、V、U（不生效） |
| 2026.7.1-1 | [81ac4f3](https://github.com/openclaw/openclaw/blob/81ac4f3bddc8b7a9a68ae908dd3d60d819c024f2/packages/gateway-protocol/src/schema/sessions.ts#L245)       | 均缺失       | S                 |
| 2026.7.1-2 | [0790d9f](https://github.com/openclaw/openclaw/blob/0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c/packages/gateway-protocol/src/schema/sessions.ts#L245)       | 均缺失       | S                 |
| 2026.7.33  | [b60a4e9](https://github.com/openclaw/openclaw/blob/b60a4e9fa97cddf1869a1866d879b3051783cf12/packages/gateway-protocol/src/schema/sessions.ts#L245)       | 均缺失       | S                 |
| 2026.7.34  | [0847c47](https://github.com/openclaw/openclaw/blob/0847c47f4451569148e5ef1789be771416ff7b11/packages/gateway-protocol/src/schema/sessions.ts#L245)       | 均缺失       | S                 |
| 2026.7.35  | [aa94808](https://github.com/openclaw/openclaw/blob/aa94808cb05668cdf1c10bc8f034a8176deba483/packages/gateway-protocol/src/schema/sessions.ts#L245)       | 均缺失       | S                 |
| 2026.8.1   | [ea80657](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/packages/gateway-protocol/src/schema/sessions-create.ts#L12) | 均声明       | S                 |
| 2026.8.2   | [0965053](https://github.com/openclaw/openclaw/blob/0965053fe6b9341776df147a6934b7485c60b5ca/packages/gateway-protocol/src/schema/sessions-create.ts#L12) | 均声明       | S                 |
| 2026.8.33  | [f773aa0](https://github.com/openclaw/openclaw/blob/f773aa06a1a93b36b050f1a3f4b57d3d91311541/packages/gateway-protocol/src/schema/sessions-create.ts#L12) | 均声明       | S                 |
| 2026.8.34  | [d21cb74](https://github.com/openclaw/openclaw/blob/d21cb744af45bc4d29352750c5e1e7f1cf7f066a/packages/gateway-protocol/src/schema/sessions-create.ts#L12) | 均声明       | S                 |
| 2026.8.35  | [713ba57](https://github.com/openclaw/openclaw/blob/713ba5785d72d6ed1cec971e21307f16cc4234a6/packages/gateway-protocol/src/schema/sessions-create.ts#L12) | 均声明       | S                 |
| 2026.9.1   | [ad6fe23](https://github.com/openclaw/openclaw/blob/ad6fe23aecb9b833d68139b0ddc9f239b894d2f1/packages/gateway-protocol/src/schema/sessions-create.ts#L12) | 均声明       | S、U（生效）      |
| 2026.9.2   | [3928bad](https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/packages/gateway-protocol/src/schema/sessions-create.ts#L13) | 均声明       | S                 |
| 2026.9.3   | [1391f7c](https://github.com/openclaw/openclaw/blob/1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.4   | [3a9d69d](https://github.com/openclaw/openclaw/blob/3a9d69db306cd7f081e06254cb89c4bcc14a7107/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.5   | [ec9c1a1](https://github.com/openclaw/openclaw/blob/ec9c1a13db8938e5a3eaa51fca2e981cde2395a9/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.6   | [eb377ac](https://github.com/openclaw/openclaw/blob/eb377ac59e6c9fd6c7705028034812becf00271b/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.7   | [c074824](https://github.com/openclaw/openclaw/blob/c074824a27c96d3983043f9eeb33823cd1772d8c/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.8   | [fc23bc8](https://github.com/openclaw/openclaw/blob/fc23bc864e4553c2d215e479eeec47b67a0bf943/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.9   | [bcfc888](https://github.com/openclaw/openclaw/blob/bcfc88812a35243893585dbeca87ca41b48272ca/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.9.33  | [5873f81](https://github.com/openclaw/openclaw/blob/5873f8174e0b2866a2b8bc0dbf4c4c8164d8dc82/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.10.1  | [e178c39](https://github.com/openclaw/openclaw/blob/e178c39e9aae3fa440735217f9aef9574f286677/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.10.2  | [b8952d4](https://github.com/openclaw/openclaw/blob/b8952d477f0c932d8ddc6da5c89cab5a169b6ff1/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.10.3  | [59cb447](https://github.com/openclaw/openclaw/blob/59cb44796b0f1f0daa0e37af8b1495abb45d9bc1/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.10.4  | [383c124](https://github.com/openclaw/openclaw/blob/383c124cc32ffee3f8e56f549b88da94d269a4af/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |
| 2026.10.5  | [1b58cb9](https://github.com/openclaw/openclaw/blob/1b58cb9a1b4f4353e1add63c8506db4d890962e8/packages/gateway-protocol/src/schema/sessions-create.ts#L17) | 均声明       | S                 |

## 已确认边界与限制

1. 首个已核对的非 beta 新合同是 8.1。此结论不定位具体引入 commit，也不推断 7.2 beta、8.1 beta 或错误命名 beta 的能力。
2. 7.x 不能沿用新版创建对象。删除单个字段不够；必须分别处理创建幂等、思考强度和权限。
3. 7.1 的 execSecurity/execAsk 是实际会话策略字段；8.1 的这两个 patch 字段虽然仍在 Schema，官方说明及实现已退休。不得以“Schema 接受”为唯一语义保证。
4. 8.1、9.1、10.5 的权限说明均保留 sandbox、工具策略和原生 harness 的独立限制，不能把 full 解读为越过所有外部约束。
5. 已对订阅、审批及终态做代表版本源码审计，并完成 27 标签的严格请求投影和 54 条 ask/full 流程自动化。6.11 与 7.1 在 Runtime 发送的 create、patch、agent 请求投影上相同，补强旧版本修复依据；未执行的 7.1 真实环境不标 L。完整原生生命周期、模型调用和权限实测未完成，暂不能发布“全部真实版本已经支持”的结论。实际边界见[实施记录](implementation.md)。

## 实施期真实验证矩阵

验收按用户最新确认的两类业务权限意图执行，兼容回退方向为扩大权限：ask 不可用时直接采用 full_access，无需逐次确认；ask 可用时保留原模式。旧版不以完整复制新版 guarded 文件边界为前提。每行都须记录请求意图、实际采用方式、回退原因和审批桥行为；缺少人工审批通道不能阻断可用的 full 路径，细则见[实施计划](implementation-plan.md)。

| 版本/分组                      | 必须验证                                                                            | 当前状态                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 6.11（用户追加）               | 基础合同 probe、full/off patch、ask 回退通知、文本及指定 exec、单次 abort 对账      | F 通过；L 五场景及只读 probe 通过，见[记录](remote-6.11-validation.md) |
| 7.1、7.1-2                     | 隔离会话、旧权限映射、基本调用、model/effort/instructions、审批允许/拒绝/过期、取消 | F 通过；真实 reviewer／harness 待验                                    |
| 7.33/34/35                     | 在上述旧合同样本上核对分支差异；发现差异加真实验证点                                | F 通过；真实完整行为待验                                               |
| 8.1、8.2                       | 新创建合同、权限退休边界、订阅及取消对账                                            | F 通过；真实完整行为待验                                               |
| 8.33/34/35                     | 创建字段一致；完整输出和权限行为仍须差异审计                                        | F 通过；真实完整行为待验                                               |
| 9.1                            | 复测用户当前可用版本，防止兼容修复回归                                              | F 通过；用户反馈成功，真实复测待验                                     |
| 9.2–9.9、9.33                  | 固定标签 strict fixture；按事件/权限/终态差异增设实测点                             | F 通过；9.4 文本／取消有 L，其余待验                                   |
| 10.1–10.5                      | 全部 strict fixture，最新稳定版 10.5 完整代表验证                                   | F 通过；真实完整行为待验                                               |
| 版本缺失、未来版本、fork、beta | 在未建立保证时，创建前明确失败，验证无会话／模型副作用及诊断脱敏                    | 已实现并通过自动化                                                     |

真实执行须区分 Gateway 直连、CLI/SDK 接入和 IM 投递；无凭据证据写入 journal。事故诊断对应的具体 Gateway build 未确认，不能用矩阵替代现场取证。

## 可重复核对

上游文件来自认证 gh 的只读 contents API，例如：

```sh
gh api -H 'Accept: application/vnd.github.raw+json' \
  'repos/openclaw/openclaw/contents/packages/gateway-protocol/src/schema/sessions.ts?ref=2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4'
```

8.1 起创建定义移到 schema/sessions-create.ts，不能只搜索 sessions.ts 就得出“字段不存在”。逐文件路径、声明行号、SHA-256 和主调用核对字段见 [source-evidence.json](source-evidence.json)。该 JSON 只保存公开源码元数据，不包含用户配置或 Gateway 凭据。

旧创建 Schema 的可重复验证：

```sh
node .octospec/tasks/40-openclaw-compatibility/verify-legacy-schema.mjs \
  /path/to/openclaw-2026.7.1 \
  /path/to/node_modules/typebox \
  /path/to/node_modules/typescript
```

脚本只应对可信的固定上游源码运行。它提取四个原始 const 初始化表达式，使用 TypeBox 编译；TypeScript 参数可省略并使用本仓依赖。实际结果见 [schema-reproduction.json](schema-reproduction.json)。
