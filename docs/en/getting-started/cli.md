# CLI Installation and Operations

[简体中文](../../zh-CN/getting-started/cli.md)

## Persistent Codex Engine

The CLI service process creates the managed owner and injects its provider into the adapter, without new required configuration. That host chooses options.codexHome, then its own CODEX_HOME environment, then ~/.codex. Configure the service process environment separately from the short-lived start client. The first invocation starts app-server; all calls to that owner reuse it. stop and normal Playboard completion stop recovery, close Kernel, then close the owned Engine while preserving Home data.

Default CLI management uses one instance per harness type. Codex requests share one app-server across workdirs, tasks and concurrency. The Resident processes (ownership) tree shows Kernel (in-process, shared PID) and app-server as peers under CLI Host; app-server includes owned, state and incarnation. Adapter references are not PID nodes. status/doctor read host snapshots without starting an Engine. Electron-owned Engines belong to Electron; SDK composition does not inherit CLI ownership policy.

```sh
npm install -g @mininglamp-oss/octo-runtime
octo-runtime start
octo-runtime doctor
octo-runtime status
octo-runtime adapter list
octo-runtime adapter probe codex
octo-runtime logs --lines 200 --follow
octo-runtime stop
octo-runtime uninstall
```

Requires Node.js 24/26. start installs if needed; install enables autostart unless --autostart=false. restart requires an installed service. stop/uninstall preserve Home, identity, configuration and logs.

Use --home, --profile and --manifest to select the CLI environment; --json returns machine-readable results.

Channels use [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) with its own CLI and Home, pointing at an existing Kernel endpoint.

For Agent requests through `playboard`, prepare the working directory before submitting stdin JSON. Local requests require a path-only workspace item, for example `{ "namespace": "octo.execution", "name": "workspace", "payload": { "path": "/absolute/prepared/project" } }`. CLI and SDK both require the explicit, existing absolute path; neither defaults to the command's cwd or creates the application directory. `run` starts the Kernel service and does not select an Agent workspace. OpenClaw uses its Provider-owned workspace and can omit a local override. See [workdir validation and migration](../reference/invoke-input.md).

Lifecycle commands are top-level: `install`, `uninstall`, `start`, `stop`, `restart`, `run`, `status`, `logs`, and `recover`. Use `octo-runtime run` for a foreground service and `octo-runtime <command> --help` for its options. `recover` requires `--acknowledge-orphan-cleanup` after you have stopped the orphan tools reported by `doctor`.

The former `octo-runtime executor-kernel <command>` syntax is removed. Update scripts to the top-level commands. After upgrading an existing system-service installation, run `octo-runtime stop`, `octo-runtime install`, then `octo-runtime start` with the same `--home` (and the same explicit `--profile`/`--manifest` when used); `install` refreshes the service launch arguments to `run`. Use `--autostart=false` on `install` if automatic startup should remain disabled. This preserves the service identity, Home and configuration. `status --json` retains the `executor-kernel` status key; the Kernel SDK package and IPC endpoint names are unchanged.
