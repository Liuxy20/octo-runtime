# Octo Runtime

Provider-neutral Agent execution infrastructure: one Kernel, a shared execution engine, and adapters for supported Harness frameworks.

## Install

Requires Node.js 24 or 26.

```sh
npm install -g @mininglamp-oss/octo-runtime
octo-runtime start
octo-runtime doctor
octo-runtime adapter list
octo-runtime logs --lines 200 --follow
```

`start` installs the user service if needed and waits for readiness. `install` enables autostart by default; `--autostart=false` disables it. `stop` and `uninstall` preserve configuration and data.

## Integrate

Applications consuming an existing Kernel install `@mininglamp-oss/octo-runtime-client` and call `attachKernel({endpoint})`. Protocol types and helpers come from `/protocol`. Owners drain their accepted invocations and finish business delivery before closing their client; closing a connection does not stop the Kernel.

Applications owning an execution service use `createKernelService({home, endpoint, adapters})` from `@mininglamp-oss/octo-runtime/host`. Desktop applications use the SDK directly. Explicit in-process execution remains available from `/executor-core`.

## Channel Gateway

[Octo Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) is an independent repository and npm package, with its own CLI and `ChannelRegistry.register(endpoint, definition)` SDK. Runtime does not discover, configure or host channel plugins. WebUI, WeCom and the Extra framework have been removed from this distribution. Existing user data is preserved; migrate channel configuration explicitly to the Gateway's own Home.

## Documentation

- [English](docs/en/README.md) / [简体中文](docs/zh-CN/README.md)
- [SDK integration](docs/en/getting-started/sdk.md)
- [CLI operations](docs/en/getting-started/cli.md)
- [Architecture](ARCHITECTURE.md)
- [Deployment](DEPLOYMENTS.md)

## Development

```sh
pnpm install
pnpm run build
pnpm run test:suites
pnpm run lint
pnpm run docs:check
pnpm run pack:release
```

`apps/cli` owns the CLI. `packages/` contains the protocol, client, execution engine, Kernel, Host SDK and Provider adapters. Internal workspace packages are private. The full Runtime and independent client are released as separate self-contained npm archives. See [CONTRIBUTING.md](CONTRIBUTING.md).
