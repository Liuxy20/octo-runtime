# OpenClaw

[English](../../../en/guides/harnesses/openclaw.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装、初始化并启动 OpenClaw Gateway，确认已有 Agent（例如 `main`）可用。 安装细节见[官方指南](https://docs.openclaw.ai/start/getting-started)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。执行以下原生检查；它只检查安装，不证明模型请求成功。

```sh
openclaw --version
```

Runtime 连接已运行的 Gateway，不代启它。使用 `provider_agent_id`，不得设置本地 `workdir`。连接地址及认证在 Runtime 的 OpenClaw Adapter 配置中准备，详见[Adapter README](../../../../packages/octo-runtime-adapter-openclaw/README.md)。

## Channel Gateway 配置

以下命令直接保存完整 Channel Gateway 配置，在 Bash / Zsh 中执行。替换 API 地址、Bot 身份、凭据；保留现有其他 Bot。Channel Gateway 默认使用 `full_access`，无需填写审批模式。

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
          "adapter_type": "openclaw",
          "provider_agent_id": "main"
        }
      }
    ]
  }
}'
```

使用[完整声明导入和启动步骤](../harnesses/channel-gateway.md)保存配置并重启 Extra。向 Bot 发送只要求短文本、不调用工具的小任务，确认实际回复；连接成功或版本探测成功不等于任务完成。

## 代理与环境变量

此 Adapter 拒绝非空逐轮 envs；不要复制其他 Harness 的代理 Context。代理应配置在独立 OpenClaw Gateway 的启动环境，并按其服务方式重启。Runtime 的 Channel Gateway Extra 可以保持无代理环境。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查 Gateway 配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。本轮仅 Antigravity 的配置到真实模型链路做了专项验证，其他 Harness 未新增真实验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-openclaw/README.zh.md) · [支持范围](../../reference/providers.md)
