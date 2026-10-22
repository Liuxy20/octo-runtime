---
type: Implementation
title: Issue 93 实施与验证记录
description: 按阶段记录实际完成、提交及未完成的事故和平台验收门槛。
tags: [testing, lifecycle, channel, ipc]
timestamp: 2026-10-22T00:00:00Z
---

# 授权与环境

用户授权实施，每个阶段独立英文 commit；保留 Git 作者 `superalsrk <lvsijia@mininglamp.com>`，每条提交追加一次 Codex co-author trailer。没有 push、PR、发布或修改运行中用户服务的授权。

本机：macOS 26.6.2 (25G83)、arm64、Node 24.19.0、pnpm 11.19.0。此为执行本任务的环境，不宣称是报告事故环境。独立 worktree 基于 `3b34415`，原 main 不改动。测试使用临时 endpoint/Home 与 fake Provider，不读取或重置用户身份和凭据。

| 阶段 | 状态 | 实际证据 |
| --- | --- | --- |
| M0 调查基线 | 文档与本地源码调查完成；事故现场门槛待外部信息 | F01-F17、H1-H6 已定位；reason12 有本地 IM 源码线索，但部署版本未核实；未执行真实一小时合盖 |
| M1 故障工具 | 隔离工具完成；真实 checkpoint 由维护者执行 | 真实 IPC relay 交叉矩阵、公共发行入口 native host 与 attach-only 探针 |
| M2 Gateway | 隔离回归完成；reason12 部署门槛保留 | 首次暂态离线恢复、5/10/15/15 秒，25 项连接状态/真实 WS 测试通过 |
| M3 执行链 | 受控缺陷修复完成；原事故根因仍待确认 | 修复前长时钟间隔误替换 generation 1→2；修复后保持1，10项回归通过 |
| M4 状态日志 | 实现及定向验证完成 | Extra状态stdout、独立镜像、logs tail/follow；40项回归及build/lint/docs/format通过 |
| M5 双模式实测 | CLI/SDK受控端到端通过；真实矩阵未完成 | loopback加密WS→Gateway→Kernel→fake Provider→IM回复，离线启动/断线/active worker loss均恢复新工作 |
| M6 交付检查 | 自动检查与包外验证完成；P0现场门槛未关闭 | 35项UI、1470项Node通过，32项跳过；lint/types/docs/format及离线tgz公共入口验证通过 |
| M7 Kernel持续恢复 | 实现与自动验证完成；现场门槛保留 | 串行15秒冷却恢复、清理失败阻断；35项UI与1472项Node通过、32项跳过，包外验证通过 |

## M0

规划知识格式验证通过（296个OKF单元），上下文11条规则指纹通过；完整仓库知识检查仍只有既有 `docs` 目录断言冲突。已向用户请求报告构建、Provider/Adapter、专用测试Bot及部署版本；在等待时继续无依赖的隔离实现。

当前无法从报告确认原 Kernel listener、worker、Provider 或观察层的哪一层故障；不将候选监督时序修复冒充原事故根因。reason12 保留终态，除非后续证据支持安全区分暂态与有效 owner 替换。P0关闭仍受原验收合同约束。

## M1

用户补充：事故使用 npm 发布的 `1.1.0`，Provider 范围为全部，本地 Extra 配置有测试 Bot。部署 IM 版本仍未知。配置只用于后续本地受控试验，不把凭据写入证据或 Git。

新增 `kernel-recovery-matrix.test.js`：同一真实 Kernel 经 relay 丢 ACK 和订阅连接，验证一次 Provider start、连续完成，再交叉旧/新 client 与旧/新 session，检查 instance 和 worker generation 不变。复用已有半开/黑洞/worker 失联 fixture，不创建另一套协议。

`recovery-kernel-probe.mts` 与 `recovery-native-host.mts` 只使用公共包入口，探针不启动服务、不重试 invoke、不输出聊天正文。native 宿主直接持有 factory。没有自动切换网络、合盖或原生服务；原计划 live runner 延后到实际专用目标和人工 checkpoint 就绪，避免把配置存在当作真实试验成功。

