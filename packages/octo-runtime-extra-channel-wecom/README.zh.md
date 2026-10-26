# WeCom Channel

[English](README.md) | [包导航](../README.zh.md)

可选的 `channel-wecom` Extra：通过企业微信自己的 WebSocket 连接 Bot，做消息准入，生成本轮输入，用 `ctx.kernel` 调已有 Kernel，再以企业微信流式消息回复。认证、心跳、ACK 顺序、投递都收在这里——不依赖 Core，也不依赖 Octo Gateway 的实现。

## 什么时候用它

- 你要接的是企业微信而不是 Octo IM；两个渠道互不依赖。
- SDK 宿主自己管理 Extra 生命周期和 Kernel 端点。
- 你要通过 CLI 部署：保存 `channel-wecom` 声明，再执行 `octo-runtime channel-wecom start`；它的服务独立于 `channel-gateway`。

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

## 配置

```json
{
  "bots": [
    {
      "bot_id": "<BOT_ID>",
      "app_secret": "<APP_SECRET>",
      "adapter": { "adapter_type": "dsh", "workdir": "/absolute/workspace" },
      "allowed_sender_ids": ["<USER_ID>"]
    }
  ]
}
```

| 字段                   | 说明                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `bots`                 | 最多 16 个。每个都要有 `bot_id`、`adapter`，以及建联前解析好的 `app_secret`。                    |
| `ws_url`               | 默认 `wss://openws.work.weixin.qq.com`。                                                         |
| `adapter`              | 本地引擎要绝对 `workdir`。OpenClaw 禁止 `workdir`，改用已有的 `provider_agent_id`，默认 `main`。 |
| `approval_mode`        | 默认 `full_access`。                                                                             |
| `run_timeout_ms`       | 默认 `120000`，允许范围 `1..600000`。                                                            |
| `allowed_sender_ids`   | 省略表示不限发送者；`[]` 表示全部拒绝。                                                          |
| `authorized_space_ids` | 只校验形状，不对企业微信消息执行 Octo Space 准入——发送者策略用企业微信自己的。                   |

这段是里层的 `config`。CLI 声明会包成 `{ "module": "@mininglamp-oss/octo-runtime-extra-channel-wecom", "enabled": true, "config": { ... } }`；SDK 只传 `config`。

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
