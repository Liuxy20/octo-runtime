---
type: Validation
title: "Issue 237：Windows 原生启动取消及新实例恢复验证"
description: "84e02505 基线、取消回滚原因链缺口、最小修复与 Node24/26 重复手动验收。"
tags: [windows, runtime, lifecycle, ipc, testing]
timestamp: 2026-11-02T11:00:00Z
---

# 版本、环境与执行边界

- 独立 checkout：本聊天 `work/octo-runtime`；分支 `fix/windows-kernel-startup-237`。起始及交付前再次 fetch 的 origin/main 均为 `84e025053b93e8f23063ef702441925a5007138d`，包含 #295、#297。首次本地交付时产品代码未提交，差异以交付 patch 与文件 SHA-256 绑定；后续 PR 提交以实际 Git head 绑定，源码与最终专项保持一致。
- 原生 Windows 11 Enterprise 10.0.22621 x64；普通用户，Administrator=False；PowerShell 7.6.5；Git 2.55.0.windows.5；Codex CLI 0.164.0-alpha.11.1。
- Node24.19.0、Node26.13.0；pnpm11.19.0，匹配 packageManager。运行器使用对应 process.execPath，子进程 PATH 前置同版 Node；未使用系统 Node22。
- 每个测试命令的 HOME、USERPROFILE、OCTO_RUNTIME_HOME、TEMP、TMP 分别隔离在 checkout 外 `work/state/<label>`。只用注入的 fake Adapter / fake Provider，无真实模型、凭据或 IM。未改在线 Bot 或其他 checkout。
- frozen 安装使用缓存，`install --frozen-lockfile --offline --ignore-scripts` 成功；另行完整构建。pnpm 命令级禁用自动重复依赖状态检查，通过本聊天 work/bin 的 shim 支持递归调用，不改全局设置或锁文件。
- Git 初始 autocrlf=true；本 checkout 设为 false，文本归一到既有 LF blob，并刷新索引。此后仅任务范围 diff，无批量换行改动。

# 历史故障到当前合同的映射

| 历史事实 | 当前对应与本轮结论 |
| --- | --- |
| c51d5cf 的 Node26 replacement.initialize 间歇失败，完整 cause 缺失 | 旧原因未定位。本轮验证新构造服务复用同 endpoint/state；不要求旧对象 reopen。 |
| 58332b3 的 Node24 更早取消回滚 incomplete | 未证明与原 replacement.initialize 同根。当前原生取消回滚多轮通过，不将新夹具通过算作旧版本复测。 |
| 旧 replacement.close 的 setWorker → writeManifest → rename EPERM | #295 删除 setWorker/worker 更新路径。当前原生 ownership 仍使用 rename，不能声称全部 IO 风险消失，也未确认旧占用者。 |
| worker/心跳/重建与旧 manifest 格式 | #295 已移除对应执行架构；未恢复 worker/API。当前旧记录保护继续由 invocation-manifest 原文件测试验证。 |
| #297 的 ACP spawn 清理终态 | 已包含在基线，无重复实施；扩展回归保留真实失败 spawn、并行/后续调用、Core ownership 与 cleanup incomplete 保护。 |

当前源码依据：KernelService.initialize 的 Promise.race；startKernelServer 的串行 bind、signal 检查与 teardown；InvocationManifest 的原生 owner 记录；Windows acquireEndpoint 返回空释放函数，实际 endpoint 由 Named Pipe 监听拥有。Windows 没有 POSIX `.owner` lease 文件，不能把无该文件算作 Windows lease 实测。

# 确认缺陷与修复

新增显式手动故障注入：原生 owner 已建立，signal 取消先结算；随后启动失败并在 manifest.close 注入 EPERM。startKernelServer 正确保留启动异常与回滚错误的 AggregateError，close 也返回 incomplete 且保留 owner；但 Service.initialize 原实现始终将 race 首先结算的取消错误作为唯一 cause，回滚 EPERM 无法从返回异常追踪。

基线两版均为 **7 pass / 1 fail / 0 skip**，失败断言是原始回滚 EPERM 必须可追踪。此 EPERM 是确定性测试注入，**不是本次原生文件系统锁失败复现**；该缺陷不证明旧 worker 故障同根。

