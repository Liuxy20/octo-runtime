# WeCom Channel

[English](README.md) | [包导航](../README.zh.md)

可选的 `channel-wecom` Extra：通过企业微信自己的 WebSocket 连接 Bot，做消息准入，生成本轮输入，用 `ctx.kernel` 调已有 Kernel，再以企业微信流式消息回复。认证、心跳、ACK 顺序、投递都收在这里——不依赖 Core，也不依赖 Octo Gateway 的实现。

## 什么时候用它

- 你要接的是企业微信而不是 Octo IM；两个渠道互不依赖。
- SDK 宿主自己管理 Extra 生命周期和 Kernel 端点。
- 你要通过 CLI 部署：保存 `channel-wecom` 声明，再执行 `octo-runtime channel-wecom start`；它的服务独立于 `channel-gateway`。

## CLI 常用命令

先替换占位值并配置，再按需启动独立服务：

```sh
octo-runtime channel-wecom configure \
  --bot_id assistant \
  --ws_url wss://openws.work.weixin.qq.com \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "<APP_SECRET>"
```

每次配置一个 Bot，可重复运行：相同 `bot_id` 更新原项（改地址也不追加），新 ID 追加到 `config.bots`；省略字段及其他 Bot 保留。旧 JSON 中跨地址的同 ID 多项会合并为首项，保留首项省略字段。业务参数与配置字段同名，凭据直接传原文。

首次配置可省略 `--model`、`--effort`，使用所选 Harness 框架本身的默认值；`effort` 可选 low/medium/high/xhigh，实际支持由 Harness 决定。更新时省略这两项会保留旧值；恢复默认值需从完整声明中删除对应字段，再执行 `extraset`。使用 OpenClaw 时改为 `--adapter_type openclaw`、`--provider_agent_id main`，不传 `--workdir`；从已有本地 Adapter 切换时，同样通过 `extraset` 移除旧 workdir。`--ws_url` 可省略：更新保留旧地址，新 Bot 使用官方默认地址。

```sh
octo-runtime channel-wecom start
octo-runtime channel-wecom status
octo-runtime channel-wecom restart
octo-runtime channel-wecom stop
octo-runtime channel-wecom configure \
  --help
```

配置只保存文件，不自动启动或重载。首次使用 `start`；已运行服务修改配置后用 `restart`。执行 Agent 任务还需单独启动 `executor-kernel`。

## 托管它

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as wecom from "@mininglamp-oss/octo-runtime/extras/channel-wecom";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function startWeCom(endpoint: string, config: JsonObject) {
  const extra = createExtraService({ endpoint, module: wecom, config, dependencies: {} });
  await extra.initialize();
  return extra;
}
```

固定的 Extra 名：`channel-wecom`。

## 进阶：JSON 配置与 SDK 字段

进阶用法：通过对应 Extra 的 `extraset/extraget` 子命令读写包含 `config`、可选 `module`/`enabled` 的完整 JSON 声明。业务配置操作以该 Extra 自己声明的子命令为准。

```sh
octo-runtime channel-wecom extraset \
  < channel-wecom-declaration.json
octo-runtime channel-wecom extraget
```

`extraset` 直接替换整份声明，不按 bot_id 合并，也不保留省略字段。读取命令返回完整对应 JSON（渠道含凭据）。保存后仍需重启已运行的 Extra。

```json
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-wecom",
  "enabled": true,
  "config": {
    "bots": [
      {
        "bot_id": "<BOT_ID>",
        "app_secret": "<APP_SECRET>",
        "adapter": {
          "adapter_type": "codex",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "allowed_sender_ids": ["<USER_ID>"]
      }
    ]
  }
}
```

`model` 和 `effort` 都可省略；省略时使用所选 Harness 框架本身的默认值。示例中的 `<MODEL_ID>` 请替换成该 Harness 支持的模型标识；`effort` 可为 `low`、`medium`、`high` 或 `xhigh`，具体支持范围由 Harness 决定。

| 字段                   | 说明                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `bots`                 | 最多 16 个。每个都要有 `bot_id`、`adapter`，以及建联前解析好的 `app_secret`。                    |
| `ws_url`               | 默认 `wss://openws.work.weixin.qq.com`。                                                         |
| `adapter`              | 本地引擎要绝对 `workdir`。OpenClaw 禁止 `workdir`，改用已有的 `provider_agent_id`，默认 `main`。 |
| `approval_mode`        | 默认 `full_access`。                                                                             |
| `run_timeout_ms`       | 默认 `120000`，允许范围 `1..600000`。                                                            |
| `allowed_sender_ids`   | 省略表示不限发送者；`[]` 表示全部拒绝。                                                          |
| `authorized_space_ids` | 只校验形状，不对企业微信消息执行 Octo Space 准入——发送者策略用企业微信自己的。                   |

上例是写入 `channel-wecom-declaration.json` 的完整 CLI 声明；SDK 只接收其中的 `config` 对象。

完整字段与限制见 [config-schema.json](config-schema.json)。

## Context

可选的 `loadContexts(botConfig, { signal })` 在每个被接纳的轮次里按同 key 替换静态 Context 项。默认 5000 ms、8 个真实在途调用，范围 `1..30000` 与 `1..32`。失败会阻止本轮调用；超时的调用要到结束才释放名额。省略 Context 不会补人设。

## 状态、会话、关闭

`status()` 返回 `{ bots, errors }`；坏 Bot 按索引和错误码报告，好的照常初始化。会话和回执去重都在有界内存里，不跨重启恢复；投递计数描述的是保留下来的回执，不是累计发送量。真实客户端渲染要在企业微信上自己验。

替换 Extra 前先 await `close()` 并确认 `complete`。销毁会取消连接、执行和投递工作；可见的失败以 `EXTRA_DISPOSE_FAILED` 抛出。它永远不停 Kernel 或其他 Extra。

## 导入与分发

发行入口：`@mininglamp-oss/octo-runtime/extras/channel-wecom`。

## 延伸阅读

- [实现](src/index.ts)、[Host SDK](../octo-runtime-host-sdk/README.zh.md)、[Octo Gateway](../octo-runtime-extra-channel-gateway/README.zh.md)。
- [Channel 合同](../../.octospec/rules/channel-integration.md)。
