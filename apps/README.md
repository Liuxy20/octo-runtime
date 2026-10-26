# 可执行入口

apps 仅包含 [CLI 宿主](cli/README.md)。组件的 run 入口直接调用 `createKernelService` 或 `createExtraService`，由 CLI 管理各自的宿主进程；Kernel 内部 worker 提供执行隔离。不再保留旧架构的独立应用。

CLI 提供 executor-kernel 与 channel-gateway 两组独立服务。其他 HostApp 使用公开 SDK，不调用 CLI 或解析终端输出。执行合同见 [本地执行](../.octospec/rules/local-execution.md)，生命周期见 [Host SDK](../packages/octo-runtime-host-sdk/README.md)。
