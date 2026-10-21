# Octo Runtime

Provider-neutral 的本地 Agent Runtime，要求 Node.js 24.x。

```bash
npm install -g @mininglamp-oss/octo-runtime
octo-runtime --help
octo-runtime executor-kernel run
```

executor-kernel 和 channel-gateway 分别提供 uninstall/install/start/restart/stop/run。首次 install 默认不自启，start/restart 要求已安装；两个组件互不隐式启动。配置渠道后通过 channel-gateway run 或其独立服务启动。

SDK 入口为 /host、/executor-kernel、/executor-core、/extra、/protocol 和 /extras/channel-gateway。主包还提供协议及三个内置 Extra 的 JSON Schema；内部 workspace 包不独立发布。宿主通过 createKernelService/createExtraService 在调用进程原生构造服务，再 initialize/status/close；attachKernel 只连接现有服务。普通调用共用 KernelClient.invoke。SDK 不经外部 Node 或 Runtime CLI 代替启动服务。

完整说明见 [项目仓库](https://github.com/Mininglamp-OSS/octo-runtime) 中的 SDK_NATIVE_INTEGRATION_FULL_GUIDE.md 与 DEPLOYMENTS.md。旧 daemon 命令、bin 和 API 已删除；升级保留 Home 和身份。Provider 的安装、认证和业务配置由宿主负责。

Apache License 2.0。
