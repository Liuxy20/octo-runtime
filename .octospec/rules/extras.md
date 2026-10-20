---
type: Rule
title: Extra 加载与业务边界
description: 插件归属、统一 KernelClient、停止清理与显式装配。
tags: ["extra","lifecycle","installation"]
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/69-kernel-client-invoke
id: runtime-extras
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-host-sdk/src/extra*","packages/octo-runtime-extra-*/**","apps/cli/src/extras.ts","test/extras*"]
  touches: ["extra","lifecycle","installation"]
source: self
supersedes: []
---

# Extra 生命周期与依赖

Extra 是宿主拥有的业务扩展。宿主通过 startExtra 在独立进程加载完整声明，Kernel 仅提供执行服务，不装配 Extra。框架管理整体加载、状态与关闭；插件内部的 Bot、连接、路由和重连不成为宿主通用业务控制接口。

## 插件合同

```ts
import type { ExtraContext, JsonObject, ChannelDependencies } from "@mininglamp-oss/octo-runtime/extra";
export const name = "example";
export default function extra(ctx: ExtraContext, config: JsonObject) {
  return async (dependencies: ChannelDependencies) => {
    ctx.onStatus(() => ({ state: "ready" }));
    ctx.onDispose(() => closeOwnedResources());
    await initialize(config, dependencies, ctx.signal);
  };
}
```

两阶段入口保持 extra(ctx, jsonConfig)(dependencies)。第一阶段同步返回 initializer，第二阶段完成初始化。状态回调同步返回 JSON，默认 {}，框架不解释业务字段；不能在 onStatus 中执行异步探测。signal/onDispose 清理插件自身资源，取消自身调用不等于关闭共享 Kernel。

完整声明为 {name,module,enabled?,config}。name 为小写字母开头的小写字母/数字/连字符，最长 64 字符，必须与模块导出 name 一致。同一宿主同名实例不能重叠；关闭失败阻止替换。多个 Bot/账号/WS 归插件内部 config.bots 等合同，不增加逐 Bot 热更或通用业务 RPC。框架加载器 ExtraPlugins 仍可用于内部装配，不由 Kernel 持有。

## 配置和重载

宿主选择配置来源、持久化和凭据保护，SDK 只消费已解析的 JSON 值。JSON 不允许函数、循环引用、非 JSON 值。SDK 不读取宿主数据库或云端配置中心。配置、模块或函数引用变化时按“停止旧 Extra并确认完整 → 保存完整配置 → 创建新 Extra”处理，不恢复 onConfigure、局部 reconcile 或业务对象控制。

CLI extraset 整份替换 <home>/extras/<name>/config.json，POSIX 0600；extraget 显式返回完整配置。配置属于 Home，不能以 profile 分区。应用使用 SDK 时无需这个文件。CLI 仅重启 channel-gateway 自己的服务，Kernel 和其他 Extra 不变。

## 动态函数与跨进程

loadContexts: (jsonConfig,{signal}) => readonly ContextItem[] | Promise<readonly ContextItem[]> 保持同步/异步合同。每轮任务准备时调用同一函数，读取当前数据；数据变化无需重载连接。函数留在父宿主，IPC 仅传 JSON 请求与结果，不进入配置或 Kernel。

每个绑定带 extra_instance_id、scope_epoch、call_id。迟到或跨代次结果丢弃。默认 5 秒超时、8 个真实在途（最大 32，timeout_ms 范围 1-30 秒），结果最多 32 项 / 64 KiB，发送队列最多 64 消息 / 2 MiB。JSON 深度和 Context v3 继续校验。

超时、取消、断线、scope 变化只结束调用方等待；底层真实 Promise 结束前保留容量，不能通过重载绕过。停止等待未完成依赖并报告 incomplete；同名替换被阻止。宿主应传递 signal 给支持取消的 IO。同步阻塞函数仍阻塞宿主 Node 线程，代理不是线程沙箱。

宿主也可显式提供 dependencyModule 绝对模块入口和导出名，在 Extra 进程中构造依赖；不能同时注入父进程函数代理。运行代码的安装和可信度归宿主。

## 执行、错误和状态

ctx.kernel 注入实际 KernelClient，invoke/cancelInvocation/respondInteraction/respondNativeInteraction/list 与普通 App 使用同一合同；身份关联和恢复在 Kernel 包维护。旧 ctx.adapterHost、ExtraAdapterHost 和 extra-port 已删除，不保留兼容接口。

每个独立 Extra 获得自己的 client，最多 128 个高层 invoke 登记（含在途/未知），只保留元数据。runner 停止时先关闭接纳，显式 drain 请求取消并核对原终态，在现有 4 秒共享期限内等待业务 onDispose 后才关闭 client。已关闭或暂停的 iterator 通过 get 核对，不额外创建订阅。单纯 client.close/iterator.return 不取消；SDK owner stop 是显式策略。未知/lost/未确认返回 incomplete，不清空登记冒充成功。执行终态不代表 delivery 或业务资源已完成，业务清理失败同样阻止替换。

初始化、Kernel 不可达、业务连接失败、dispose 失败和进程退出分别报告；日志不携带凭据或私有错误正文。可选 logging.directory 使用统一元数据白名单。登录、云端登记和 IM 建联不是本地 Kernel 或其他 Extra 的前提。

三个内置插件为 channel-gateway、channel-wecom 和 webui，都复用函数式入口。公开配置 Schema 从主包 /extras/<name>/config-schema.json 获取。没有 Extra 也可执行本地请求。

验证：[生命周期](../../test/host-sdk-lifecycle.test.js)、[依赖额度](../../test/extra-dependency-proxy.test.js)、[插件加载器](../../test/extras.test.js)、[SDK 指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。真实 IM 与平台证据单独记录。