验证：workspace build 通过；既有 invoke 27 项通过；新增交叉矩阵 1 项通过；两个公共入口工具 strict TypeScript 编译通过。fake Provider 结果不替代真实 IM/Provider 证据。

## M2

首次暂态连接失败不再要求历史 online；认证、明确终端拒绝和未知协议仍停止。每连接仅一个计时器，回收成功后按 5/10/15/15 秒等待，成功归零；Retry-After、超长 timer 分段、延迟回调不追赶、停止 fence 保留。增加 connecting/retry_started/retry_scheduled 元数据事件，M4 接入状态专用输出。构建与 25 项状态机/真实 WS 测试通过；reason12 仍终态，不能将本阶段写成原事故已经恢复。

## M3

先在未修复构建执行长 wall clock 间隔测试：健康 worker 在新探测前被替换，断言 generation 1 实际2，构成受控复现；这不是 OS 真睡眠，也不能据此确认原事故。

新增私有 WorkerHeartbeat：wall/monotonic 长间隔和回拨均触发新序号探测，保留完整5秒响应窗口；旧/迟到 pong 不能刷新期限，正常 tick 不延长在途期限。serveWorker 只回显合法私有 probe，不改业务协议，不向 worker stdout 写状态。重启预算按活跃观测时间，休眠不能重置。真正主循环阻塞仍被替换，worker丢失仍只产生唯一lost，不重跑旧执行。

构建通过；10项心跳、真实worker监督和交叉矩阵测试通过，包括真实15秒阻塞、三次预算耗尽、旧Run唯一lost和新工作恢复。四个本地Bot指向生产IM；未在这些连接上自动执行集成试验，im-test部署版本仍缺失。

## M4

用户追加要求：本次核心逻辑使用英文注释，覆盖调度间隔、新probe期限、资源所有权、旧回调隔离、日志白名单与背压；文档仍使用中文，OSS提交英文。

RuntimeLogging独立构建不可变Extra状态记录，sink和磁盘失败独立退化；callback不进入workerData。服务记录生命周期，单个在途Kernel探测完成后5秒再检查且只打印转换；Gateway输出连接和重试元数据。状态镜像与普通执行日志分开，沿用HourlyLog三份/每份100MiB。stdout最多128条/1MiB，恢复后报告丢弃数。

CLI新增 `<extra> logs --lines 1..10000 --follow --json`，默认200条，JSON为NDJSON；在解析Home配置、加载模块和创建管理器前路由。最多读最近三份4MiB，重建白名单、忽略非状态记录和符号链接文件，follow处理部分行、轮转和取消。空日志成功并提示stderr。中英文排障文档、CLI/SDK指南和受影响规则同步更新。

验证：build、lint、format检查通过；40项定向测试通过（状态隔离/镜像、慢stdout、损坏配置下读取、follow取消/轮转、生命周期关闭、小时保留与容量）；docs检查通过（17对页面、35个Markdown、18个JSON样例、16个Mermaid和4个运行测试）。先前lint与clean/build并行造成声明暂时缺失，构建后单独重跑通过；不计为产品故障。

## M5

新增同一loopback加密IM fixture分别接CLI独立进程与SDK原生factory，使用实际Gateway/Kernel/worker、fake Provider。每种模式先503离线启动，恢复后收到第一条真实fixture IM回复；断开WS后自动重连，再收到新回复；active调用期间杀测试worker，监督恢复后新IM请求完成。分别确认Kernel instance/PID与Extra PID不变，四次实际Provider admission均唯一，未知旧任务不重跑；再对同Kernel交叉旧/新client与旧/新session完成四次直接IPC调用。

CLI模式约15.0秒、SDK模式约14.8秒通过；此计时包括主动等待两段5秒退避和未知结果清理，不是线上SLA。CLI fixture配置改用0600后通过；最初失败是测试配置权限错误，SDK首次已通过。CLI信号注入场景在Windows跳过，不能据此宣称Windows验证通过。

