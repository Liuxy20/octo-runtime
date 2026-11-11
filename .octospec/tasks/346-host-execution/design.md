---
type: Design
title: Issue 346：依赖注入与 metadata 复用设计
description: 区分执行描述、宿主选择和协议适配，列出各 Adapter、CLI 与启动器的具体变更及失败边界。
tags: [architecture, adapter, metadata, envs, lifecycle]
---

# 结论

复用现有 metadata 描述 Adapter、复用 probe 描述所选依赖的状态，复用具体构造参数传入依赖。metadata 不承载 executable 配置、client、factory、owner 或生命周期方法。普通命令 Adapter 可以消费宿主已选定的启动描述，不必全部变成常驻 Engine。

下表记录初始 main `bf665881` 的审计证据和改动位置；实现已 rebase 到 `c7ae0256`，保留 #345 的单个 Codex app-server。实际 API 与检查结果以下文和 validation 为准，不承诺已提供容器或远程执行平台。

## 现状与改动位置

路径均相对仓库根。

| 模块与现状证据 | 目标改动 |
| --- | --- |
| `packages/octo-runtime-adapter-sdk/src/index.ts:100` 的 AdapterMetadata 只有类型、来源、协议、MCP/workspace 与描述字段 | 保留字段语义；需要构造前展示的内置模块导出静态 metadata，实际 Adapter 使用同一份声明，经过 defineAdapter 补齐协议默认值 |
| 同文件 `:545` 的 probeCommand 遍历 PATH，`:348` 的 spawnJsonLines 在最终 spawn 前合并 process.env 并解析启动载体 | 把 PATH 发现移至宿主；保留“校验单一已选目标”的 helper；最终执行只消费已解析 command/参数，不隐式回读宿主环境重选程序 |
| Codex Adapter 已要求 engine；初始 owner 默认 codex，按 Run 解析路径。#345 已把池改为一个服务，但仍有默认裸命令 | 保留 engine 注入和 #345 单服务；owner 强制显式启动目标与前缀，probe/启动/恢复同源 |
| `packages/octo-runtime-adapter-opencode/src/index.ts:43,420` 默认 opencode；每轮 probeOpenCode 按本轮环境和 workdir 解析，再分别执行 run/acp | 工厂显式接收宿主绑定；ask/full_access 两路和 probe 使用同一 executable/runtime，不按 envs/cwd 改选；按最新用户要求删除版本准入及调用前版本探针 |
| `packages/octo-runtime-adapter-acp/src/index.ts:45,240` 的 definition 含 command，factory 默认 spawnAcpClient，probe 自动 PATH 查找 | definition 保留 type/provider/协议 args/env；实际 command 从宿主依赖输入；复用 acpClientFactory 注入口，不在注入 factory 后另起本地 PATH 探针 |
| Hermes、Kimi、MCode、Qoder CLI/CN 的 `src/index.ts` 直接导出带裸命令的 ACP 实例 | 暴露显式构造工厂与静态 metadata，CLI 负责各自默认命令；删除库内零参默认安装选择，迁移所有仓内消费者 |
| CodeBuddy、Claude Code、Antigravity 的 `src/index.ts` 工厂含默认裸 command 及 probeCommand | 改为显式绑定命令，保留各自协议实现、版本/输入检查与交互；不能只修改通用 ACP 而漏掉专用实现 |
| Grok Build 的 `src/index.ts`、`src/adapter.ts`、`src/client.ts` 有独立 probe、client factory 和底层启动 | 三层一起迁移，保留 Grok 专用 RPC/反向请求；不能假设它完全复用标准 ACP adapter |
| `packages/octo-runtime-acp-client/src/index.ts:437`、Grok `src/client.ts:152` 在底层重新合并环境和 resolveProcessLaunch | 最终启动遵守宿主已经解析的执行目标；本轮 env 合并只影响子进程环境，不触发程序发现 |
| `packages/octo-runtime-adapter-sdk/src/process-launch.ts` 会解析 Windows shim、相邻 node.exe 和 PATH node | 把程序、shim、Node 选择作为宿主调用的解析步骤；Adapter 最终启动器不再调用带搜索能力的 resolver；未知 batch 不用 shell 兜底 |
| DSH `src/launch.ts` 要求绝对 dshBin；CLI `adapter-configurations.ts` 已负责 npm 安装发现 | 复用 #205 的边界，保留官方 SDK，不改成通用 command。核查显式 Node/Electron runtime 与 probe/执行同源，不凭空扩大官方 SDK 支持范围 |
| OpenClaw `src/index.ts:1393` 是 Gateway 连接，不启动 Provider CLI | 保留连接配置和连接校验，复核不夹带本地程序发现；不为统一形状新增 executable |
| `apps/cli/src/adapters.ts` 已支持工厂与 CliAdapterResource，`manifest.json` 除 Codex 外多为默认实例 | 沿用 manifest v1 的 factory/options；为内置 Provider 在 apps/cli 编写装配工厂，不把 CLI 工厂签名强加给 SDK |

