# Octo Gateway Channel

[English](README.md) | [包导航](../README.zh.md)

把 Octo IM 机器人接到本地 Agent 执行服务的 Extra：负责 Bot 凭据、悟空 WebSocket、消息准入、按会话维护的 session、`ctx.kernel.invoke`，以及把回复流式发回聊天。Gateway 与 Executor Kernel 独立启动；Kernel 暂不可用时 Gateway 保持运行并等待恢复，执行 Agent 任务时才需要 Kernel 可达。企业微信使用独立的 WeCom Extra。

## 什么时候用它

- 你想让 Octo 机器人和应用走同一条执行路径。
- 你需要私聊、群与话题、交互卡片或文件投递。
- 你要接的是企业微信：用 [WeCom Channel](../octo-runtime-extra-channel-wecom/README.zh.md)。

## CLI 常用命令

先查看当前安装版本的命令和示例：

```sh
octo-runtime channel-gateway --help
octo-runtime channel-gateway configure --help
```

替换占位值并配置，再按需启动独立服务：

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "<BOT_TOKEN>"
```

每次配置一个 Bot，可重复运行：相同 `bot_id` 更新原项（改地址也不追加），新 ID 追加到 `config.bots`；省略字段及其他 Bot 保留。旧 JSON 中跨地址的同 ID 多项会合并为首项，保留首项省略字段。业务参数与配置字段同名，凭据直接传原文。

首次配置可省略 `--model`、`--effort`，使用所选 Harness 框架本身的默认值；`effort` 可选 low/medium/high/xhigh，实际支持由 Harness 决定。更新时省略这两项会保留旧值；恢复默认值需从完整声明中删除对应字段，再执行 `extraset`。使用 OpenClaw 时改为 `--adapter_type openclaw`、`--provider_agent_id main`，不传 `--workdir`；从已有本地 Adapter 切换时，同样通过 `extraset` 移除旧 workdir。

```sh
octo-runtime channel-gateway start
octo-runtime channel-gateway status
octo-runtime channel-gateway restart
octo-runtime channel-gateway stop
octo-runtime channel-gateway logs --lines 200
```

配置只保存文件，不自动启动或重载。首次使用 `start`；已运行服务修改配置后用 `restart`。执行 Agent 任务还需单独启动 `executor-kernel`。

帮助中的公共命令在前，自有命令在后：

| 命令        | 用途                                                       |
| ----------- | ---------------------------------------------------------- |
| `install`   | 注册当前服务，默认开启自启；`--autostart=false` 显式禁用。 |
| `uninstall` | 卸载服务，保留配置和数据。                                 |
| `start`     | 未安装时自动安装，再启动并等待就绪。                       |
| `stop`      | 停止当前服务，保留自启设置。                               |
| `restart`   | 重启已安装的服务并等待就绪，不自动安装。                   |
| `run`       | 前台运行，不注册系统服务。                                 |
| `status`    | 查看服务状态及 Gateway 公开的业务状态。                    |
| `logs`      | 查看组件状态日志，支持 `--follow`。                        |
| `extraset`  | 从 stdin 读取并替换完整 JSON 声明。                        |
| `extraget`  | 输出完整 JSON 声明，包含凭据。                             |
| `configure` | Gateway 自有命令，按 `bot_id` 新增或更新 Bot。             |

## 托管它

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function startGateway(endpoint: string, config: JsonObject) {
  const extra = createExtraService({ endpoint, module: gateway, config, dependencies: {} });
  await extra.initialize();
  return extra;
}
```

`endpoint` 是已有的 Kernel 端点；Gateway 不构造也不关闭 Kernel。需要逐轮业务 Context 就传 `dependencies.loadContexts`；聊天到会话的绑定要跨重启保留，就传 `dependencies.createSessionStore`。

## 进阶：JSON 配置与 SDK 字段

进阶用法：通过对应 Extra 的 `extraset/extraget` 子命令读写包含 `config`、可选 `module`/`enabled` 的完整 JSON 声明。业务配置操作以该 Extra 自己声明的子命令为准。

```sh
octo-runtime channel-gateway extraset \
  < channel-gateway-declaration.json
octo-runtime channel-gateway extraget
```

`extraset` 直接替换整份声明，不按 bot_id 合并，也不保留省略字段。读取命令返回完整对应 JSON（渠道含凭据）。保存后仍需重启已运行的 Extra。

```json
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "enabled": true,
  "config": {
    "bots": [
      {
        "api_url": "https://im-test.deepminer.com.cn/api",
        "bot_id": "<BOT_ID>",
        "bot_name": "local-assistant",
        "enabled": true,
        "bf_token": "<BOT_TOKEN>",
        "adapter": {
          "adapter_type": "codex",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "approval_mode": "full_access",
        "run_timeout_ms": 86400000,
        "context": {
          "schema": "octo.context-envelope/v3",
          "items": [
            {
              "namespace": "octo.control",
              "name": "instructions",
              "payload": { "entries": [{ "text": "You are the local assistant." }] }
            }
          ]
        },
        "allowed_sender_ids": ["<USER_ID>"],
        "groups_enabled": true,
        "group_ids": ["<GROUP_ID>"],
        "artifact_delivery": {
          "mode": "channel",
          "allowed_roots": ["/absolute/workspace"],
          "allowed_mime_types": ["image/png", "application/pdf"]
        },
        "cards": true,
        "typing": true
      }
    ]
  }
}
```

