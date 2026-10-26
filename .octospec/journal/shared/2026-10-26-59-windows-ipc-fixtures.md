---
type: Journal
title: Issue 59 Windows IPC 测试夹具修复与验证
description: 限定测试层的失败清理和 UTF-8 修复，记录 Windows 原生验证及历史回归映射。
tags: [ipc, testing, windows]
---

# 实施范围

关联 [Issue 59](https://github.com/Mininglamp-OSS/octo-runtime/issues/59) 与 [任务 brief](../../tasks/59-windows-ipc-fixtures/brief.md)。分支 `fix/59-windows-ipc-fixtures` 基于 `167205ccd113e0795a7f7d9c5c24beeba9c56e5d`；验证完成后按用户授权提交 PR。

- `kernelFixture` 在初始化前登记同一个幂等 disposer，初始化失败立即回滚，原始错误与清理失败保留；不将服务报告的 incomplete 当成功，不在回收失败后删除所属目录。
- `kernelRelay` 对监听错误正常 reject，提前登记清理并等待所属连接关闭；使用跨 chunk 的 UTF-8 decoder。clients 的 ACK 丢失测试复用此 relay。
- 删除已未调用且假定 POSIX socket 路径的历史 helper；回归迁移到当前 Kernel/worker 与 Worker RPC 边界。
- 严格清理断言暴露原 worker 强杀测试的收尾竞态：流断开可能先于监督器收到退出通知。测试等待新一代 worker ready 后才结束，沿用已有监督器回归的屏障；原执行仍断言未知结果且没有重放。
- `apps/`、`packages/`、SDK 接口、Schema、默认容量和默认超时均未改动。

# Windows 证据

Windows 11 Enterprise build 22621 x64，普通用户，PowerShell 5.1；Node `24.18.0`、pnpm `11.19.0`。测试 Home、Temp、配置和缓存隔离于本轮外部证据目录；使用构建后的 workspace 包与 fake Provider，未调用真实模型或日常 Runtime。

依赖先执行冻结锁文件、忽略 scripts、无 optional 的离线安装；构建所需 Windows 原生包从本机既有 checkout 复制相同锁定版本的 rolldown、esbuild 与 lightningcss 二进制。未更改锁文件或依赖声明。最终 `pnpm typecheck` 完整构建 CLI/WebUI 后通过，CLI 构建记录为上述 commit、dirty。

## 修复前失败与修复后对应关系

| 历史/实测问题                                      | 当前回归与结果                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 未使用的 `host.sock` helper 在 Windows 监听 EACCES | 删除死代码；当前真实 Kernel 与 peer 继续使用 Windows named pipe，不引入兼容 API                                                  |
| Kernel fixture 初始化失败遗留目录                  | 新失败注入测试在旧 helper 下失败；修复后断言原始 EACCES 仍可追溯、目录立即清空、清理提前登记                                     |
| relay 监听失败不 reject、无清理登记                | 新 EADDRINUSE 注入测试在旧 helper 下失败；修复后原错误直接 reject，清理在 bind 前登记                                            |
| relay 按 Buffer chunk 转字符串破坏中文             | 大中文经旧 relay 的精确文本断言失败；修复后 direct/relay 均保留 1,430,765 字节输入对应完整输出、单一终态和并发兄弟结果           |
| UTF-8 字符跨接收边界                               | 原生 IPC 分两次写入、在首个中文字符第一字节后切开，客户端返回完整原文                                                            |
| 无换行数据按字节超限                               | Worker RPC 断言错误 code、boundary、limitBytes 与 measuredBytes；Kernel client 原生 pipe 断言 HOST_FRAME_TOO_LARGE，后续连接正常 |
| 最大合法帧和旁路请求                               | 保留现有 hard-maximum HostFrame + envelope 及兄弟请求回归                                                                        |
| worker 强杀测试清理竞态                            | 首轮扩展测试报告 cleanup incomplete；补监督器恢复屏障后 native/canonical 聚焦测试 2/2，通过后整批相关测试再次通过                |

原生 pipe 的约 40 MiB 超限测试使用已有 `get` 的 30 秒 deadline，区分传输耗时与容量判断；未修改产品五秒默认值。字符数小于容量上限而 UTF-8 字节数超过容量上限；本轮原生超限测试约 13.5 秒，默认五秒超时不能当成容量保护缺失。

## 最终检查

- 18 个相关文件：Node test concurrency=4，140 项，138 通过，0 失败，2 项原有 Windows 平台跳过，耗时约 58.6 秒。覆盖全部 `kernelFixture`/`kernelRelay` 消费测试及 stream limits/host policy。
- 两项跳过分别依赖 POSIX process group 与阻塞主循环信号；未新增 skip。
- `pnpm typecheck`（含完整构建）、`pnpm lint`、`pnpm lint:names`、`pnpm format:check` 与 `git diff --check` 通过。
- OKF lint 仍被 7 个本分支未改动的既有文件缺少 YAML frontmatter 阻塞：tasks 下 dsh-upstream-sdk 的 brief/upstream-feedback、systemd-directive-paths 的 brief/review，以及 journal 的 2026-10-22-systemd-directive-paths、2026-10-24-124-sass-build-fix、2026-10-26-dsh-upstream-sdk。新增 brief/journal/context 无新增检查错误。
- 本轮未执行全仓测试、macOS/Linux、真实模型、真实 Octo 联调。fake Provider 通过不代表这些项目已验证。

完整外部证据保存在本轮独立验证目录，未纳入仓库：`fix-tests.log`、`fix-test-files.txt`、`worker-loss-fixed.log`、`worker-loss-followup.log`、`red-fixture.log`、`red-utf8-relay.log`、各检查的 `fix-*.log`，以及修复前的 `report.md`。原失败检查保留，不以最终绿灯覆盖失败事实。

# 规则与复核

按 context 中 architecture、local-execution、engineering 规则复核：公共合同和拓扑不变，清理只处理夹具所属资源，错误不降级成成功，容量验证不靠增加产品默认预算。既有 engineering 规则已经要求“kill 请求不等于退出”、启动拒绝保留 cause、单 disposer 顺序清理；本轮将其应用于 fixture，无须新增重复规则。未触及真实凭据或提交本机运行产物。

# PR 189 的 CI 修复

首次托管 CI（run `40293575316`）中，Ubuntu Node 24/26 的完整构建、测试与打包及 Windows Node 24/26 发行包验证通过；macOS Node 24/26 均仅失败于新增的客户端无换行超限测试。两者都在约 30 秒收到 `KERNEL_TIMEOUT`，而断言期待 `HOST_FRAME_TOO_LARGE`，导致最终 CI Gate 失败；不是发布步骤失败。

原测试将约 40 MiB 输入经过 OS socket 分片并在客户端逐步累积，容量断言因此受平台分片与反复复制的耗时影响。修复限定在测试层：mock 下一次 `net.createConnection` 为受控 Duplex，在两块中提供上限前 2 字节及越过上限的最后 3 字节；仍调用原客户端解析和容量保护，断言 `HOST_FRAME_TOO_LARGE` 及连接销毁。恢复 mock 后，在同一客户端上查询真实原生 IPC peer，验证下一连接可用。真实 1.43 MB direct/relay 传输与字符拆包测试保持不变。移除测试自行传入的 30 秒 deadline，恢复默认 status 查询预算；未改 SDK、产品容量/超时或新增 skip。

Windows Node 24 聚焦复测 `kernel-stream-transport`、`host-stream-transport`、`kernel-fixture-failure` 三文件 8/8 通过，其中客户端容量测试约 186 ms（原原生测试约 13.5 秒）。首次失败日志保留于独立证据目录；macOS 结果以该修复提交的新 CI 为准，不能由 Windows 复测推断通过。
