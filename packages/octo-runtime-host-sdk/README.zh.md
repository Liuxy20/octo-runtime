# Host SDK

Kernel、常驻 Engine 与 Home 的生命周期由实际宿主分别维护。Host SDK 不从 Adapter 引用取得 Engine 管理权；CLI 托管和 Electron 自管是不同装配。CODEX_HOME 显式注入，目录权限与持久数据归 Home owner。详见[模块对象与生命周期](../../docs/zh-CN/concepts/architecture.md)。

提供宿主共享的 Home、身份、端点与诊断约定。业务应用从公开 /host 构造 Kernel，或使用独立 client 连接已有 Kernel。

不提供业务插件框架、业务配置或渠道生命周期。 [Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 通过自己的 SDK/CLI 管理业务。

[SDK](../../docs/zh-CN/getting-started/sdk.md)
