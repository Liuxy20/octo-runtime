---
type: Task
title: Issue 210 Kernel 恢复阻塞与 Codex 渠道诊断
timestamp: 2026-10-27T00:00:00Z
---

# Issue 210：Kernel 恢复阻塞与 Codex 渠道诊断

## 目标与范围

基于 `origin/main@005116ec7a28e27ccaddde75057e6289cfb549a5`，在独立 worktree
`codex/issue-210-kernel-recovery` 中排查、设计并实现快速恢复与独立 Kernel 日志。
用户确认受影响 Adapter 为 Codex，接受偶发请求失败，要求避免故障消失后长期不可用；
明确要求先补齐 OctoSpec 方案，再以本地故障模拟验证。后续授权实施、本地 verified-review、
提交并推送 PR，以及在 Loop OCTO-1 追加 PR 地址；未授权部署或修改真实服务。

实施方案见 [design.md](design.md)，基线缺陷证据见 [assessment.md](assessment.md)，
当前本地实现和验收见 [validation.md](validation.md)，审查与修复见 [review.md](review.md)。

业务目标是让在线 Bot 的执行不可用可诊断、可恢复，区分未提交与真实未知结果。
Kernel 拥有 worker 监督与替换决定权，CLI 拥有部署与日志入口，Gateway 拥有业务反馈。
显式输入为 Kernel endpoint、worker 装配和既有 Home；Gateway 不启动或重启 Kernel。
不重放旧业务请求、不重置身份或配置、不扩展为按 Bot 管理共享 worker。

## 拓扑与所有权

测试进程通过公共 `createKernelService` 原生构造 Kernel 并持有临时 socket；Kernel
启动真实独立 worker，worker 加载真实 `createCodexAdapter`，Adapter 启动本地 Node
app-server 协议 fixture。没有真实模型、IM 连接或用户凭据。测试只对自己创建的 worker
发送信号；清理探测故障仅匹配该 worker 的负 PGID，manifest 故障仅作用于本进程类方法。

## 关键合同与待验证项

- 基线 `exhausted` 在恢复抛错后永久停留；本次改为当前恢复被阻塞且仍有定时重试。
- 不确认旧执行所有权释放，不能创建第二个执行者；但一次清理失败不应天然成为永久故障。
- 重新观测资源消失和重新执行清理必须分开。当前 cleanup 缓存首次 Promise，重复 close
  不会重新探测；本次提供内部可重试清理入口，不能循环等待同一 rejected Promise。
- 进程清理失败与 manifest 更新失败应分别诊断；PID 消失、空 invocations 都不能单独证明
  所有工具已经退出。Codex app-server 本身拥有独立进程组，worker 组消失不能证明它也消失。
- 未提交证明只能由执行责任边界产生，不能把任意同名错误当作未执行证据。
- 实施 Kernel 父进程独立状态日志、CLI `executor-kernel logs`、公开阻塞诊断和自动恢复。
  仅真实执行边界的明确拒绝可产生未提交证明；旧请求不重放。

## 验收依据

运行 `pnpm build` 后，执行：

```sh
node --test .octospec/tasks/210-kernel-recovery/reproduction.test.mjs
```

检查 Codex 子进程退出与 worker 退出的不同故障域、正常自动恢复、清理探测失败和
manifest 失败造成的 `generation=1 / exhausted / restart_attempt=0`。修复后的验收要求：
撤销暂态故障后 5 秒内新请求成功、Kernel instance 不变、代次增加、旧请求不重放；
持续故障下继续重试但不创建冲突 worker，关闭可取消等待。

另外运行 `test/kernel-recovery.test.js` 和 `test/im-pre-execution-failure.test.js`，覆盖真实
文件系统故障、独立日志读取、白名单、Gateway 准确反馈。完整构建、类型、lint、协议生成
检查与全量回归结果写入验证记录。本地模拟不证明原事故退出原因，不替代真实模型和 IM 验收。

## PR P1 跟进

外部审查发现 Windows 普通 worker 退出进入 immediate 清理后永久阻塞，已本地复现。
修复保留首次清理前已退出的基线分支，同时保留已观察到的树清理失败；新增相邻反例和
Windows CI 覆盖。用户关注的 macOS 原始退出原因仍未知，不能将此 P1 认作原事故根因。
