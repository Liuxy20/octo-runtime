# Extra-owned commands

[简体中文](../../zh-CN/guides/extra-commands.md) | [Documentation](../README.md)

Use `octo-runtime <extra> --help` to discover setup commands. Root help reads the selected Extra catalog without importing Extras. Detailed help imports only the selected command module; it does not run handlers, authenticate, start services, or require a Kernel. Native SDK composition does not load command modules. The catalog combines built-in manifests, the Home manifest, and packages discovered in the current CLI’s global npm/pnpm environment, in that priority order. An explicit `--manifest` replaces all three sources.

Root help presents built-in and discovered commands in one `Available Commands` list. `help <command>` and `<command> --help` share the same help. Static summaries come from the manifest entry’s optional `description`; global discovery reads `package.json.description`. Older entries without a description receive a generic service summary. The CLI recursively maps existing Extra declarations to Commander; Extra packages and SDK hosts do not depend on Commander. Root help shows the version, commit, and build time at the top; `version` / `--version` also expose the full metadata.

Root commands prioritize `executor-kernel`, `channel-gateway`, `channel-wecom`, and `webui` when present in the effective catalog. Remaining commands are sorted by name. Each Extra lists shared commands first, starting with `install`, `uninstall`, `start`, `stop`, `restart`, and `run`, followed by the other shared commands and then business commands in declaration order. A separate `Examples` section follows `Usage`: the host provides shared operation examples, and extensions provide business examples through their `examples` declarations below.

## Configure the built-in Extras

`--home` and `--manifest` remain global Runtime options and work before or after the custom command, including alongside business options. The CLI selects the Home and module source before loading the command. `--json`, `-h` and `--help` also work in either position. Repeating an option is an error. After `--`, tokens are literal positional arguments, not global options. Configuration is Home-scoped; `--profile` is rejected. Host boolean flags retain the legacy presence semantics, including `--json=true` and `--help=true`; the equals value does not disable the flag. Extra-owned boolean options accept only the bare flag. Existing lifecycle syntax remains supported. The WeCom namespace is `channel-wecom`.

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "EXAMPLE_BOT_TOKEN"

octo-runtime channel-wecom configure \
  --bot_id assistant \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "EXAMPLE_APP_SECRET"

octo-runtime webui configure \
  --port 13888
```

Business option names exactly match the stored configuration fields, including the channel fields’ snake_case. Gateway accepts raw `--bf_token` and WeCom accepts raw `--app_secret`; these values are saved unchanged. Omitted credentials preserve the existing value. `--credential-stdin` and the previous business option aliases are removed. Adapter fields such as `--adapter_type` and `--provider_agent_id` populate `bots[].adapter`; other Bot fields populate `bots[]`. Bot commands also expose `--model`, `--effort` and `--provider_agent_id`. OpenClaw uses its existing Agent workspace and rejects `--workdir`; local adapters reject `--provider_agent_id`. WeCom requires a local workdir unless using OpenClaw and accepts an optional `--ws_url` (preserved on update; official endpoint for a new Bot). Gateway keeps its existing default workdir behavior. WebUI exposes only `--port`; initial configuration derives `sessionStorePath` as `<home>/extras/webui/sessions.json`. Existing paths are preserved. Use `extraset` to write advanced paths inside the complete declaration’s `config` field.

Gateway and WeCom `configure` match by `bot_id`: an existing ID is updated even when its endpoint changes; a new ID is appended to `config.bots`. If legacy JSON contains the same ID under different endpoints, configure keeps the first entry’s omitted fields and collapses those matching entries into one. Other Bots are preserved. Both commands preserve omitted fields. Direct extraset validates the envelope; business validation runs when the Extra loads. WebUI has one `webui` configuration per Home; changing its port updates the same instance.

Commands construct the same envelope used by `extraset` and save `<home>/extras/<name>/config.json`, preserving host-owned `enabled` and `module`. They work before setup and while disabled. Saving does not start, enable or reload services. `saved: true` and `reload_required: true` mean persistence succeeded; restart the whole Extra to apply changes. For first use, run `<extra> start`. Agent tasks separately require executor-kernel.

```sh
octo-runtime channel-gateway restart
```

## Advanced: write JSON manually

Service help and `extraset --help` use Bash/Zsh `<<<` examples with a complete JSON declaration, without requiring a separate configuration file:

```bash
octo-runtime channel-gateway extraset <<< '{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "enabled": true,
  "config": {
    "bots": [{
      "api_url": "https://im.example.com/api",
      "bot_id": "<BOT_ID>",
      "bf_token": "<BOT_TOKEN>",
      "adapter": {
        "adapter_type": "codex",
        "workdir": "/absolute/workspace",
        "model": "<MODEL_ID>",
        "effort": "medium"
      }
    }]
  }
}'
```

Replace the endpoint, Bot ID, credential and workdir. Remove `model` and `effort` to use the Harness framework's own defaults. `<<<` redirects stdin in the shell; `< file.json` remains supported. Third-party Extras may provide a public `configExample` object in their manifest entry. The CLI wraps it in the declaration's `config`; examples do not supply configuration defaults or read stored credentials. Never put real credentials in examples. Offline help may read catalog metadata, falling back to a generic JSON envelope if the catalog is broken so configuration repair remains available.

`<extra> extraset` accepts a complete JSON declaration, such as `{"enabled":true,"config":{"bots":[]}}`, and replaces the whole declaration using the existing envelope validation. `<extra> extraget` returns that full declaration, **including credentials**, and reports an error when it is not configured. Neither command loads the business command module, so a broken extension does not block configuration repair. Each Extra defines its own business subcommands, such as `configure`. The built-in `config set/get` commands and shared `configCommands` helper have been removed.

Legacy root-level `octo-runtime extraset <extra>` / `extraget <extra>` remain hidden compatibility aliases. Their help points to the canonical command beneath the service.

Complete Gateway and WeCom JSON examples are in [CLI setup](../getting-started/cli.md). Both include `config.bots[].adapter.model` and `effort`: either may be omitted to use the selected Harness framework’s own defaults. `configure` preserves existing values when flags are omitted; to restore Harness defaults, remove the corresponding fields from a full declaration and save it with `extraset`.

```sh
octo-runtime channel-gateway extraset \
  < channel-gateway-declaration.json