按用户轮转要求增加状态专用系列的五小时测试：任意时刻最多三份，最终只保留02/03/04三个小时，普通日志不被状态系列删除。现有100MiB封顶、无溢出分片、跨进程互斥测试继续适用。

发行验证扩展公共状态记录类型、原生sink回调和attach-only探针；实际tgz strict编译及运行安排在M6，不预先宣称成功。

真实S01-S14矩阵仍全部缺现场证据：没有合盖、切换用户网络、重启用户系统、竞争生产Bot owner或发真实IM消息。M5受控试验覆盖S01/S05/S08/S09/S11中的部分路径，不替代一小时/隔夜、电源条件、DM/群/话题、多Bot、登录自启、真实Provider与IM部署，以及Windows/Linux证据。

## M6

2026-10-22，本机对代码提交 `0265807fdafa9a7f75b11bb050e631bd2a7a3bde` 执行 `pnpm test`：完整构建通过；35项UI通过，Node共1502项、1470通过、32跳过、0失败。两种模式的本地加密IM端到端包含在本次全量执行中。跳过项不计为通过。随后lint、名称检查、根TypeScript、docs和format全部通过；docs另含4项运行检查。

`node scripts/pack-release.mjs` 生成本地占位版本 `dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`；没有改源版本或发布。执行 `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 0265807fdafa9a7f75b11bb050e631bd2a7a3bde --require-clean` 成功。验证器在workspace外、空npm缓存下离线安装，确认公共类型strict编译、三个内置Extra、WebUI资源、原生Kernel、独立Extra、状态sink、直接恢复探针、CLI Kernel和卸载保留Home。包内build-info指向干净M5代码提交，后续M6提交只收尾知识记录。

复核改动边界：Gateway没有控制Kernel重启；SDK没有通过CLI代启服务；未知旧调用没有重放；没有新增原生依赖或聊天持久化。新增核心注释为英文。状态日志沿用既有小时轮转和容量控制，每个Extra状态系列最多3个实际文件、每个100MiB，因此系列上限300MiB；普通元数据系列独立保留，不能把此上限解释为整个Home磁盘上限。stdout及worker队列独立有界，磁盘/输出失败不等待业务恢复。

最终知识校验：上游OctoSpec检查通过297个OKF单元；11条规则的新SHA-256指纹、A01-A27实施映射与diff空白检查通过。仓库自有知识lint仍仅报既有 `已退出的文档目录仍存在: docs`，不作为新增实现回归，也不声称该检查通过。

### 验收映射

以下“受控通过”仅针对列出的自动化边界；涉及现场的完整断言不因此自动PASS。所有证据为本仓测试源码、上述构建提交与2026-10-22运行结果；没有生产聊天或凭据附件。

