# CodeBuddy

[简体中文](../../../zh-CN/guides/harnesses/codebuddy.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install with `npm install -g @tencent-ai/codebuddy-code`, then run `codebuddy`, select the account region, and sign in. See the [official guide](https://www.codebuddy.cn/docs/cli/quickstart) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
codebuddy --version
```

Runtime uses `codebuddy --acp`. Model availability depends on the account. See the [setup overview](../harnesses.md) for regional and plan limits on shared WorkBuddy credits.

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Proxies and Environment Variables

Set this invocation’s proxy variables using `octo.execution/envs` in `agentEnv.items`; see [Invocation Environment](../context-and-sessions.md). Runtime passes them to the Provider invocation without changing the host’s global environment. Verify that the installed Harness networking library honors them.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before checking invocation settings. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. Earlier Harness validation covered Antigravity’s configuration-to-model path only. This documentation update adds no live Provider acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-codebuddy/README.md) · [Support matrix](../../reference/providers.md)
