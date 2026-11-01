# Antigravity

[简体中文](../../../zh-CN/guides/harnesses/antigravity.md) | [Harness index](../harnesses.md)

## Install and Authenticate

1. Install the CLI using the official guide, then run interactive `agy` as the Runtime OS user to authenticate. See the [official guide](https://antigravity.google/docs/getting-started?tab=cli) for installation details.
2. Make the same account, home directory, and executable PATH available to the background Runtime. Run this native installation check; it does not prove a successful model request.

```sh
agy --version
```

Minimum version: `1.3.3`. Only `full_access` and canonical output are supported; images and per-call MCP are unsupported. Success requires a native SUCCESS result with nonempty text; a version probe does not prove account or model availability.

## Channel Gateway Configuration

Assume your internet proxy runs **without TUN**, its HTTP listener is `127.0.0.1:7890`, and it runs on the same machine as the Kernel that launches agy. Use the configuration below directly.

Replace the API URL, Bot ID, token, and working directory, then run in Bash / Zsh. Retain other configured Bots in the `bots` list: this command replaces the entire declaration. Channel Gateway defaults to `full_access`, allowing agy to execute tools automatically without an explicit approval setting.

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
          "adapter_type": "antigravity",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "context": {
          "schema": "octo.context-envelope/v3",
          "items": [
            {
              "namespace": "octo.execution",
              "name": "envs",
              "payload": {
                "env_variables": [
                  {
                    "key": "http_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "HTTP_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "https_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "HTTPS_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "all_proxy",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "ALL_PROXY",
                    "value": "http://127.0.0.1:7890"
                  },
                  {
                    "key": "no_proxy",
                    "value": "localhost,127.0.0.1,::1"
                  },
                  {
                    "key": "NO_PROXY",
                    "value": "localhost,127.0.0.1,::1"
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}'
```

> **Optional parameters:** `bot_name` is the Bot display name. Omit `model` and `effort` to use the selected Harness’s own defaults. Replace `<MODEL_ID>` with a supported model ID. `effort` accepts `low`, `medium`, `high`, or `xhigh`; effective support depends on the Adapter and Harness.

The `context` already contains the proxy environment variables for agy; no additional `export` before starting Runtime is needed. They reach this Bot's agy process and tools that inherit its environment. This configuration does not set a proxy for Channel Gateway Extra itself.

If the proxy address or port differs, replace all six occurrences of `http://127.0.0.1:7890`. If no proxy is needed, remove the entire `context` field. For a remote Kernel, `127.0.0.1` refers to the remote machine. Keep commands containing real tokens out of shared shell history.

## Start and Verify

For a new installation, start Kernel and Channel Gateway in order:

```sh
octo-runtime executor-kernel start
octo-runtime channel-gateway start
```

If Channel Gateway is already running, execute `octo-runtime channel-gateway restart` after saving. Pass the same `--home` on every command when using a custom Home. Send the Bot “Reply only OK. Do not use tools.” and confirm an actual reply.

## Troubleshooting and Verification Limits

Check native authentication, model access, and proxy connectivity before Gateway configuration. Record sanitized errors, Harness and Runtime versions, and the actual terminal result. Another Harness's pass is not substitute evidence. This change live-tested only Antigravity's configuration-to-model path; no new live acceptance is claimed for other Harnesses.

[Adapter details](../../../../packages/octo-runtime-adapter-antigravity/README.md) · [Support matrix](../../reference/providers.md)
