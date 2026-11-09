# Antigravity

[English](../../../en/guides/harnesses/antigravity.md) | [Harness 目录](../harnesses.md)

## 安装与认证

1. 按官方指南安装 CLI，使用运行 Runtime 的同一操作系统账号运行 `agy`，交互完成认证。 安装细节见[官方指南](https://antigravity.google/docs/getting-started?tab=cli)。
2. 确保后台 Runtime 使用同一账号、用户目录和可执行文件 PATH。执行以下原生检查；它只检查安装，不证明模型请求成功。

```sh
agy --version
```

最低版本为 `1.3.3`；仅接受 `full_access`，仅 canonical，不支持图片及逐轮 MCP。原生 SUCCESS 且回答非空才是成功；版本探测不能证明账号或模型可用。

## 渠道集成

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 独立提供渠道配置和注册 SDK。

## 启动并验证

使用 `octo-runtime start` 启动执行服务，再按 [SDK 接入](../../getting-started/sdk.md)调用已配置的 Antigravity Adapter，发送“只回复 OK，不调用工具”等短请求，确认回答和成功终态。渠道部署另按独立仓库的说明操作。

## 排查与验收边界

先分别检查原生登录、模型权限、代理可达性，再检查调用配置。遇到失败保留脱敏错误、Harness 版本、Runtime 构建版本及实际终态；不要用另一 Harness 的通过结果替代。此前 Harness 专项仅验证 Antigravity 的配置到真实模型链路；本次文档更新不新增真实 Provider 验收。

[Adapter 说明](../../../../packages/octo-runtime-adapter-antigravity/README.zh.md) · [支持范围](../../reference/providers.md)
