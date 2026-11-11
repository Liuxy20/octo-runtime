# Module Loading

[简体中文](../../zh-CN/concepts/module-loading.md)

SDK applications import adapter objects and pass them to createKernelService. The Kernel does not read manifests. CLI built-in and Home manifests contain adapters only; --manifest replaces default sources.

Channels use the SDK from the independent repository. Runtime has no business plugin discovery, configuration schema or registration RPC.

A CLI manifest declares module, export, factory and serializable options. For factory=true, CLI calls the selected export with (options, {env}). It accepts an Adapter or an explicit host resource {adapter, processes?, beginShutdown?, close(deadline)}. CLI owns rollback and final cleanup, attempts every disposer, and passes absolute performance.now() milliseconds. Default Codex selects CLI's createCliCodexAdapter factory, which composes the managed owner; no new required user configuration is added.

This convention applies only to CLI factories. SDK adapters may use classes, arbitrary factory signatures, closures or plain objects, accepting a concrete client or any other dependencies. Runtime constrains only the constructed execution contract, never parameter count, types or order. No common options, Engine base class, Codex provider or manifest serialization is required. Engine, connection and Home ownership must be explicit; see [architecture](architecture.md).
