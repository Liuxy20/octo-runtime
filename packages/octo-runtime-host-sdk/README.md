# Host SDK

业务通过 KernelClient 调用 RPC，像使用普通工具一样 invoke 并消费结果，按需取消或响应交互；不要求构造服务、操作调用登记或手动 drain。服务托管归 CLI/App 装配入口：使用 createKernelService / createExtraService 在调用进程构造服务，依次 initialize、status、close。attachKernel 只连接既有服务，client.close 不取消 Run 或关闭 Kernel。

工厂无 IO，初始化失败携带 ServiceInitializationError.cleanup。Extra 关闭共用 4 秒单调预算及继承的更早截止，立即停新 invoke，并发等待所属 Run 排空和插件清理。disposer 等待自己的消费、保存和投递任务；清理完成或到期前允许收尾调用注入函数，之后封锁后续调用，再等待全部实际依赖。complete=false 保留失败所有权，阻止同 endpoint/name 替换；SDK 不退出宿主进程，不关闭宿主数据库。

Extra 保持 extra(ctx, config)(dependencies) 两阶段合同。ctx.kernel 使用共享 KernelClient；函数依赖在宿主同进程直接调用，不经 IPC。配置、模块及函数引用变化时先完整关闭再构造；同一函数读取的数据变化下一轮生效。SQLite 完全由宿主维护，SDK/Extra 不创建、迁移或关闭应用数据库。

App 使用 attachKernel(...).invoke 或 kernelService.client.invoke；插件使用 ctx.kernel.invoke。SDK 不实现第二个 invoke。每个独立 Extra 获得自己的 client，停止时关闭其接纳，按共享 deadline 排空它的调用，再等待 onDispose 和释放连接。旧 ExtraAdapterHost、ctx.adapterHost、extra-port 已删除；插件取消改用 ctx.kernel.cancelInvocation，回执字段为 accepted。详见 [Kernel 合同](../octo-runtime-executor-kernel/README.md)。

startNativeComponent 只用于显式配置的外部原生程序，保留自己的进程清理合同，不能用于替代 Kernel/Extra 原生构造。完整类型、用法、限制和迁移见 [SDK 指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。
