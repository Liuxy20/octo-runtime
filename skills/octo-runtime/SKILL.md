---
name: octo-runtime
description: Operate, build, diagnose, and troubleshoot independent Octo Runtime executor-kernel and channel-gateway components, Home selection, provider adapters, logs, and source deployments. Do not use it as a cloud business control plane.
---

# Octo Runtime

Use octo-runtime for independent Kernel and Channel Gateway lifecycle, provider checks, and local diagnostics. Host SDK clients use public package APIs directly. Runtime does not manage cloud business tasks or Agent definitions.

## Establish The Target

Before a state-changing command, determine and state:

- whether this is an installed package or this source checkout;
- the Runtime Home, using `--home PATH` consistently when it is not the platform default;
- the profile for adapter configuration or `doctor`, if it is not `default`;
- which component is targeted and whether it runs in the foreground or through a native user service.

One Home partitions component endpoints, service IDs, configuration and identity. ExecutorKernel supervises its worker; each Extra runs independently and owns its business connections. HostApp or CLI manages each component explicitly. An attached client owns connections only. Existing machine/profile identity formats remain unchanged; the Kernel does not require login or create a durable business outbox.

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

doctor reports native manager availability and component service/runtime checks. Global status reports executor-kernel and channel-gateway separately. Distinguish execution_ready, worker health, Extra initialization and business connectivity.

### Prepare The Local Home

CLI 不提供 login。显式 --home 优先于 OCTO_RUNTIME_HOME，再使用平台默认目录。executor-kernel run 使用本地配置和显式 Adapter 集合；channel-gateway run 需要已保存的完整插件声明。运行组件不要求重新初始化或删除已有身份。

登录、登记与共享属于可选 Extra，不是本地设备存在或执行的条件。不得以本地就绪推导云端注册或连接成功，也不得按历史重置说明删除现有身份。

### Manage Independent Components

Use the native user-service commands for an installed Runtime:

```bash
octo-runtime executor-kernel install
octo-runtime executor-kernel start
octo-runtime executor-kernel restart
octo-runtime executor-kernel stop
octo-runtime executor-kernel uninstall
octo-runtime executor-kernel run

octo-runtime channel-gateway install
octo-runtime channel-gateway start
octo-runtime channel-gateway restart
octo-runtime channel-gateway stop
octo-runtime channel-gateway uninstall
octo-runtime channel-gateway run
```

Each command acts on its named component only. First and repeated `install` enable autostart by default; only explicit `--autostart=false` disables it. A later plain `install` enables it again. `start` automatically installs a missing service with autostart enabled, reports installation progress on stderr, then starts it and waits for readiness. Existing services keep their settings. `restart` requires an installed service and returns exit code 3 when it is missing.

An explicitly disabled service rejects both `start` and `restart` with `SERVICE_DISABLED`. Run `<component> install --autostart=true` before starting it again. For foreground use without registering a system service, use `<component> run`. `stop` preserves the autostart setting; `uninstall` preserves Home data. There is no `--force` option. Never delete identity or configuration as an automatic recovery step.

Save an enabled declaration with `extraset <extra-name>` before starting that Extra. Use its own component name: `octo-runtime webui start` for WebUI and `octo-runtime channel-wecom start` for WeCom; use the same names for `run` and `restart`. These commands do not start Kernel or another Extra. SDK hosts can instead use `createExtraService` with parsed configuration and own its lifecycle without CLI service registration.

Use run for foreground debugging. Gateway may start before Kernel and report kernel_available=false; it must never start or maintain Kernel. A component restart does not restart its siblings.

### Inspect Local Execution

Use the public /executor-kernel client for Run lookup, subscription, cancellation and interaction. The CLI provides playboard for temporary local execution:

```bash
octo-runtime playboard < request.json
```

CLI logs use <home>/logs/kernel-YYYYMMDDTHH.log and <home>/logs/extras/<extra_type>-YYYYMMDDTHH.log. They contain operational metadata, not the complete business transcript. See the operations guide for retention and configuration.

Explicit Kernel client cancel affects the identified live Run; closing an attached client or subscription does not cancel it. Preserve the original receipt, Kernel instance and stream identity for replay; never reinvoke automatically after an unknown ACK.

The CLI has no agent-run/agent-session command groups. Business task scheduling, retry policy, session persistence and message delivery belong to their respective services or Extras.

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
