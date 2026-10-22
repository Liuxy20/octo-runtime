# Adapter and Extra Loading

[简体中文](../../zh-CN/concepts/module-loading.md) | [Documentation](../README.md)

This page describes the loading mechanism implemented for [issue #85](https://github.com/Mininglamp-OSS/octo-runtime/issues/85), including Extras and user extensions. The CLI combines its built-in `manifest.json` with an optional Runtime Home manifest. SDK hosts compose native modules directly using the existing service factories.

## CLI and SDK Responsibilities

| Integration | Adapter selection | Extra selection |
| --- | --- | --- |
| CLI | Built-in manifest plus a user-extension manifest | The same manifests declare modules; explicit component startup and business configuration control activation |
| SDK, including Electron | Host code imports selected Adapters and registers them in its worker entry | Host code imports selected Extra modules and passes them to `createExtraService` |
| FDE delivery | The business team copies the code it needs and handles dependencies | The business team chooses its own dependencies and deployment |

The SDK must not require, read, copy, or generate a permanent or temporary manifest. Electron's main process constructs Kernel and Extra services directly. Adapter instances belong to the host-provided execution worker; module objects and business functions are not serialized across processes. See [Architecture](architecture.md) and [SDK Integration](../getting-started/sdk.md).

Kernel, Core, and Host SDK must not depend on concrete Provider Adapters or business Extras. Shared framework and transport helpers remain valid dependencies. The standard App/CLI distribution continues to include its full default catalog. An SDK integration loads only its explicit selection; adding a module to the repository does not add it to every product.

## CLI Manifest Sources

| Source | Path | Purpose |
| --- | --- | --- |
| Built-in | `apps/cli/src/manifest.json`, copied to CLI `dist/manifest.json` | Full default Adapter and Extra catalog |
| User extension | `<Runtime Home>/manifest.json`, normally `~/.octo-runtime/manifest.json` on macOS/Linux | Additional Adapter and Extra modules |

The former default Adapter JSON is consolidated into this built-in manifest. Both manifests contain `version: 1`, `adapters`, and `extras`. Selecting `--home` also changes the user-extension path; platform defaults and `OCTO_RUNTIME_HOME` follow the existing Home selection rules.

For example, a Home extension can declare local modules:

```json
{
  "version": 1,
  "adapters": [
    {
      "type": "example",
      "module": "./plugins/example-adapter.mjs",
      "export": "exampleAdapter"
    }
  ],
  "extras": [
    {
      "name": "example-extra",
      "module": "./plugins/example-extra.mjs"
    }
  ]
}
```

An Adapter entry uses `type`, `module`, `export`, and the existing optional `factory`/`options` fields. An Extra entry uses `name` and `module`; its module exports a matching `name` and the existing `default` plugin function. The manifest does not contain business credentials, host functions, activation settings, or autostart settings.

## Merge and Resolution Rules

1. Validate the built-in file and the optional user file. A missing user file means no extensions; malformed or unreadable files fail clearly.
2. Reject duplicate Adapter types or Extra names within one file. Adapter and Extra keys are independent.
3. Append user entries after built-ins. Built-ins win on a matching Adapter `type` or Extra `name`; report ignored entries without resolving, importing, or calling them.
4. Preserve each retained entry's source manifest. Resolve relative paths and bare package names from that original file, following ESM `node`/`import` conditions and package `exports`. Absolute paths and file URLs retain their explicit locations.
5. Do not retry resolution from the process working directory, Kernel package, another manifest, or a global package location.
6. Empty arrays contribute no entries. A CLI `--manifest` override remains a complete replacement, without automatically merging built-in or Home files; a legacy Adapter-only override is normalized to an empty Extra array.

Legacy explicit manifests also allow an Adapter to omit `type`. The CLI-owned execution worker instantiates each selected module once and uses its actual `metadata.type` to perform OpenClaw connection discovery and credential refresh before the existing readiness handshake. CLI Kernel and Playboard share this order. It does not infer types from package names or import unselected Providers to identify the selection.

For example, a user-relative `./plugins/example-extra.mjs` points inside the selected Home. An internal package name in the built-in manifest resolves from the CLI installation. Merging the two files must not change either anchor.

## Loading Is Separate from Activation

Kernel's worker loads the selected Adapters. It never imports or manages Extras. CLI merges and resolves the selected Adapters once and passes a JSON snapshot over the existing internal Node IPC channel. Worker recovery reuses that snapshot, without rereading the manifest or replaying Runs. This is internal worker initialization, not an SDK service launcher.

An Extra is imported and initialized only when its own service is explicitly started and enabled. Listing all default Extras does not automatically start them; an unused Extra package must not prevent Kernel startup.

Extra business settings and `enabled` remain in `<Home>/extras/<name>/config.json`. Host functions remain native SDK dependencies. Each Extra retains independent startup, status, shutdown, and cleanup, and cannot close a shared Kernel or host database.

A per-Extra configuration may omit `module` because the manifest declares it:

```json
{
  "enabled": true,
  "config": {}
}
```

A legacy `module` is accepted only when its text exactly matches the effective declaration. `EXTRA_MANIFEST_DECLARATION_REQUIRED` means the Extra needs a declaration in the selected manifest; `EXTRA_MODULE_MIGRATION_REQUIRED` means the saved module conflicts. Add custom modules to the Home manifest, then explicitly save matching module text or omit the legacy field with `extraset`. Built-in names cannot be overridden by Home extensions. Existing files, identities and credentials are never automatically rewritten.

Unselected modules are never imported or probed. Existing probes for selected Adapters remain unchanged; this work does not introduce a new readiness protocol. Missing required modules, invalid exports, mismatched Adapter types or Extra names, and registration errors fail before the affected service is ready.

There is no automatic module installation or live module reloading. Preserve the existing invocation, cancellation, resource ownership, and cleanup contracts. A failed Extra must not stop unrelated services.

SDK code must not use an external Node process to load modules or start a top-level Kernel/Extra service. There is no `startOwnedKernel` integration. The host imports Extra modules in its own process, and its own worker entry imports selected Adapters before calling `serveWorker`. See the [isolated native SDK fixture](../../../test/fixtures/native-loading-host.mts) for invocation, cancellation, caller PID and cleanup checks without CLI or unselected packages.

Implementation and verification are tracked in [OctoSpec](../../../.octospec/tasks/85-provider-decoupling/brief.md). The normative ownership constraints live in the [architecture rules](../../../.octospec/rules/architecture.md).