`model` 和 `effort` 都可省略；省略时使用所选 Harness 框架本身的默认值。示例中的 `<MODEL_ID>` 请替换成该 Harness 支持的模型标识；`effort` 可为 `low`、`medium`、`high` 或 `xhigh`，具体支持范围由 Harness 决定。

这是完整的 CLI 声明：必填 `config`，以及可选的 `module`、`enabled`。通常由有效模块清单提供 `module`；显式填写时必须与选中的模块一致。SDK 只取其中的业务配置：`createExtraService({ endpoint, module: gateway, config: declaration.config, dependencies })`。顶层 `enabled` 由 CLI 处理，Bot 内的 `enabled` 由 Gateway 处理，两者不是同一层配置。

只有一个 Bot 也写 `bots: [bot]`，没有单对象格式。每次 `extraset` 都整体替换声明——省略的字段不会从旧配置继承，也不会按 `bot_id` 合并。上限：64 个 Bot、64 个在途管理操作、单份声明 256 KiB。

## 真正会设的 Bot 字段

| 字段                          | 说明                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_url`、`bot_id`           | 必填。`api_url` 指向 Octo IM，例如 `https://im-test.deepminer.com.cn/api`。                                                                  |
| `bf_token`                    | 宿主提供的 Bot Token。插件不读凭据文件，也不读配置中心。                                                                                     |
| `adapter`                     | 执行设置：`adapter_type`、`workdir` 及 Provider 专有选项；`model`、`effort` 可省略，使用 Harness 默认值。                                    |
| `context`                     | 可选 Context v3 envelope，空 `items` 合法。                                                                                                  |
| `approval_mode`               | 默认 `full_access`；允许范围跟随所选 Adapter。                                                                                               |
| `groups_enabled`、`group_ids` | 群与话题。省略 `groups_enabled` 或设为 `true` 即开启；不影响私聊。                                                                           |
| `run_timeout_ms`              | 默认 `86400000`（24 小时），允许范围 `100..86400000`。                                                                                       |
| `allowed_sender_ids`          | 省略表示不限发送者；`[]` 表示全部拒绝。                                                                                                      |
| `artifact_delivery`           | `mode: "tools"` 关闭内置上传；`allowed_roots`、`allowed_mime_types`、`max_file_bytes`、`max_total_bytes`、`max_files`、`timeout_ms` 可收窄。 |
| `cards`、`typing`             | 布尔值，默认都是 `true`。关掉卡片不影响普通文本回复。                                                                                        |

完整字段、默认值和限制见 [config-schema.json](config-schema.json)。

## 会话与投递

- 聊天到会话的绑定放在 `ImSessionStore`。默认的 `MemoryImSessionStore` 有界、不跨重启；要持久化就提供 `createSessionStore(botConfig)`。store 不保存完整 Provider 历史，也恢复不了未结束的 Run。
- Gateway 在模型执行前准备本轮 Context。新逻辑会话可补充当前触发之前的最近聊天；群/话题存在历史缺口时按固定规则补齐，最多 15 条、1500 Unicode 码点，失败不阻断当前任务。Host/Adapter 不自行读取聊天历史，额外业务调查仍由 Agent 按任务执行。
- 成功 final 里引用的文件会作为 IM 附件上传：单文件 20 MiB、单轮 50 MiB、最多 16 个不同文件、准备时间 30 秒。部分失败保留成功的链接，并写明哪些没投递。
- Adapter 发来的 `session.update` 是不透明的 Provider 绑定数据，不是应用历史。

模型连续静默满 30 秒时，Gateway 更新原推理卡片底部提示，之后每 30 秒刷新。助手正文或公开 reasoning 到达即清除提示；工具、审批和等待用户输入暂停计时。连续模型静默达到 300 秒时请求取消，不自动重放任务；取消待确认期间保留 Stop，确认原执行结束后才提供 Retry。该间隔也适用于已有输出后及工具结束后的模型等待，不只测量首字延迟。显式执行期限可更早结束本轮。

## 工作容量与会话排队

每个 Bot 有 **64 个工作槽位**，可以理解为同时服务 64 个逻辑 session 的名额。同 session 每次只处理 1 条消息，还可另收 **4 条排队消息**；排队消息等待前一条结束，不额外占工作槽。准备、等待模型/工具/用户、内部重试和必要的投递清理期间，工作槽仍被占用。

这里的 session 按同一 Bot 下的私聊、群或话题划分。同群内不同发送者共用该群的队列；独立话题使用自己的队列。

以下例子均假设消息已通过授权、不是重复消息且 Gateway 正常运行。每行描述同一个 Bot 的一种情况：