## metadata 如何复用

| 现有对象/字段 | 复用方式 | 禁止赋予的新语义 |
| --- | --- | --- |
| `metadata.type/agentSources/protocolSupport/mcp/workspace` | 注册、原生输出接纳、静态展示；同一静态声明供已绑定与 unavailable Adapter 使用 | 安装策略、运行器选取、账号与权限准入 |
| `metadata.processModel/transport` | 如实描述 host-owned-engine、逐调用命令或连接方式，保持描述性 | 根据字符串创建/关闭 Engine、决定隔离或自动选择 transport |
| `ProbeResult.command/version/available/reason` | 探测已经绑定的目标，Core 沿用 providerPath/providerVersion/available 投影 | 把返回 command 当成下一轮自动重选配置；远端 command 文本不能冒充本机路径 |
| `HostedAdapterMetadata.providerPath/providerVersion` | 保持 probe 的输出结果，失败仍按原合同投影 | 反向作为构造输入、配置持久化或安装事实 |
| `AcpAdapterDefinition.args/env/protocolVersion` | 保留协议启动要求与固定环境的单一维护位置 | definition 内的裸 command 自动选择实际安装 |
| `CommandSpec.command/args/cwd/env/input/cleanup` | 保留本轮完整执行计划；新增 base argv 需求在具体绑定参数中解决，再组合到 CommandSpec | 将共享 owner.close 塞进 cleanup；把本轮计划当作安装发现规则 |

静态 metadata 导出是从现有对象中抽取同一声明，不新增第二份 requiredCapabilities/requirements 注册目录。不需要给所有第三方 Adapter 规定导出名称；CLI 的第三方 manifest 仍由显式工厂实现自己的依赖装配。

`AdapterMetadata.protocolSupport` 的编写可省略、DefinedAdapter 的补齐、HostedAdapterMetadata 的注册必填三层合同保持。CLI 生成 unavailable Adapter 也必须经过 defineAdapter 或提供完整 HostedAdapter；不能为没有安装而放宽注册校验。

## 注入合同

### 本地命令

实现复用既有 command/commandArgsPrefix/env 参数；adapter-sdk 的 ProviderLaunch 仅供宿主解析与构造快照，不成为 Engine 基类或统一注册合同。

```ts
type ProviderLaunch = Readonly<{
  command: string; // 宿主解析的绝对 executable；不接受裸名或相对路径
  args: readonly string[]; // 宿主选定 runtime/入口的前缀 argv，可为空
  env: NodeJS.ProcessEnv; // 宿主捕获的基础环境副本
}>;

const adapter = createOpenCodeAdapter({
  command: launch.command,
  commandArgsPrefix: launch.args,
  env: launch.env
});
```

组合次序固定为“宿主 executable + 宿主前缀 argv + Adapter 协议 argv”。例如 npm JS 入口的 command 是宿主选定 Node 的绝对路径，前缀 argv 是该安装内的入口文件；Adapter 追加 `acp` 或 `run --format json ...`。普通原生程序的前缀 argv 为空。probe 使用同一 executable/前缀 argv 追加 `--version`，不能对 Node 本身做版本判断后误称 Provider 可用。

CLI 调用显式宿主 helper `adapter-sdk/process-launch` 的 resolveHostProviderLaunch。它解析 PATH、Windows npm shim 和 POSIX Node 入口（包括无扩展名的简单 Node shebang）。带额外 shebang 参数的 Node 脚本要求宿主显式交付运行器和 argv，不猜测 shell 语法；其他解释器仍由宿主自行提供明确启动描述。

通用 probe 只校验已选 command 的文件类型、执行权限与启动系统错误，不解释 argv 中的脚本入口。`--version` 非零退出、超时或无有效版本只返回 `available: true, version: null`，不能把可选版本命令当作所有 Provider 的执行门禁。2026-11-10 用户明确 OpenCode 升级不应影响 octo-runtime：OpenCode 不设置最低/主版本范围，也不拒绝预发布或未知版本；实际 invoke 不执行版本探针，直接进入宿主绑定的 JSON/ACP 协议。真实协议错误与启动错误按执行结果报告，失败不改选安装；probe 不证明握手或真实调用成功。

绑定对象及 args/env 在构造时复制，避免调用方后续修改造成隐式换程序；不改全局 process.env。宿主主动换安装时重新构造依赖并处理旧 owner/会话，不从任何逐轮配置推导换绑。

最终环境仍按宿主基础 env → Run envs → 低层宿主 overrides → Adapter 固定协议 env 合并，Windows 按不区分大小写的键身份覆盖。PATH 可影响 Provider 内部工具，但不能重选 Provider executable 或选定 Node。`OPENCODE_CONFIG_CONTENT`、`OPENCODE_CLIENT`、`PWD` 继续按协议处理，不把它们误判为安装发现。源码未证明存在统一的 OPENCODE_BIN 等变量，实施不得凭空设计变量迁移表。

