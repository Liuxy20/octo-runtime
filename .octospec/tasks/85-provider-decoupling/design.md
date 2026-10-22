---
type: Task
title: Issue 85：CLI 双 manifest 与 SDK 原生装配设计
description: Adapter 和 Extra 共用显式选择原则，CLI 合并两份清单，SDK 无 manifest。
tags: [architecture, adapter, extra, installation, runtime]
status: locally-validated
timestamp: 2026-10-21T00:00:00Z
---

# 确定的设计边界

本 worktree 已实现以下架构方向：[SDK 原生装配、CLI 双清单扩展](../../rules/architecture.md)。默认发布 App 继续全量，FDE 业务方自行复制代码并处理依赖。本任务修复 Runtime 的依赖与加载边界，不接管业务交付。实际证据见[实施记录](implementation.md)。

## 依赖方向与原生 SDK

- Kernel 依赖 Core / Adapter SDK / Protocol，不反向依赖具体 Provider。
- Host SDK 不依赖具体 Adapter 或 Extra；Core 同样保持中立。
- 具体 Adapter 依赖自己的共享适配实现；例如 OpenClaw 需要 ws，ACP 系列需要其公共传输实现，依赖不因名称包含 adapter 就应删除。
- App/CLI 选择完整默认集合并持有对应依赖。FDE 选择子集时，不因框架依赖而强制带入其他具体模块。
- SDK 不读 CLI 或 Home manifest，不生成临时 JSON。Adapter 原生 import 和注册发生在宿主维护的 worker 入口；Extra 原生 import 后在宿主调用进程传入 createExtraService。
- SDK 继续使用已有公共工厂和生命周期；Extra 函数依赖直接注入，不能写入 manifest 或序列化给 worker。

现有依据：[Kernel dependencies](../../../packages/octo-runtime-executor-kernel/package.json)、[Core](../../../packages/octo-runtime-executor-core/package.json)、[Host SDK](../../../packages/octo-runtime-host-sdk/package.json)、[serveWorker](../../../packages/octo-runtime-executor-kernel/src/serve.ts)、[Extra service](../../../packages/octo-runtime-host-sdk/src/extra-service.ts)。

## CLI 的两份 manifest

内置来源为 apps/cli/src/manifest.json，随 CLI 编译到 dist/manifest.json；现有 apps/cli/src/default_adapters.json 的 12 个条目迁入 adapters，现有内置 channel-gateway/channel-wecom/webui 加入 extras。不继续保留另一份默认模块表。

用户扩展来源为 <Home>/manifest.json，macOS/Linux 默认 ~/.octo-runtime/manifest.json，Windows 沿用现有 Runtime Home；--home 改变 Home 后同步改变扩展路径。两份均使用 version=1、adapters 和 extras，扩展格式如下：

```json
{
  "version": 1,
  "adapters": [
    {
      "type": "example",
      "module": "./plugins/example-adapter.mjs",
      "export": "exampleAdapter"
    }
  ],
  "extras": [
    {
      "name": "example-extra",
      "module": "./plugins/example-extra.mjs"
    }
  ]
}
```

Adapter 沿用 type/module/export/factory/options 的模块描述；新统一清单的 type 必填，用于导入前去重。Extra 使用 name/module，加载命名空间中的 name 和 default，保持原有 ExtraPluginModule 合同。manifest 不承载业务 config、凭据、enabled、自启或 JS 函数依赖。

### 合并与快照

1. 读取并校验内置来源。用户清单不存在时取空扩展；读取失败、坏 JSON、版本或条目不合法时明确失败，不静默忽略。
2. 每份文件内部 Adapter type 或 Extra name 重复时报错。adapters 与 extras 的命名空间彼此独立。
3. 内置项在前，用户项追加；同类同名保留内置项并报告被忽略的用户项。不解析、导入或调用被忽略模块。
4. 每个保留项携带原始 manifest 的绝对 file URL，不能合并后统一改用内置目录或 Home 目录解析。
5. Kernel 启动仅消费合并后的 adapters。运行某个 Extra 时才加载该名称对应的 module；列在 extras 不等于启用、配置或自启。没有启动的 Extra 模块缺失不阻止 Kernel 或其他 Extra。
6. 同一服务的 worker 恢复复用本次启动的有效集合和已解析模块，不重新读取被修改的清单，不重放 Run。修改模块集合后，由宿主显式重启对应服务。
7. CLI 原有高级 --manifest 显式覆盖保持完整替换语义：不叠加内置或 Home 清单。旧 adapters-only 显式文件可在 CLI 边界规范化为 extras=[]；默认和新用户清单要求两个数组齐全。此兼容只针对该显式参数，不新增 SDK JSON 入口。

## 解析锚点与实现

相对路径、裸包名均从条目原 manifest 文件位置解析。/app/config/manifest.json 中的 ./adapter.mjs 指 /app/config/adapter.mjs；包名按该位置的 Node 依赖查找规则向父级查找 node_modules。指定 --home 或改变进程 cwd 不改变内置条目的解析来源。

