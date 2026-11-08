# 接入导航

连接已有 Kernel：安装 `@mininglamp-oss/octo-runtime-client`，调用 `attachKernel({endpoint})`，协议从 `/protocol` 导入。

拥有执行服务：使用完整 Runtime 的 `/host` 构造 `createKernelService({home, endpoint, adapters})`，原生 import Adapter。桌面 App 使用 SDK，自行管理配置与生命周期。

接入 IM：[独立 Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 提供 `ChannelRegistry.register(endpoint, definition)`，拥有自己的 npm 包、CLI、配置、会话存储和投递逻辑。

- [SDK 入门](docs/zh-CN/getting-started/sdk.md)
- [CLI 运维](docs/zh-CN/getting-started/cli.md)
- [发行部署](DEPLOYMENTS.md)
