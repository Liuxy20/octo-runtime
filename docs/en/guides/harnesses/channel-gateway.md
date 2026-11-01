# Channel Gateway and Harness Proxies

[简体中文](../../../zh-CN/guides/harnesses/channel-gateway.md) | [Harness index](../harnesses.md)

Configure a proxy only for the Harness while keeping proxy variables out of Channel Gateway Extra's environment. TUN is not required. Runtime already supports per-call environment variables; no Adapter changes are needed. See the [Harness topics](../harnesses.md) for installation, authentication, and differences.

## Install and Prepare

1. Install Runtime using [CLI operations](../../getting-started/cli.md), with Node.js 24.x or 26.x. Install and authenticate the Harness as the Runtime OS user; Runtime does not install it.
2. Prepare an authorized Octo IM Bot, API URL, and protected credential. Keep real tokens out of Git and public logs.
3. Prepare an existing absolute working directory and a listening proxy. This example uses HTTP CONNECT at `http://127.0.0.1:7890`; the proxy URL remains http for HTTPS destinations. A remote Kernel's loopback address refers to the Kernel machine, not the UI machine.
4. Keep the two authentications separate: `bf_token` authenticates to Octo IM; native Harness sign-in authenticates model access. A proxy replaces neither.

## Proxy Only the Harness

Replace the API URL, Bot identity, credential, and working directory below, then run the command directly. The configuration is passed inline; no configuration file is needed. This example uses Antigravity; select other Harness adapter fields and approval modes from their topics. Retain existing Bots: this command replaces the entire declaration. This syntax works in Bash / Zsh. Keep commands containing real credentials out of shared shell history.

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

The proxy item belongs in `config.bots[i].context.items`, not `adapter.envs`, top-level `envs`, or the host's global environment. `env_variables` is a list of `{key,value}`, not a dictionary. Values do not expand `$http_proxy`; repeat literal addresses. Keys must be unique. An empty list does not remove inherited variables. Remove the envs item when no proxy is needed.

The overrides reach this Bot's invocation-owned Provider process and tools/stdio MCP that inherit its environment under native rules. They do not change another Bot or apply a proxy to Gateway's own HTTP/WebSocket connections. This is process-environment isolation, not a network sandbox or a guarantee that every upstream networking library honors these names.

OpenClaw is different: it connects to an independently running Gateway and rejects nonempty per-call envs. Configure that service's own startup environment instead; see [OpenClaw](openclaw.md).

## Start or Reload

The `extraset` command above saves the complete declaration. Successful persistence does not mean the running Extra loaded it; business configuration is checked when the Extra loads. For a new installation, start Kernel and then Gateway:

```sh
octo-runtime executor-kernel start
octo-runtime channel-gateway start
```

For an existing Gateway, apply updates with `octo-runtime channel-gateway restart`. Pass the same `--home` on every command when using a custom Home. SDK hosts pass the declaration's `config` to `createExtraService`, then close and recreate the whole Extra after changing configuration; see [Extras](../extras.md).

These commands assume the host environment has no proxy variables. If proxies were exported globally, clear inherited upper/lowercase HTTP/HTTPS/ALL_PROXY variables for new hosts, update any service-manager environment, and restart affected services. A terminal unset does not change existing services or necessarily override their configured environment. Do not put Provider-only proxies into the shared Runtime/Extra service environment.

## Verify in Order

1. Send a small native request without tools from a temporary working directory to check native account and proxy access, not IM. See [Antigravity](antigravity.md) for Gateway configuration and startup.
2. Send the Bot a unique short marker in Octo IM and ask for that marker without tools.
3. Confirm Gateway connectivity and one successful Provider terminal, then read the full marker back from IM history. Connection, queue acknowledgement, and progress cards do not replace result readback.
4. Confirm that the host startup environment contains no proxy variables. Proving actual Extra direct connections additionally requires destination inspection and system-proxy checks.

Without TUN, OS system proxies remain a separate factor. Native networking libraries determine whether to use them. Absence of environment variables alone does not establish that every connection is direct.

## Recorded Verification and Limits

On 2026-11-01: macOS arm64, Node 24.22.2, agy 1.4.12, Runtime source `85411725`. The Bot Context passed real Gateway configuration validation and dispatcher, an independent Kernel, and the Antigravity Adapter. It returned the expected marker and one `run.completed` in about 12 seconds. Host proxy variables stayed absent and Kernel cleanup completed. IM receive/send were not part of that run.

The full QA IM attempt was blocked before sending by Bot authentication (`err.server.bot_api.auth_failed`). IM acceptance did not pass, and actual Extra connections bypassing the OS proxy were not established. Other Harnesses have no new live acceptance in this change. See the [validation record](../../../../.octospec/tasks/252-antigravity-proxy/validation.md).

## Troubleshoot

- Native failure: check Harness sign-in, model access, proxy, and service reachability; a version probe is insufficient.
- Native success but Runtime failure: check background PATH, workdir, OS user, and the selected Bot's envs. A dynamic `loadContexts` item with the same envs key replaces the static item entirely; retain all required variables.
- IM authentication failure: repair that IM credential separately from model authentication; switching Bots does not verify the original account.
- Failure with only `all_proxy`: observed locally with agy 1.4.12; the complete HTTP/HTTPS variable set worked. Individual uppercase/lowercase requirements were not isolated, and other versions are not covered.

[Environment format](../../reference/contexts.md) · [Extra commands](../extra-commands.md)