本机绝对路径、Windows 盘符/UNC 和 file URL 继续使用现有分类与 pathToFileURL 边界，避免盘符被当作 URL scheme。裸包解析遵守 ESM 的 node/import 条件、scope 包和公开 exports 子路径；查找失败不再从 Kernel、cwd、全局包或其他清单的目录尝试第二套解析。

实现使用纯 JS 的 import-meta-resolve@4.2.0，调用 resolve(module, sourceManifestUrl) 得到 URL 后再 import，不使用 createRequire 的 require 条件。该版本已安装并更新 lockfile，无声明的生产 dependencies。工具位于现有 Adapter SDK 的 ./module-manifest 子路径，供 CLI 与 runner 复用，不新增框架包或具体 Provider 依赖。

[Node 24](https://nodejs.org/docs/latest-v24.x/api/esm.html#importmetaresolvespecifier)的自定义 import.meta.resolve parent 参数需要实验标志，因此不要求宿主开启此标志。[resolver 项目](https://github.com/wooorm/import-meta-resolve)不覆盖自定义 loader/CLI conditions 等语义；此通用 CLI 路径使用上述默认条件。需要宿主特殊加载语义时，SDK 原生 import 继续由宿主掌控。

CLI 完成合并后在进程内保存带来源的描述，通过已有 Node IPC 通道发送 {type:"kernel.adapters",adapters} 启动快照；内置 runner 使用 --adapters-from-ipc 接收，注册完成后进入既有 list 握手。恢复时复用已解析快照，不写临时 manifest、不占命令行或环境长度。传输仅包含受宿主控制的模块描述与 JSON options，不包含函数、实例或 Extra；禁止另起顶层服务，不改业务 Run/Context/公共 Kernel IPC 字段。

这一步需要修改现有仅通过 --manifest 路径启动 runner 的边界，是支持两份不同锚点与稳定重启快照的必要改动，不以临时文件或忽略来源代替。SDK 自有 worker 直接 import 的路径不经过该阶段。

## Extra 配置和迁移

基线 Extra 配置要求每个 <Home>/extras/<name>/config.json 含 module、enabled?、config。本次已将 CLI 模块选择归还清单，存储配置允许省略 module，保留原业务配置文件和独立服务生命周期。

- 默认 Extra 目录的 module 声明写入内置 manifest；用户扩展写入 Home manifest。
- 新业务配置允许只含 enabled? 和 config；启用与自启仍沿既有 CLI 命令处理，不由 manifest 全量列表自动打开。
- 旧配置的 module 字段暂可读取和返回；若存在，必须与有效 manifest 的声明一致。若不一致或旧自定义 Extra 尚未加入清单，报出明确迁移提示，不执行另一模块、不静默覆盖、不自动重写已有配置。
- 迁移说明指导用户将旧模块声明加入 Home manifest；同名内置不会被扩展覆盖，需要替换实现时使用不同的注册名称或显式完整清单。自定义模块的导出 name 必须与声明一致。
- 原先同一模块使用了不同路径/公开别名的配置，应在迁移中统一声明文本；不靠扫描模块或宽松等价推测隐藏冲突。
- 原有 Extra 的 config、凭据、POSIX 文件权限、独立启停和 incomplete 清理语义继续保留。停止一个 Extra 不关闭 Kernel、其他 Extra 或宿主数据库。

这是有意的配置迁移，已写入双语文档及 CLI 使用说明，不自动重写用户实际 Home。既有通用 descriptor/extraRegistration 保留给显式代码调用方，SDK 原生装配不经过该文件加载路径。缺声明报 EXTRA_MANIFEST_DECLARATION_REQUIRED，旧 module 文本不一致报 EXTRA_MODULE_MIGRATION_REQUIRED。

## 加载、失败与范围

未选条目不执行任何模块代码或 probe。已选 Adapter 继续现有 list -> describe -> probe 链路，不在本任务改造成无 probe 就绪；测试以 fake Provider 验证。Extra 仅在显式启动且 enabled 时 import/initialize；被禁用项不导入，缺少业务配置仍按配置合同反馈。

坏导出、Adapter type 或 Extra name 不符、工厂错误、非法协议声明、重复注册在对应服务就绪前失败并回收本次资源。扩展文件格式错误属于 CLI 配置错误，模块运行错误仅属于实际加载它的服务。保留真实 cause 与来源，不打印 options/config 中的凭据。

范围止于依赖方向、CLI 双清单选择与加载、SDK 原生装配说明及回归。不实现 FDE 拷贝工具、不拆分 npm 发布、不热加载、不自动安装模块、不重构业务调用。相较最初仅 Adapter 的 #85，用户新增 Extra 与 Home 扩展清单使 CLI 装配改动增加；不能再将整个范围描述为仅删除几条 dependencies。

双语说明见[中文](../../../docs/zh-CN/concepts/module-loading.md) / [English](../../../docs/en/concepts/module-loading.md)。实施计划见[验收](acceptance.md)。
