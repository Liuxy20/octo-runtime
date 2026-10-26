---
type: Task
title: Issue 184 verified-review
description: 按逐文件阅读和实际运行两条路径检查改动合同与失败边界。
tags: [testing, ipc, review]
---

# verified-review

## 范围与规则

基线 `81284c9ed92066ce7cf34c1b84b608b9336279bf` 到本 worktree 的全部改动（dirty），macOS arm64 / Node v24.19.0。使用 verified-review 的正确性、安全、性能、维护及测试维度；用户关于常驻 Home 不变、Playboard 短临时路径的约束优先于泛化建议。

## Track A：逐文件检查

| 文件 | 核对重点 |
| --- | --- |
| `apps/cli/src/playboard.ts` | 原生 Kernel 所有权、固定短根、独占私有目录、创建失败无 handler 残留、原 close/incomplete 顺序 |
| `test/playboard.test.js` | 真实 bind/worker/invoke、两种帧、并发、长多字节根、取消及后续调用；stderr 进入失败断言 |
| `test-support/fake-owned-process-tree.mjs` | 同目录原子发布；ticks 先于就绪；不更改已有终态/父先退出场景 |
| `test-support/fixture-process.mjs` | 仅有效正 PID、ESRCH 确认、权限错误传播、3 秒有限等待；超时不继续删目录 |
| `test/dsh-adapter.test.js` | 单一 disposer 拥有后代与目录；PID 空文件不当作 0；保留上游 SDK 实际回收边界 |
| `test/process-group-cleanup.test.js` | 正常断言不弱化，失败收尾也等待所属进程；不修改产品进程管理 |
| `.github/workflows/ci.yml` | Windows 两版本真实执行新增 IPC 回归；不误运行 POSIX signal 测试；不删除既有门禁 |
| `.octospec/rules/{engineering,local-execution}.md` | 规则与本次实现一致，常驻 Home 不扩改，强杀边界不夸大 |
| `.octospec/tasks/184-ci-ipc-reliability/{brief,assessment,context,validation,review}` | 改动点、授权、评分依据、实际命令、既有 OKF 失败与未验平台分别记录 |
| `.octospec/index.md`、`.octospec/log.md`、本任务 journal | 链接、历史事实、未完成远端门禁没有写成完成 |

无锁文件、生成文件、二进制或仅格式变化的大文件被纳入本次提交；没有跳过本次源代码文件。

## Track B：实际运行

原实现的同一长路径输入失败，修复后 focused 87 项和全量 Node/UI 通过；进程场景 10 次连续运行通过；发行包离线安装与公共 SDK/CLI 路径通过。对未改路径的独立验证包括全量 Kernel/Host 测试及发行验证的常驻 CLI Kernel。完整命令、结果及证据边界见 [validation](validation.md)。

## 结论

没有发现 medium 及以上问题。既有 OKF frontmatter 失败不归入本次缺陷，未改的清理失败覆盖主错误路径由 #183 处理。Linux/Windows 与 Node 26 以本 PR CI 为准；本地审查不是 GitHub reviewer approval，不替代分支保护。

## 最新 main 合并复核

用户要求同步后，将 `main@79b11aadfb77ab1955d5f361d49d9615beb73414` 合入。Track A 检查两处文档冲突均完整保留双方记录，确认上游代码按原样合入、与本任务产品及 fixture 改动无重叠。Track B 重新构建与全量运行，Node 1845、WebUI 35 通过；lint、命名、格式及文档检查通过。相对最新 main 的本任务源代码差异未变；没有发现 medium 及以上问题。初始 PR head 的六平台 CI 已通过，最终 head 以重新推送后的 CI 为准。
