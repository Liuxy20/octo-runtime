---
type: Plan
title: Issue 93 分阶段修复与验证计划
description: 七个可独立评审的里程碑，包含输入、文件、动作、退出门槛与失败处理。
tags: [architecture, lifecycle, channel, ipc, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 执行顺序

`M0 诊断 → M1 工具 → M2 Gateway / M3 执行链 → M4 状态日志与文档 → M5 双模式实测 → M6 交付检查`。

M1 不必等待一小时试验结束；M2 的首次离线恢复不依赖未确认的 reason-12 分型。M3 先完成四组探针和受控复现再选修改，不预设一定重建 listener。这里的阶段拆分不授权多 Agent、commit 或发布。

| 阶段 | 责任角色 | 产物/修改位置 | 完成门槛 | 失败处理 |
| --- | --- | --- | --- | --- |
| M0 现场与合同 | 执行本任务的工程师；部署信息由服务维护方提供 | 环境清单、脱敏时间线、H1-H6 分支结论、reason12 部署依据；写入任务 evidence | 一小时报告能在明确构建试验；重启前直接 IPC 证据、单 owner/竞争 owner 对照；恢复计时固定 | 环境缺失列具体字段和获取方式；若不能复现保留次数/条件，继续受控实验但不得写根因确认；无仲裁信息阻塞 reason12 自动恢复及 Issue 关闭 |
| M1 故障工具 | 工程师 | 复用 `test/kernel-relay.js`、kernel fixture 与真实 WS fixture；新增双模式 recovery harness | ACK 丢失、订阅断线、半开、timer 延迟、worker 失联均可按脚本重现；能统计 admission/工具副作用次数 | 工具不能观测的项先补观测，不能用 status 成功替代执行证据 |
| M2 Gateway | 工程师 | `application/im-channel.ts`、`transport/wukong.ts`、`channel.ts`、`connection-error.ts`；连接测试 | 首次暂态失败后台恢复；5/10/15/15 秒；单 timer/连接；Retry-After、终态、close fencing 全部通过 A01-A06 | reason12 依据不足保持终态且 P0 未完成；close 未回收禁止新 owner，不吞失败 |
| M3 执行链 | 工程师 | 按实证选择 kernel `client.ts / supervisor.ts / serve.ts / server.ts / host-run-service.ts / invocation-lifecycle.ts` 或特定 adapter；对应回归 | 定位一个或多个实际失败边界；新/旧 client/session 交叉通过；旧 unknown 不触发重跑且新请求恢复；A07-A12/A17 | 未确认根因不提交“大重启”修复；真实 cleanup 失败保留 ownership；若是部署/Provider 合同问题，记录最小复现与依赖，不能冒充 Runtime 已修复 |
| M4 状态日志与文档 | 工程师 | CLI `main.ts / help.ts`、新增 `apps/cli/src/logs.ts`；Host SDK extra-service 与 adapter-sdk `runtime-log.ts / runtime-log-worker.ts / hourly-log.ts`；规则与指南 | `<extra> logs`、stdout 状态事件、镜像、tail/follow/轮转/脱敏/有界背压通过 A18-A23；更新 15 秒重连保证和 unknown 限制 | 不把聊天日志当状态日志；不污染 worker NDJSON；无法写文件不阻塞恢复；旧文档 30 秒与首次离线终态合同须一起替换 |
| M5 真机与集成 | 工程师执行；平台维护者提供不可用平台环境 | CLI/SDK 分开的 S01-S14 证据、macOS 真睡眠、自启、真实 Provider/IM；Windows/Linux 记录 | macOS 核心矩阵双模式通过，重复与长时完成；平台未验项明确标 gap/负责角色/后续入口，不能写三平台通过 | 任意在线但不可执行、重复执行、接管循环、资源累计、宿主需重建均回到责任阶段修复；非 15 秒普通重连不先放宽门槛 |
| M6 交付检查 | 工程师 | 回归、包外 SDK strict fixture、发行包验证、文档与证据汇总 | A01-A27 可追溯；原问题两层恢复均有证据；所有缺口与限制公开；只有之后才可准备关闭建议 | 若 reason12/Kernel 根因/双模式仍缺证据，保持 P0 未完成；仅凭规划分数不能交付 |

## M0 操作顺序

1. 固定 Node 24 或 26、pnpm 11、同一构建、同一隔离 Home/profile、Provider 版本与凭据来源。专用测试 Bot，单 owner 试验先核实没有其他进程/设备。记录 AC/电池、系统睡眠设置、服务自启定义、Kernel/Gateway/worker/Provider PID、endpoint 所有权和 instance。凭据本身不进入文档。
2. 建立正常直接 IPC 与 IM 小请求基线，再分别运行 idle / active。active 使用无副作用长任务，保存原 ref、最后连续 seq 与工具执行计数；真实副作用试验只使用隔离计数 fixture。
3. 每个 checkpoint 执行以下既有命令，保持相同 Home/profile；同时运行 M1 的附加 KernelClient 探针，不能使用会另建 Kernel 的 playboard 代替。

```sh
octo-runtime --home "$trial_home" --profile "$trial_profile" status --json
octo-runtime --home "$trial_home" --profile "$trial_profile" executor-kernel status --json
octo-runtime --home "$trial_home" --profile "$trial_profile" channel-gateway status --json
octo-runtime --home "$trial_home" --profile "$trial_profile" doctor
```

4. 记录唤醒、link-up、DNS、IM、Provider 可达时间，按 T1 自然观察 180 秒。M4 完成后使用下列**待新增命令**补取状态 stdout 镜像；M0 阶段仍按实际路径保留既有脱敏日志和原生管理器日志。

```sh
octo-runtime --home "$trial_home" channel-gateway logs --lines 200 --json
octo-runtime --home "$trial_home" channel-gateway logs --follow
```

5. 失败时先取同 endpoint 四组 client/session 探针和 get 原 Run，再拷取脱敏证据，之后才执行有标记的 workaround trial。日志当前只保留有限实际文件，必须在轮转前取证，不能重置 Home 或重装。
6. 独立执行 Gateway-only、Kernel-only、Gateway→Kernel、Kernel→Gateway，每个 trial 重建健康起点并重新注入同样故障。保留重启前后身份及每步探针结果；不要将某个独立 trial 的恢复拼接成另一个 trial 的证据。

## M1 双模式工具合同

以下是待新增工具，不是本轮已经能运行的命令：

- `test-support/recovery-native-host.mts`：仅公共发行包 import；直接构造 Kernel/Extra，initialize/status/invoke/close。注入受保护配置的已解析值；无 CLI/system service 调用。输出脱敏证据、宿主 PID、initialize 次数、服务 status 和 cleanup complete。
- `test-support/recovery-kernel-probe.mts`：attach 指定**已运行** endpoint，支持已有/新 client、已有/新 session，单次唯一输入身份；保存 ACK、原 ref、最后连续 seq、get 状态及终态；不自行启动服务或重试未知接纳。
- `scripts/verify-sleep-wake-recovery-live.mjs`：以 mode、scenario、Home、endpoint、受保护配置路径和 evidence 目录为输入；配置路径属于测试宿主，不进入 SDK Bot schema。CLI 模式管理器启动既有服务，SDK 模式运行最小原生宿主。host 进程本身由测试启动不等于 SDK 外部代启顶层服务。
- 运行器在真实 IM 试验中只发送用户本次明确允许的专用测试消息；当前规划阶段不发消息。真正合盖/重启/网络切换保留人工 checkpoint，不能让工具悄悄关闭用户现有网络或服务。

同一个故障 fixture 分别接两种模式，输出逐模式记录。Provider fake 的确定性结果与真实 Provider/IM 结果分开。协议 timer 与测试 wall/monotonic clock 独立控制，避免把 fast-forward 当作 OS 睡眠证明。

## M4 实施细化

优先复用当前 RuntimeLogging/HourlyLog，在普通日志之前提取白名单状态事件。拟在非 JSON 的服务 logging 选项中加入可选 `statusOutput(record)` sink，CLI 提供有界 stdout writer；SDK 默认不提供。callback 不可放入 Worker 的 workerData，后者只传可 clone 的目录/状态序列配置。最终导出类型通过包外 fixture 编译；不得把函数塞入 Extra JSON 配置。

状态镜像由日志 Worker 维护，logs.ts 有界 tail/follow；CLI action 在模块加载及管理器操作前路由，不能因 manifest 或 Kernel 不在线而无法查看已有日志。extra-service 负责服务生命周期和低频 Kernel availability **转换**事件（建议 5 秒一次无副作用 status，close 时取消，单次失败不并发堆积），插件负责自身连接状态；onStatus 本身仍同步，不塞异步探测。状态心跳不反复打印相同状态，避免稳定运行刷屏。第三方 Extra 没有连接事件时仍有统一服务生命周期，插件自有业务状态只按白名单显式接线。

同步修改 `.octospec/rules/channel-integration.md`、`extras.md`、`runtime-lifecycle.md`、`local-execution.md` 中被本修复改变的合同；操作说明至少更新 `CLI_USAGE_GUIDE.md`、`SDK_CHANNEL_GATEWAY_GUIDE.md`、Gateway README、`docs/en` 与 `docs/zh-CN` 的相关生命周期章节。普通用户帮助使用英文，项目计划使用中文；GitHub/commit 说明按用户 OSS 要求使用英文。

## 检查命令与执行范围

实施后先安装固定依赖并构建，再运行现有相关测试。以下均为未来步骤；本轮仅文档，不运行模型或服务：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node --test test/im-connection-state-machine.test.js test/kernel-clients.test.js test/kernel-worker-supervision.test.js test/kernel-invoke-lifecycle.test.js test/native-service-architecture.test.js
pnpm lint
pnpm lint:names
pnpm typecheck
pnpm test
pnpm docs:check
pnpm format:check
```

M1/M4 新增 recovery、logs、stdout、小时轮转测试后明确加入测试清单；跨包共享合同按仓库规则运行全量。打包沿 `scripts/pack-release.mjs` 与 `scripts/verify-release.mjs` 现有约定，不发布 npm。包外 SDK 使用实际 tgz 严格编译和运行；不要仅导入 workspace 源码。

本轮知识检查使用 `uv run --with pyyaml python .octospec/scripts/lint.py`。基线会报 `已退出的文档目录仍存在: docs`；不得删除现行 docs 目录来消除旧断言。使用上游 OctoSpec 格式校验与仓库规则/链接定向检查补充证据，并持续报告完整 lint 未通过。

## 回退与交付边界

本改动不迁移数据，保留 Home、profile、凭据、身份和宿主 store。若实际修复回归，恢复原构建与服务定义时只按宿主明确部署操作执行；不能自动删除 endpoint/锁或重置数据库。状态日志损坏只影响排障读取，须独立退化，不能拖垮执行链。外部提交、PR、发布及合并需要用户后续授权；授权 commit 时保留配置作者，以英文消息并恰好一个 Codex co-author trailer。
