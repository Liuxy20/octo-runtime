# Octo Runtime CLI

CLI 是执行服务的宿主，负责 Adapter manifest、Runtime Home 和原生用户服务。SDK 应用直接构造执行服务。

```text
octo-runtime executor-kernel install|uninstall|start|stop|restart|run|status|logs
octo-runtime executor-kernel recover --acknowledge-orphan-cleanup
octo-runtime adapter list
octo-runtime adapter probe <type>
octo-runtime doctor
octo-runtime status [--json]
octo-runtime playboard < request.json
```

通用参数为 `--home PATH`、`--profile NAME`、`--manifest PATH` 和 `--json`。manifest 仅装配 Adapter；SDK 不读取 CLI manifest。start 自动安装缺失服务，install 默认自启，stop/uninstall 保留配置和数据。

渠道由[独立 Gateway CLI](https://github.com/Mininglamp-OSS/octo-channel-gateway)管理。详细操作见 [CLI 指南](../../docs/zh-CN/getting-started/cli.md)。
