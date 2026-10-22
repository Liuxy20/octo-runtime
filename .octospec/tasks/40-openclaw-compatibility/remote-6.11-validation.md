---
type: Task
title: Issue 40：远程 6.11 验证记录
description: 记录真实 6.11 的探测、权限回退、文本、工具及取消验收，并区分 7.1 的源码依据。
tags: [openclaw, adapter, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 当前结果

用户授权对远程 Gateway 进行验证。地址脱敏为 `ws://<internal-gateway>:18789`，真实内网地址及凭据不写入仓库。用户批准配对后，真实 hello-ok 确认 `server.version=2026.6.11`、协议 4，必要执行方法和 agent 事件均存在，授权包括 operator.admin、operator.approvals、operator.read、operator.write。

已补入 6.11 精确版本合同，沿用基础字段创建和当前隔离会话 full/off patch。真实 Adapter probe 通过，只调用 connect、agents.list，没有创建会话。其余五个场景均通过：

| 场景                 | 实际权限                | 工具次数 | 终态          | 回退通知 |
| -------------------- | ----------------------- | -------- | ------------- | -------- |
| full_access 固定文本 | full_access（full/off） | 0        | run.completed | 0        |
| ask 固定文本         | full_access（full/off） | 0        | run.completed | 1        |
| 接纳后立即取消       | full_access（full/off） | 0        | run.cancelled | 0        |
| full_access 指定工具 | full_access（full/off） | 1        | run.completed | 0        |
| ask 指定工具         | full_access（full/off） | 1        | run.completed | 1        |

每场景仅一次 sessions.create、一次 agent、一个终态；取消恰好一次 sessions.abort，并由 agent.wait 确认。创建字段只有 agentId、key，未发送三个新版创建字段。patch 保存结果由 Adapter 核对后才执行。文本均返回固定标记且模型步骤 ID 一致；工具场景断言恰好一次 exec、命令精确为 `printf OPENCLAW_COMPAT_TOOL_OK`，并收到原生成功工具输出及最终文本。ask 回退通知确认 requested ask、effective full_access 和 legacy_human_reviewer_unconfirmed 原因。

无凭据证据分别保存为 [probe](live-gateway-6.11-probe-evidence.json)、[文本与取消](live-gateway-6.11-evidence.json)、[工具执行](live-gateway-6.11-tools-evidence.json)。未发送 IM，未修改目标 Agent、OpenClaw Home 或全局策略。

## 测试传输边界

原始地址使用明文 ws。正式 Adapter 的非回环 URL 仍要求 wss，直接提交远程 ws 会返回 remote_gateway_requires_wss，本轮没有放宽该规则。测试使用显式本地 TCP 端口转发到用户授权的私网地址，绑定 127.0.0.1 随机端口；使用已批准的真实设备、原 token 和实际 Gateway，未伪装 server.version 或请求回执。转发不提供 TLS，也不证明正式远程 WSS 部署已验收；每次测试结束均关闭转发与连接。

测试脚本可显式从 `OCTO_OPENCLAW_QA_TOKEN` 读取 token；此时不读取本机 Gateway 配置。`OCTO_OPENCLAW_QA_DEVICE` 指定仓库外的设备身份文件，首次生成以 0600 权限独占创建，后续复用，避免批准后换身份。不得提交该文件。`--probe` 只认证并输出白名单握手字段，不调用执行 RPC。

固定测试身份首次配对未完成；用户要求“重新授权”后，复用同一身份重新发起请求。用户随后确认“已批准”，重连成功；没有关闭设备认证。此前临时身份请求未复用，以此固定身份完成后续验证。配对请求编号不进入交付文档。

# 源码依据

官方 [v2026.6.11](https://github.com/openclaw/openclaw/releases/tag/v2026.6.11) 的 annotated tag 指向提交 `e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2`。只读官方源码取得以下结果，不以此代替目标实例握手或真实执行：

| 文件                                                                                                                                               | SHA-256                                                            | 已确认内容                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [version.ts](https://github.com/openclaw/openclaw/blob/e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2/packages/gateway-protocol/src/version.ts)          | `a51e4f47258c07a2bee21c28565cd7760a790c82026e4c5cc763fa5df537a8c7` | 协议及最低客户端协议均为 4                                                                  |
| [sessions.ts](https://github.com/openclaw/openclaw/blob/e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2/packages/gateway-protocol/src/schema/sessions.ts) | `acfbeb46d72ed955c65cfeee4c309e3b005db51f698162140a2c9a52c167c0d8` | create 缺少 permissionMode、idempotencyKey、thinkingLevel；patch 声明 execSecurity、execAsk |
| [agent.ts](https://github.com/openclaw/openclaw/blob/e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2/packages/gateway-protocol/src/schema/agent.ts)       | `5d28d8da7c068c57262f57777bcb70591af28a21fa801e41905ff114b0d58123` | agent 声明 model、thinking、extraSystemPrompt、idempotencyKey                               |

同时核对 6.11 的 sessions.ts 创建／patch／abort 处理器、sessions-patch.ts 的 full/off 保存逻辑及 agent.ts 的 agent.wait 对账字段。固定处理器 SHA-256：sessions.ts 为 `d3965161b08ad40e96211c174aede6632f54ed8de87adfa62b6983cb4edbab41`，sessions-patch.ts 为 `6198d2c0b7dc7100f18ae43c866803be56b4c2f426b048bc7dcfdf5a014ef9c1`，agent.ts 为 `62faa858290f3309ec3ff3f0c61260760895f10ca7d2e653839aef9672149147`。旧版实现未拆成新版的 sessions-create.ts、agent-wait.ts 等文件，不把这些路径的 404 当成接口不存在。

与固定 7.1 源码比较：订阅、abort、agent.wait Schema 声明文本一致；完整 create、patch、agent 声明存在差异。机械提取 Runtime 实际发送字段后，6.11 的 create、patch、agent 严格请求投影与 7.1 全部一致，未增加第五类投影。当前共 27 个标签、四类投影和 54 条 ask/full 流程。这支持旧创建字段修复覆盖 7.1 的判断，不等于运行过 7.1 的真实 Gateway。

# 复测及限制

通过环境变量配置 QA token、同一设备文件和本地转发 URL，运行 `node scripts/verify-openclaw-compatibility-live.mjs` 验证文本和取消，增加 `--tools` 单独验证两个固定工具场景。`OCTO_OPENCLAW_QA_EVIDENCE` 可保存脚本输出的白名单 JSON；不会保存凭据、完整正文或原生回执。真实接口脚本保持显式运行，不加入默认自动化测试。

本实例的 full/off 指定工具执行已验证；人工 reviewer、所有 harness、严格宿主 approval floor、禁止工具及真实 CLI／SDK／IM 仍未全部验收。模型、effort 和可信系统指令的可选参数保留已有严格请求回归，但本次真实会话使用目标 Agent 默认模型，没有额外验证所有可选参数的原生语义。6.11 的证据独立保存，7.1 的状态继续标为源码／自动化证据。