| 场景 | 工作槽占用 | 排队消息数 | 下一步如何处理 |
| --- | --- | --- | --- |
| session A 正在处理 A1，A2/A3/A4/A5 等待 | 1 | 4 | 再发 A6，因 A 的队列满拒收。 |
| 20 个 session 各处理 1 条、排队 4 条 | 20 | 80 | 已受理共 100 条消息，仍有 44 个工作槽可接纳新/空闲 session。 |
| 64 个 session 各处理 1 条，都没排队 | 64 | 0 | A 仍可追加 A2/A3/A4/A5；工作槽仍为 64，排队变为 4。 |
| 64 个工作槽已满，A 也已有 4 条排队 | 64 | 4 | A6 因 A 的队列满拒收；其他工作 session 仍可补满各自的队列。 |
| 64 个工作槽已满，新 session Z 发 Z1 | 64 | 不变 | Z1 需要工作槽，因 Bot 工作满拒收；只有历史 binding 的空闲 session 也需要申请槽位。 |

A1 结束并完成清理后，A2 接着使用 A 的槽位：A 排队数从 4 减为 3，工作槽仍为 64。只有 A 最后一条消息结束并完成清理，槽位才释放给其他 session。取消 ACK 本身不释放槽位。拒收消息不会自动重提，需要在容量空出后重新发送。Bot 工作满对应 `OH-RUN-2003`；session 队列满对应 `OH-RUN-2004`，两者同时满足时优先报告队列满。拒收不开始执行、不标记已读。

每个 Bot 的状态用 `workingTasks` 表示已占工作槽、`queuedTasks` 表示等待消息。历史聊天到 session 的 binding 独立计数，不占上述名额；状态中的 `sessions` 只列当前调度条目。默认内存 store 另有容量和期限，见 [会话存储合同](../../.octospec/rules/session-reset.md#当前内置-im-存储)。这些是 Gateway 的容量限制，不限制一天累计服务过的 session 数，不保证 64 个模型同时执行，也不适用于 WeCom。

## 生命周期与状态

`status()` 返回 `{ bots, errors }`：有效 Bot 报告连接、投递和会话计数，无效 Bot 按索引和错误码报告，不影响其他 Bot。`loaded` 不代表每个 Bot 都在线。

| Bot `state` | 含义 | `connected` / `error` |
| --- | --- | --- |
| `stopped` | 未启动、被禁用或正在停止/已停止 | `false` / `null` |
| `connecting` | 首次连接尝试中 | `false` / `null` |
| `online` | 鉴权、注册和 WebSocket 握手完整成功 | `true` / `null` |
| `retrying` | 首次或后续暂态失败后，等待重试或正在重新连接 | `false` / 最近一次连接错误码 |
| `failed` | 缺凭据、明确终端拒绝或连接清理失败 | `false` / 连接错误码；清理失败另发释放诊断 |

首次暂态失败和上线后的暂态断线都会自动恢复。失败连接回收结束后，依次等待 **5、10、15 秒，后续每次失败均等待 15 秒**。服务端 `Retry-After` 可延长当次等待。连接尝试和清理还需额外时间，因此这些间隔不代表上线时间保证。完整上线后清除 `error` 并重置计数，下次断线重新从 5 秒开始；仅注册成功不算完整上线。

例如首次连接遇到 HTTP 503，进入 `retrying`；5 秒后重试仍失败，下一次等待 10 秒；再失败等待 15 秒，此后持续按 15 秒等待恢复。缺凭据以及明确认证、权限、配置或协议拒绝则进入 `failed`。Gateway 不轮询缺失凭据，修正原因后需重启 Extra。合法服务端断开（包括 reason 12 和未知断开原因）默认重试；HTTP 超时、冲突、限流和服务故障也重试，明确终端拒绝仍停止恢复。

停止或卸载会取消待触发的重连计时器和在途建联。Provider 执行、卡片和投递使用独立诊断；`online` 只证明连接健康，不代表任务完成或回复已送达。

`close()` 取消插件拥有的连接、执行和投递工作。替换 Extra 之前要 await 并检查 `complete`；它不会停掉 Kernel 或其他 Extra。清理失败以 `EXTRA_DISPOSE_FAILED` 暴露。

## CLI 部署

保存后的声明在 `<home>/extras/channel-gateway/config.json`（POSIX `0600`）。已运行的后台服务修改配置后执行 `octo-runtime channel-gateway restart`；前台运行需结束旧进程，再执行 `octo-runtime channel-gateway run`。`octo-runtime status` 和 `octo-runtime channel-gateway status` 会显示系统服务、Kernel 可用性及 Gateway 返回的 Bot/任务等业务摘要；需要完整公开状态时添加 `--json`。服务就绪和每个 Bot 在线仍需分别判断。写配置不会装包、不会立即建连，也不会改动运行中的实例。

## 导入与分发

发行入口：`@mininglamp-oss/octo-runtime/extras/channel-gateway`。private workspace 包名是给源码和子模块宿主用的。

## 延伸阅读

- [实现](src/index.ts)、[动态 Context 指南](../../.octospec/guides/channel-dynamic-contexts.md)、[Channel 合同](../../.octospec/rules/channel-integration.md)。
- [Gateway 指南](../../SDK_CHANNEL_GATEWAY_GUIDE.md)、[Host SDK](../octo-runtime-host-sdk/README.zh.md)。
