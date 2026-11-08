# CLI Installation and Operations

[简体中文](../../zh-CN/getting-started/cli.md)

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

Requires Node.js 24/26. start installs if needed; install enables autostart unless --autostart=false. restart requires an installed service. stop/uninstall preserve Home, identity, configuration and logs.

Use --home, --profile and --manifest to select the CLI environment; --json returns machine-readable results.

Channels use [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) with its own CLI and Home, pointing at an existing Kernel endpoint.
