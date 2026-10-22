# Adapter 与 Extra 载入

[English](../../en/concepts/module-loading.md) | [开发者文档](../README.md)

本文说明 [Issue #85](https://github.com/Mininglamp-OSS/octo-runtime/issues/85)已实现的载入机制，包括 Extra 和用户扩展。CLI 合并内置 `manifest.json` 与可选 Runtime Home 清单；SDK 宿主继续通过已有服务工厂直接组装原生模块。

## CLI 与 SDK 的责任

| 接入方式 | Adapter 选择 | Extra 选择 |
| --- | --- | --- |
| CLI | 内置 manifest 加用户扩展 manifest | 同一组清单声明模块，由显式组件启动和业务配置控制激活 |
| SDK，包括 Electron | 宿主代码 import 所需 Adapter，在自己的 worker 入口注册 | 宿主代码 import 所需 Extra 模块，传入 `createExtraService` |
| FDE 交付 | 业务方复制所需代码并自行处理依赖 | 业务方选择依赖和部署方式 |

SDK 不得要求、读取、复制或生成永久或临时 manifest。Electron 主进程直接构造 Kernel 和 Extra 服务；Adapter 实例属于宿主提供的执行 worker，不跨进程序列化模块对象和业务函数。见[架构](architecture.md)和 [SDK 接入](../getting-started/sdk.md)。

Kernel、Core、Host SDK 不得依赖具体 Provider Adapter 或业务 Extra；框架公共工具和共享传输实现可以保留。默认 App/CLI 发行继续携带完整默认集合。SDK 仅加载宿主显式选择的集合，仓库新增模块不自动加入每个产品。

## CLI 的清单来源

| 来源 | 路径 | 用途 |
| --- | --- | --- |
| 内置 | `apps/cli/src/manifest.json`，构建到 CLI `dist/manifest.json` | 完整默认 Adapter 与 Extra 目录 |
| 用户扩展 | `<Runtime Home>/manifest.json`，macOS/Linux 通常为 `~/.octo-runtime/manifest.json` | 追加 Adapter 与 Extra 模块 |

原默认 Adapter JSON 已迁入统一内置 manifest，不再维护第二份默认目录。两份清单均有 `version: 1`、`adapters` 和 `extras`。指定 `--home` 后，扩展清单也从指定 Home 读取；平台默认路径和 `OCTO_RUNTIME_HOME` 沿用既有 Home 选择规则。

例如，Home 扩展可声明本地模块：

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

Adapter 项使用 `type`、`module`、`export` 和现有可选 `factory`/`options`。Extra 项使用 `name`、`module`，模块导出匹配的 `name` 和现有 `default` 插件函数。manifest 不保存业务凭据、宿主函数、启用设置或自启设置。

## 合并与解析规则

1. 校验内置文件和可选用户文件。用户文件缺失表示没有扩展；文件损坏或无法读取时明确失败。
2. 单文件内 Adapter type 或 Extra name 重复时报错，两类键互不冲突。
3. 内置项在前，用户项追加。Adapter 按 `type`、Extra 按 `name` 同名时内置优先；报告忽略项，不解析、不 import、不调用其工厂。
4. 每个保留项携带原始清单来源。相对路径和裸包名以该原始文件为基准，遵守 ESM `node`/`import` 条件及包 `exports`。绝对路径和 file URL 保持显式位置。
5. 查找失败后不从进程 cwd、Kernel 包、另一份清单或全局包目录尝试第二套解析。
6. 空数组表示该来源没有条目。CLI `--manifest` 保留完整替换语义，不自动叠加内置或 Home 文件；旧 Adapter-only 显式文件规范化为 Extra 空数组。

旧式显式清单还允许 Adapter 省略 `type`。CLI 自有执行 worker 只实例化所选模块一次，按实例的真实 `metadata.type` 完成 OpenClaw 连接发现和凭据刷新，再进入现有就绪握手；CLI Kernel 与 Playboard 使用同一装配顺序。不会按包名猜测类型或为了判断类型而导入未选 Provider。

例如，用户清单中的 `./plugins/example-extra.mjs` 指向指定 Home 内的文件；内置清单中的包名从 CLI 安装位置解析。合并后两者的解析锚点均不能改变。

## 加载与激活分别处理

Kernel 的 worker 加载选中 Adapter，不 import 或管理 Extra。CLI 合并并解析所选 Adapter 后，通过既有内部 Node IPC 发送 JSON 快照。worker 恢复复用该快照，不重读清单、不重放 Run；这是内部执行 worker 的初始化，不是 SDK 服务启动器。

只有显式启动且启用某个 Extra 服务时才导入并初始化该模块。默认清单列出所有 Extra 不代表全部启动；未使用 Extra 的包缺失不得阻止 Kernel 启动。

Extra 业务配置和 `enabled` 仍存于 `<Home>/extras/<name>/config.json`；宿主函数作为原生 SDK 依赖传入。每个 Extra 保留独立启动、状态、关闭和清理，不能关闭共享 Kernel 或宿主数据库。

Extra 配置可省略 `module`，由 manifest 声明模块：

```json
{
  "enabled": true,
  "config": {}
}
```

旧 `module` 仅在与有效声明的文字完全一致时继续接受。`EXTRA_MANIFEST_DECLARATION_REQUIRED` 表示需在选中清单中声明该 Extra；`EXTRA_MODULE_MIGRATION_REQUIRED` 表示已保存模块与清单冲突。将自定义模块加入 Home 清单，再通过 `extraset` 显式保存相同 module 文字，或省略旧字段。Home 扩展不能覆盖内置名称。程序不会自动改写已有文件、身份或凭据。

未选模块不 import、不 probe。已选 Adapter 的现有 probe 行为保持，本次不引入新的就绪协议。缺少实际加载模块、坏导出、Adapter type/Extra name 不符和注册错误，在对应服务就绪前失败。

不自动安装模块，不运行期间热加载；保留现有 invoke、取消、资源所有权与清理合同。一个 Extra 的失败不应停止无关服务。

SDK 不得使用外部 Node 进程加载模块或代启顶层 Kernel/Extra 服务，不提供 `startOwnedKernel` 接入。宿主在本进程 import Extra，自己的 worker 入口 import 所选 Adapter 后调用 `serveWorker`。无 CLI、无未选包的调用、取消、宿主 PID 和清理验证见[隔离原生 SDK fixture](../../../test/fixtures/native-loading-host.mts)。

具体实施与验证见 [OctoSpec](../../../.octospec/tasks/85-provider-decoupling/brief.md)，规范责任边界见[基础架构规则](../../../.octospec/rules/architecture.md)。
