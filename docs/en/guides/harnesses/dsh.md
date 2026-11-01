# DeepSeek Harness

[简体中文](../../../zh-CN/guides/harnesses/dsh.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install npm Provider `@deepseek-ai/dsh` at `>=0.2.1-rc.4`, for example `npm install -g @deepseek-ai/dsh@0.2.1-rc.4`, then authenticate using the official guide. See the [official guide](https://github.com/deepseek-ai/deepseek-harness) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
dsh --version
```

Experimental integration: `full_access` only, using profile `sdk`. CLI resolves the npm JavaScript entry on PATH; SDK hosts supply `dshBin` explicitly. Desktop/ASAR is not used. The pinned Client SDK differs from the Provider minimum; see [Adapter limits](../../../../packages/octo-runtime-adapter-dsh/README.md).

## Channel Gateway Configuration

Run the following command in Bash / Zsh to save the complete Channel Gateway declaration. Replace the API URL, Bot identity, credential, and existing absolute working directory; retain other configured Bots. Channel Gateway defaults to `full_access`, permitting automatic tool execution.

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
          "adapter_type": "dsh",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        }
      }
    ]
  }
}'
```

> **Optional parameters:** `bot_name` is the Bot display name. Omit `model` and `effort` to use the selected Harness’s own defaults. Replace `<MODEL_ID>` with a supported model ID. `effort` accepts `low`, `medium`, `high`, or `xhigh`; effective support depends on the Adapter and Harness. This Adapter does not apply explicit `effort`; remove it to avoid a configuration warning.

Follow the [complete declaration and startup steps](../harnesses/channel-gateway.md) to save and reload. Send a short text request without tools and check the actual reply. A connected Bot or successful version probe is not a completed task.

## Proxies and Environment Variables

To proxy only this Harness, add the [Provider proxy Context](../harnesses/channel-gateway.md) to this Bot's `context.items`. Runtime injects it into the invocation's Provider child process without changing the Extra's global environment. Verify that the native networking library honors these variables in the installed version; Antigravity's success does not establish acceptance for this Harness.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before Gateway configuration. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. This change live-tested only Antigravity's configuration-to-model path; no new live acceptance is claimed for other Harnesses.

[Adapter details](../../../../packages/octo-runtime-adapter-dsh/README.md) · [Support matrix](../../reference/providers.md)
