# 接入导航

连接已有 Kernel：安装 `@mininglamp-oss/octo-runtime-client`，调用 `attachKernel({endpoint})`，协议从 `/protocol` 导入。

拥有执行服务：纯原生应用从源码 workspace 引入 Kernel/Core、公共辅助包与实际使用的 Adapter，构造 `createKernelService({home, endpoint, adapters})`；不依赖 CLI 聚合包或 Adapter 聚合导出。仅需 Codex 不引入 OpenClaw，反之亦然。桌面 App 自行选择加载集合并管理配置与生命周期。

接入 IM：[独立 Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 提供 `ChannelRegistry.register(endpoint, definition)`，拥有自己的 npm 包、CLI、配置、会话存储和投递逻辑。

- [SDK 入门](docs/zh-CN/getting-started/sdk.md)
- [CLI 运维](docs/zh-CN/getting-started/cli.md)
- [发行部署](DEPLOYMENTS.md)
