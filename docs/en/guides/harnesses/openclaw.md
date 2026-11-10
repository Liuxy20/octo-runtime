# OpenClaw

[简体中文](../../../zh-CN/guides/harnesses/openclaw.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install, onboard, and start OpenClaw Gateway using the official guide; verify that an existing Agent such as `main` is available. See the [official guide](https://docs.openclaw.ai/start/getting-started) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
openclaw --version
```

Runtime connects to an existing Gateway; it does not start it. Select the target using the package-local contract and omit local `workdir`. Prepare connection settings and authentication in Runtime's OpenClaw Adapter configuration; see the [Adapter README](../../../../packages/octo-runtime-adapter-openclaw/README.md).

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Proxies and Environment Variables

This Adapter rejects nonempty per-call envs. Do not copy another Harness's proxy Context. Configure the independent OpenClaw Gateway's own startup environment and restart it using its service mechanism. OpenClaw Gateway is a Provider service, distinct from Octo Channel Gateway.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before checking invocation settings. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. Earlier Harness validation covered Antigravity’s configuration-to-model path only. This documentation update adds no live Provider acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-openclaw/README.md) · [Support matrix](../../reference/providers.md)