octo-runtime channel-gateway extraget

octo-runtime channel-wecom extraset \
  < channel-wecom-declaration.json
octo-runtime channel-wecom extraget

octo-runtime webui extraset \
  < webui-declaration.json
octo-runtime webui extraget
```

Business subcommands read configuration before interaction. Saving through ctx.saveConfig takes the same Home lock as extraset and compares the entire stored declaration with the snapshot revision. Concurrent changes fail with `EXTRA_CONFIG_CONFLICT`; read again before deciding to retry. Cancellation before the atomic write prevents saving; once writing starts, the actual write result wins. Completed saves are not rolled back. POSIX files remain 0600, and corrupt or unsafe files are not treated as missing configuration.

## Author a command extension

Export an independent `./commands` module from the selected Extra package. Import public types from `@mininglamp-oss/octo-runtime/extra`. Modules must have no initialization side effects.

```ts
import type { ExtraCommandExtension } from "@mininglamp-oss/octo-runtime/extra";

// CLI 拥有 signal 和持久化；Extra 负责业务校验，交互必须配合取消。
const extension: ExtraCommandExtension = {
  apiVersion: 1,
  commands: [
    {
      name: "configure",
      description: "Save the business endpoint",
      options: [{ name: "endpoint", type: "string", required: true, description: "Service URL" }],
      async run(ctx, input) {
        const snapshot = await ctx.readConfig();
        const endpoint = String(input.options.endpoint);
        // 这里按业务合同校验 endpoint；若需认证，在写锁外完成并传 ctx.signal。
        const saved = await ctx.saveConfig({ ...snapshot.config, endpoint }, snapshot.revision);
        return { value: { ...saved } };
      }
    }
  ]
};
export default extension;
```

Packages named `octo-runtime-extra-<name>` or `@scope/octo-runtime-extra-<name>` installed in the same global environment as the CLI are discovered automatically. Their `/commands` export uses the same selected installation as the service; removal or replacement invalidates that selection. See [module loading](../concepts/module-loading.md). For other names or local installations, select the package through the Home manifest:

```json
{
  "version": 1,
  "adapters": [],
  "extras": [
    {
      "name": "loop-daemon",
      "description": "Manage Loop workflows",
      "module": "your-extra-package"
    }
  ]
}
```

The package must resolve from that manifest, for example from its adjacent `node_modules`. Service and command resolution use the same selected module and source manifest, never an unrelated globally installed package. For file modules, declare `"commands":"./commands.mjs"` in the same entry. Ignored duplicate entries are never imported. Missing optional exports preserve lifecycle functionality; broken declared exports and unsupported API versions fail only the selected command extension.

Use `commands` for nested groups and `run` for leaves, exclusively. Maximum depth is 8 below the top-level group, with at most 128 commands. Groups cannot declare options or positional arguments. Option names start with a lowercase letter and may contain lowercase letters, digits, underscores, and hyphens (up to 64 characters); case is significant. Command names retain their lowercase/hyphen grammar. Options are string or boolean; string values accept `--name value` and `--name=value`. Use the equals form for values beginning with `-`. Positional `arguments` are consumed in declaration order; after `--`, every token is positional, including host flags and help. Unknown or duplicate options and excess arguments fail. Required-value checks are skipped for help.

Runtime root namespaces, lifecycle command names (`install`, `uninstall`, `start`, `stop`, `restart`, `status`, `run`, `logs`, `extraset`, `extraget`) and host option names are reserved. `run` receives parsed input and a context with Home, cancellation, configuration snapshots, atomic saves, output, interactive prompts and bounded stdin (1 MiB). `prompt` is for non-secret terminal input. Credential input is owned by each Extra; the built-ins accept direct string options. `readStdin` remains available for JSON configuration and other extension workflows. The handler returns optional JSON `value`, a safe human-readable `message`, and `exitCode` (0..255, default 0). Avoid extra stdout output when producing machine-readable results.

Only use `ExtraCommandError` for fixed, safe diagnostics; do not include credentials, raw input or backend errors. Other handler failures become `EXTRA_COMMAND_FAILED`. Extensions own output redaction, cooperative cancellation and cleanup of their resources. They run in the CLI process, not a JavaScript sandbox. Completed remote effects and saved configuration are not automatically rolled back.
