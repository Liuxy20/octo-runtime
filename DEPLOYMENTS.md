# 发行与部署

完整 `@mininglamp-oss/octo-runtime` 与独立 `@mininglamp-oss/octo-runtime-client` 同版本发布。完整包内置 client/protocol，继续支持单 tgz 离线安装；内部 workspace 包不单独发布。构建使用 `pnpm run build`，归档使用 `pnpm run pack:release`。

```sh
npm install -g @mininglamp-oss/octo-runtime
octo-runtime install
octo-runtime start
octo-runtime doctor
octo-runtime logs --lines 200
```

首次和重复 install 默认开启自启，显式 `--autostart=false` 禁用。start 未安装时自动安装；restart 不隐式安装。stop/uninstall 保留 Home、身份、凭据和日志。不要删除或复制现有 Home 来完成本次迁移。

Channel Gateway 使用[独立仓库和发行包](https://github.com/Mininglamp-OSS/octo-channel-gateway)，由其 CLI 管理自身服务，并通过指定 endpoint 连接已就绪的 Kernel。

纯原生 SDK 应用从源码 workspace 构建 Kernel、公共辅助包及所选 Adapter，可以随应用携带 Node；不通过 CLI 聚合包接入。另一种部署是由 octo-runtime CLI 启动服务，独立 App 仅安装 octo-runtime-client。依赖、加载集合与关闭责任见 [SDK 接入](docs/zh-CN/getting-started/sdk.md)。Windows、Linux 和 macOS 的服务后端保持既有实现；本次实际验收平台及未验范围记录在任务验证文件。
