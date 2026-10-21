---
type: Journal
title: Issue 75 CLI 独立服务与真机验证
description: 记录普通用户产品策略、install 默认自启、状态输出及 launchd 最小修复。
tags: [cli, lifecycle, installation, testing]
timestamp: 2026-10-21T00:00:00Z
---

# 实施范围

从最新 origin/main@0c1d1c99c90a85c715212de6e55858a41924f058 新建 worktree octo-runtime-issue-75，分支 fix/75-cli-lifecycle，处理 [Issue 75](https://github.com/Mininglamp-OSS/octo-runtime/issues/75)。[任务合同](../../tasks/75-cli-lifecycle/brief.md)与 context.yaml 记录范围及实际读取的规则。本轮未创建 Git 提交、PR 或发布 npm。

CLI 继续通过 resolveServiceControl → createServiceBackend 使用仓库的 @mininglamp-oss/octo-runtime-cross-service；Kernel 与各 Extra 分别作为原生用户服务运行 CLI run 入口，各入口直接调用共享 SDK 构造服务。没有新增服务管理库或替代 launcher。

- 按用户明确的普通用户定位，install 默认注册并开启本组件自启，首次和重复安装相同；只有显式 --autostart=false 才禁用，再次普通 install 恢复开启。各组件单独启停、自启，启动次序互不约束。
- 沿用 cross-service 的平台启用/禁用语义，显式禁用后的 start/restart 保留 SERVICE_DISABLED 并给出恢复命令。没有 plist 目录迁移、Windows 触发器改造或 Linux 手动启动语义变更；cross-service 仅改 launchd.ts 一个文件（+19/-6）。
- 裸内置组件显示帮助，组件 status 与汇总 status 均可用。已配置 Extra 按注册名管理；状态查询不导入插件模块，继续调用每个 Extra 的公开 status。管理器查询失败不跳过 IPC 状态。
- 默认状态输出紧凑文本，展示原生状态、IPC、worker、Kernel 可用性及 Bot 业务健康和任务/队列/保留集合计数；--json 输出缩进完整公开结果。extraget 保留紧凑 JSON，playboard 保留 NDJSON。
- 错误保留稳定 code、受控 cause_code、组件、动作和日志位置。前台初始化错误经既有 RuntimeLogging 白名单与小时轮转落盘，后台启动只读取本次尝试后的有限日志尾部；不捕获任意 stdout/stderr，不打印完整异常或配置。

# 真机发现与修复

本机 launchctl print-disabled 使用 enabled/disabled 字面量，与已有 true/false fixture 不同。解析已兼容四种字面量；禁用服务不会被误报为启用，普通 install 按默认开启设置恢复既有禁用服务。

连续切换自启并快速 stop/start 曾出现 COMPONENT_UNAVAILABLE：launchctl bootout 默认在卸载完成前返回，紧随的 start 可能 kickstart 尚在退出的旧 job。cross-service 现在有界等待旧 job 从 manager 消失，随后才返回或 bootstrap。增加异步卸载 fixture，最终真机连续三轮快速停启及 stopped 状态断言通过。未通过无限等待的 bootout --wait 掩盖问题。

# 产品策略修订

最初沿用仓库“首次安装不自启”的前提，并为手动启动改造三个平台后端。用户明确“install 就默认开机自启，用户是普通用户”后，已收回这部分公共语义改造。现行策略持久记录在[架构产品规则](../../rules/architecture.md#cli-面向普通用户的产品默认值)，生命周期、CLI 帮助/指南和验收同步。普通用户无需猜测 enable 或隐藏启动前提，默认输出易读，组件启动顺序由程序处理；高级开关显式提供。

此前 104 条真机检查的 /tmp/oc75-live-UExeMq/evidence.json 仅为已撤回方案的历史证据，不作为现行默认自启方案的验收。

# 默认自启方案验证（自动安装补充前）

- 构建、根 TypeScript noEmit、ESLint、命名检查通过。
- 定向 CLI 默认自启/状态/cross-service 回归 21 项通过。
- 最终全量 Node 1386 项中 1376 通过、10 条件跳过、0 失败；WebUI 35 项通过。
- 使用 scripts/pack-release.mjs 生成完整 tgz，并以 npm install --global --prefix /tmp/octo75-npm.TkutU4 --offline --ignore-scripts 安装至隔离 npm prefix；没有替换用户已有全局包。
- 最终发行包真机验收 119 条命令通过，证据位于 /tmp/oc75-live-3DYIIC/evidence.json，输出位于 /tmp/octo75-autostart-native.log。所有本次服务和定义已卸载，隔离 Home 已清理，证据保留。
- 同一脚本在独立旧 Home 复现用户已有全局版本：默认 executor-kernel install 后 start 返回 COMMAND_FAILED。候选版在缺失显式 manifest 时返回 ENOENT，受控启动日志包含原始稳定码。
- scripts/verify-cli-services-live.mjs 覆盖默认开启安装、手动 start/restart、重复 install、显式 false 拒绝启动、普通 install 恢复开启、保持运行进程的重复安装、Extra 先启动、Kernel 先启动、Kernel 下线后重连、独立重启、文本/JSON 汇总、卸载保留数据标记；使用本机真实 launchd、真实 Kernel/worker 和真实 Gateway/WeCom 模块。
- 另外只读查询用户默认 Home：候选版读到既有前台 Gateway PID 24771 与 4 个 Bot 的自身状态及任务/投递计数；PID 和启动时间保持不变。该快照的 Bot 业务连接失败、Kernel 不可用是现有运行状态，不作为本轮修复后的健康成功证据。未重启该进程或修改其配置。

本轮测试输出：/tmp/octo75-autostart-full.log、/tmp/octo75-autostart-focused.log、/tmp/octo75-autostart-checks.log、/tmp/octo75-autostart-native.log。记录不包含凭据或完整配置。

# start 自动安装、用途帮助与英文 README

用户试用时指出 channel-gateway start 返回 SERVICE_NOT_INSTALLED 不符合普通用户预期，明确要求未安装时默认安装并打印额外日志。现由 CLI 在组件 setup 锁内 inspect，未安装时复用 cross-service install(enabled=true)，随后 start 并等待 IPC 就绪；只处理当前组件，保留 profile/manifest 参数。安装失败不调用 start；已有服务不重新安装或修改显式禁用设置。restart 仍要求已安装。

stderr 依次输出 service not installed; installing with autostart enabled 和 installation complete; starting service。最终成功/失败结果沿既有输出接口提供；--json 的 stdout 保持单个可解析 JSON。实际安装尚未成功时不打印完成进度。无需增加公共服务后端改动。

用户要求帮助说明模块用途，现 executor-kernel、channel-gateway、channel-wecom、webui 均先介绍用途，再给出配置/启动入口；全局命令逐一人工查看 Kernel/Gateway 帮助通过。根 README 按用户指定参考项目的介绍与快速开始结构改为英文，依次说明真实 npm 包、Gateway 配置、start/status，并提供 Executor Kernel、Channel Gateway IPC、外部 Loop Daemon IPC 的核心架构图。仓库没有内置 Loop Daemon 命令，正文明确其为仓外业务集成，未新增虚构命令。

按用户此前授权，npm link 已将全局 @mininglamp-oss/octo-runtime 指向 /Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-75；这次构建后全局 bin 直接使用新行为。link 时原全局安装目录已不存在，没有可备份的旧包。测试不修改默认 Home 的配置或业务进程。

- 构建、TypeScript noEmit、ESLint、格式、命名、git diff --check 通过。
- 自动安装成功、失败中止、profile/manifest 保留、重复 start 不重装、JSON/进度分离与既有 cross-service 定向 25 项通过。
- 再次全量 Node 1386 项：1376 通过、10 条件跳过、0 失败；WebUI 35 项通过。
- 以已 link 的全局 bin 执行真实 macOS launchd 验收 118 条命令通过，证据 /tmp/oc75-live-KZKZyR/evidence.json。Kernel/Gateway/WeCom 均从未安装直接 start，校验 stderr 两阶段日志、默认自启、JSON 可解析、Extra 先启动时 Kernel 仍未安装、重复 start 无安装日志及双顺序/独立重启/禁用恢复等既有流程。临时服务与 Home 均已清理。
- 输出：/tmp/octo75-auto-install-build.log、/tmp/octo75-auto-install-focused.log、/tmp/octo75-auto-install-full.log、/tmp/octo75-auto-install-native.log；现行方案仍未提交、推送或发布。

# start/restart 返回完整状态

用户明确启动/重启结果至少应包含 status 所展示的服务、自启、IPC、Manager、PID、Worker 和定义路径。成功分支现复用 snapshot 与 formatStatus，保留操作回执与日志位置，并展示与本组件 status 相同的完整状态区块。JSON 保留 component/action/service，并新增与 status 相同的 runtime 数据；Extra 的 Bot、任务等业务字段继续通过自身 IPC 状态返回，没有新增一套状态推导逻辑。其他服务动作不受此输出补充影响，公共 cross-service 无新增改动。

- CLI 包构建、根 TypeScript noEmit、定向 ESLint、格式与 diff 检查通过；28 项 CLI 测试通过，覆盖 start/restart 文本与 status 相同以及 JSON 业务状态。
- 已 link 的全局 CLI 真机 launchd 118 条命令通过，证据 /tmp/oc75-live-2eguUu/evidence.json；新增断言覆盖 Kernel 文本中的 running/autostart/IPC/PID/Worker/Definition、Extra 文本 Bot 计数及三个组件 restart JSON 中的 runtime 数据。
- 输出：/tmp/octo75-start-status-build.log、/tmp/octo75-start-status-tests.log、/tmp/octo75-start-status-native.log。临时服务与 Home 已清理，未操作默认业务实例；全局命令已使用本次构建。尚未提交、推送或发布。

# 回执状态只展示总数

用户看到 cardDeliveries 的 effectKey/messageId 列表后担心内存增长。源码确认 Gateway/WeCom 每个投递器原有最多 512 条回执缓存，非全部消息永久累积；512 是容量选择，不是协议强制。用户进一步明确本项只需 status 展示现有总数，投递机制保持不变。据此没有交付过程卡缓存绕过、累计状态计数或回执保留策略改造。

Gateway cardDeliveries、Gateway/WeCom deliveries 现直接读取内部 Map.size，返回数字，不再复制或公开完整回执列表；没有改变原有投递、重试、消息 ID、去重或 512 条淘汰逻辑。数字表示当前保留回执数，不是累计发送量。SDK/CLI 使用同一 Extra 状态，文本与 JSON 均如此。

- 构建、TypeScript noEmit、ESLint、改动文件格式与 git diff --check 通过。
- 新增 Gateway/WeCom 万次投递回归，验证缓存保持 512 条、重复 effect 不重复发送、在途/未知回执计数及无明细状态；卡片创建/编辑原消息回归保持通过，CLI 文本与 JSON 校验非零数量。
- 全量 Node 1391 项：1381 通过、10 条件跳过、0 失败；WebUI 35 项通过。最终输出 /tmp/octo75-delivery-counts-full.log。
- 已 link 的全局 CLI 在隔离 Home 启动真实 Gateway 用户服务，status 的 JSON/文本均返回数字 0，输出 /tmp/octo75-delivery-counts-native.log。测试 Bot 故意未提供凭据，状态 failed；此处只验真实服务/IPC 状态，不发送外部消息、不宣称 Bot 连通。临时服务与 Home 已清理。
- 默认业务 Gateway 没有被重启；其既有进程仍运行旧代码，需用户在合适时机执行 channel-gateway restart 后读取新状态。尚未提交、推送或发布。

# 验证边界

本轮没有重启电脑或注销用户，因此用户登录时自动激活仅验证了真实原生定义与两种激活顺序，未宣称实际重登验收。Windows Task Scheduler 和 Linux systemd 使用后端 fixture 回归，未在对应原生系统执行。生命周期真机服务采用空 bots 配置，回执数量检查另用未提供凭据的测试 Bot，未以此宣称真实 IM/Provider 业务调用成功；默认 Home 的业务状态仅作只读状态展示核验。

# 用户验收与交付授权

用户确认试用没有问题，要求解除全局链接并将当前 worktree 提交 PR、合并 main。已执行 npm unlink --global @mininglamp-oss/octo-runtime，确认 PATH 中不再有 octo-runtime；保留默认业务进程与配置。授权范围包括提交、推送、PR 和正常合并，不包括 npm 发布或绕过仓库保护。

最终全仓格式与命名检查通过。交付前拉取 main，发现新增 #76 的宿主会话存储实现，需在提交后整合并重新验证；GitHub CI 与审批结果以 PR 为准。

已 rebase 到 main@d44f5cd，保留宿主会话存储合同；冲突仅涉及索引及无状态规则文档，双方内容均保留。整合后构建、TypeScript、ESLint 与全量测试通过：Node 1416 通过、10 跳过，UI 35 通过，输出 /tmp/octo75-pr-integrated-tests.log。PR #80 首轮 Windows 发行包检查暴露 verify-release 仍断言旧的 stdout 错误、start 不安装与默认 JSON 合同；脚本改为文本错误检查 stderr、未安装 restart 显式 JSON、status/run 显式 JSON，并增加裸组件帮助和默认文本状态验证。自动安装仍由 CLI 回归及隔离原生生命周期脚本覆盖，离线包验证不新增系统服务。

修正后重新打包并在空 npm 缓存、隔离 prefix/Home 中通过 verify-release：离线安装、公共类型、内置 Extra/WebUI、宿主会话存储、真实 Kernel/CLI 与卸载保留 Home 均通过，输出 /tmp/octo75-pr-offline.log。此验证未重新 link 全局。

# PR 80 评审整改与再次整合 main

用户要求先整合最新远端 main，再查看评审。已 rebase 到 main@43cdee7（#79 双语开发文档），保留双语文档入口、根 README 作为 npm README 的装包策略及已删除的 release/README.md。根 README 保持英文快速开始与 IPC 图，并使用可在发行包中打开的仓库链接；同步双语 CLI 指南的默认自启与显式 JSON 合同。

评审指出的三个 P1 及一个 P2 已落实：

- install/start/restart/stop/uninstall 共用组件 setup lock，覆盖 inspect、修改、就绪与最终状态确认。同组件并发请求返回 SETUP_IN_PROGRESS 和重试提示，不调用管理器；不同组件仍独立。
- 前台服务通过统一幂等终态处理 initialize 失败、意外 closed、closed 拒绝和 signal；移除监听、取消初始化、确认清理并记录/输出受控失败一次，原始初始化失败不被清理拒绝吞掉。
- systemd uninstall 停止/禁用失败传播，删除前确认 inactive/failed 与 MainPID=0；Windows /End 后等待旧任务停止再删除或启动替换。/End、/Delete、权限/管理器失败不视为成功；/Query 非零通过 Task Scheduler 原生 HRESULT 确认缺失，不依赖本地化文字。Windows 重装停止失败时保留旧 sidecar。
- 启动后不再以 manager 的历史 LastTaskResult/ExecMainStatus 判定新启动失败，无本次日志失败证据就保留就绪预算。定向测试模拟旧失败仍被读取、随后 IPC 成功的延迟启动；不冒充原生 Windows 复现。

本地构建、TypeScript、lint、命名、格式与 docs:check 通过。首轮整改全量 Node 1436 通过、10 跳过，UI 35 通过，输出 /tmp/octo80-review-full.log；之后补充 systemd 失败状态查询和 Windows 重装失败保护回归。macOS launchd 118 条命令通过，证据 /tmp/oc75-live-cwsm5V/evidence.json，临时服务/Home 已清理，未操作默认实例或恢复全局链接。Linux/Windows 后端故障由确定性 fixture 覆盖；本机仍未执行其原生服务注册、实际重登或真实 IM/Provider 调用。

最终代码再次全量验证：Node 1438 通过、10 跳过、0 失败，UI 35 通过，输出 /tmp/octo80-review-final-full.log；最终后端/CLI lint 与 diff 检查通过。更新远端使用显式旧 head 的 force-with-lease，避免覆盖他人提交；后续发行包与 GitHub 检查结果记录在 PR。
