# Host SDK

The actual host owns Kernel, persistent Engine and Home lifecycles separately. Host SDK does not acquire Engine control from an adapter reference. CLI management and Electron-owned Engines are distinct compositions. CODEX_HOME is explicit; its owner manages permissions and persistent data. See [module and object lifecycles](../../docs/en/concepts/architecture.md).

Provides shared Home, identity, endpoint and diagnostic conventions. Native applications depend on Host SDK, Kernel and selected Adapters from source workspace. Independent Apps use the client to connect to a CLI-started Kernel without loading host packages or Adapters.

Business plugin discovery, configuration and channel lifecycle are outside Runtime. [Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) owns those concerns through its SDK and CLI.

[SDK](../../docs/en/getting-started/sdk.md)
