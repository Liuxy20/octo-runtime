# ZCode

[English](../../../en/guides/harnesses/zcode-gui.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装 ZCode Desktop，并在应用中配置模型账号。 安装细节见[官方指南](https://zcode.z.ai/cn/docs/install)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。先在 ZCode 中确认账号及客户端可用，再发送一个 Runtime 文本任务。

Runtime 使用桌面应用内置客户端，依次检查 `ZCODE_BIN`、PATH 和桌面安装位置。需要显式路径时，通过本轮 `envs` 设置 `ZCODE_BIN`；客户端版本与登录状态仍须实际验证。

## Channel Gateway 配置

以下命令直接保存完整 Channel Gateway 配置，在 Bash / Zsh 中执行。替换 API 地址、Bot 身份、凭据及已存在的绝对工作目录；保留现有其他 Bot。Channel Gateway 默认使用 `full_access`，无需填写审批模式。

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
          "adapter_type": "zcode-gui",
          "workdir": "/absolute/workspace",
          "effort": "medium"
        }
      }
    ]
  }
}'
```

> **可选参数**：`bot_name` 是 Bot 的显示名称。当前 Runtime ZCode Adapter 拒绝显式 `model`，因此示例省略该字段，使用 ZCode 自身的模型设置。`effort` 可省略；当前 Adapter 不会应用它，请删除该字段以避免无效配置警告。

使用[完整声明导入和启动步骤](../harnesses/channel-gateway.md)保存配置并重启 Extra。向 Bot 发送只要求短文本、不调用工具的小任务，确认实际回复；连接成功或版本探测成功不等于任务完成。

> 模型和推理强度的 V4 接入由 [Issue #286](https://github.com/Mininglamp-OSS/octo-runtime/issues/286) 跟踪；以上限制属于当前 Runtime Adapter，不代表上游 ZCode 没有该能力。

## 代理与环境变量

需要仅此 Harness 走代理时，在该 Bot 的 `context.items` 中加入[Provider 代理 Context](../harnesses/channel-gateway.md)。Runtime 将它注入本轮 Provider 子进程，不修改 Extra 的全局环境。变量是否被原生网络库使用，必须按该 Harness 版本验证；不能从 Antigravity 的成功推断本 Harness 已验收。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查 Gateway 配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。本轮仅 Antigravity 的配置到真实模型链路做了专项验证，其他 Harness 未新增真实验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-zcode-gui/README.zh.md) · [支持范围](../../reference/providers.md)
