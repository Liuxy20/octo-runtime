# MiniMax Code

[简体中文](../../../zh-CN/guides/harnesses/mcode.md) | [Harness index](../harnesses.md)

This page covers MiniMax Code. Its executable and Adapter type are `mcode`; it is distinct from Xiaomi's mimocode.

## Install and Authenticate

Install using the [official MiniMax Code guide](https://github.com/MiniMax-AI/minimax-code). Sign in as the OS user that runs Runtime:

```sh
mcode login
```

For an international account, use `mcode login --region global`. Make sure the background Runtime can find the executable:

```sh
mcode --version
```

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Startup and Proxies

Start Runtime with `octo-runtime executor-kernel start`, then use [SDK integration](../../getting-started/sdk.md) to invoke the `mcode` Adapter. MiniMax Code owns model selection; Runtime does not send a per-session model setter.

For invocation-specific proxies, use `octo.execution/envs` in `agentEnv.items`; see [Invocation Environment](../context-and-sessions.md). Verify proxy support with the installed MiniMax Code version. Send a short request and confirm the answer and successful terminal event; installation probes alone do not establish model access. This documentation update performs no live MiniMax Code acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-mcode/README.md) · [Support matrix](../../reference/providers.md)
