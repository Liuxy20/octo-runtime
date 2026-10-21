---
type: Implementation
title: Issue 71 原生服务实施与验证记录
description: 记录共享服务 API、清理顺序、调用进程拓扑及实际验证结果，不扩展外部 Electron 工程。
tags: [architecture, lifecycle, testing, sdk]
status: locally-validated
---

# 当前状态

当前基线 origin/main@70f0247ac7dc00cc9729b366eba64ea8288b5b78，分支 refactor/71-unified-sdk-services。2026-10-21 拉取最新 main 并 rebase；旧分支全部未提交改动（含新增文件）保存在 stash，仅作参考。最新 main 是协议和行为基准，不能以旧分支覆盖。`134b98b`、第二轮修复 `afeea70` 和第三轮修复 `8430836` 已推送至 [PR #74](https://github.com/Mininglamp-OSS/octo-runtime/pull/74)；当前新增整改和核验见文末第四轮记录。

本次纳入 #72，保留 Gateway/Core/KernelClient 源码及其排空和失败语义，ExtraPlugins 复用 main 生命周期实现，第四轮仅修正其泛型依赖快照装配；原生服务复用相同单调预算协调清理。删除旧 launcher 后，其专有启动 ACK 测试不再适用；新增 Gateway 排空测试和真实验证脚本迁移到 createKernelService/createExtraService。真实验证脚本只做 API 迁移，本轮不执行外部 IM/Provider 操作。

此前独立评审发现：关闭过早禁用注入依赖导致终态写入失败、WebUI/WeCom 缺少公开模块迁移入口、工程规则残留依赖代理合同。本轮在 main 基线更新后，按用户授权完成三个整改项。

2026-10-21 [评审整改 OctoSpec](remediation.md) 已实施并验证 C01-C12，具体证据见文末。先新增回归复现 disposer 无法保存，再修复取消/依赖权限及并发关闭；新增三个模块的包外真实构造与静态资源验证。

createKernelService 在调用进程复用原 server、Supervisor、worker 和 AgentExecutor。createExtraService 从原 runner 抽取初始化、状态、控制端点和清理，直接注入泛型依赖；CLI run/playboard 使用相同工厂。删除旧 Kernel/Extra launcher、专用 entry 和依赖 IPC 代理；Extra 执行桥已由 main 删除。

最新 main 的 KernelClient、InvocationRegistry、Invoke 协议和三个渠道执行实现均无本地修改。旧 worktree 自加的 beginDrain/drain、KernelExecutionClient 和重复 invoke 测试不再采用；保留 main 的 cancelInvocation、交互响应、ACK 恢复和信号错误优先级。ExtraService.close 内部自动复用 client.invocations，立即停准入并排空所属调用，并发等待插件清理；插件结束或共享 4 秒单调截止到期后封锁依赖，再等待全部实际操作。初始化回滚不重开预算，incomplete 保留冲突所有权。

业务接入文档已改为先说明 KernelClient RPC：取得客户端、invoke、消费结果，按需取消和响应交互。服务托管另章说明；普通业务不构造服务、不操作登记表，也不手动 drain。SQLite 完全归宿主维护。

新增主包 /extras/channel-gateway、/extras/channel-wecom、/extras/webui 模块出口。包外 fixture 模拟宿主自行创建和关闭 SQLite，仅把查询函数注入 Extra；真实 Kernel 回归另通过注入保存函数写入终态，验证同进程调用和关闭后宿主继续查询。数据库连接未传给 SDK，也不存在 Runtime 保管或关闭数据库的职责。SDK、CLI 及架构指南同步迁移，不提供旧 API alias。

# e82a2f0 历史验证

执行平台 macOS，Node 24.19.0、pnpm 11.19.0。rebase 后 pnpm typecheck、pnpm lint、pnpm lint:names 和 pnpm format:check 通过。pnpm test:suites：Node 1316 项，1306 通过、10 跳过、0 失败；UI 35 项通过。核心 invoke 与原生服务的定向测试 49 项通过。旧测试假定 signal 取消在源终态后正常返回，现按 main 合同验证抛出原始 signal.reason，并继续确认业务尾部完成；未修改 main 的错误语义。基线与当前未提交工作树共同构成验证源码，不能把基线 SHA 当作已包含这些变更的提交。

node scripts/pack-release.mjs 生成 dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz；使用 node scripts/verify-release.mjs 对该 tgz 做离线安装、公共类型严格编译、原生 Kernel、独立 Extra、CLI Kernel 及卸载保留 Home 检查，全部通过。0.0.0 为本地验证版本，没有发布。

uv run --with pyyaml python .octospec/scripts/lint.py 通过：263 个单元、20 条规则；git diff --check 通过。Git 无未解决冲突，当前 HEAD 等于本次拉取的 origin/main@e82a2f0；原生服务改动仍为未提交工作区差异。

架构防回归包含原生 CLI/SDK PID 对照、源码 AST 禁止旧 launcher 和服务层创建顶层子进程、已删除 dist 入口检查、实际发行包公开类型及残留入口检查。静态名字检查不能独立证明架构正确，需同时通过真实调用进程 PID 测试。

本次不修改外部 Electron 项目；真实 Electron 打包、Windows 原生服务、真实 Provider/IM 未实测，保留独立证据边界，不阻塞库内交付。系统 manager 使用现有测试替身，未注册本机系统自启；数据库验证为隔离 fixture，不宣称完成生产数据迁移。现有数据不做重登记或重置。独立评审结果见当前状态，旧验证不能替代整改验收。

# 70f0247 整改前基线验证

2026-10-21 在 macOS 完成构建、类型检查、lint、format:check 和 OctoSpec 检查（271 个单元、20 条规则、1692 个本地链接）。生命周期及 #72 排空定向测试 36 项全部通过；全量 Node 1352 项中 1342 通过、10 跳过、0 失败，UI 35 项通过。git diff --check 通过，Git 无未解决冲突。

功能分支 HEAD 与本次拉取的 origin/main 均为 70f0247，双方提交差为 0/0；当前任务全部差异仍未提交。Core、KernelClient、InvocationRegistry、Kernel server、协议及三个渠道源码对 main 无差异。主 checkout 的 main 保持原状，未被合入功能改动。两个历史 stash 均保留，可追溯恢复前的现场。

本轮未重新打包或验证 tgz，未执行真实 IM/Provider；此前发行包验证仅属于 e82a2f0 基线。完成 rebase 和回归不等于三个评审问题已经整改，也不代表当前可以提交可合并 PR。

# 评审整改验证

2026-10-21 在上述 main@70f0247 工作树完成 R01/R02/R03；前两节为历史证据，本节为当前状态。C01-C12 逐项证据见[整改方案](remediation.md#本轮验收证据)。ExtraPlugins、Core、KernelClient、InvocationRegistry、协议及三个内置 Extra 执行源码保持 main 实现。

关闭立即取消所属调用并通知插件停准入；取消不封锁已有任务的收尾依赖。插件清理结束或共同截止到期后，在进入宿主函数前拒绝后续调用；全部阶段共用 4 秒单调预算，初始化回滚也不重开。最终等待清理期间新启动的真实依赖，超时和业务清理失败保留 incomplete/所有权。宿主复用同一 Promise 也按每次调用占额，128 上限不能被绕过。实际函数无法被 SDK 强停，数据库始终由宿主维护。

新增 extra-service-shutdown 回归，并把 host-sdk-lifecycle 的终态保存改成真实注入函数写入宿主 SQLite，通过 Promise gate 验证等待顺序；覆盖初始化失败/取消、保存拒绝、永不完成、截止后迟到调用、重复关闭和失败替换。Gateway #72 定向回归保留。

当前源码通过 pnpm typecheck、pnpm lint、pnpm lint:names、pnpm format:check。pnpm test:suites：Node 1362 项，1352 通过、10 跳过、0 失败；UI 35 项通过。七个生命周期/架构/启动文件定向回归 46/46。最终全量复验曾暴露启动测试在 PID 文件内容未写入时读到 0 的竞态，已改为等待有效 PID 后触发取消，未改 Kernel 清理实现。

node scripts/pack-release.mjs 生成实际 dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz，node scripts/verify-release.mjs 对其离线安装验证通过：publicTypes、三个 builtinExtras、webuiAssets、nativeKernel、independentExtra、cliKernel、uninstallPreservedHome 均为 true。隔离 consumer 只安装该主包，strict/skipLibCheck=false 编译并原生构造三个模块；空 Bot 无外部连接，WebUI 首页和引用 JS/CSS 可读取、close 后不再监听，三个公开 Schema 可读取。0.0.0 仅用于本地验证，未发布。

验证日志位于 /tmp/octo-71-remediation-{typecheck,lint,names,format,focused,tests,pack,release}.log。OctoSpec lint 通过：273 个单元、20 条规则；git diff --check 通过，结论见[本轮记录](../../journal/shared/2026-10-21-native-service-remediation.md)。未修改外部 Electron 工程，未注册本机系统服务，未执行真实 Provider/IM；不将这些库外事项作为本轮整改阻塞。尚未 commit、push 或创建 PR。

# 提交与合并授权

用户随后授权 commit、创建 PR 并合并 main。提交前重新 fetch origin/main，远端仍为 70f0247，与当前功能分支基线一致。Windows 发行验证命令已移除删除的 extra-dependency-proxy 测试，改为 extra-service-shutdown 和 native-service-architecture；实际跨平台结果以本 PR 的 GitHub 检查为准。前述“尚未提交”均为当时本地验证状态，不限制本次已授权的交付。

# PR 第二轮评审整改验证

用户授权修复后一起 commit，并要求核对 yujiawei 的最新 review。本轮基于 `134b98b`，再次 fetch 后 origin/main 仍为 `70f0247`。依据 [Jerry-Xin review](https://github.com/Mininglamp-OSS/octo-runtime/pull/74#pullrequestreview-5588602357) 和 [yujiawei review](https://github.com/Mininglamp-OSS/octo-runtime/pull/74#pullrequestreview-5588799435) 核验四项，未盲目按严重等级修改。

- R04 成立：旧实现等加载器的 disposer 超时后才开始取消，真实 Kernel 回归失败。现由插件回滚 abort 通知立即停止准入、缓存同一 drain Promise 和截止，保留原初始化 cause。新增回归验证省略可选 signal 的普通 invoke 得到原取消终态，通过注入保存函数完成收尾，disposer 成功、可替换，无关 Run 与 Kernel 实例不变。
- R05 成立：实际 CLI 子进程在挂起/拒绝 disposer 和初始化失败后均因引用 timer 不退出，旧代码在 7 秒上界失败。现仅可执行入口设置退出码并提供 250ms 最终退出余量，unref 不延长正常退出；修复后挂起清理约 4.4 秒退出 5，其余失败路径约 0.4 秒退出 5。SDK/runCli 不退出宿主。
- R06 成立：Extra 的异步控制 bind 超过截止后，旧实现漏关，gate 回归失败。现记录 binding Promise，清理操作即使已超时仍在 bind settle 后继续关闭；返回结果保持 incomplete，保留端点租约和冲突所有权。覆盖迟到成功及失败，均不发布 ready。
- R07 的 Kernel 漏关结论不成立：startKernelServer 等待 listen Promise，再检查 signal 并在 catch 中 teardown；没有并发跳过 listen 的 teardown 路径。createKernelService.close 也等待 starting。新增相同 gate 测试在修复前后都通过：取消时不能提前报告成功，绑定后关闭并释放 endpoint，允许新 Kernel 初始化。Kernel 源码保持不变。

架构第 9、11 条及生命周期规则记录回滚取消顺序、异步创建资源所有权与 CLI 最终退出边界。新增绑定回归加入 Windows CI；本机仅验证 macOS，不宣称已在 Windows/Linux 手工运行。

本轮 pnpm typecheck、lint、lint:names、format:check 通过；定向 50/50，全量 Node 1369 项中 1359 通过、10 跳过、0 失败，UI 35 项通过。重新生成实际 tgz 并通过 scripts/verify-release.mjs：offlineInstall/publicTypes/builtinExtras/webuiAssets/nativeKernel/independentExtra/cliKernel/uninstallPreservedHome 均 true。实际日志为 /tmp/octo-71-review-{typecheck,lint,names,format,focused,tests,pack,release}.log；失败对照为 review-red.log 和 bind-red.log。

本轮 OctoSpec lint 通过：273 个单元、20 条规则；git diff --check 通过。完整检查后将上述修复与回归一起提交；托管 CI 和 reviewer 重新确认独立于本地结果，不能用既有 `134b98b` 的绿色 CI 宣称新提交已通过。

# PR 第三轮：慢管道输出整改验证

依据 [Jerry-Xin 最新 review](https://github.com/Mininglamp-OSS/octo-runtime/pull/74#pullrequestreview-5588971464)，确认 `afeea70` 对全部命令安装退出 timer 的作用范围错误。对照执行旧入口和未改行为的 extraget：有效配置预期输出 700,049 字节，暂停读取 800ms 后只收到 65,536 字节，退出码仍为 0。初始回归也在旧入口失败，证明不能把有限输出刷新余量当作成功数据命令的刷新保证。

修复只涉及 CLI：既有 parse 与命令校验确认 action=run 后，通过内部 onComponentRun 通知入口选择进程策略，通知不表示 ready。index.ts 仅对该前台组件命令保留 250ms/unref 兜底；数据、帮助、状态及部署命令通过 process.exitCode 自然退出，待管道输出完成。没有重复参数解析，SDK、普通 invoke、SQLite 所有权和前两轮资源清理源码均不变。

真实 CLI 慢读取回归通过：逐字节核对完整 JSON、反序列化结果及 stderr 路径，退出 0。挂起/拒绝 disposer 和初始化失败三个残留句柄回归仍退出 5，挂起路径约 4.4 秒。41 项 CLI/生命周期/绑定/架构定向测试通过；本轮全量 Node 1370 项，1360 通过、10 跳过、0 失败，UI 35 项通过；typecheck、lint、lint:names、format:check 通过。日志为 /tmp/octo-71-output-{red,typecheck,lint,names,format,focused,tests}.log。origin/main 再次 fetch 仍为 70f0247。

本轮重新生成实际 tgz，并通过离线安装、严格包外类型、三个内置 Extra、WebUI 静态资源、原生 Kernel、独立 Extra、CLI Kernel 及卸载保留 Home 验证；日志为 /tmp/octo-71-output-{pack,release}.log。OctoSpec lint 通过：273 个单元、20 条规则、1724 个本地文件链接；git diff --check 通过。未发布发行物，未执行外部 Electron 或真实 IM/Provider。新提交的托管 CI 与 reviewer 复核独立于上述本地结果。

# PR 第四轮：类实例依赖与异步拒绝核验

核对 [yujiawei 对 8430836 的 review](https://github.com/Mininglamp-OSS/octo-runtime/pull/74#pullrequestreview-5593228740)，四项分别取证。R09 成立：createExtraService 与 ExtraPlugins.load 的对象展开都会丢失类原型方法。新增 3 项回归在修复前全部因 read/save 不是函数而失败。现共享私有浅快照函数保留继承、非枚举和 Symbol 成员，函数绑定宿主原对象，支持私有字段且不冻结宿主状态；服务继续包装权限、实际在途和共享截止。测试确认直接加载器和原生服务均可读取宿主更新、等待类方法保存；挂起的同一 Promise 仍逐次占额，超时保留 incomplete 和冲突所有权。值及访问器结果是构造时浅快照，嵌套对象不递归代理。

R10/R11 未复现：Promise.race 对全部输入注册观察器，胜出后仍消费落败分支的拒绝；微任务间延后 catch 不会单独触发 Node 的未处理拒绝判定。Kernel 的 starting?.catch 实际在传参时同步执行。新增 Extra 初始化器在清理超时返回后才拒绝、Kernel bind 在取消及 5 秒清理超时返回后才拒绝的回归，在未改 Kernel 源码的情况下通过 --unhandled-rejections=strict，保留原错误和清理结果。R12 是 R07 的重复意见：Kernel 串行等待 bind，再检查取消并 rollback，测试确认迟到成功/失败后监听关闭、owner 租约释放、允许新实例。Kernel 源码保持不变，不添加无证据的拒绝吞错分支。

52 项严格模式定向测试通过；全量 Node 1376 项，1366 通过、10 跳过、0 失败，UI 35 项通过。pnpm typecheck、lint、lint:names、format:check 通过。Windows 生命周期 CI 加入类实例回归并启用严格拒绝模式；本地执行平台仍为 macOS。失败对照为 /tmp/octo-71-review4-red.log，严格拒绝修复前对照为 review4-rejection-before.log，当前日志为 /tmp/octo-71-review4-{typecheck,lint,names,format,focused,full}.log。

重新生成实际主包 tgz 并通过 scripts/verify-release.mjs，offlineInstall/publicTypes/builtinExtras/webuiAssets/nativeKernel/independentExtra/cliKernel/uninstallPreservedHome 均 true。包外 strict fixture 通过类实例方法读取宿主 SQLite，宿主随后自行查询和关闭数据库。日志为 /tmp/octo-71-review4-{pack,release}.log。OctoSpec lint 通过：273 个单元、20 条规则、1726 个本地文件链接；git diff --check 通过。托管 CI 和 reviewer 复核以新提交为准；未发布发行物、未执行外部 Electron 或真实 IM/Provider。
