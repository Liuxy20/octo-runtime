# OpenClaw

[简体中文](../../../zh-CN/guides/harnesses/openclaw.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install, onboard, and start OpenClaw Gateway using the official guide; verify that an existing Agent such as `main` is available. See the [official guide](https://docs.openclaw.ai/start/getting-started) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
openclaw --version
```

Runtime connects to an existing Gateway; it does not start it. Set `provider_agent_id` and omit local `workdir`. Prepare connection settings and authentication in Runtime's OpenClaw Adapter configuration; see the [Adapter README](../../../../packages/octo-runtime-adapter-openclaw/README.md).

## Channel Gateway Configuration

Run the following command in Bash / Zsh to save the complete Channel Gateway declaration. Replace the API URL, Bot identity, credential; retain other configured Bots. Channel Gateway defaults to `full_access`; omit the approval mode.

```bash
octo-runtime channel-gateway extraset <<< '{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "enabled": true,
  "config": {
    "bots": [
      {
        "api_url": "https://im.example.com/api",
        "bot_id": "<BOT_ID>",
        "bot_name": "local-assistant",
        "bf_token": "<BOT_TOKEN>",
        "adapter": {
          "adapter_type": "openclaw",
          "provider_agent_id": "main"
        }
      }
    ]
  }
}'
```

Follow the [complete declaration and startup steps](../harnesses/channel-gateway.md) to save and reload. Send a short text request without tools and check the actual reply. A connected Bot or successful version probe is not a completed task.

## Proxies and Environment Variables

This Adapter rejects nonempty per-call envs. Do not copy another Harness's proxy Context. Configure the independent OpenClaw Gateway's own startup environment and restart it using its service mechanism. Runtime's Channel Gateway Extra can keep an environment without proxy variables.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before Gateway configuration. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. This change live-tested only Antigravity's configuration-to-model path; no new live acceptance is claimed for other Harnesses.

[Adapter details](../../../../packages/octo-runtime-adapter-openclaw/README.md) · [Support matrix](../../reference/providers.md)
