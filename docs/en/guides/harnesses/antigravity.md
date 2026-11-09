# Antigravity

[简体中文](../../../zh-CN/guides/harnesses/antigravity.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install the CLI using the official guide, then run interactive `agy` as the Runtime OS user to authenticate. See the [official guide](https://antigravity.google/docs/getting-started?tab=cli) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
agy --version
```

Minimum version: `1.3.3`. Only `full_access` and canonical output are supported; images and per-call MCP are unsupported. Success requires a native SUCCESS result with nonempty text; a version probe does not prove account or model availability.

## Channel Integration

[octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides channel configuration and registration in its independent repository.

## Start and Verify

Start the execution service with `octo-runtime start`. Follow [SDK integration](../../getting-started/sdk.md) to invoke the configured Antigravity Adapter with a short request such as “Reply only OK. Do not use tools.” Confirm both the answer and successful terminal event. Channel deployment is a separate operation in the independent repository.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before checking invocation settings. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. Earlier Harness validation covered Antigravity’s configuration-to-model path only. This documentation update adds no live Provider acceptance.

[Adapter details](../../../../packages/octo-runtime-adapter-antigravity/README.md) · [Support matrix](../../reference/providers.md)
