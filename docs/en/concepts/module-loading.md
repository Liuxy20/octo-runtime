# Module Loading

[简体中文](../../zh-CN/concepts/module-loading.md)

SDK applications import adapter objects and pass them to createKernelService. The Kernel does not read manifests. CLI built-in and Home manifests contain adapters only; --manifest replaces default sources.

Channels use the SDK from the independent repository. Runtime has no business plugin discovery, configuration schema or registration RPC.
