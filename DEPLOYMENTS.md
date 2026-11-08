# 发行与部署

完整 `@mininglamp-oss/octo-runtime` 与独立 `@mininglamp-oss/octo-runtime-client` 同版本发布。完整包内置 client/protocol，继续支持单 tgz 离线安装；内部 workspace 包不单独发布。构建使用 `pnpm run build`，归档使用 `pnpm run pack:release`。

```sh
npm install -g @mininglamp-oss/octo-runtime
octo-runtime executor-kernel install
octo-runtime executor-kernel start
octo-runtime doctor
octo-runtime executor-kernel logs --lines 200
```

首次和重复 install 默认开启自启，显式 `--autostart=false` 禁用。start 未安装时自动安装；restart 不隐式安装。stop/uninstall 保留 Home、身份、凭据和日志。不要删除或复制现有 Home 来完成本次迁移。

Channel Gateway 使用[独立仓库和发行包](https://github.com/Mininglamp-OSS/octo-channel-gateway)，由其 CLI 管理自身服务，并通过指定 endpoint 连接已就绪的 Kernel。

SDK 应用可以携带 Node 和发行包，直接构造 Kernel；只消费执行能力的应用仅安装 client。Windows、Linux 和 macOS 的服务后端保持既有实现；本次实际验收平台及未验范围记录在任务验证文件。