最终版专项另做严格对照：从 Git 读取基线 service.ts，用当前 TypeScript/ES2022 转译，仅临时替换 ignored dist/service.js，两版仍各7 pass / 1 fail。对照后恢复修复产物并校验 SHA-256 完全相同，再进行最终增强组合三轮。源码、公共类型及其他构建产物未回退；baseline-comparison.json 保存源码/产物 hash 和恢复确认。

产品修复只在 `service.ts` 增加 11 行、替换 1 行：等待原 close 后，若存在不同于首次错误的已确认启动 AggregateError，聚合首次错误与完整启动/清理链；否则保留原 cause。ServiceInitializationError、ServiceCleanupResult、RPC/SDK 签名、5秒期限和所有权不变，不吞错误、不释放未确认资源、不退出宿主。最终测试还验证取消原因、另一个启动失败及回滚 EPERM 三者原对象均保留。

# 重复结果

所有 Node 测试使用 `--unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1`；每轮自然结束，退出码0。基线失败轮退出码1；没有运行器超时或外部终止。

| 命令文件集 | Node24.19.0 | Node26.13.0 |
| --- | --- | --- |
| 基线原组合：invocation-manifest + component-startup | 三轮，每轮5 pass / 0 fail / 0 skip | 三轮，每轮5 pass / 0 fail / 0 skip |
| 基线新增原因链回归（初版8项） | 7 pass / 1 fail / 0 skip | 7 pass / 1 fail / 0 skip |
| 修复后原组合，精确两文件命令 | 三轮，每轮5 pass / 0 fail / 0 skip | 三轮，每轮5 pass / 0 fail / 0 skip |
| 修复后原组合 + manual/kernel-startup-237.test.mjs | 三轮，每轮13 pass / 0 fail / 0 skip | 三轮，每轮13 pass / 0 fail / 0 skip |
| 原生装配 / bind / Host SDK / clients / native Host / cleanup / ACP扩展 | 52 pass / 0 fail / 0 skip | 52 pass / 0 fail / 0 skip |

原组合精确命令：

```text
node --unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1 test/invocation-manifest.test.js test/component-startup.test.js
```

手动增强组合在上述文件后追加 `test/manual/kernel-startup-237.test.mjs`；不加入默认入口。扩展文件集完整为：`test/adapter-composition.test.js test/service-bind-startup.test.js test/host-sdk-lifecycle.test.js test/kernel-clients.test.js test/native-host.test.js test/cleanup-budget.test.js test/host-adapter-core.test.js test/acp-transport-failure.test.js test/manual/acp-cleanup-236.test.mjs`。其中部分文件已随 #295 成为无测试的迁移占位，以 TAP 的实际52项为准，不按文件数推算覆盖。

# 逐场景验收

| 手动场景 | 断言与实际结果 |
| --- | --- |
| pre-abort | 保留原 cause、无 Adapter invoke，完整回滚，原对象 client 不开放，替换执行及关闭成功。 |
| owner-abort | 写入真实 nativeOwner 后取消，owner 清单删除、pipe 不可连接，新实例相同 endpoint/state 执行成功。 |
| bind-abort | 真实 net.Server.listen 在屏障处暂停；取消后不 ready，放开实际 bind 后串行回滚，监听关闭再允许替换。 |
| bind-close | 初始化期间显式 close，与 initialize/closed 使用同一清理结果；无迟到 ready，后续新构造正常。 |
| initializer-error | 原始 Error 对象未重建，cleanup complete，新实例 RPC 执行与关闭正常。 |
| late bind success | 暂停 bind 至真实5秒关闭截止之后；返回 failed/incomplete，owner 阻止竞争实例。放开 bind 后实际监听被回收、清单消失；旧 close 仍返回首次 incomplete，旧服务无 client/ready；新实例可执行。 |
| rollback IO failure，未取消 | 聚合链含原初始化 Error 与注入 EPERM；清单 cleanupFailed=true，inspect 为 cleanup_incomplete，竞争实例被拒绝；兄弟服务仍执行、关闭成功。 |
| rollback IO failure，取消先发生 | 首次取消原因、其后的不同启动失败及 EPERM 均可遍历且保持原对象；cleanup/owner/兄弟行为同上。 |

