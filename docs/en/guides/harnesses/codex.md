# Codex

[简体中文](../../../zh-CN/guides/harnesses/codex.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install Codex CLI using the official guide, then run `codex` to sign in. See the [official guide](https://developers.openai.com/codex/cli) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
codex --version
```

Runtime starts `codex app-server`. Use the same OS account and `CODEX_HOME` (default `~/.codex`); see the [setup overview](../harnesses.md) for Computer Use.

## Channel Gateway Configuration

Run the following command in Bash / Zsh to save the complete Channel Gateway declaration. Replace the API URL, Bot identity, credential, and existing absolute working directory; retain other configured Bots. Channel Gateway defaults to `full_access`; omit the approval mode.

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
          "adapter_type": "codex",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        }
      }
    ]
  }
}'
```

> **Optional parameters:** `bot_name` is the Bot display name. Omit `model` and `effort` to use the selected Harness’s own defaults. Replace `<MODEL_ID>` with a supported model ID. `effort` accepts `low`, `medium`, `high`, or `xhigh`; effective support depends on the Adapter and Harness.

Follow the [complete declaration and startup steps](../harnesses/channel-gateway.md) to save and reload. Send a short text request without tools and check the actual reply. A connected Bot or successful version probe is not a completed task.

## Proxies and Environment Variables

To proxy only this Harness, add the [Provider proxy Context](../harnesses/channel-gateway.md) to this Bot's `context.items`. Runtime injects it into the invocation's Provider child process without changing the Extra's global environment. Verify that the native networking library honors these variables in the installed version; Antigravity's success does not establish acceptance for this Harness.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before Gateway configuration. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. This change live-tested only Antigravity's configuration-to-model path; no new live acceptance is claimed for other Harnesses.

[Adapter details](../../../../packages/octo-runtime-adapter-codex/README.md) · [Support matrix](../../reference/providers.md)
