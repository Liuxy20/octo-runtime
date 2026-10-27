---
type: Validation
title: Issue 210 本地实现与快速恢复验收
timestamp: 2026-10-27T00:00:00Z
---

# 本地实现与验收

工作分支 `codex/issue-210-kernel-recovery`，基线 `origin/main@005116e`。
方案见 [design.md](design.md)，基线缺陷与拓扑见 [assessment.md](assessment.md)。
用户已授权 verified-review 后提交、推送并创建 PR，再向 Loop OCTO-1 追加 PR 地址。
本记录描述提交前的本地验收；未修改部署。

## 实现

- Kernel 监督循环将旧 worker 清理、manifest 写入分阶段串行重试，间隔 1/2/5 秒，上限
  5 秒；持续失败不并发创建替代 worker，关闭取消等待并保留 incomplete。
- 清理提供实际重新观测入口；清理成功后不再触碰历史 PGID，PID 身份冲突阻止发信号。
  替代启动失败的回滚清理也能重试。manifest 写队列失败后可写入新的完整快照。
- schema 新增可选 worker.recovery 诊断，生成 TypeScript、Go、Python。`exhausted`
  表示当前恢复阻塞，配合 stage/code/retry_at 可见下一次尝试，不再永久停住。
- 父进程写独立 `kernel-status` 日志，新增 CLI `executor-kernel logs`，支持 lines、follow、
  text 和 NDJSON，复用既有读取预算、轮转与白名单。CLI 默认开启，SDK 使用 logging.directory。
- Kernel 真实接纳前拒绝的匹配 RPC 产生可信未提交证明，Gateway 显示 OH-RUN-2012；
  已接纳失联仍为 unknown，不重放旧请求，不改变 Home 或 Kernel 身份。

## 快速恢复证据

环境：macOS / Node.js 24.19.0。每个场景创建独占临时 Home、真实 Kernel 和独立 worker。
Codex 场景使用真实 Codex Adapter，但 app-server 为本地无网络协议 fixture。

| 场景 | 实测与断言 |
| --- | --- |
| 所属组探测 EPERM 后解除 | 新请求约 1.35–1.38 秒成功，低于 5 秒；Kernel instance/PID 不变 |
| 真实目录写入故障后恢复 | 新请求约 1.33–1.35 秒成功，磁盘清单更新为新 worker PID |
| Codex 清单 EIO 后解除 | 新请求约 1.37 秒成功，原 Kernel 自动恢复 |
| 替代启动回滚清理失败 | 保留实际清理入口，解除后 5 秒内 ready，不并发替换 |
| 持续探测失败 | retry_at 持续变化，generation 不增加；close 取消等待，小于 1 秒返回 incomplete |
| 模拟 PID 复用 | 报 WORKER_PROCESS_IDENTITY_CONFLICT，不向历史组发终止信号；解除后恢复 |
| 共享关闭期限 | 延迟 worker 回收确认 4400 毫秒、日志关闭 1000 毫秒，重叠清理约 4.47 秒完成，不误报 incomplete |
| app-server EOF | 仅本轮失败，共享 worker 保持 ready，下一轮成功 |
| Codex 在途 worker 强杀 | 原请求 unknown，新 worker 仅执行新请求，fixture 随 stdin EOF 退出 |

时间从撤销注入/恢复存储起，计至新请求实际完成；测试同时断言 5 秒上限。它不是生产 SLA，
也不包括故障解除前的持续失败时间；心跳检测、清理和启动握手另有预算。

## 检查

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck（含完整 build） | 最终全部改动重新运行通过 |
| pnpm lint | 最终重新运行通过；初次构建与 lint 并发的解析错误已消除 |
| pnpm lint:names | 通过，无 findings |
| pnpm test:suites | 最终 Node 2022 通过 / 56 跳过 / 0 失败；WebUI 35 通过 |
| Codex reproduction.test.mjs | 5 通过 / 0 跳过 / 0 失败 |
| test/kernel-recovery.test.js | 最终全量中 7 通过 / 0 跳过 / 0 失败 |
| extra-status-logs + im-pre-execution-failure（最后一次） | 39 通过 / 0 跳过 / 0 失败 |
| pnpm native:check | 3 份生成文件及输入摘要一致 |
| pnpm native:test --suite protocol | Go、Python 各 358 条共享样例通过，含新增恢复诊断；首次缺 Python venv，按锁文件初始化后重跑通过 |
| pnpm docs:check | 示例类型与文档静态检查通过，4 项运行检查通过 |
| 本次源码/测试/模拟脚本 Prettier | 通过 |
| git diff --check | 通过 |
| OctoSpec lint | 通过；最终提交前重新检查 |
| verified-review | 两项 medium 均复现并修复，修复前失败、修复后通过；无剩余 medium 及以上发现 |

最后一次全量包括 PID 复用、启动回滚、Kernel follow、共享关闭期限和协议样例测试。
两项审查发现及覆盖边界见 [review.md](review.md)。最后一次 Codex 故障解除后新请求成功：
清理探测 1367 毫秒、manifest EIO 1364 毫秒；全量中的真实文件系统故障恢复为 1315 毫秒。
检查摘要同步至 [journal](../../journal/shared/2026-10-27-210-kernel-recovery-investigation.md)。

## 未验证边界

未连接真实模型或 IM，未操作用户真实 Home，未验证 Windows 真机进程树行为。Windows
保留已观察到清理失败后的保守阻塞，没有借 leader 消失放行。Codex app-server 使用独立
进程组，模拟 EOF 退出不能证明真实工具后代在强杀场景全部被回收；本次不作该保证。
原事故 worker 为什么退出仍未知；本次修复的是已复现的永久阻塞路径和诊断缺失。

## PR P1 增量验收

上述 2022 项为首个提交 `e8feadb` 的本地结果。外部审查随后发现 Windows 普通退出被
无条件 immediate 清理永久阻塞，结论成立，复现和修复见 [review.md](review.md)。

新增 Windows 分支回归在修复前 1 通过 / 1 失败，修复后普通退出约 354 毫秒恢复到
generation=2 / ready；已经观察到树清理失败后 leader 退出仍阻塞的反例通过。
专项组合 13 通过、22 项 Windows 原生测试跳过、零失败；完整 build/typecheck、lint
和格式检查通过。Codex 五项模拟再次通过，故障解除至新请求完成分别为 1487 和
1525 毫秒（与全量并行时测量），均低于本地 5 秒门槛。

本轮全量第一次发生 1 失败 / 4 取消，系统日志同时记录 22:00–22:02 睡眠/唤醒；
对应五份测试单独复跑 38 项通过。阻止空闲睡眠后再跑默认并发，仍出现 3 失败 /
2 取消，涉及短期限启动、版本探测和渠道测试；因此不能将默认并发这两次写成通过。
改用同一组 Node 测试、并发上限 4 后，系统仍经历长时间暂停；CLI 恢复测试超过 60 秒
期限，进程滞留，最终终止该次测试所属进程。本轮三次全量均不计通过，未修改产品或
测试超时来绕过失败。新增 P1 回归在三次全量中均通过；专项独立结果仍为有效证据。
Windows CI 已加入恢复专项和新增分支回归，真机结果以新提交的托管运行结果为准。
