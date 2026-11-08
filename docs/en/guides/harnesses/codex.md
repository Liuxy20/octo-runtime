# Codex

[简体中文](../../../zh-CN/guides/harnesses/codex.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install Codex CLI using the official guide, then run `codex` to sign in. See the [official guide](https://developers.openai.com/codex/cli) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
codex --version
```

Runtime starts `codex app-server`. Use the same OS account and `CODEX_HOME` (default `~/.codex`); see the [setup overview](../harnesses.md) for Computer Use.

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Proxies and Environment Variables

Set this invocation’s proxy variables using `octo.execution/envs` in `agentEnv.items`; see [Invocation Environment](../context-and-sessions.md). Runtime passes them to the Provider invocation without changing the host’s global environment. Verify that the installed Harness networking library honors them.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before checking invocation settings. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. Earlier Harness validation covered Antigravity’s configuration-to-model path only. This documentation update adds no live Provider acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-codex/README.md) · [Support matrix](../../reference/providers.md)
