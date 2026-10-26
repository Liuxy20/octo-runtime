# Octo Gateway Channel

[English](README.md) | [包导航](../README.zh.md)

把 Octo IM 机器人接到已有 Kernel 上的 Extra：Bot 凭据、悟空 WebSocket、消息准入、按会话维护的 session、`ctx.kernel.invoke`，以及把回复流式发回聊天。它只管 Octo IM——企业微信是另一个 Extra，生命周期也各管各的。

## 什么时候用它

- 你想让 Octo 机器人和应用走同一条执行路径。
- 你需要私聊、群与话题、交互卡片或文件投递。
- 你要接的是企业微信：用 [WeCom Channel](../octo-runtime-extra-channel-wecom/README.zh.md)。

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

## 配置

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
          "model": "gpt-6.1-sol",
          "effort": "medium"
        },
        "approval_mode": "full_access",
        "run_timeout_ms": 600000,
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

这是完整的 CLI 声明：`module`、`enabled`，以及插件自己的 `config`。SDK 只取里面那层——`createExtraService({ endpoint, module, config: declaration.config, dependencies })`——不看 `enabled`，后者只决定 CLI 服务是否启动这个插件。

只有一个 Bot 也写 `bots: [bot]`，没有单对象格式。每次 `extraset` 都整体替换声明——省略的字段不会从旧配置继承，也不会按 `bot_id` 合并。上限：64 个 Bot、64 个在途管理操作、单份声明 256 KiB。

## 真正会设的 Bot 字段

| 字段                          | 说明                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_url`、`bot_id`           | 必填。`api_url` 指向 Octo IM，例如 `https://im-test.deepminer.com.cn/api`。                                                                  |
| `bf_token`                    | 宿主提供的 Bot Token。插件不读凭据文件，也不读配置中心。                                                                                     |
| `adapter`                     | 必填的执行设置：`adapter_type`、`workdir`、`model`，以及 Provider 专有选项。                                                                 |
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
- 本轮 Context 的内容和顺序由插件决定。允许空 Context；宿主只做校验、转发和固定渲染，绝不从聊天历史补齐。
- 成功 final 里引用的文件会作为 IM 附件上传：单文件 20 MiB、单轮 50 MiB、最多 16 个不同文件、准备时间 30 秒。部分失败保留成功的链接，并写明哪些没投递。
- Adapter 发来的 `session.update` 是不透明的 Provider 绑定数据，不是应用历史。

## 生命周期与状态

`status()` 返回 `{ bots, errors }`：有效 Bot 报告连接、投递和会话计数，无效 Bot 按索引和错误码报告，不影响其他 Bot。`loaded` 不代表每个 Bot 都在线。

`close()` 取消插件拥有的连接、执行和投递工作。替换 Extra 之前要 await 并检查 `complete`；它不会停掉 Kernel 或其他 Extra。清理失败以 `EXTRA_DISPOSE_FAILED` 暴露。

## CLI 部署

保存后的声明在 `<home>/extras/channel-gateway/config.json`（POSIX `0600`）。改完之后，装了后台服务的设备执行 `octo-runtime channel-gateway restart`，前台运行用 `octo-runtime channel-gateway run`。`octo-runtime status` 报的是生命周期，同样不是每个 Bot 的连通性。写配置不会装包、不会立即建连，也不会改动运行中的实例。

## 导入与分发

发行入口：`@mininglamp-oss/octo-runtime/extras/channel-gateway`。private workspace 包名是给源码和子模块宿主用的。

## 延伸阅读

- [实现](src/index.ts)、[动态 Context 指南](../../.octospec/guides/channel-dynamic-contexts.md)、[Channel 合同](../../.octospec/rules/channel-integration.md)。
- [Gateway 指南](../../SDK_CHANNEL_GATEWAY_GUIDE.md)、[Host SDK](../octo-runtime-host-sdk/README.zh.md)。
