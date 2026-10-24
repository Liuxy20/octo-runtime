# @mininglamp-oss/octo-runtime-adapter-opencode

OpenCode 2 适配器，type 为 `opencode`。本次验证的最低版本与最新稳定版本均为 **2.1.3**；支持范围为 `>=2.1.3 <3`，不支持预发布版本。其他 2.x 版本尚未逐版本实测。

`probe` 和每次 `invoke` 都检查实际选中的 executable，包括调用方指定的路径。本轮 PATH、cwd 与环境参与选择，执行使用同一解析路径。OpenCode 1 返回 `OPENCODE_VERSION_UNSUPPORTED`，包含检测版本和 “OpenCode 1 is no longer supported”；版本检测失败、超时或输出无法解析返回 `OPENCODE_VERSION_DETECTION_FAILED`。适配器不自动安装、升级或登录。

PATH 使用本机 `node:path` 规则及平台分隔符，保留条目顺序。绝对项保留原有含义，空项和相对项按本轮 cwd 查找；Windows 自定义命令的根相对和盘符相对路径也按本轮 cwd 解析。Windows UNC 项遵循本机 UNC 解析，适配器不映射共享、不提供网络认证；UNC 共享的真实可达性尚未实测。版本探测成功后执行固定绝对路径，不再次搜索 PATH。宿主负责选择可信目录，workdir 不构成安全沙箱。

Windows 的 PATH 和 PATHEXT 键不区分大小写。普通环境对象若同时含有多个大小写别名，探测与 Node 子进程一致，使用字典序首项，不修改调用方对象；POSIX 保留区分大小写的环境语义。

## 传输与权限

| approvalMode | 原生传输                                                    | 行为                                                                                                |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| full_access  | `opencode run --format json --thinking --auto --standalone` | 私有服务；原生自动批准请求，显式 deny 仍生效                                                        |
| ask          | `opencode acp`                                              | ACP protocolVersion=1；原生策略需要审批时，通过同一 invocation 的 respondInteraction 返回允许或拒绝 |
| assisted     | 无                                                          | 明确报 APPROVAL_MODE_UNSUPPORTED                                                                    |

ACP 使用标准初始化、session/new、session/load、session/prompt 和 session/cancel；只声明客户端实际实现的能力。session/load 的历史通知发生在 prompt 订阅前，不作为本轮答案重放。调用方继续传同一绝对 workdir 和 providerSession，缺失会话或 Provider 错误如实失败，不靠本地历史补齐。

ask 保留 OpenCode 原生权限配置，不用全局 allow 或 ask 覆盖用户 deny。若需要所有工具都请求审批，可由宿主在本轮原生配置中显式设置 `permissions: [{ action: "*", resource: "*", effect: "ask" }]`。已有原生允许规则可能无需再次请求审批；workdir 本身不是沙箱。

## 输入与配置

- CLI prompt 通过 stdin 原样传入，保留换行、引号和空格；不放入 argv。ACP 使用标准 text prompt。
- 新会话 controlInstructions 写入权限为 0600 的临时 instructions.md，追加到现有 inline instructions。正常续聊不重复追加；ACP 遵循共享 Adapter 的新会话控制指令合同。
- 每轮独立合并环境，不修改 process.env。子进程 cwd 与 PWD 同步为本轮 workdir，避免 V2 优先使用继承 PWD 而选择错误工作区。
- `OPENCODE_CONFIG_CONTENT` 必须为 JSON 对象；错误在创建临时资源或启动执行传输前报告。保留已有配置，不写用户配置文件。
- CLI MCP 映射到 V2 的 `mcp.servers`：stdio 为 local，HTTP 为 remote，`disabled: false`；toolTimeoutMs 映射为 `timeout.execution`。保留其他 server 与 mcp.timeout。
- ACP MCP 通过 session/new、session/load 的 mcpServers；HTTP 需原生声明支持。ACP 不支持 toolTimeoutMs 等扩展选项时明确报错。
- model 使用完整 provider/model。CLI 有显式 model 时将 effort 映射为 `--model provider/model#variant`，不传已删除的 `--variant`；xhigh 降为 high。未显式选择 model 的 CLI，以及尚未实现 effort setter 的 ACP，保留模型默认值并发送 REASONING_EFFORT_NOT_APPLIED 提示。具体 variant 是否可用由所选模型决定。

本轮模型 Context 仍由业务方显式提供；框架不按 sessionId 缓存、补齐或省略普通 Context。图片输入当前明确拒绝，不因上游 ACP 声明支持而扩大本适配器合同。

## 输出与清理

JSON CLI 归一化 step_start、text、reasoning、tool_use、step_finish 和 error。公开 reasoning 标记为 analysis/public_reasoning；相同 part 的快照不重复累加。V2 可以只发送终结工具帧，也可能在最终文本后直接退出而不发送 step_finish；有实际帧时保留原生 usage。

工具终态只接受原生 `completed` 与 `error`，分别映射为 completed 与 failed；其他状态不产生工具终态，不猜测新状态已经完成或失败。running 产生工具开始事件，pending 不产生工具终态。工具状态不决定整个 Run 成功，Run 仍以进程退出和最终文本为准。

一次模型 step 的 stop 不等于整个进程成功。适配器等待 CLI 正常退出且收到最终文本后才发送 run.completed；后续非零退出不能被早先 step_finish 掩盖。取消、原生错误和异常退出产生各自真实终态。ACP 同样保留文本、工具、usage_update 和 prompt 结果。每轮临时文件及所属 Provider 进程沿现有清理机制回收，清理失败继续向上报告。

## 使用与验收

宿主原生注册 `createOpenCodeAdapter({ command: "/absolute/path/to/opencode" })`；未传 command 时按宿主 PATH 选择。用户通过 V2 安装脚本安装的程序通常位于 `~/.opencode/bin/opencode`；非交互服务的 PATH 需要由宿主配置，适配器不会改选另一个安装。

```bash
pnpm build
node --test test/opencode-v2.test.js test/adapters.test.js test/context-mcp.test.js
OCTO_OPENCODE_COMMAND=/absolute/path/to/opencode node scripts/verify-opencode-v2.mjs
node scripts/verify-opencode-v1-rejection.mjs
```

真实验收脚本使用宿主已有模型认证、临时工作区和合成 MCP 凭据。V1 脚本只解包临时拒绝样本，不全局安装。IM 验证另需显式测试账号文件及测试群，见 `scripts/verify-opencode-im-live.mjs`。

验证矩阵、精确版本、脱敏结果与未测组合见 [Issue 103 验收记录](../../.octospec/tasks/103-opencode-v2/validation.md)。上游合同参考 [V2 CLI](https://dev.opencode.ai/v2/docs/cli/commands/)、[V2 ACP](https://dev.opencode.ai/v2/docs/cli/acp/)、[V2 迁移](https://dev.opencode.ai/v2/docs/migrate-v1/)。
