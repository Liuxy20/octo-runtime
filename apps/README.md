# 可执行入口

apps 仅包含 [CLI 宿主](cli/README.md)。Kernel 和 Extra 的独立 runner 位于内部 packages，由 Host SDK 启动；不再保留 daemon app。

CLI 提供 executor-kernel 与 channel-gateway 两组独立服务。其他 HostApp 使用公开 SDK，不调用 CLI 或解析终端输出。执行合同见 [本地执行](../.octospec/rules/local-execution.md)，生命周期见 [Host SDK](../packages/octo-runtime-host-sdk/README.md)。
