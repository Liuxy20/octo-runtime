# Host SDK

The actual host owns Kernel, persistent Engine and Home lifecycles separately. Host SDK does not acquire Engine control from an adapter reference. CLI management and Electron-owned Engines are distinct compositions. CODEX_HOME is explicit; its owner manages permissions and persistent data. See [module and object lifecycles](../../docs/en/concepts/architecture.md).

Provides shared Home, identity, endpoint and diagnostic conventions. Applications construct Kernel services from the public /host entry, or connect using the standalone client.

Business plugin discovery, configuration and channel lifecycle are outside Runtime. [Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) owns those concerns through its SDK and CLI.

[SDK](../../docs/en/getting-started/sdk.md)
