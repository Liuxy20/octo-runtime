# Octo Runtime 使用与接入入口

按使用场景选择指南，具体操作和示例只在对应指南维护。

| 场景 | 文档 | 责任 |
| --- | --- | --- |
| 云端设备的定制接入、部署和运维 | [CLI 使用指南](CLI_USAGE_GUIDE.md) | 使用完整 CLI 发行物及系统管理、自启服务 |
| Electron 项目只接入 Octo IM；OctoBuddy 推荐 | [SDK Channel Gateway 指南](SDK_CHANNEL_GATEWAY_GUIDE.md) | submodule、依赖、IM 配置、主进程启动与重载 |
| 普通业务调用 Kernel RPC，或负责托管 Runtime | [SDK 调用与托管指南](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md) | 业务使用 KernelClient；装配入口另管原生服务 |

**Electron、Tauri 2 桌面程序严禁通过 CLI 接入，必须使用 SDK。** 主进程直接构造 Kernel/Extra 服务，禁止外部 Node 代替启动；内部执行 worker 及 Adapter 的 Provider CLI 按原有隔离合同运行。

CLI 默认包含全部 Adapter、Extra，以及系统管理、开启自启等服务能力；默认包含不表示安装后全部启用或已注册自启。SDK 宿主自行选择需要的依赖和装配范围。

普通业务像调用工具一样使用 KernelClient.invoke(input, environment?)：传入输入并消费 RPC 结果，需要时发送取消或交互响应。App 可以使用注入的客户端或 attach 已有 endpoint；Extra 使用相同的 ctx.kernel。调用不要求构造服务、管理登记表或手动 drain。服务启动和关闭归 CLI/App 装配入口；无 Extra 也能执行。具体协议见 [Kernel](packages/octo-runtime-executor-kernel/README.md)。

- 配置来源与对象契约：[SDK 配置说明](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#3-原生-extra)。
- CLI Extra 文件配置：[接入 Octo IM](CLI_USAGE_GUIDE.md)。
- SDK Extra 装配：[SDK Extra 管理](SDK_CHANNEL_GATEWAY_GUIDE.md#装配顺序)。
- 发行与打包：[DEPLOYMENTS.md](DEPLOYMENTS.md)。
- 架构合同：[基础架构](.octospec/rules/architecture.md)、[Runtime 生命周期](.octospec/rules/runtime-lifecycle.md)。

本文件仅作选型导航；原接入正文已拆入上述两份指南。