| 断言 | 实际证据与结论 | 剩余边界 |
| --- | --- | --- |
| A01/A02 | 受控通过：`im-connection-state-machine.test.js` 首次暂态失败、退避、Retry-After；`recovery-dual-mode.test.js` CLI/SDK离线503后新IM完成 | 真实网络/部署恢复计时待测 |
| A03 | 未执行部署验收；reason12保持终态 | 核实部署IM版本、owner与Token触发语义后决定安全恢复策略 |
| A04/A05 | 连接状态机受控通过：WS失联、迟到回调、abort和清理失败；双模式断开后新IM完成 | 真实睡眠、黑洞与网络切换待测 |
| A06 | 部分：Gateway离线启动恢复和同对象新调用通过 | Gateway先于Kernel等完整启动顺序未覆盖 |
| A07 | 事故现场未复现，已提供attach-only公共探针 | listener/worker/Provider/观察层的原事故边界未确认 |
| A08/A09 | 受控通过：`kernel-heartbeat.test.js`、`kernel-worker-supervision.test.js` 时钟间隔/回拨、probe fence、真实worker阻塞/快速替换限速；M7新增持续失败低频恢复与清理阻断；双模式active worker loss后新IM完成 | OS实际暂停及恢复时序待测 |
| A10/A11 | 既有invoke/订阅回归与新增 `kernel-recovery-matrix.test.js` 通过；丢ACK与订阅断线只接纳一次 | 不替代真实Provider副作用和部署消息重放合同 |
| A12 | CLI/SDK各自四组client/session交叉、新IM完成且Kernel实例和服务PID保留；实际Provider admission唯一 | 长时/真实渠道重复循环待测 |
| A13 | 部分：两种模式受控场景均完成direct与IM调用 | 180秒现场SLA及所有可恢复故障尚未验收 |
| A14 | 受控通过：SDK服务PID等于宿主，公共tgz工厂、类型与探针通过 | 实际SDK宿主自启和睡眠待测 |
| A15/A16/A17 | 现场合同未执行；单次受控去重/恢复不视为长期资源或完整补偿证据 | 登录自启、部署重放与至少十次资源循环待测 |
| A18/A19 | `extra-status-logs.test.js`及两模式回归通过：stdout/sink、镜像、白名单、隐私；默认SDK不配输出sink | 后台原生服务实机对照待测 |
| A20/A21/A22 | 受控通过：tail参数/坏配置/空日志/读取限额、partial line/follow/轮转/取消/符号链接、慢stdout、磁盘失败、三份保留和既有容量上限 | 非所有组合均单独注入；多平台后台输出行为待测 |
| A23/A24 | 部分：共同状态镜像、生命周期/Kernel/连接状态及安全码实现与回归通过 | Windows/Linux后台和事故分层诊断未实测 |
| A25/A26 | 自动门槛通过：全量build/tests、lint/names/types/docs/format和离线tgz；复核拓扑与改动范围 | 仓库知识lint仍有既有docs目录断言冲突，单独记录 |
| A27 | 未满足，不关闭P0 | 两层原事故边界、reason12安全策略及真实矩阵仍缺证据 |

### 后续现场入口

由运行环境维护者在issue #93补充原IM部署版本与可隔离的测试部署；本地配置的四个Bot均指向生产地址，不能直接当成im-test。使用 `test-support/recovery-kernel-probe.mts` 保留原client，并对旧/新session分别验证；SDK宿主入口为 `test-support/recovery-native-host.mts`。按acceptance的证据字段逐行执行S01-S14，分别保存CLI与SDK结果、真实Provider admission计数和旧调用结论。macOS合盖/隔夜/电源、Windows/Linux和登录自启由具备对应环境的维护者执行；这些缺口影响恢复保证，记录缺口不等于验收通过。

95分是规划可执行性的自评，不代表修复成功率、根因确定性或P0完成度。当前交付可评审的共享层修复、诊断日志和隔离证据，保留现场门槛。

## M7 复核后补充修复

用户要求复核Kernel本地监听与断网/休眠的关系，进一步要求修复永久exhausted。复核确认本地Unix socket/Windows Pipe不以网络为前提；200次本地status后新调用完成，未发现该路径的连接积累。隔离试验禁止Kernel/worker发TCP、DNS和fetch请求，模拟Provider网络错误只失败当前Run；同时SIGSTOP两进程6.2秒再恢复，原Kernel instance与worker PID不变、旧活动调用可确认取消、新调用完成。该暂停试验不是OS真实合盖证据。

本阶段合同：保留最多三次快速替换的250/1000/4000ms退避；三次快速尝试均失败且旧进程及所有权记录均已确认回收后，保持recovering，每次15秒冷却后只启动一个worker。冷却与启动串行，失败后重新等待15秒，不因status/invoke并发触发额外启动，休眠回调不补跑。成功启动不立即重置低频策略，须连续健康观测60秒才恢复快速重试。Kernel进程、instance和监听端点不重建，未知旧执行不重放。旧worker清理、启动回滚或所有权确认失败保留exhausted并报告close失败；close取消冷却，不允许迟到启动。

