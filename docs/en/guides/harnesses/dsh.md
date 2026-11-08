# DeepSeek Harness

[简体中文](../../../zh-CN/guides/harnesses/dsh.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install npm Provider `@deepseek-ai/dsh` at `>=0.2.1-rc.4`, for example `npm install -g @deepseek-ai/dsh@0.2.1-rc.4`, then authenticate using the official guide. See the [official guide](https://github.com/deepseek-ai/deepseek-harness) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
dsh --version
```

Experimental integration: `full_access` only, using profile `sdk`. CLI resolves the npm JavaScript entry on PATH; SDK hosts supply `dshBin` explicitly. Desktop/ASAR is not used. The pinned Client SDK differs from the Provider minimum; see [Adapter limits](../../../../packages/octo-runtime-adapter-dsh/README.md).

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Proxies and Environment Variables

Set this invocation’s proxy variables using `octo.execution/envs` in `agentEnv.items`; see [Invocation Environment](../context-and-sessions.md). Runtime passes them to the Provider invocation without changing the host’s global environment. Verify that the installed Harness networking library honors them.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before checking invocation settings. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. Earlier Harness validation covered Antigravity’s configuration-to-model path only. This documentation update adds no live Provider acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-dsh/README.md) · [Support matrix](../../reference/providers.md)
