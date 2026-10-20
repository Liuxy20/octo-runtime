---
type: Task
title: 两项 P1 的开发阶段与逐文件安排
description: 先验证高风险机制，再分别实现 Gateway drain、Windows 归属回收和发行验收。
tags: [planning, lifecycle, testing, windows, channel]
timestamp: 2026-10-20T00:00:00Z
status: in_progress
---

# 开发顺序

2026-10-20 修订：继续执行下表中的 Gateway M1/M2 及对应回归、包外与真实 IM 验证；原 Windows M0/M3、C07/C08/C10/C13 中的 Go/Job 与原生分发工作已撤回。旧阶段、勾选项和命令保留为历史，不是现行实施要求。当前先删除原生产品接线，再修复评审发现的取消 Promise 和收尾失败漏报，最后验证 Node-only 构建、三平台 CI、真实 IM 卡片与故障收尾。遵守[公共层原生依赖约束](../../rules/architecture.md#实现语言与原生依赖边界)。

已按用户授权开始实施。逐阶段的实际结果见[实施记录](implementation.md)，不能将旧版本结果记作新功能通过。
两个缺陷分别保留回归和变更边界；共用此 worktree，不要求额外线程或并行 Agent。

| 阶段 | 开发内容 | 必须交付的证据 | 退出条件 |
| --- | --- | --- | --- |
| M0 复现与机制门 | 固定 SHA/接口声明，补 Gateway 先断连接、尾事件丢失，以及 Windows leader 先退 fixture；验证最小 Job broker 的挂起关联、Node fd3 和 disconnect | 原实现失败记录；新机制原生 Windows 结果；公开声明/Schema 基线 | G02/G03/G04 原缺陷可复现，W01/W02/W05/W06 机制通过；broker 不透明则留在 M0 修设计，禁止放宽验收 |
| M1 Gateway 信号与 drain | manager/runtime/task 分离准入、执行取消和投递资源；绑定尾事件、唯一 final、3秒 drain/4秒资源截止 | G01–G07；任务执行次数、final 次数、关闭顺序、绑定代次 | 正常/取消/未知/离线均有真实结果；无迟到新 invoke |
| M2 Host/runner 接线 | ExtraPort 和独立 runner 共享关闭阶段；并发取消和 dispose、失败 ref 保留、remaining budget；检查 WeCom 兼容 | G08–G10；真实独立 Extra+Kernel+兄弟 Run | 不关闭兄弟或 Kernel；关闭 ACK 不掩盖业务 drain 失败 |
| M3 Windows owner 实现 | 生产级私有 broker、控制 Pipe、句柄确认、PID/创建时间、所有 launcher 接线 | W01–W09；各 launcher 的 leader先退/owner死/取消/后续调用 | 每条受影响路径有独立归属；不依赖全机进程扫描；完整/不完整真实区分 |
| M4 发行与跨平台 | 固定 Go 构建、两个架构资源、打包检查、Windows CI、最终 tgz 离线安装、公开类型 | W10、I01/I02；Linux/macOS 全套回归 | 同一发行包资源完整；消费者无编译器/隐式下载；SDK 调用不变 |
| M5 真实验收与知识回写 | Windows10/11、真实 Provider 和 im-test SDK/CLI 场景；实际应用构建/重启；更新规则和 journal | I03/I04；命令、PID、版本、耗时、脱敏结果 | 必需平台与业务场景通过后才关闭对应 P1；缺证据保留未完成 |

## 逐文件落点

| 编号 | 当前源码/拟新增位置 | 计划改动 | 阶段 |
| --- | --- | --- | --- |
| C01 | `packages/octo-runtime-extra-channel-gateway/src/application/im-channel.ts` | active/draining/closed，尾事件保存、final 和最后释放 | M1 |
| C02 | `packages/octo-runtime-extra-channel-gateway/src/lifecycle/manager.ts` | 同步停准入、取消准备、并发 Bot drain、共享截止 | M1 |
| C03 | `packages/octo-runtime-extra-channel-gateway/src/execution/task.ts` | 停止后续尝试，取消已接纳调用但保留尾流，真实终态竞态 | M1 |
| C04 | `packages/octo-runtime-extra-channel-gateway/src/extra.ts`及`delivery/` | owner stop 到内部 drain，投递信号存活/截止撤权 | M1 |
| C05 | `packages/octo-runtime-host-sdk/src/extra-port.ts` | 所属 ref 的取消/消费确认与失败保留，不改 attached.close | M2 |
| C06 | `packages/octo-runtime-host-sdk/src/extra-entry.ts`、`extras.ts` | 共用内部截止，dispose 与 cancelOwned 不相互提前拆资源 | M2 |
| C07 | `native/windows-process-owner/`（拟新增） | Go Win32 broker、可重复构建、原生测试；不提供业务 IPC | M0/M3 |
| C08 | `packages/octo-runtime-adapter-sdk/src/process-cleanup.ts`及私有 managed-launch 模块 | Windows Job owner、树清空确认，POSIX 路径原样回归 | M3 |
| C09 | `packages/octo-runtime-host-sdk/src/launch.ts`、`native.ts` | component/native 创建与回滚、真实目标 PID、owner死宽限 | M3 |
| C10 | `packages/octo-runtime-executor-kernel/src/process.ts`、`invocation-manifest.ts` | worker 归属、broker/目标清理事实、先回收再替换 | M3 |
| C11 | Adapter SDK NDJSON、`octo-runtime-acp-client/src/index.ts`、Codex/ZCode app-server | 接到私有 launcher；共享 Provider 的进程 owner 不变 | M3 |
| C12 | `scripts/pack-release.mjs`、`verify-release.mjs`、`verify-windows-release.mjs`、构建脚本 | Go/架构/摘要门禁；tgz 实测，不向 consumer 暴露新步骤 | M4 |
| C13 | `.github/workflows/ci.yml`、相关 package scripts | 固定 Go，Windows 必跑 broker/回收/独立 Extra 测试，接入 CI Gate | M4 |
| C14 | `test/`及`test/fixtures/` | [验收矩阵](acceptance.md)中的故障与资源断言 | M0–M5 |
| C15 | SDK 指南、相关 README、`.octospec/rules/`及journal | 仅在实现后回写实际合同、平台证据和限制 | M5 |

## 环境与实施前检查

1. 重新 fetch main 并核对 #65/#66 等后续改动；记录重定基线，不覆盖其他 worktree。
2. Node 24.x、pnpm 11.19.0、Go 1.25.x；先确认实际 executable、cwd 和平台。新 worktree 单独安装构建，临时 Home 在 checkout 外。
3. M0 Windows fixture 不需要真实模型、Bot 凭据、管理员或 WSL；Windows CI 可跑机制门，Windows10/11桌面再补业务验收。
4. Windows arm64 资源必须打包；交叉编译/PE 头检查不等于 arm64 实测，缺机器保持该项待验，不写“全部架构已验证”。
5. 真实业务阶段通过宿主现有受保护配置获得授权；不将凭据写入文件样例、Git、日志或模型 Context。

## 验证命令

实施后先运行新增 focused tests，再执行共享合同检查：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm format:check
pnpm test:suites
pnpm pack:release
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
uv run --with pyyaml python .octospec/scripts/lint.py
git diff --check
```

Windows 另运行 `verify-windows-release.mjs`，参数沿用脚本当时的实际用法并包含精确源码 SHA。
新增测试文件和平台命令见[验收执行表](acceptance.md)。只在用户后续授权时提交、推送或创建英文 PR；英文 commit 使用配置作者并保留一次 Codex trailer。

## 当前完成项

- [x] 新 worktree 与基线固定。
- [x] 现行规则、两条缺陷链路和原生 OS 机制核对。
- [x] 设计、逐文件计划、故障矩阵、发行门禁及评分落文档。
- [x] M0 最小 broker 的 Node IPC/argv/leader退出/owner退出/被杀原生 Windows 机制通过。
- [x] M1/M2 Gateway drain 与共享关闭预算已实现，受控与独立 runner 回归通过。
- [x] M3 所有 owned launcher 接线完成，扩大后的 Windows Job/Provider 及原生组件关闭回归通过；缺失故障子场景保留待验。
- [x] M4 最终实现的三平台 CI、打包与公开接口验证（代码SHA `1d6104f`）。
- [ ] M5 真实 IM/Provider/桌面验收及知识回写。

M5 的 im-test SDK/CLI、真实 Codex 执行中停止及重启已经通过；发送边界故障注入也已验证 incomplete。桌面 Windows10/11 与 arm64 原生机器仍未提供，不能把 M5 整体勾选完成。
