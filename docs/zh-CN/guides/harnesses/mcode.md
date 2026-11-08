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

## 渠道集成

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 独立提供渠道配置和注册 SDK。

## 启动与代理

使用 `octo-runtime executor-kernel start` 启动 Runtime，再按 [SDK 接入](../../getting-started/sdk.md)调用 `mcode` Adapter。模型由 MiniMax Code 自行选择，Runtime 不发送会话级模型设置请求。

本轮代理使用 `agentEnv.items` 中的 `octo.execution/envs`，见[本轮环境](../context-and-sessions.md)。按安装的 MiniMax Code 版本确认代理支持，发送短请求并确认回答和成功终态；安装探测不代表模型可用。本次文档更新未进行真实 MiniMax Code 验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-mcode/README.zh.md) · [支持范围](../../reference/providers.md)