### client/provider/factory

Codex 继续 `createCodexAdapter({engine})`，不暴露共享 owner.close。ACP 继续复用 client factory；远程/容器宿主可以用闭包封装自己的执行位置，Adapter 不在本机 stat/probe 远端命令。其可用性由宿主提供 probe 或真实握手验证；不能因为没有本地 PATH 结果就拒绝注入的 client。

不设计统一远程执行 API。现有 factory 返回的 AcpClient 是结构类型；专项用不含 ChildProcess 的 client 完成初始化、会话、prompt 与幂等 close，且 probe 不进行本地 IO。真实远程协议及任意实现的兼容不在此结果承诺内。

宿主注入 spawn/factory 不代表必须把全部逐调用进程操作挪出协议传输层。宿主可通过显式绑定委托该传输创建、取消和释放本轮独占子进程；共享 Engine 的最终关闭权始终不随引用转移。

## CLI 装配与缺失安装

CLI 显式选中的 manifest 集合不变。在实际服务宿主或 playboard 装配时，内置包装工厂按以下顺序处理：

1. 有明确配置时，只解析该配置；非法/缺失目标返回该配置失败，不转 PATH 发现。静态形状非法在装配期报错；有效路径但文件缺失或权限失败可注册 unavailable Adapter，保留配置目标和诊断。
2. 没有明确配置时，CLI 自己按宿主环境发现默认程序。固定首个被选中的安装，版本不兼容、权限失败或入口损坏不能使 Adapter 改选下一安装；默认自动下载不在本任务内。
3. 找到可用启动目标时构造 Adapter；仅未安装/所选目标不可用时，CLI 用模块静态 metadata 和现有 defineAdapter 构造 unavailable 包装对象，probe 保留失败目标与原因。invoke 使用 runAdapterPreparation 记录没有 Provider 资源，以 ENOENT/EACCES 明确失败且不 spawn；交互 responder 只拒绝无活动请求，避免在依赖失败前误报审批能力不足。不得伪造空 command、占位 executable 或懒发现的 Adapter。
4. 不影响其他已装配 Adapter；Kernel 可启动，adapter.list 如实展示。真正的模块加载/配置形状错误保持现有启动失败及已创建资源回滚。
5. main 与 playboard 共用装配函数。帮助/版本命令不装配、不发现、不启动 Provider。服务运行期间不会自动读取后来终端 export；显式重装配后才采用新依赖。

现有 profile 的可信 providerOptions（包括 DSH dshBin）维持所属 Adapter 的配置合同；不把 executable 塞入公共 agentEnv。CLI wrapper 的安装配置来自 manifest options/自身可信配置源，优先级必须在同一个包装工厂内落实，不能让 Core 解释。

## 失败、诊断与生命周期

| 条件 | 目标行为 |
| --- | --- |
| SDK 本地工厂未传 launch / command 为空、含 NUL、非绝对路径 | 构造时 TypeError，建议稳定 reason 为 PROVIDER_LAUNCH_REQUIRED / PROVIDER_LAUNCH_INVALID；不启动探针，无 Run 时不合成 Run 失败 |
| 所选文件缺失、无执行权限或启动系统错误 | probe unavailable；invoke 保留明确失败。既有 command-not-found、permission 和 protocol 分类分别复用 OH-ADP-3002/3003/3005；新增 reason 映射须与本地专项一起维护；版本未知不属于此类失败 |
| 已固定路径后启动失败 | 保留原 errno/cause、cwd 和可安全显示的目标；ENOENT 不自动推断为 executable 缺失，cwd 也可能失效；不 fallback |
| 探针超时/取消或握手失败 | 关闭本次实际创建的探针/transport，沿用有界清理并保留 incomplete；不把 cleanup 请求当退出确认 |
| 取消本轮或关闭一个 borrowing Core | 只释放所属 transport/channel；不关闭共享 Engine、不改变 Home |
| owner 恢复 | 使用原绑定 executable/runtime；原安装失效时报告失败，宿主显式换绑前不重新扫描 |

安装发现和文件路径绑定不提供同账号沙箱或文件不可替换保证；固定路径不等于锁住文件内容。无需为本任务新增哈希信任体系。日志不记录 env、argv 中的秘密、凭据或整个绑定对象。

## 与其他任务和升级的关系

#339 的 owner/provider 分离是基础；#341 的 AgentEnv 直传保持。#343 已随 #345 合入最新基线，重跑其 100 并发专项以确认整合。owner 捕获的启动绑定保持唯一数据源。

内置无参实例及默认 command 已删除，这是 SDK 破坏性变更，无兼容层。迁移工厂、包 README、双语文档、manifest、fixtures、真实验证脚本及示例。主线已删除根 public 的 Codex/DSH 原生转发入口，不恢复这些导出。CLI 普通用户由 CLI 装配便利层获得默认选择；本轮不正式发布。
