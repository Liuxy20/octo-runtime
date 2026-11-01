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

## Channel Gateway Configuration

Replace the API URL, Bot ID, token, and working directory, then run in Bash / Zsh. Retain existing Bots in the `bots` list: this command replaces the entire declaration. Channel Gateway defaults to `full_access`; no approval setting is needed.

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
          "adapter_type": "mcode",
          "workdir": "/absolute/workspace"
        }
      }
    ]
  }
}'
```

> **Optional parameters:** `bot_name` is the Bot display name. Configure the model in MiniMax Code. The current integration advertises no per-session model selection, so the example omits `model`. The Adapter does not apply explicit `effort`. Omit both to retain the Harness's own settings.

## Startup and Proxies

For a new installation, run `octo-runtime executor-kernel start`, then `octo-runtime channel-gateway start`. For an existing Gateway, run `octo-runtime channel-gateway restart` after saving. Pass the same `--home` when using a custom Home.

For a Bot-specific proxy, use the [complete proxy Context example](channel-gateway.md), changing the adapter type to `mcode` and removing `adapter.model` and `adapter.effort` to match this page. Verify that the installed MiniMax Code version honors the proxy variables; no new live MiniMax Code acceptance was performed in this change.

Send a short text request without tools and confirm an actual reply. Installation probes and Gateway connectivity do not prove a successful model request.

[Adapter details](../../../../packages/octo-runtime-adapter-mcode/README.md) · [Support matrix](../../reference/providers.md)
