---
type: Plan
title: 恢复缺口分阶段实施计划
description: 按工具预检、部署取证、最小修复、自动化和真实双模式验收列出文件、依赖、退出与回退条件。
tags: [testing, lifecycle, channel, ipc]
timestamp: 2026-10-26T00:00:00Z
---

# 阶段依赖

首轮完成规划；下表为完整实施步骤。随后用户提供账号并授权E2E，已新增`scripts/verify-recovery-live.mjs`，先执行无需部署变更的真实Codex恢复子集，结果见[live记录](live-verification.md)。该子集不代表整个M1或M5完成，旧工具迁移、无网preflight及手动checkpoint仍待补齐。M0 → M1；M1后可分别准备M2与M4，reason12修复必须等M2的机器合同；M3的产品修复必须有对应失败证据。M5依赖M1、M2和适用的M3/M4，M6汇总实际结果。

| 阶段 | 文件与动作 | 验证和退出条件 | 失败处理 |
| --- | --- | --- | --- |
| M0 固定基线 | 记录新main/发行物SHA与digest、OS/Node/Provider版本；重读本任务及现行规则；建立仓库外trial目录 | build和R1/R2基线有实际结果；既有失败和skip单列，原工作树不改动 | 基线失败先保留完整错误，不复制邻近worktree的dist当作本基线产物 |
| M1 工具 | 修改 `scripts/verify-channel-connection-live.mjs`、`scripts/verify-im-diagnostic-live.mjs`；扩展 `test-support/recovery-kernel-probe.mts`、`recovery-native-host.mts`；新增 `test/recovery-probes.test.js` 和 `scripts/verify-recovery-live.mts` | 无网preflight能实际调用当前kernel合同；5/10/15/15断言；attach-only高层探针终态正确；故意旧依赖及非公开发行入口被拒；Windows载体版号查询有证据 | preflight失败不得进入live；沿#139/#142修同一根因，保持原诊断/投递断言；不临时绕过工具继续声称通过 |
| M2 部署合同 | 在本任务证据中记录IM部署revision/错误码/owner/在线过期/ACK与replay；对照`wukong.ts`、`connection-error.ts` | 单owner、第二owner、Token变化分别有服务端原因与客户端状态；按D1选择分支并登记服务维护角色 | 不能区分则维持终态，记录服务端变更所需合同与阻塞G03，不盲改retryable |
| M3 最小修复 | 仅修改证据命中的`transport/*`、`application/im-channel.ts`、`execution/task.ts`、Kernel `client/server/endpoint/supervisor/process` 或具体Adapter；按#118处理阶段误判 | 同一最小复现在旧代码失败、新代码通过；另一个不经过修复入口的调用方通过；未知执行次数不增加、清理失败不启动替身 | 失败保留原endpoint/状态取证；撤回本阶段实验改动，不撤回用户工作，不重置Home，不创建规避式整服务重启 |
| M4 回归 | 扩展`test/im-connection-state-machine.test.js`、`kernel-recovery-matrix.test.js`、`recovery-dual-mode.test.js`、`recovery-im-fixture.js`；按需扩展心跳/监督和容量测试 | R1-R7按适用范围通过；两模式分别跑；启动顺序、黑洞、旧Run后新invoke、10轮循环、饱和对照有计数 | 失败不提高超时/容量或增加skip换通过；确定是fixture问题则先修fixture并保留失败记录 |
| M5 真实验收 | 用M1入口在专用macOS目标执行原S01-S14；每个mode/Provider/负载/频道/Bot数单独记录；另做Windows/Linux支持场景与登录自启 | 收集G02-G11逐项证据，G01沿用M1结果，G12由M6执行；#93报告的一小时和两次重启边界在重启前捕获；新direct和IM均完成 | BLOCKED/NOT_RUN不得算PASS；#134/#131影响Windows试验时沿原issue跟踪；服务重启workaround是单独诊断trial |
| M6 收尾 | 更新CLI/SDK指南、`docs/en`和`docs/zh-CN`排障、受影响规则及索引；新建实施记录，重跑verified-review | 差异逐文件审查、静态与回归、包外tgz、公有API及模式证据均明确；P0关闭表全部满足 | 未具备现场证据只交付已确认修复，两个P0保持开放；提交/PR/合并按当时用户授权处理 |

# 执行命令与结果解释

所有现有命令从当前 worktree 根执行。先安装锁定依赖，再完整构建，避免检查时读取正在清理的dist。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node --unhandled-rejections=strict --test test/im-connection-state-machine.test.js test/kernel-heartbeat.test.js test/kernel-worker-supervision.test.js test/kernel-worker-recovery.test.js test/kernel-recovery-matrix.test.js test/recovery-dual-mode.test.js test/extra-status-logs.test.js
```

后续实现跨包合同时执行以下门槛。M1新增preflight入口尚未实现，不能把设计中的命令当作当前可用入口；M1完成时记录真实调用命令及参数。

```sh
pnpm test
pnpm lint
pnpm lint:names
pnpm exec tsc -p tsconfig.json --noEmit
pnpm docs:check
pnpm format:check
node scripts/pack-release.mjs
```

发行包检查使用上一步实际输出的tgz路径和实际源码完整SHA，调用 `node scripts/verify-release.mjs <tgz> --expected-commit <sha>`；只有产物确实来自干净提交时才附 `--require-clean`。不为满足验证而伪造版本、SHA或clean标志。规划文档只跑知识、链接、上下文和文本检查，本轮额外构建/定向回归用于核对当前能力，不替代后续产品修复验收。

# 故障现场步骤

1. 固定隔离Home/profile和专用测试Bot，禁止其他owner；记录部署、Provider和服务管理器版本，先完成DM、有效群/话题及direct控制请求。
2. checkpoint runner保留既有client和实际Provider session；活动trial先记录接纳ref和最后连续seq，再手工执行该行故障。
3. 唤醒、链路、DNS、IM和Provider分别记录可达时间；自然恢复观察按[计时合同](acceptance.md)执行，先不重启。
4. 故障仍在时采集 `octo-runtime --home <trial-home> status --json`、两组件status、doctor及 `channel-gateway logs --json`。占位参数须替换为本trial路径；SDK另保存其原生status。日志和截图先脱敏。
5. 对原endpoint执行四组高层探针和新IM请求。direct调用不得创建临时Kernel；playboard只可作为另标的Provider配置对照。每个未知探针保留身份后停止，不能用重试再次执行同一请求。
6. 自然恢复失败后先保存证据，再在独立trial分别测试Gateway-only、Kernel-only、Gateway→Kernel、Kernel→Gateway；每次重启之间重复direct/IM探针。重启后结果不代表自然恢复成功。
7. 验证旧Run实际终态、卡片/文本与新任务；停止测试服务，确认清理结果，保留失败cause和未回收资源。只删除本trial拥有的临时资源。

# 责任与回退

Runtime维护角色负责M0/M1/M3/M4/M6；IM服务维护角色负责M2部署合同和服务端修复；CLI/SDK测试执行角色分别负责M5及对应平台。实际人员、测试设备和部署版本在M2开工记录中填入，目前未指派，不能假定已有环境。

每阶段保持可独立审阅的差异；本任务不预授权commit。产品实验通过前保留当前主线行为；服务端合同不可用时保留终态并报告阻塞。不得通过更改真实凭据、Home身份、Provider原生数据或宿主数据库回滚。
