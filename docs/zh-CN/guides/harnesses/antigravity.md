# Antigravity

[English](../../../en/guides/harnesses/antigravity.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装 CLI，使用运行 Runtime 的同一操作系统账号运行 `agy`，交互完成认证。 安装细节见[官方指南](https://antigravity.google/docs/getting-started?tab=cli)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。执行以下原生检查；它只检查安装，不证明模型请求成功。

```sh
agy --version
```

最低版本为 `1.3.3`；仅接受 `full_access`，仅 canonical，不支持图片及逐轮 MCP。原生 SUCCESS 且回答非空才是成功；版本探测不能证明账号或模型可用。

## Channel Gateway 配置

假设你的外网代理使用**非 TUN 模式**，HTTP 代理监听在 `127.0.0.1:7890`，并且与运行 agy 的 Kernel 在同一台机器上，直接使用下面的配置。

替换 API 地址、Bot ID、Token 和工作目录后，在 Bash / Zsh 中执行。已有其他 Bot 时，将它们保留在 `bots` 列表中；此命令会替换整个声明。Channel Gateway 默认使用 `full_access`，允许 agy 自动执行工具，无需额外配置审批模式。

```bash
octo-runtime channel-gateway extraset <<< '{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "enabled": true,
  "config": {
    "bots": [
      {
        "api_url": "https://im.example.com/api",
        "bot_id": "<BOT_ID>",
        "bot_name": "local-assistant",
        "bf_token": "<BOT_TOKEN>",
        "adapter": {
          "adapter_type": "antigravity",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "context": {
          "schema": "octo.context-envelope/v3",
          "items": [
            {
              "namespace": "octo.execution",
              "name": "envs",
              "payload": {
                "env_variables": [
                  {
                    "key": "http_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "HTTP_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "https_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "HTTPS_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "all_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "ALL_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "no_proxy",
                    "value": "localhost,127.0.0.1,::1"
                  },
                  {
                    "key": "NO_PROXY",
                    "value": "localhost,127.0.0.1,::1"
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}'
```

> **可选参数**：`bot_name` 是 Bot 的显示名称；`model` 和 `effort` 均可省略，省略时使用所选 Harness 自身的默认设置。`<MODEL_ID>` 请替换为该 Harness 支持的模型 ID；`effort` 可填 `low`、`medium`、`high` 或 `xhigh`，实际支持范围由 Adapter 和 Harness 决定。

其中 `context` 已包含 agy 使用的代理环境变量，无需在启动 Runtime 前额外执行 `export`。这些变量传给此 Bot 的 agy 子进程及继承其环境的工具，不会通过该配置设置 Channel Gateway Extra 自身的代理。

如果代理地址或端口不同，替换上面六处 `http://127.0.0.1:7890`。不需要代理时，删除整个 `context` 字段。远端 Kernel 的 `127.0.0.1` 指远端机器。不要将包含真实 Token 的命令保存到共享 shell 历史。

## 启动并验证

首次使用，依次启动 Kernel 和 Channel Gateway：

```sh
octo-runtime executor-kernel start
octo-runtime channel-gateway start
```

如果 Channel Gateway 已经在运行，保存配置后执行 `octo-runtime channel-gateway restart`。使用自定义 Home 时，每条命令传入相同的 `--home`。向 Bot 发送“只回复 OK，不调用工具”，确认收到实际回答。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查 Gateway 配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。本轮仅 Antigravity 的配置到真实模型链路做了专项验证，其他 Harness 未新增真实验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-antigravity/README.zh.md) · [支持范围](../../reference/providers.md)
