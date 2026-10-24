---
type: Reference
title: OpenCode 2 官方资料、发行渠道与源码差异
description: 固定 2.1.3 源码与 npm 发行信息，区分本仓确认缺口、上游合同和待实测风险。
tags: [adapter, protocol, invocation, interaction, envs, mcp, reasoning, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 调研基线

日期：2026-10-23，Asia/Shanghai。Runtime：`445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`。

## 发行信息：npm 已有稳定版 2

查询 npm 官方 registry 后确认：

| 对象 | 查询结果 | 含义 |
| --- | --- | --- |
| `@opencode/cli` 的 `latest` | 2.1.3 | V2 已实际发布，不是只有开发文档 |
| `@opencode/cli@2.1.3` 发布时间 | 2026-10-22T12:44:20.273Z，即北京时间 20:44:20 | 查询时最新稳定 2.x，后续执行前应重新核对 latest |
| `@opencode/cli@2.0.0` 发布时间 | 2026-09-11T23:44:52.963Z | 最低版本候选，尚未进行兼容验证 |
| `opencode-ai` 的 `latest` | 1.19.4 | 旧包的 latest 不能用于判断 V2 是否发布 |
| GitHub releases 列表头部 | v1.19.4 | 单看 release 列表会遗漏已发布的 V2 |
| Git tag `v2.1.3` | `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1` | 本文固定源码依据 |
| 本机交互式终端 `opencode --version` | opencode v2.1.3 | 实际选中 `~/.opencode/bin/opencode`，已直接运行绝对路径复核 |
| 本机非交互终端原先选中的 nvm 安装 | 1.18.30 | 旧 `opencode-ai` 仍在，后续作为 V1 拒绝样本；不能代表用户终端的有效版本 |

来源：[npm V2 元数据](https://registry.npmjs.org/@opencode%2fcli)、[npm 旧包元数据](https://registry.npmjs.org/opencode-ai)、[固定源码](https://github.com/anomalyco/opencode/tree/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1)。npm 包版本与 Git tag 对应名称已经核对，但未验证发行二进制与源码字节一致。

复查命令：

```bash
npm view @opencode/cli version dist-tags --json --registry=https://registry.npmjs.org
npm view @opencode/cli@2.1.3 dist.tarball dist.integrity --json --registry=https://registry.npmjs.org
gh api repos/anomalyco/opencode/commits/v2.1.3 --jq '{sha,html_url}'
opencode --version
```

初次调研只查 GitHub releases 引发的 V2 发布疑问已纠正。版本门禁必须依据实际 executable，不能判断安装渠道后放行或拒绝。

### 本机路径复核

用户确认已安装 2.1.3 后，再次执行交互式 shell 与绝对路径查询，结果如下：

```text
zsh -ic 'opencode --version'
opencode v2.1.3

/Users/lvsijia/.opencode/bin/opencode --version
opencode v2.1.3
```

Agent 默认非交互环境选中 `/Users/lvsijia/.nvm/versions/node/v24.19.0/bin/opencode`，仍返回 1.18.30。后续真实 V2 验证固定使用 `/Users/lvsijia/.opencode/bin/opencode`，并记录有效 PATH 与所选程序；不能因为 Agent 环境解析到旧版就判定用户未升级。该差异也应进入自定义路径和 PATH 覆盖回归。

## 官方资料入口

| 来源 | 使用目的 |
| --- | --- |
| [V1 -> V2 迁移](https://dev.opencode.ai/v2/docs/migrate-v1/) | 配置兼容归一化与原生 V2 结构；支持 V1 配置不代表 Runtime 继续支持 V1 程序 |
| [V2 CLI](https://dev.opencode.ai/v2/docs/cli/) | 普通命令的共享服务、`--standalone` 私有服务及会话持久化 |
| [V2 Commands](https://dev.opencode.ai/v2/docs/cli/commands/) | run、session、ACP 与自动审批的命令边界 |
| [V2 ACP 协议参考](https://dev.opencode.ai/v2/docs/cli/acp/) | 比旧站 ACP 简介更完整的 V2 握手、session、权限、配置选项和取消合同 |
| [V2 Config](https://dev.opencode.ai/v2/docs/config/) | 原生 permissions、MCP、instructions 及管理配置优先级 |
| [旧站 ACP 简介](https://opencode.ai/docs/acp/) | issue 原链接；仅证明入口形式，不能单独支撑 V2 完整协议结论 |

滚动文档可能与所选最小版本不同，实际验收固定包版本和源码。未读取的引用页面不作为已确认依据。

## CLI：已确认参数差异

固定源码 [commands.ts](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/commands/commands.ts) 的 run 定义（376-417 行）提供 `--model provider/model#variant`、`--thinking`、`--auto` 和 ServerParams；未定义独立 `--variant`。

本仓 `buildOpenCodeCommand` 仍在 effort 有值时拼接 `--variant`。这是参数合同已确认的差异；尚未实际运行 2.1.3 来保存该参数的错误输出。模型显式提供时应验证合成模型引用；未提供模型但有 effort 时，需基于原生有效模型或其他真实载体实现，不能静默挑一个模型或假装已应用。

固定 [run handler](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/commands/handlers/run.ts) 将 `standalone` 交给 ServerConnection；[ACP handler](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/commands/handlers/acp.ts) 直接调用 Standalone.start。因此应首先验证 CLI 的 `--standalone`，保证临时配置和环境进入本轮 Provider 服务；尚未证明不加此参数必然丢失所有 env，因为 V2 也有会话环境传递。

[run.ts](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/run/run.ts) 的入口还会格式化 argv 消息并合并 stdin，故 prompt 的引号、换行、前导连字符等须做保真测试，不能只测试简单字符串。

## JSON 输出：部分结构仍保留，不能直接推断全失效

已读取固定 [noninteractive.ts](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/run/noninteractive.ts)：

- JSON 外层仍有 `type`、`timestamp`、`sessionID`，保留 step_start、text/reasoning part、tool_use、step_finish 和 error。
- tool part 使用原生 id、messageID、tool 和 state；step_finish 包含 finish、tokens 等数据，需保存代表样本逐字段对照。
- CLI 对非交互 permission/form 有原生处理，`--auto` 不等于无限制覆盖 deny，也不等于具备人工问答。
- 当前 Runtime 在 `part.reason === stop` 时发出 run.completed，共享 JSON helper 收到终态后立即结束读取并进入清理。必须验证此时是否已是整次执行完成，及晚到错误/退出码会否被忽略；本轮只记录风险，不宣称已复现误报。

本仓已有 snapshot 增量去重与 tool start 去重测试，但没有实际 V2 输出证据。保留现有逻辑中仍符合合同的部分，基于实测修正变化字段。

## 配置：V1 兼容输入与 V2 原生生成分开

V2 支持读取部分 V1 格式并在内存归一化，不能因此直接判定当前 MCP 或 permission 配置必定无效；也不能因此跳过生成结果的原生合同验证。

| 本仓生成内容 | V2 原生方向 | 本次发现与后续验证 |
| --- | --- | --- |
| CLI `inline.mcp[name]`、enabled、数值 timeout | `mcp.servers[name]`、disabled、分开的 timeout 用途 | 应生成 V2 载体；验证已有 native mcp.servers 与本轮 server 保留及同名语义 |
| ACP 固定 `permission: ask` | 有序 permissions 规则 | 检查与 native permissions 并存的优先级，不能假设旧字段必定覆盖原生字段 |
| ACP 从 `process.env.OPENCODE_CONFIG_CONTENT` 构造覆盖 | 从 `invocationEnvironment(request)` 的有效本轮值构造 | 代码明确没有读取 request 版本；随后 adapter 固定 env 覆盖本轮同名变量，会忽略逐轮 inline 配置 |
| CLI mkdtemp/writeFile 后 JSON.parse | 先校验或包住失败路径清理 | 非法 inline JSON 等 buildCommand 中途失败时，spec 尚未返回，共享 finally 不会调用 cleanup；属于源码可见清理缺口 |
| 临时 instructions 追加 | 保留本地配置与已有 instructions | 单独验证新会话和 resume 时控制指令行为，不混同普通 Context |

不修改用户全局或项目配置。JSONC 是否需要由 adapter 解析是独立兼容选择；本仓现有 inline 合同是 JSON，不因 V2 文件支持 JSONC 就自动扩展本次范围。

## ACP：现有基础可复用，仍有关键待验项

依据 [V2 ACP](https://dev.opencode.ai/v2/docs/cli/acp/) 与本仓共享 ACP 源码：

| 项目 | 上游合同与当前 Runtime 对照 |
| --- | --- |
| 传输 | stdio NDJSON JSON-RPC，ACP protocolVersion=1；产品 OpenCode major=2 与协议版本1无关 |
| 生命周期 | ACP 自动启动私有服务；关闭 stdin 后退出，仍须观测实际后代清理 |
| 续聊 | session/load 会重放历史，session/resume 不重放；当前通用路径固定 load，需验证旧历史会否被归入新一轮输出 |
| cwd | 创建及恢复使用绝对路径，恢复须匹配 session 原目录，错误不可伪装成续聊成功 |
| 模型 | configOptions 与 session/set_config_option；当前 helper 已有该载体，但分组模型 options 需验证 |
| effort | 固定 config-option.ts 提供 effort/thought_level；当前共享 ACP 未调用 setter，需按现有未应用合同提示或实现 |
| 权限 | optionId 包含 once、always、reject；审批桥应按实际选项返回并验证拒绝结果、取消及重复响应 |
| MCP | session/new/load 可传 stdio/HTTP；当前 client 有转换，仍需验证工具实际执行及同目录并发隔离 |
| 取消 | session/cancel 的 prompt 结果应带 cancelled；Runtime 当前 250ms 后强制关闭兜底，需验证不会吞掉终态或漏留后代 |
| 用量 | prompt response 的 usage 可复用现有终端 usage 处理；usage_update 中 used/size/cost 结构与当前 update.usage 不同，存在字段遗漏风险 |
| 原生扩展 | form elicitation、compaction 等仅在实现且验证后声明；当前 initialize 的 clientCapabilities 为空，不新增自建功能标签 |

固定 [config-option.ts](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/acp/config-option.ts) 和 [capabilities.ts](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/src/acp/capabilities.ts) 已读取。model 的 CLI `#variant` 与 ACP 原生 setter/模型值不能混用同一字符串拼接规则。

## 本轮证据等级

已完成：issue、官方网页、npm 元数据、固定源码、本仓源码/测试范围核对，以及本机 V2 和旧 V1 的实际路径/版本查询。用户已安装 V2 2.1.3；本轮未安装或覆盖任何 Provider。尚无 V2 ACP 握手、模型调用、工具、审批或取消证据；没有执行 Runtime 产品测试。所有功能兼容矩阵条目均保持待验。
