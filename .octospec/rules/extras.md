---
type: Rule
title: Extra 加载与业务边界
description: 插件归属、统一 KernelClient、停止清理与显式装配。
tags: ["extra","lifecycle","installation"]
timestamp: 2026-10-21T00:00:00Z
implementation_baseline: fix/75-cli-lifecycle
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

Extra 是宿主拥有的业务扩展。依据[统一原生服务原则](architecture.md#统一原生服务构造与部署边界)，CLI 服务进程和 Electron 主进程必须直接构造同一 Extra 服务。createExtraService 后 initialize/status/close，Kernel 只提供执行服务，不装配 Extra。插件内部的 Bot、连接、路由和重连不成为宿主通用业务控制接口。见[服务合同](../tasks/unified-native-sdk-services/design.md)。

## 插件合同

```ts
import type { ExtraContext, JsonObject } from "@mininglamp-oss/octo-runtime/extra";
import type { GatewayDependencies } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
export const name = "example";
export default function extra(ctx: ExtraContext, config: JsonObject) {
  return async (dependencies: GatewayDependencies) => {
    ctx.onStatus(() => ({ state: "ready" }));
    ctx.onDispose(() => closeOwnedResources());
    await initialize(config, dependencies, ctx.signal);
  };
}
```

两阶段入口保持 extra(ctx, jsonConfig)(dependencies)。第一阶段同步返回 initializer，第二阶段完成初始化。状态回调同步返回 JSON，默认 {}，框架不解释业务字段；不能在 onStatus 中执行异步探测。signal/onDispose 清理插件自身资源，取消自身调用不等于关闭共享 Kernel。

原生代码的模块描述为 {name,module,enabled?,config}；CLI 保存配置为 {module?,enabled?,config}，模块由有效 manifest 决定。name 为小写字母开头的小写字母/数字/连字符，最长 64 字符，必须与模块导出 name 一致。同一宿主同名实例不能重叠；关闭失败阻止替换。多个 Bot/账号/WS 归插件内部 config.bots 等合同，不增加逐 Bot 热更或通用业务 RPC。框架加载器 ExtraPlugins 仍可用于内部装配，不由 Kernel 持有。

## 配置和重载

Adapter/Extra 的装配方式统一遵守[基础架构中的 CLI 与 SDK 约束](architecture.md#cli-与-sdk-的-adapterextra-装配约束)：SDK 原生 import 并注入模块，不依赖 manifest；CLI 将模块目录统一到内置和用户 Home 两份 manifest 的 adapters、extras 字段，并为 Extra 增加当前 CLI 同一全局安装环境的发现来源（内置 > Home > 全局）。发现只读元数据，不启用/启动，不影响 SDK 原生装配；具体环境识别、冲突和回退以架构规则为准。统一清单与旧 module 字段迁移已接通；新 CLI 配置可省略 module，保留时须与有效清单文字一致，冲突明确失败。本规则下文的配置路径和现有生命周期保持。设计说明见[中文](../../docs/zh-CN/concepts/module-loading.md) / [English](../../docs/en/concepts/module-loading.md)。

宿主选择配置来源、持久化和凭据保护，SDK 只消费已解析的 JSON 值。JSON 不允许函数、循环引用、非 JSON 值。SDK 不读取宿主数据库或云端配置中心。配置、模块或函数引用变化时按“停止旧 Extra并确认完整 → 保存完整配置 → 创建新 Extra”处理，不恢复 onConfigure、局部 reconcile 或业务对象控制。

CLI `<extra> extraset` 整份替换 <home>/extras/<name>/config.json，POSIX 0600；`<extra> extraget` 显式返回完整配置。旧顶层 extraset/extraget 为隐藏兼容入口。配置属于 Home，不能以 profile 分区。应用使用 SDK 时无需这个文件。CLI 以注册名称独立管理各 Extra 服务；例如 channel-gateway/channel-wecom/webui，各自 install/start/restart/stop/status/run，自启也按组件设置。重启只影响对应 Extra，Kernel 和其他 Extra 不变。全局 status 逐个查询已配置 Extra 自身公开状态，不只查询进程或 Kernel。

CLI 安装、自启、未安装与显式禁用的行为统一遵循[本地生命周期合同](runtime-lifecycle.md#cli)；Extra 操作指南和仓库 Skill 的示例须与该合同一致。SDK 原生装配不继承 CLI 的系统服务安装要求。

## 动态函数与实际在途

loadContexts: (jsonConfig,{signal}) => readonly ContextItem[] | Promise<readonly ContextItem[]> 保持同步/异步合同。每轮任务准备时调用同一函数，读取当前数据；数据变化无需重载连接。原生服务直接注入函数，函数留在服务所在的调用进程，不进入配置或 Kernel。

通用服务最多跟踪 128 个实际异步依赖，不排队。Gateway 的回调池默认 5 秒超时、8 个真实在途（最大 32，timeout_ms 范围 1-30 秒），结果最多 32 项 / 64 KiB；迟到结果丢弃，JSON 深度和 Context v3 继续校验。不保留独立 runner、依赖代理或 dependencyModule。

Context loader 可由调用方显式传入同步来源选择函数：两个来源分别通过原有输入校验后选择有效项，再合并并校验最终预算。选择策略属于调用方，通用 loader 不识别业务命名空间；省略选择函数保持原行为。不得为过滤另建回调池、重复调用宿主函数或改变完整配置快照、超时、取消及迟到结果处理。

依赖容器允许普通记录及类实例，服务与直接加载器必须保留继承方法、非枚举和 Symbol 成员。注入视图为只读浅快照，函数引用及值/访问器结果在装配时固定，函数 this 绑定宿主原对象以支持私有状态；不冻结宿主实例，也不接管其资源。宿主后续状态由同一方法读取，不以对象展开丢失方法。嵌套对象不递归代理，这不是沙箱；原生服务的函数包装仍须执行关闭权限、截止和实际在途计数。

超时、取消、断线、scope 变化只结束调用方等待；底层真实 Promise 结束前保留容量，不能通过重载绕过。停止等待未完成依赖并报告 incomplete；同名替换被阻止。宿主应传递 signal 给支持取消的 IO。同步阻塞函数仍阻塞宿主 Node 线程，代理不是线程沙箱。

函数和模块的安装及可信度归宿主；JS 同进程调用不提供线程或沙箱隔离。

## Gateway 专属存储依赖

GatewayDependencies 由 `/extras/channel-gateway` 定义，扩展既有 loadContexts 并提供可选同步 createSessionStore(botConfig)。通用 `/extra`、ExtraContext 和服务加载器不新增 Gateway store 或数据库字段；其他 Extra 定义自己的依赖类型，仍通过同一泛型服务加载。

每个有效且启用的 Bot 获得一个工厂句柄；工厂输入是已校验、保留未知宿主 scope 字段的独立深拷贝。工厂和普通 store 方法同步，close 可异步；工厂抛错、无效对象及误返 Promise 不回退 Memory。工厂句柄由 Gateway 在 Runtime 尾写后撤权并释放一次，宿主共享数据库始终归宿主；内部直接注入 sessions 仍是借用，不能与工厂同时配置。原始宿主方法的 this 与可选方法缺失语义必须保留。

句柄与 Runtime/Manager 共用最早关闭截止，取消通知不立即撤销必要尾写；实际保存或 close 失败、到期仍未释放均使清理 incomplete，保留旧所有权并阻止替换。错误 async 工厂的迟到资源仍须回收，迟到完成不能覆盖已返回失败。整个 Runtime 不依赖 SQLite、不提供 SQLite 适配实现。方法语义、包外样例及宿主职责见 [SDK 存储接入](../../SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)，回归见 [宿主工厂测试](../../test/gateway-host-session-store.test.js)。

## 执行、错误和状态

ctx.kernel 注入实际 KernelClient，invoke/cancelInvocation/respondInteraction/respondNativeInteraction/list 与普通 App 使用同一合同；身份关联和恢复在 Kernel 包维护。旧 ctx.adapterHost、ExtraAdapterHost 和 extra-port 已删除，不保留兼容接口。

每个 Extra 获得自己的 client，最多 128 个高层 invoke 登记（含在途/未知），只保留元数据。invoke 自动登记，原生 Extra 服务 close 自动关闭接纳、取消并核对原终态，在 4 秒共享单调期限内等待业务 onDispose 后才关闭 client；普通插件和宿主不必手动操作 invocations。已关闭或暂停的 iterator 通过 get 核对，不额外创建订阅。单纯 client.close/iterator.return 不取消；服务 close 是显式策略。未知/lost/未确认返回 incomplete，不清空登记冒充成功。执行终态不代表 delivery 或业务资源已完成，业务清理失败同样阻止替换。低层 submit 的 RunRef 仍由明确选择该原语的高级调用方自行管理。

框架 owner 停止是停准入与启动清理的信号，业务插件可在共享截止内保留已接纳调用的消费和投递资源，并调用宿主注入函数完成有界收尾。Gateway 最多 3 秒完成 drain，Extra 原生服务的各清理阶段共用 4 秒单调预算，并发等待调用排空与 dispose。插件清理结束或到期即封锁后续依赖调用，然后等待所有实际在途依赖；超时不能释放实际占额。未知执行结果、绑定/规则保存失败、最终展示或投递失败均保留失败事实，重复关闭不能变成成功；此行为不自动扩展为 WeCom 的回复策略。

初始化、Kernel 不可达、业务连接失败、dispose 失败和进程退出分别报告；日志不携带凭据或私有错误正文。可选 logging.directory 使用统一元数据白名单。登录、云端登记和 IM 建联不是本地 Kernel 或其他 Extra 的前提。

Issue93新增组件状态专用白名单：可选非JSON `logging.statusOutput(record)` 在宿主进程接收服务生命周期、Kernel可用性转换及Gateway连接/重试；SDK默认静默。不得携带session/run/message标识、聊天正文、模型输出、工具参数、凭据。镜像由现有有界日志Worker写入 `extras/<extra>-status-<UTC小时>.log`，复用三份/每份100MiB保留。callback不进入workerData，sink异常与磁盘失败独立退化。Kernel探测单个在途、完成后5秒再检查，只打印转换，close取消；onStatus仍同步，不重启服务。

三个内置插件为 channel-gateway、channel-wecom 和 webui，都从主包 /extras/<name> 公开模块导入，并复用函数式入口。公开配置 Schema 从主包 /extras/<name>/config-schema.json 获取。没有 Extra 也可执行本地请求。

验证：[生命周期](../../test/host-sdk-lifecycle.test.js)、[实际依赖与启动](../../test/extra-startup.test.js)、[插件加载器](../../test/extras.test.js)、[SDK 入门](../../docs/zh-CN/getting-started/sdk.md)。真实 IM 与平台证据单独记录。

## Extra 自有命令

CLI 可选加载所选模块的 `/commands`（apiVersion:1）；文件模块通过同一 manifest 条目的 commands 指定入口。全局发现的命令与服务复用同一安装身份校验，包被移除或替换后拒绝回退到祖先同名包。根帮助只读目录，详细帮助不运行 handler、不启动服务。业务参数、认证、校验与身份去重由 Extra 决定；CLI 负责 Home、IO、取消和持久化，SDK 原生服务不加载命令模块。生命周期名称与宿主选项保留；--home/--manifest 即使位于子命令后，也由 CLI 全局解析并在加载命令前选定来源，Extra 不声明同名参数。重复参数拒绝，-- 后只解释为字面位置参数。损坏扩展不阻断其他 Extra 或普通离线生命周期。

命令只更新现有存储外壳内的 config，保留 enabled/module。交互在锁外进行，保存在与 extraset 相同的锁中比对整份声明修订，冲突拒绝，原子写入保持原权限。锁与回收锁均须原子发布可验证的所有者，进程退出后可恢复；不得按时间或无所有者标记删除活跃写入者的锁。保存必须报告重启才能应用，不隐式启用或启动。Gateway/WeCom configure 按 bot_id 更新或追加，改 endpoint 仍更新原项；旧跨 endpoint 同 ID 项合并为一项并保留首项省略字段。WeCom 更新省略 ws_url 保留原值，新 Bot 省略才使用官方地址；完整 extraset 仅校验声明外壳，业务校验留给 Extra 加载，WebUI 按 Home 内 webui 单例更新。去重不进入通用宿主层。内置 configure 的参数与存储字段同名（渠道字段使用 snake_case），adapter_type 等执行字段写入 Bot 的 adapter 对象；bf_token/app_secret 直接接收原文，省略保留已有值，不保留 credential-stdin 或旧业务参数别名。WebUI configure 只暴露 port，首次会话路径取 `<home>/extras/webui/sessions.json`，已有路径保留；高级 extraset 将原业务 JSON 放在完整声明的 config 字段。用法及开发合同见 [命令指南](../../docs/zh-CN/guides/extra-commands.md)。

CLI 用户文档与各 Extra README 优先展示 configure 的核心参数和独立启停；手写完整声明的 `<extra> extraset/extraget` 放进阶说明，明确整体替换不执行 configure 的按 ID 更新。内置 config set/get 与 configCommands 生成器已删除；业务子命令以 Extra 自己的声明为准。

### CLI 命令展示

CLI 使用 Commander 统一命令树、参数解析与帮助。根帮助只列有效目录中的实际命令及用途，不单独列 Extra namespace、Components 或占位路径。manifest 条目可提供 description，全局发现取 package.json.description；旧条目缺省时用通用说明。根帮助不导入模块，选择 Extra 后才导入其 commands，生命周期与 extraset/extraget 离线可用。每层仅一份 Usage 与命令列表，help 路径与 --help 共用定义。旧顶层 extraset/extraget 隐藏兼容，带目标名称的旧帮助指向组件下的路径。根帮助和 version/--version 均展示版本、commit、build；全局 -v/--version 在命令前后均有效，不依赖目录或插件，-- 后仍为字面参数。

根命令优先显示 executor-kernel、channel-gateway、channel-wecom、webui，缺席的条目不补入目录，其余按名称排序。Extra 内先列公共命令，前六项为 install、uninstall、start、stop、restart、run，再列 status/logs/extraset/extraget，最后按声明顺序展示自有命令。Usage 后提供独立 Examples 区块；根示例只用有效目录和通用动作，插件示例来自已选命令的 examples，不能为根示例导入插件。

组件与 extraset 帮助用 Bash/Zsh `<<<` 展示完整 JSON 声明，包含有效目录中对应的 module，便于识别配置用途；目录不可用时不猜造 module。相对模块路径不满足旧配置外壳合同，示例继续省略此可选字段。manifest 条目的可选 configExample 为公开业务配置示例，由 CLI 包入 config，不能作为运行时默认值或包含真实凭据。渲染器不按 Extra 名称拼业务字段，不读已存配置；离线 extraset 帮助尽量读目录元数据，目录损坏时退回通用声明外壳，动作仍不依赖目录或业务命令模块。
