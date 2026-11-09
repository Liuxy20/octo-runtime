# 模块装配

[English](../../en/concepts/module-loading.md)

SDK 原生 import Adapter 对象并传给 createKernelService，Kernel 不读取 manifest。CLI 的内置 manifest 与 Home manifest 仅声明 adapters；显式 --manifest 替换默认来源。

业务渠道通过独立仓库的 SDK 接入，Runtime 无插件发现、业务配置 schema 或注册 RPC。

CLI manifest 是 CLI 的模块装配清单，记录 module、export、factory 和可序列化 options。factory=true 时 CLI 调用选中导出的工厂 (options, {env})；结果可为 Adapter，或显式宿主资源 {adapter, processes?, beginShutdown?, close(deadline)}。CLI 持有资源并负责初始化失败回滚和最终关闭，所有 disposer 均被尝试，deadline 是 performance.now() 绝对毫秒。默认 Codex 指向 CLI 自己的 createCliCodexAdapter 工厂，由它装配 managed owner；配置默认值无需用户增加必填项。

这只约束 CLI 工厂入口，不限制 SDK 的 Adapter 构造方式、参数数量、类型或顺序。类、任意工厂、闭包和直接对象均可；业务可以传具体 client 或其他任意依赖。Runtime 只接收满足公开执行合同的构造结果，不要求统一 options、Engine 基类、Codex provider 或 manifest 序列化。Engine、连接和 Home 的所有权须显式约定，见[架构](architecture.md)。
