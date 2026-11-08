# Grok Build

[简体中文](../../../zh-CN/guides/harnesses/grok-build.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install using the official guide and run `grok` to authenticate natively; Runtime does not perform browser login. See the [official guide](https://docs.x.ai/build/overview) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
grok --version
```

Compatible range: `>=1.0.67 <2.0.0`; Runtime starts `grok --no-auto-update agent --no-leader stdio`. `assisted` is unsupported; even with full_access, questions and plan approvals require responses through the original invocation.

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Proxies and Environment Variables

Set this invocation’s proxy variables using `octo.execution/envs` in `agentEnv.items`; see [Invocation Environment](../context-and-sessions.md). Runtime passes them to the Provider invocation without changing the host’s global environment. Verify that the installed Harness networking library honors them.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before checking invocation settings. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. Earlier Harness validation covered Antigravity’s configuration-to-model path only. This documentation update adds no live Provider acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-grok-build/README.md) · [Support matrix](../../reference/providers.md)
