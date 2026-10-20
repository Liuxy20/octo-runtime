---
type: Guide
title: 工作区与开发组织
description: pnpm workspace、包依赖、构建和新增项目步骤。
tags: []
timestamp: 2026-10-20T00:00:00Z
implementation_baseline: feat/executor-kernel-host-lifecycle
---

# 工作区与开发组织

当前包边界见 [Runtime 合同](../rules/runtime-lifecycle.md)。Host SDK 独立管理 Kernel 和 Extra；Kernel 只监督 worker，worker 使用唯一 AgentExecutor。SDK 宿主不依赖 apps/cli 或未选用的业务 Extra。

Octo Runtime 使用 pnpm workspace 管理多项目。workspace 边界由根目录 [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 定义：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

根目录的 `.octospec/`、`config/` 和 `test/` 是仓库级资源，不是独立发布项目。

## 目录职责

```text
apps/
  cli/                  面向用户的 Unix socket CLI

packages/
  octo-runtime-protocol/             canonical protocol
  octo-runtime-executor-core/                 local execution context resolution
  octo-runtime-host-sdk/             owned Kernel/Extra、依赖代理、原生组件启动
  octo-runtime-extra-channel-gateway/ optional Octo IM integration
  octo-runtime-extra-channel-wecom/   optional WeCom integration
  octo-runtime-extra-webui/           optional local WebUI with canonical SSE
  octo-runtime-executor-kernel/      Kernel IPC/client、worker 监督、源流窗口
  octo-runtime-adapter-sdk/          adapter authoring helpers
  octo-runtime-acp-client/           reusable ACP client
  octo-runtime-adapter-*/            provider adapter definitions
```

依赖方向：

```text
apps -> packages
octo-runtime-adapter-* -> octo-runtime-adapter-sdk / provider protocol helpers
octo-runtime-host-sdk -> Kernel / Protocol / Adapter SDK
optional extras -> Host SDK 的插件类型与 Protocol
HostApp composition -> 显式选择 Kernel worker 入口及 Extra 声明
octo-runtime-executor-kernel -> Core / Protocol / Adapter SDK / runner 所需 Provider Adapter
```

Kernel 和 Host SDK 的生产依赖不引入业务 Channel；HostApp 携带并显式启用所需 Extra。标准根发行物携带内置模块，不代表源码 SDK 宿主必须部署全部模块。旧 daemon、adapter-host、worker-access 和 Context Builder 包已移除。

`packages/*` 不应 import `apps/*`。provider 命令构造、native event parser、session codec 和权限适配必须留在 `packages/octo-runtime-adapter-*`；apps 只做配置、进程启动和 I/O 装配。

内部 package 的目录名与包名非 scope 部分一致，均标记 private，不独立发布到 npm。对外只发布根 CLI `@mininglamp-oss/octo-runtime`；`pnpm pack:release` 将内部编译模块及生产依赖一起打包，内部模块发行版本统一采用根版本号。源码 workspace 依赖仍保持 `workspace:*`，宿主 SDK 可从源码构建部署，详见 [部署说明](../../DEPLOYMENTS.md)。

## TypeScript 构建约定

所有 app 和 package 的实现源码均为 `src/*.ts`，统一继承根目录的 [tsconfig.base.json](../../tsconfig.base.json)。当前采用 `strict`、`NodeNext` module/module resolution，并开启 declaration 与 source map 输出。

每个 workspace 只把 `src/` 当作源码，把编译结果写到未提交 Git 的 `dist/`：

```text
src/index.ts
   | pnpm build
   v
dist/index.js
dist/index.js.map
dist/index.d.ts
dist/index.d.ts.map
```

内部 package 的 `exports` 指向 `dist/index.js`，`types` 指向 `dist/index.d.ts`，供 workspace 与手动拷贝的内部发行目录解析模块，不依赖 TypeScript 源文件或 ts-node loader。这些入口不构成独立 npm SDK；内部项目单独使用时由维护者手动拷贝、覆盖同次构建的程序目录。

IDE 应使用 workspace TypeScript SDK 和本仓库的 flat-config ESLint，使编辑器诊断与命令行一致；编辑器个人配置不属于 Runtime 发布合同。

## 安装与常用命令

根 [package.json](../../package.json) 固定 `pnpm@11.19.0`：

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm cli executor-kernel run
pnpm cli channel-gateway run
pnpm cli status
```

查看 workspace：

```bash
pnpm --recursive list --depth -1
```

单独运行 worker runner 的 stdio 诊断入口（通常由 Kernel 监督启动）：

```bash
pnpm host
```

查看单个 package 的依赖：

```bash
pnpm --filter @mininglamp-oss/octo-runtime-adapter-codex list
```

内部依赖必须使用 `workspace:*`：

```json
{
  "dependencies": {
    "@mininglamp-oss/octo-runtime-adapter-sdk": "workspace:*"
  }
}
```

这样 pnpm 安装时只会链接当前 workspace package，不会意外从 registry 拉取同名旧版本。

外部 SDK 接入统一使用宿主独立的 pnpm workspace：submodule 位于宿主的 `octo-runtime/` 子目录。第一步在宿主 `pnpm-workspace.yaml` 中纳入 `octo-runtime/packages/*`，保留宿主原有配置并合并所需 allowBuilds；第二步在宿主根 `package.json` 中以 `workspace:*` 声明直接依赖。`protocol`、`core`、`adapter-sdk` 等全部纳入 workspace，其传递依赖由 pnpm 自动链接；宿主直接 import 时才另加直接依赖。

集成安装和构建均从宿主根目录执行：`pnpm install` 后，使用 `pnpm --filter <模块包名>... run build` 按依赖顺序构建，无需单独命名一个宿主 Runtime 构建 script。子仓原有 workspace 文件与 lockfile 保留；集成时使用宿主 workspace 配置及 lockfile，宿主 lockfile 与 submodule 指针一起提交，CI 使用宿主 `pnpm install --frozen-lockfile`。SDK 无需纳入子仓根 CLI 包或 apps，正式发行仍携带完整生产依赖。完整步骤见 [SDK 完整原生接入指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)与 [Channel Gateway 指南](../../SDK_CHANNEL_GATEWAY_GUIDE.md#装配顺序)。

宿主保留预编译方案，将上述过滤构建及独立 Host 入口编译前置到原有 `dev` / `build` 命令，保留原有开发、检查与打包步骤；不要求安装时的 `prepare` 或额外脚本文件。开发启动后仅 App 源码由原服务监听，修改 Runtime 源码需重新编译。普通安装覆盖所有 workspace 项目，构建过滤本身不限制安装范围。

源码 SDK 宿主按实际依赖闭包裁剪模块，不能仅按是否启用判断可否排除。内置 Kernel runner 的 Provider 依赖仍须保留；自定义 worker 入口只注册宿主显式选择的 Adapter。已发布单包通过 /host、/executor-kernel、/executor-core、/extra、/protocol 子路径消费，完整示例见两篇 SDK 指南。

## 新增 Adapter Package

以下步骤描述当前实现。已确认的目标改造为 [CLI 与 SDK 分别选择集合](../tasks/adapter-composition-ownership/brief.md)：CLI 自管清单，SDK 嵌入代码自管选择，宿主 App 自行管理依赖、裁剪及打包，框架不承诺客户包体。实施后新增 Adapter 不应自动加载到所有客户产品；对接文档和加载代码的详细中文注释必须同步交付。在改造完成前，不能把下面的共享 JSON 当作长期责任划分。

以 `foo` provider 为例：

1. 创建 `packages/octo-runtime-adapter-foo/package.json`、`src/index.ts` 和 `README.md`。
2. 包名使用 `@mininglamp-oss/octo-runtime-adapter-foo`，依赖 `@mininglamp-oss/octo-runtime-adapter-sdk: workspace:*`。
3. 实现 metadata、probe、invoke、session 和 canonical event mapping。
4. CLI 默认项在 [default_adapters.json](../../apps/cli/src/default_adapters.json) 注册 type/module/export；SDK 在各自 Host 入口直接 import 并注册，不复制 CLI 资源。
5. 使用内置 runner 时，在 `packages/octo-runtime-executor-kernel/package.json` 增加所需 workspace dependency；标准 CLI 发行时同步根生产依赖。自定义 SDK worker 则由宿主管理其依赖和 serveWorker 注册集合。
6. 若根测试直接 import 该包，在根 `devDependencies` 增加 workspace dependency。
7. 在 `test/` 添加 native event、success/error/cancel/session resume 契约测试。
8. README 至少说明包的作用、设计原则、适用场景、明确边界和最小用法，并在 [Packages And Adapter Guide](../../packages/README.md) 与 provider matrix 中建立入口。

Core、Kernel 和 CLI 不应增加 `if adapterType === "foo"`。新增 provider 差异必须终止在 adapter contract 边界。

## 新增 App

1. 创建 `apps/<name>/package.json` 和 `src/index.ts`。
2. package 标记 `private: true`，命名采用当前 scope `@mininglamp-oss/<name>`；与库包同名时追加 `-app`。新增 app 不恢复旧 daemon 组合壳。
3. 使用 `workspace:*` 依赖需要的 runtime packages。
4. 在 app package 中提供 `start` script；需要统一入口时再加入根 scripts。

App 可以选择不同 transport 或部署形式，但不能复制一份 Core/Adapter 业务逻辑。

## Lockfile 与 CI

仓库只提交根 `pnpm-lock.yaml`，不提交 `package-lock.json` 或子项目 lockfile。CI 推荐：

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

升级 pnpm 时应同时更新根 `packageManager`、CI 版本和 lockfile；升级 provider CLI 不需要修改 workspace lock，但必须重跑 adapter contract 和受控 live smoke test。
