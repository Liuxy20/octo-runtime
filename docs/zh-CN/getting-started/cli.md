# CLI 安装与运维

[English](../../en/getting-started/cli.md)

```sh
npm install -g @mininglamp-oss/octo-runtime
octo-runtime executor-kernel start
octo-runtime doctor
octo-runtime status
octo-runtime adapter list
octo-runtime adapter probe codex
octo-runtime executor-kernel logs --lines 200 --follow
octo-runtime executor-kernel stop
octo-runtime executor-kernel uninstall
```

支持 Node.js 24/26。start 未安装时自动安装，install 默认开启自启；--autostart=false 关闭自启。restart 不安装缺失服务。stop/uninstall 保留 Home、身份、配置和日志。

通过 --home、--profile 和 --manifest 选择 CLI 自己的环境。--json 输出机器可读结果。

渠道使用 [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 自己的 CLI 和 Home，并指定已启动 Kernel 的 endpoint。