每个成功替换均实际经 kernel.client / Named Pipe RPC 执行，看到 run.completed 和回应正文；status.pid 等于宿主PID。fake Adapter entered=1、active=0、released=1；取消启动的旧服务 entered=0；Kernel 不调用 Adapter 上代表宿主资源的任意 close。正常 close 重复调用共享同一 Promise/结果，所有权记录删除，pipe 无监听。

失败注入只对本次独占、未开始任何执行且尚未 bind 的测试服务生效。日志先保存完整错误链和失败清单；测试最终恢复 mock 并完成其测试清单 IO 清理后移除临时目录。此 fixture 收尾不属于产品自动恢复，也不声称 incomplete 服务已 reopen。迟到 bind 在实际结束后才由产品删除 owner，未提前删除以放行竞争实例。

诊断读取边界：bind 超过关闭截止但仍 pending 时，ServiceCleanupResult 已是 incomplete，service.phase=failed，而 inspectOrphanCleanup 仍从“live owner、尚未写 cleanupFailed”的持久记录返回 available。完整原始观测保存在日志；它不是 execution_ready 或 cleanup complete，也未允许覆盖 owner。真正已结算的 teardown IO 失败有 cleanupFailed 并显示 cleanup_incomplete。本次未改变此只读检查的语义。

# 检查与证据

- 基线及修复后的 Node24 `pnpm typecheck`：通过，均包含全 workspace build 和根 noEmit；构建有既有浏览器 use client 警告，退出0。Node26 复用当前构建执行根 tsc noEmit，亦通过；未声称 Node26 另做全 workspace 构建。
- `pnpm format:check`、`pnpm lint`、`pnpm lint:names`：通过。
- `.octospec/scripts/lint.py`：通过，618个OKF单元、20条规则、3865个本地文件链接；当前文档链接手动审计通过；`git diff --check` 通过。规则、任务、review 与 journal 均有规定 frontmatter。
- 附加 `scripts/checks/developer-doc-links.test.mjs`：9 pass / 2 fail / 0 skip，退出1；两项均在普通用户创建文件/目录 symlink 时被 Windows EPERM 拒绝，未进入相应链接判断。脚本、权限、默认开关均未修改，此环境前提失败不并入 #237 产品修复；保留全部失败日志，未批量 skip 或声称所有检查全绿。
- 证据包包含全部基线/修复测试原始日志、各命令 JSON、results.ndjson、安装/环境、Issue/PR只读快照、运行器、变更文件及 diff。初版7项探索通过不作为最终8项专项结果；基线失败日志保留。
- 本次不跑完整默认 `test:suites`。历史 #236 的旧架构全仓失败仅属于旧基线，不能推定当前全仓失败或通过。新增测试位于 test/manual，workflow、默认测试开关与 Gate 无 diff。

# 关闭条件与未验收边界

当前 Windows11、Node24/26、fake Provider 的取消回滚→新构造同 endpoint/state→RPC执行→完整关闭合同已按上述场景和轮次满足；已确认的当前原因链缺口有本地最小修复及前后对照。建议在用户审查、合入修复并完成适用共享平台回归后，用“旧执行路径由 #295 替代、当前合同已重新验收、取消回滚诊断已修复”的理由关闭 #237。不能写成“已定位并修复旧 Node26 replacement.initialize 或旧 rename EPERM 的根因”。若关闭政策要求找出旧版本的实际占用者/根因，该条件仍未满足。

未执行 Windows10、macOS/Linux、真实 Provider/模型/IM、Electron 实机、发行包安装和持续负载；本项不关闭 #14，也不处理 #238/#240/#241/#242。共享代码的 macOS/Linux 结果需后续实际执行，本机不作推定。没有提交、推送、创建 PR、发布评论、关闭或合并。

上述无远端写入事实对应首次本地验收阶段。后续用户明确授权“提PR”，重新 fetch 的 main 仍为相同基线；产品源码、手动专项与已验证产物保持一致，仅补充授权与交付记录。按此授权提交并推送本分支、创建上游 PR，关联 Refs #237 / Refs #14；合并、关闭及未执行验收仍由后续安排。CI 结果以 PR 实际 checks 为准，不由本地通过推定。
