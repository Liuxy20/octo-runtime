---
name: octo-runtime
description: Operate, build, diagnose, and troubleshoot Octo Runtime executor-kernel, Home selection, provider adapters, logs, and source deployments. Do not use it as a cloud business control plane.
---

# Octo Runtime

Use octo-runtime for Kernel lifecycle, provider checks, and local diagnostics. Host SDK clients use public package APIs directly. Runtime does not manage cloud business tasks or Agent definitions.

## Establish The Target

Before a state-changing command, determine and state:

- whether this is an installed package or this source checkout;
- the Runtime Home, using `--home PATH` consistently when it is not the platform default;
- the profile for adapter configuration or `doctor`, if it is not `default`;
- which component is targeted and whether it runs in the foreground or through a native user service.

One Runtime Home partitions Kernel endpoints, service IDs, configuration and identity. HostApp or CLI owns Kernel lifecycle; attached clients own connections only. Kernel executes with injected Adapters in its own process. Business Gateway is a separate package with its own Home and CLI.

Run octo-runtime help before relying on version-specific options. Structured command errors contain an error.code and return nonzero; do not infer success from stdout alone.

## Choose The Correct Workflow

### Inspect And Diagnose

Start with the least invasive commands that answer the question:

```bash
octo-runtime doctor
octo-runtime status
octo-runtime adapter list
octo-runtime adapter probe codex
```

doctor reports manager availability and Kernel readiness. Global status reports executor-kernel only. execution_ready does not prove Provider authentication or business connectivity.

### Prepare The Local Home

CLI 不提供 login。--home 显式选择目录，否则统一使用 ~/.octo-runtime；CLI 准备根，SDK 服务只接受宿主准备好的绝对 Home。octo-runtime run 使用本地配置和显式 Adapter 集合，不要求删除或重新初始化身份。

业务登录、渠道登记与共享归独立 Gateway/宿主。不得从本地就绪推导云端连接成功，也不得自动重置身份。

### Manage the Runtime Service

Use the native user-service commands for an installed Runtime:

```bash
octo-runtime install
octo-runtime start
octo-runtime restart
octo-runtime stop
octo-runtime uninstall
octo-runtime run

```

Each command acts on the Runtime service. First and repeated `install` enable autostart by default; only explicit `--autostart=false` disables it. A later plain `install` enables it again. `start` automatically installs a missing service with autostart enabled, reports installation progress on stderr, then starts it and waits for readiness. Existing services keep their settings. `restart` requires an installed service and returns exit code 3 when it is missing.

An explicitly disabled service rejects both `start` and `restart` with `SERVICE_DISABLED`. Run `octo-runtime install --autostart=true` before starting it again. For foreground use without registering a system service, use `octo-runtime run`. `stop` preserves the autostart setting; `uninstall` preserves Home data. There is no `--force` option. Never delete identity or configuration as an automatic recovery step.

Channel Gateway uses the separate @mininglamp-oss/octo-channel-gateway package and octo-channel-gateway CLI. Runtime has no Extra declarations or business plugin loader.

Use run for foreground debugging. Gateway connects to an explicitly selected existing Kernel endpoint and owns its own lifecycle.

### Inspect Local Execution

Use the public octo-runtime-client for Run lookup, subscription, cancellation and interaction. The CLI provides playboard for temporary local execution:

```bash
octo-runtime playboard < request.json
```

CLI logs use <home>/logs/kernel-YYYYMMDDTHH.log. They contain operational metadata, not the business transcript.

Explicit Kernel client cancel affects the identified live Run; closing an attached client or subscription does not cancel it. Preserve the original receipt, Kernel instance and stream identity for replay; never reinvoke automatically after an unknown ACK.

The CLI has no agent-run/agent-session command groups. Business task scheduling, retry policy, session persistence and message delivery belong to their respective applications.

## Build And Link From Source

Require Node.js 24.x or 26.x (LTS) and pnpm 11. From the repository root, install dependencies when needed:

```bash
pnpm install --frozen-lockfile
```

For a full local rebuild and global link, use the deployment entrypoint:

```bash
npm link --foreground-scripts
```

The root `prepare` lifecycle runs the complete `pnpm build` before npm creates the global package and command links. After TypeScript-only changes, `pnpm build` is normally sufficient because the link already targets the checkout. Re-run `npm link` when package `bin` or link metadata changes.

Refresh the current zsh command cache when needed, then verify both commands and the CLI:

```bash
rehash
command -v octo-runtime
octo-runtime help
```

Verify that the global package symlink resolves to the intended checkout; finding a command on PATH alone does not prove that the correct checkout is linked.

## Consult Repository Documentation

When operating from this checkout, use these sources instead of guessing version-specific behavior:

- [CLI operations](../../apps/cli/README.md) for current commands, state layout, and service behavior.
- [Deployments](../../DEPLOYMENTS.md) for build, link, package, and release procedures.
- [Project overview](../../README.md) for ownership boundaries, runtime architecture, and source debugging.

Publishing is a separate external mutation. Read the deployment procedure and perform its full validation sequence, but do not publish packages without an explicit request.

## Verify The Outcome

Match verification to the operation:

- build/link: check command resolution, resolved symlink target, and `octo-runtime help`;
- component installation: run doctor/status and check that component's actual IPC readiness;
- adapter issue: run `adapter list` and probe only the affected adapter;
- Run issue: capture the Run state, canonical events, and scoped logs without exposing credentials or unnecessary sensitive fields.

Report the selected Home/profile, commands that materially changed state, success or failure, and the smallest actionable remediation for any failed check.
