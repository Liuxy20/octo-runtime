---
type: Task
title: Issue 184 Playboard 短临时端点与进程测试竞态
description: 固定一次性 Unix socket 的短根目录并修复就绪发布与后代清理时序。
tags: [ipc, testing, lifecycle]
---

# 目标

基于 `origin/main@81284c9ed92066ce7cf34c1b84b608b9336279bf`，修复 [Issue 184](https://github.com/Mininglamp-OSS/octo-runtime/issues/184) 中三类已确认失败。用户授权独立 worktree、规划、实施、verified-review、英文提交与 PR，门禁通过后合入 main。

## 关键合同与归属

- 业务目标是一次性 Playboard 在长 TMPDIR 下也能执行，以及 fake Provider 自动化测试无文件发布/删除竞态。端点位置由 CLI 拥有；fake 后代及测试目录由各 fixture 拥有。
- 常驻端点、SDK 自配 Home、Unix CLI 默认 `~/.octo-runtime`、Windows 命名管道及 Home 默认值保持现状；不增加 Home 校验、迁移、短路径注册表或配置项。
- Unix Playboard 在固定 `/tmp` 下用 `mkdtemp` 独占创建短私有目录，socket 为其 `k.sock`。使用私有目录而非直接在共享 `/tmp` 建可预测文件；不受 TMPDIR/TMP/TEMP 影响。Windows 保留系统临时目录及既有 Home 哈希命名管道。
- Playboard 进程直接调用 `createKernelService`，自己持有 socket；内部 worker 执行同一 AgentExecutor。服务、worker、Provider 拓扑及公共接口不变。删除映射：无公共接口删除，仅替换临时目录根的选择。
- 成功/失败/取消及 incomplete 合同沿用当前实现。只在真实关闭完成后删除所属临时目录，不删除其他实例。临时目录创建失败不能留下已注册的进程信号监听。
- 进程树 fixture 在同目录写完整临时 JSON 后 rename 发布 ready.json。消费者继续拒绝损坏 JSON，不吞 SyntaxError。
- DSH 测试在唯一 fixture disposer 中先终止其登记的后代并有界确认消失，再删除目录。不改变未修改的上游 SDK 的产品回收保证。

## 改动点

| 位置 | 动作 | 验收 |
| --- | --- | --- |
| `apps/cli/src/playboard.ts` | Unix 固定 `/tmp` 短目录；创建在 signal 注册之前；补中文所有权注释 | 长临时根仍完成真实 IPC 调用 |
| `test/playboard.test.js` | 长且含中文 TMPDIR、两种帧、并发和 POSIX 取消回归；断言包含 stderr | 修复前失败、修复后通过 |
| `test-support/fake-owned-process-tree.mjs` | ready.json 原子发布；先创建 ticks 再发布 ready | 原进程树测试与连续运行 |
| `test/dsh-adapter.test.js` | fixture 统一管理后代和目录清理；kill 后确认退出 | tree/tree-exit 与整组 DSH 测试 |
| `test-support/fixture-process.mjs`、`test/process-group-cleanup.test.js` | 共享测试专用 kill/退出确认，失败收尾也先等待进程退出 | 原进程树测试与连续运行 |
| `.github/workflows/ci.yml` | Windows 显式运行新长临时根回归 | Windows Node 24/26 原生命名管道 |
| `.octospec/rules` 及本任务 | 回写临时端点和测试资源顺序，记录证据 | OKF lint 与逐文件审查 |

## 范围外

不改常驻 IPC 或 SDK API；不合并 #183 的 Windows 控制台处理；不调用真实模型、注册真实 OS 服务或操作用户运行中的 Runtime；不发布 npm。

## 验收

1. 独立构建后，新增长 TMPDIR 回归在原 Playboard 实现上失败，在修复上通过；测试必须实际 bind、执行及关闭，不仅比较路径字符串。
2. native/canonical、两个并发实例、provider failure、POSIX SIGINT、后续调用分别保留真实终态和退出码。
3. Node 24 本机 macOS 执行 focused 及全量自动化；Node 26 与 Linux/Windows 由 PR CI 验证。Windows 只运行适用新回归，信号测试归 #183。
4. 运行格式、lint、命名、typecheck/build、docs、OKF 与必要发行验收；审查全部改动文件，修复 medium 及以上发现后复验。
5. PR required checks 与评审满足后 squash merge，最终提交保留一次 Codex trailer；检查 main 的合并提交与 CI。
