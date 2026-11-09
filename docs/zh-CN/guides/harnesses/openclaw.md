# OpenClaw

[English](../../../en/guides/harnesses/openclaw.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装、初始化并启动 OpenClaw Gateway，确认已有 Agent（例如 `main`）可用。 安装细节见[官方指南](https://docs.openclaw.ai/start/getting-started)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。执行以下原生检查；它只检查安装，不证明模型请求成功。

```sh
openclaw --version
```

Runtime 连接已运行的 Gateway，不代启它。使用 `adapter.openclaw/options.payload.agentId`，不得设置本地 `workdir`。连接地址及认证在 Runtime 的 OpenClaw Adapter 配置中准备，详见[Adapter README](../../../../packages/octo-runtime-adapter-openclaw/README.md)。

## 渠道集成

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 独立提供渠道配置和注册 SDK。

## 代理与环境变量

此 Adapter 拒绝非空逐轮 envs；不要复制其他 Harness 的代理 Context。代理应配置在独立 OpenClaw Gateway 的启动环境，并按其服务方式重启。OpenClaw Gateway 是 Provider 服务，与 Octo Channel Gateway 不同。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查调用配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。此前 Harness 专项仅验证 Antigravity 的配置到真实模型链路；本次文档更新不新增真实 Provider 验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-openclaw/README.zh.md) · [支持范围](../../reference/providers.md)
