# SDK Channel Gateway 接入

宿主使用 /host 的 startExtra 独立管理 Channel Gateway，执行通过指定的 Kernel endpoint。完整可编译调用方式及 loadContexts 注入见 [原生 SDK 指南第 3 节](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#3-独立-extra)。

## 装配顺序

1. 宿主准备 Node、Provider 和自己的 worker 入口，调用 startOwnedKernel，或附加到已有 Kernel。
2. 从自己的受保护配置源取得 Bot 值，构造 {name: "channel-gateway", module, config: {bots}}。
3. startExtra({endpoint, declaration, dependencies}) 创建独立 Gateway。
4. extra.status() 读取插件 JSON；业务 Bot online 与 kernel_available 分别判断。
5. 配置变更先等待 extra.stop() 且 complete=true，再保存并创建新实例；Kernel 保持运行。

## 逐轮 Context

dependencies.loadContexts(botConfig,{signal}) 返回当前 ContextItem 数组或 Promise。函数留在宿主，由有界 IPC 代理逐轮调用；函数读取的数据变化无需重载连接。超时或取消后真实 Promise 未结束仍占额度；返回值最多 32 项 / 64 KiB。静态 context 与动态项的合并、业务指引和准入规则继续按 [Gateway 合同](packages/octo-runtime-extra-channel-gateway/README.md)。

不要把函数、源码或模块实例放进 config。替换函数引用按整体停止/加载处理。调用方处理 signal 的正常取消，dispose 的真实失败仍须报告。

## 配置和业务责任

完整字段见 [Gateway JSON Schema](packages/octo-runtime-extra-channel-gateway/config-schema.json)，业务行为见 [Gateway README](packages/octo-runtime-extra-channel-gateway/README.md)。宿主负责令牌取得、存储、更新与授权流程；Extra 消费实际配置值，不扫描 CLI Home 或其他凭据文件。Electron/Tauri 使用 SDK，不调用 Runtime CLI。

真实 IM 验收只使用 im-test.deepminer.com.cn，具体宿主和 Provider 的结果另记，不能由本地 fixture 推断。
