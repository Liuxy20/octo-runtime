# Host SDK

宿主独立拥有 Kernel 和每个 Extra 的生命周期，SDK 不依赖 CLI 的 JSON 目录或账号登录流程。对外使用主发行包 /host、/executor-kernel、/extra。

- startOwnedKernel：创建独立 Kernel，提供 client、exited、stop 和显式 restart。
- attachKernel：只连接现有 Kernel，没有 start/stop/restart 权限。
- startExtra：在独立 Node 进程加载一个完整插件声明，注入实际 KernelClient 和宿主依赖。
- startNativeComponent：按绝对 executable、argv、cwd、configPath、endpoint 启动原生组件；shell=false，按声明的 stdin-json 或 signal 合同关闭。

stop 返回 CleanupResult，complete、processExited、pendingResources 和稳定错误码分别表达清理事实。进程退出不等于插件 dispose 或宿主依赖已完成；失败实例保留所有权，禁止同名替换。

App 使用 attachKernel(...).invoke 或 owned.client.invoke；插件使用 ctx.kernel.invoke。SDK 不实现第二个 invoke。每个独立 Extra 获得自己的 client，停止时关闭其接纳，按共享 deadline 排空它的调用，再等待 onDispose 和释放连接。旧 ExtraAdapterHost、ctx.adapterHost、extra-port 已删除；插件取消改用 ctx.kernel.cancelInvocation，回执字段为 accepted。详见 [Kernel 合同](../octo-runtime-executor-kernel/README.md)。

spawn 后启动失败抛出 ComponentStartError，保留 cause 与 cleanup；依赖未结束也计入回滚 incomplete。初始化期间的 owner 断开和 stop 会取消启动并回收迟到资源，不在清理后发布 ready。Kernel restart 失败时仍保留新实例的清理结果，不回退使用旧实例的成功 stop 结果。Native IPC readiness 的 status.result.pid 必须匹配本次新建进程。

Extra 的异步清理共用 4 秒预算，runner 在 stop 开始后 4.5 秒执行最终退出兜底；owner 消失后仍自行执行，POSIX 同时回收自己的独立进程组。强制退出不代表 dispose 完成，失败仍保留租约和名称。该内部定时器要求事件循环可调度；Extra 同步死循环且 owner 同时退出时，仍需要独立 supervisor 执行进程回收。

函数式 Extra 合同保持 extra(ctx, config)(dependencies)。loadContexts 函数留在宿主；IPC 仅传 instance/epoch/call ID、剩余时限和受限 JSON。默认 8 个实际在途（最大 32），超时或取消只结束调用方等待，实际 Promise 结束前不释放额度。默认 5 秒，范围 1-30 秒，结果最多 32 项 / 64 KiB，发送队列最多 64 条 / 2 MiB。断线和重载不能绕过未完成的真实调用。

宿主也可通过显式 dependencyModule 在 Extra 进程中加载依赖。模块入口必须绝对，不能与函数代理同时使用；它属于产品装配代码，不是 JS 沙箱。

Extra 的 logging.directory 由宿主显式提供，日志使用既有元数据白名单。配置或函数引用变化时，等待旧 handle.stop 完成再创建新 handle；同一函数读取的数据变化无需重载。完整示例见 [SDK 接入](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。
