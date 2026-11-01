# MiniMax Code

[English](../../../en/guides/harnesses/mcode.md) | [Harness 目录](../harnesses.md)

本页对应 MiniMax Code，命令和 Adapter 类型均为 `mcode`，不是小米的 mimocode。

## 安装与认证

按 [MiniMax Code 官方指南](https://github.com/MiniMax-AI/minimax-code)安装。使用运行 Runtime 的操作系统账号登录：

```sh
mcode login
```

国际账号使用 `mcode login --region global`。确保后台 Runtime 能找到可执行文件：

```sh
mcode --version
```

## Channel Gateway 配置

替换 API 地址、Bot ID、Token 和工作目录后，在 Bash / Zsh 中执行。已有其他 Bot 时保留在 `bots` 列表中，此命令会替换整个声明。Channel Gateway 默认使用 `full_access`，无需填写审批模式。

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
          "adapter_type": "mcode",
          "workdir": "/absolute/workspace"
        }
      }
    ]
  }
}'
```

> **可选参数**：`bot_name` 是 Bot 的显示名称。模型在 MiniMax Code 中配置，当前接入未广告会话级模型选择，不在示例中填写 `model`；当前 Adapter 不应用显式 `effort`。两项均省略，沿用 Harness 自身设置。

## 启动与代理

首次使用依次执行 `octo-runtime executor-kernel start` 和 `octo-runtime channel-gateway start`。已有 Gateway 保存配置后执行 `octo-runtime channel-gateway restart`。使用自定义 Home 时传入相同的 `--home`。

需要为此 Bot 设置代理时，使用[完整代理 Context 示例](channel-gateway.md)，将其中的 adapter 类型改为 `mcode`，并删除 `adapter.model` 和 `adapter.effort`，保留本页的 adapter 配置。代理变量是否被 MiniMax Code 使用，需要按安装版本验证，本轮未做 MiniMax Code 真实环境验收。

向 Bot 发送只要求短文本、不调用工具的请求并确认实际回复。安装探测和 Gateway 连接成功不代表模型请求成功。

[Adapter 说明](../../../../packages/octo-runtime-adapter-mcode/README.zh.md) · [支持范围](../../reference/providers.md)
