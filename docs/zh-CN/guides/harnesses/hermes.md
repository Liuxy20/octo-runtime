# Hermes Agent

[English](../../../en/guides/harnesses/hermes.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装 Hermes 和 ACP 扩展依赖，使用 `hermes model` 配置模型凭据。 安装细节见[官方指南](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。执行以下原生检查；它只检查安装，不证明模型请求成功。

```sh
hermes acp --check
```

Runtime 使用 `hermes acp`；只装交互 CLI 而未装 ACP 依赖可能无法启动。先在同一用户下完成 ACP 检查。

## 渠道集成

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 独立提供渠道配置和注册 SDK。

## 代理与环境变量

在 `agentEnv.items` 中通过 `octo.execution/envs` 设置本轮代理变量，见[本轮环境](../context-and-sessions.md)。Runtime 将变量传给 Provider 调用，不修改宿主全局环境；须验证当前 Harness 的网络库确实使用这些变量。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查调用配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。此前 Harness 专项仅验证 Antigravity 的配置到真实模型链路；本次文档更新不新增真实 Provider 验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-hermes/README.zh.md) · [支持范围](../../reference/providers.md)
