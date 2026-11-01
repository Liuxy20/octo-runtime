# OpenCode

[English](../../../en/guides/harnesses/opencode.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装 CLI，运行 `opencode`，使用 `/connect` 配置模型账号。 安装细节见[官方指南](https://dev.opencode.ai/docs/)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。执行以下原生检查；它只检查安装，不证明模型请求成功。

```sh
opencode --version
```

当前 Adapter 要求 `>=2.1.3 <3`。`full_access` 使用 `opencode run --format json --thinking --auto --standalone`，`ask` 使用 `opencode acp`；不支持 `assisted` 或图片。模型使用 `provider/model`，网络设置仍遵循该版本原生规则。

## Channel Gateway 配置

以下命令直接保存完整 Channel Gateway 配置，在 Bash / Zsh 中执行。替换 API 地址、Bot 身份、凭据及已存在的绝对工作目录；保留现有其他 Bot。Channel Gateway 默认使用 `full_access`，允许该 Harness 自动执行工具。

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
          "adapter_type": "opencode",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        }
      }
    ]
  }
}'
```

> **可选参数**：`bot_name` 是 Bot 的显示名称；`model` 和 `effort` 均可省略，省略时使用所选 Harness 自身的默认设置。`<MODEL_ID>` 请替换为该 Harness 支持的模型 ID；`effort` 可填 `low`、`medium`、`high` 或 `xhigh`，实际支持范围由 Adapter 和 Harness 决定。

使用[完整声明导入和启动步骤](../harnesses/channel-gateway.md)保存配置并重启 Extra。向 Bot 发送只要求短文本、不调用工具的小任务，确认实际回复；连接成功或版本探测成功不等于任务完成。

## 代理与环境变量

需要仅此 Harness 走代理时，在该 Bot 的 `context.items` 中加入[Provider 代理 Context](../harnesses/channel-gateway.md)。Runtime 将它注入本轮 Provider 子进程，不修改 Extra 的全局环境。变量是否被原生网络库使用，必须按该 Harness 版本验证；不能从 Antigravity 的成功推断本 Harness 已验收。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查 Gateway 配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。本轮仅 Antigravity 的配置到真实模型链路做了专项验证，其他 Harness 未新增真实验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-opencode/README.zh.md) · [支持范围](../../reference/providers.md)
