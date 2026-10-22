---
type: Reference
title: Grok Build 使用资料与 ACP 接入依据
description: 官方文档、固定源码入口、本机 1.0.67 探测事实及 Runtime 映射限制。
tags: [adapter, protocol, invocation, session, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 资料范围与版本

检索日期 2026-10-22。需求为 [octo-runtime #95](https://github.com/Mininglamp-OSS/octo-runtime/issues/95)。本机已安装 `grok 1.0.67 (2fe064390d07)`，平台 macOS arm64。源码仓库为 [xai-org/grok-build](https://github.com/xai-org/grok-build)，本次固定读取 [2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8](https://github.com/xai-org/grok-build/tree/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8)。源码快照不等于本机发布二进制；相同字段也须以固定二进制实测确认，不声称已支持所有版本。

## 官方使用入口

| 来源 | 关键信息与用途 |
| --- | --- |
| [仓库 README](https://github.com/xai-org/grok-build#readme) | 官方 coding harness，原生工具、会话、headless 与 ACP；发行二进制名为 grok，源码构建产物名不同 |
| [Overview / 认证](https://docs.x.ai/build/overview) | harness 的安装与认证由宿主及使用者准备，具体凭据来源不进入 Runtime 合同；不能把直接调用模型 API 当作 Grok Build 集成 |
| [Headless 与 ACP](https://docs.x.ai/build/cli/headless-scripting) | `grok agent stdio` 使用 NDJSON JSON-RPC；先 initialize/authenticate，再 session/new/prompt；正文通过 session/update，prompt 响应提供结束元数据；自动化入口使用 --no-auto-update |
| [CLI Reference](https://docs.x.ai/build/cli/reference) | cwd、model、effort、rules、权限、session 等 CLI 选项；CLI 选项存在不代表 agent stdio 会使用它，必须核对实现 |
| [Sessions](https://docs.x.ai/build/features/sessions) | 新建/恢复/继续最近会话的产品语义；该页面首次 web 读取失败，不把未读正文作为已验证依据 |
| [Permissions](https://docs.x.ai/build/features/permissions) | ask、auto、always-approve 与 sandbox 分开；deny/hook 仍可能拒绝。不能因无人值守而擅自自动审批 |
| [Plan Mode](https://docs.x.ai/build/features/plan-mode) | 计划模式独立于审批档位，TUI plan review 不能直接推断成标准 ACP 模式列表 |
| [MCP Servers](https://docs.x.ai/build/features/mcp-servers) | stdio/HTTP、原生本地配置与兼容加载来源；需要验证 ACP 的临时 mcpServers 是否再次展开模板、覆盖同名配置及何时连接 |
| [ACP 扩展协议](https://agentclientprotocol.com/protocol/extensibility) | 自定义方法名加 `_` 前缀，params 直接承载方法参数；不能凭 Rust ExtRequest 的内部表示推断外层 JSON-RPC 包装 |

本机 `grok --help` 还列出 `--permission-mode`、`--reasoning-effort`、`--rules` 等参数；`grok --no-auto-update agent stdio --help` 只显示 debug 与 leader-socket 类选项。`grok agent --help` 列出 model、effort、always-approve、agent-profile、leader/no-leader；这些参数属于 agent 层，应放在 stdio 前。Adapter 不能仅照根帮助拼装控制参数。

## 固定源码入口

以下相对路径均以固定源码快照为根，方便后续追溯实现而非依赖滚动 main：

- [ACP Agent 实现](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs)：initialize、认证、标准 session RPC、私有 x.ai 扩展。
- [会话创建和加载](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/session_setup.rs)：cwd、mcpServers、_meta.sessionId/modelId/yoloMode 等；load 与 resume 的恢复策略不同。
- [配置 RPC](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/handlers/config_option.rs)：session/set_config_option 接受 model 与 reasoning_effort，校验当前模型的有效选项。
- [会话配置数据](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/session_config.rs)：原生配置与会话详情，不能另复制成 Runtime 功能注册表。
- [会话类型及启动 hints](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/session/acp_types.rs)：nonInteractive/permissionMode 等私有字段；需要检查反向请求的实际合同。

## 本机 ACP 探测事实

探测使用临时空工作目录、空 clientCapabilities 和空 mcpServers，未修改用户配置或输出认证文件。没有广告客户端 fs/terminal 能力，Grok 保持原生工具执行所有权。

| 步骤 | 1.0.67 实际结果 | 对适配器的影响 |
| --- | --- | --- |
| initialize | protocolVersion=1；loadSession=true；MCP http/sse=true | 检查握手，不能把新版本默认视为兼容 |
| authMethods | 本机返回 cached_token 与 grok.com | 仅选择可无人值守的已有认证，不能自行发起浏览器登录 |
| authenticate | cached_token 加 `_meta.headless=true` 成功 | 仅证明认证步骤，不证明付费配额或模型执行成功 |
| session/new | 有 sessionId/models/configOptions；无 modes | 通用 ACP 的 advertised mode selector 无法直接应用 |
| model | 当前 grok-4.6；模型集合来自服务端 | 不硬编码模型列表，不猜别名，不静默换模型 |
| reasoning_effort | configOptions 中 category=thought_level；当前模型列出 low/medium/high/xhigh | 可评估标准 session/set_config_option；切换模型后需重新验证可用档位 |
| session/load 缺失 | JSON-RPC -32603，data.code=FS_NOT_FOUND | 不能只判断 null/{}，也不能匹配模糊报错正文触发 fresh fallback |
| promptCapabilities | 本机 image=true、audio=false、embeddedContext=true | 源码快照的 image 声明不同，图片按实际握手验证；不据此声称图片执行已经成功 |
| session/set_config_option | reasoning_effort 的 value 是字符串；设置 low 后响应确认 currentValue=low | 使用标准 setter，切模型后重新读取配置选项 |
| session/set_mode | modeId=default 成功，虽然新会话未发布 modes | 显式 default/plan 经 RPC 成功后才发布 applied 事实；plan 的原生执行未实测 |

本机初始化还返回私有 `_meta.modelState`、默认认证 ID 等信息。参考记录只保留协议所需事实，不保存全量握手、主机名、用户标识、认证数据或本机配置正文。

## 实现映射与验证边界

首选 ACP，原因是现有 ACP Client、规范化器与审批桥可复用，并能完成同一次调用内的权限往返。headless streaming 不作为首版第二传输。

每轮仍由共享 `octo-runtime-acp-client` 拉起 CLI，命令为 `grok --no-auto-update agent --no-leader stdio`，不编译或嵌入上游源码。用户明确使用通用 ACP client；源码仅作为公开文档缺失字段的辅助参考，不是新的运行依赖。Grok 的 ACP 认证握手和私有参数留在新 adapter 包，共享 client、通用 ACP adapter 与 SDK 审批桥不增加本需求的行为扩展。

认证来源不属于 Runtime 合同：宿主或使用者预先准备可直接使用的 harness，harness 自行解析环境或已有登录状态。Adapter 不检查专属认证环境变量或凭据文件；只按 initialize 广告顺序选择受支持的非交互方法完成 ACP authenticate。真实认证拒绝即失败，不自动切换认证方式或代办登录。

控制指令使用新会话 `_meta.rules`，在原生系统提示中追加约束，不覆盖整个 Grok system prompt。load 不重传 rules，使用 `_meta["x.ai/restore_code"]=false` 禁止恢复代码快照。权限以 yoloMode/autoMode 逐会话表达；`full_access` 不代答追问或批准计划。显式 sandbox 不支持，直接拒绝。

模型、effort 与 actmode 使用标准会话配置 RPC。MCP 使用标准 mcpServers，不更改用户配置；对原生二次模板展开无法保留的最终 `${` 字面量明确拒绝。追问和计划 review 的 wire 方法为 `_x.ai/ask_user_question` / `_x.ai/exit_plan_mode`，params 为正文，回复仍使用同一 JSON-RPC id。

### 真实 CLI 只读执行，2026-10-22

- 平台 macOS arm64；Node 24.19.0；`grok 1.0.67 (2fe064390d07)`；使用 harness 已有认证状态，Runtime 未提供认证材料。
- 初次适配器测试在 90 秒和 60 秒内未获得正文。通用 ACP client 原始复测成功完成握手、认证、新会话并收到队列及 retry_state 通知，但 45 秒内仍未获得正文，主动取消后收到 cancelled。未将超时归为 ACP 不兼容。
- 用户开启代理后，同一 ACP 接入成功：第一轮要求记住并输出 `OCTO_GROK_95`；第二轮启动新 CLI，以显式 providerSession 恢复，要求复述前一轮标记，两次均准确返回该标记并完成。
- 进一步用 [手动验证脚本](../../../scripts/verify-grok-build.mjs)经 AgentExecutor SDK 注册并调用，两轮均获得唯一 `run.completed`，第二轮 Provider session ID 与第一轮一致、没有 fresh fallback。脚本分别创建 invocation，不把历史标记放入第二轮输入。
- 实际流包含思考、正文、model step、usage 与终态；没有执行工具，没有测试真实审批或图片。
- 脚本使用临时空 workdir，ask 模式，不自动批准工具。每轮进程结束后才继续，最终检查 SDK shutdown 清理结果。未保存账号标识、会话 ID、认证文件或全量协议日志。

原生工具/权限往返、追问、计划 review、模型切换、动态 MCP 实际连接、图片，以及 Linux/Windows 原生进程清理未做真实 Provider 验收；fixture 覆盖协议映射和失败边界不能替代这些实测。跨平台平台跳过项如实保留。