实际验证：心跳/监督/持续恢复/交叉矩阵共12项通过。四次worker故障后的快速尝试耗尽不再锁死，15秒后同Kernel instance/PID的新调用完成；短暂恢复后再次故障仍使用低频策略，close在2秒内取消冷却。fixture模拟持续readiness失败，实际启动记录确认两次低频启动分别至少间隔15秒；移除故障后自动恢复，旧Run仍为lost。对测试worker进程组注入EPERM，确认进入exhausted、没有替换，close仍报告失败。

2026-10-22再次执行全量 `pnpm test`：35项UI通过，Node共1504项、1472通过、32跳过、0失败；其中包含CLI与SDK加密IM恢复。lint/names、根TypeScript、docs与format通过。重新打包当前工作树的0.0.0 tgz，包外离线安装、strict类型、原生Kernel/Extra、CLI与公共恢复探针验证通过；包内build-info如实标记基于 `717dc5ad0a1c09c0f9930c752c09b84b71015bbc` 的dirty构建，本次没有宣称干净发行版本或发布。首次验证命令误填expected-commit，因SHA不匹配被拒绝；改为实际父提交SHA后通过，没有修改校验器或包内容来绕过检查。

这里的快速次数限制仅防止worker启动/崩溃循环，IPC请求不受该计数影响。普通Provider网络错误不触发worker替换；重试不关闭或重绑本地监听。M7修复一个确定的永久不可用机制，不能据此确认原事故根因；S01-S14现场门槛保持开放。

## M8 同步 main 与提交 PR

用户授权从最新main rebase当前分支、提交英文PR并合入main；未授权发布npm。2026-10-22获取 `origin/main@d076474673b1aac542b08940d987c5598e5a4968`，包含WebUI Windows会话保存修复 #94；八个阶段提交无冲突完成rebase，产品提交为 `40598e8`。前文SHA保留为当时的验证证据，当前基线和授权已更新到context。

rebase后全量 `pnpm test` 通过：35项UI通过；Node共1522项、1488通过、34跳过、0失败。lint、名称、根TypeScript、docs和format检查通过，工作树没有生成物漂移。新增跳过项来自main中的原生Windows文件锁测试，在本机macOS没有执行。

main保护要求CI Gate通过和至少一位审阅者批准，且管理员也受约束；仓库关闭自动合并。后续按保护完成推送、PR和合并，不修改保护。PR以Refs #93关联；原事故根因、部署reason12语义和S01-S14仍缺现场证据，本次不关闭P0。

## M9 PR 96 Windows 测试覆盖补充

[PR #96](https://github.com/Mininglamp-OSS/octo-runtime/pull/96) 的 `bdcfa94537caba1ec9dd2d116a5d698d8ea911bc` 已完成全部六组平台/Node任务、CI Gate和代码审查检查，并获得Jerry-Xin批准。评审没有阻塞项，P3建议将新增恢复与状态日志测试纳入Windows显式列表；用户授权补充。用户同时明确以后由其手动merge，本次及后续跟进均不得代为合并；推送后须重新检查批准和CI，不沿用旧提交的就绪结论。

Windows Node 24/26矩阵新增独立步骤，以 `--unhandled-rejections=strict --test` 执行 `extra-status-logs`、`kernel-heartbeat`、`kernel-worker-recovery`、`im-connection-state-machine` 和 `recovery-dual-mode` 五个文件。覆盖状态白名单、stdout背压、磁盘失败、三份轮转和follow，心跳调度间隔、readiness持续失败后恢复、首次离线/WS恢复及SDK实际loopback IM链路。沿用原有CLI信号场景和POSIX进程组注入的Windows skip，SDK场景正常执行；没有新增跳过、放宽断言或更改生产代码。

本机macOS执行与新步骤相同的命令：40项通过，0跳过、0失败；CI配置与说明的Prettier检查、diff空白检查通过。Windows结果须以更新后远端两组任务为准，不将本机通过写成Windows通过。`.github/CI.md`已同步覆盖和平台边界；真实S01-S14仍开放。
