---
type: Acceptance
title: 恢复规划的关闭门槛与执行证据
description: 保留原场景编号，明确新增门槛、双模式独立记录、计时方法与未执行状态。
tags: [testing, channel, lifecycle, ipc, stream]
timestamp: 2026-10-26T00:00:00Z
---

# 状态与证据

`PASS` 表示列出的断言在列出的模式与环境通过；`FAIL` 表示已执行但不满足；`BLOCKED` 表示缺少必需条件；`NOT_RUN` 表示尚未执行；`N/A` 必须附不适用依据。CI skip不计PASS，其他模式/平台的通过不填入本格。规划阶段全部实现门槛初始为NOT_RUN，部署合同门槛G03/G08为BLOCKED；用户随后提供账号，当前真实Codex子集见[live记录](live-verification.md)，不据此把完整G门槛改为PASS。首轮规划检查见[验证记录](verification.md)。

每个trial保存：完整源码SHA/dirty、发行物digest、部署revision、OS/arch/Node/服务管理器/Provider版本、mode、原S编号、idle/active、DM/group/thread、Bot数、配置的脱敏指纹、故障与可达时间、PID/instance/worker代次、旧Run关联代号与连续seq、四组direct结果、接收/准入/接纳/终态/回复回执、实际Provider接纳与副作用计数、资源计数、人工干预、判定和证据路径。含身份的原始材料位于仓库外受保护目录；入库只放脱敏结果，不存凭据或聊天正文。

# 计时合同

令 `t_ready` 为本次故障后宿主已唤醒、网络/DNS、所需IM与Provider依赖均恢复可达的最晚时刻。由与被测连接独立的探测和系统电源事件确定，不以被测服务重新online的时刻倒推，避免掩盖恢复耗时。

每个模式分别测量新direct探针和新IM探针；探针只要求固定短文本和无副作用操作。`t_ready` 后先等待status中的execution_ready及Bot重新online，再各发一个唯一请求，记录 `t_admitted / t_terminal / t_reply`；等待就绪本身计入同一窗口，不通过反复invoke探活。目标是在 `t_ready + 180秒`（含边界）前同时确认direct成功终态和IM回复回读；此为本计划验收目标，未经现场测量不能宣传产品SLA。若就绪一直不恢复则FAIL。180秒不是长任务完成上限，也不要求用户交互任务在该窗口完成。重新online前送出的消息另列为G10的离线投递试验，避免把未验证的replay能力作为G02前提。

静默WS故障当前超过90秒无包才判失联，每25秒检查，正常调度下发现约需90至115秒；这是源码推导，OS暂停和事件循环延迟可延长，必须实测。5/10/15秒是每次旧连接回收完成后的等待，不是从断网起计的总恢复时间。另记清理、请求超时、worker readiness及Provider耗时。

服务器有效Retry-After超过基本窗口时记录原值、接收点及实际延后，按解除服务端限制后的180秒窗口另判，基本窗口注明未满足及原因；不得把等待限制中的不可用标成原窗口PASS。认证/有效owner替换为终态对照，不适用暂态恢复保证。可达时刻或Retry-After缺证据则BLOCKED。

# G01-G12 关闭门槛

| ID | 动作及观察 | 通过条件 | 原断言 |
| --- | --- | --- | --- |
| G01 工具可信 | 两份live入口preflight、attach-only runner、平台carrier | 无网无凭据即可跑合同检查；旧host/签名失败，新kernel调用实际产生终态；旧退避断言移除；不生成第二Kernel | A07/A14/A25 |
| G02 新任务恢复 | 每个暂态故障后四组direct与新DM/群/话题 | 在容量允许且依赖可达条件下按计时合同完成；原服务对象/PID/Kernel instance不因普通故障重建 | A01/A06/A12/A13 |
| G03 reason12 | 单owner、竞争owner、Token更新、拒绝 | 部署revision及机器语义明确；单owner可恢复故障能恢复，有效替换不争抢；含糊协议不得关闭 | A03/A27 |
| G04 原事故 | MacBook真实一小时合盖，失败时分步取证 | 已识别版本的原环境或可核对等效环境重现两层失败并定位；修复后同条件自然恢复；未重现不宣称事故根因已确认 | A07/A27 |
| G05 旧Run真实性 | 丢ACK、断流、窗口过期、实例变化、worker丢失 | 原身份续流或准确lost/unknown；接纳与副作用计数不增加；旧失败不污染新abort/repair/队列 | A09-A12 |
| G06 双模式原生合同 | CLI独立组件、SDK同进程工厂，各自故障 | SDK无需CLI、外部顶层Node代启、宿主重连实现或整体重建；确认实际PID和socket归属 | A14/A26 |
| G07 自启与顺序 | 两种组件启动顺序、延迟worker、离线登录 | 用户登录管理器实际启动；新任务随后成功；SDK采用宿主自启策略且不反复initialize掩盖故障 | A06/A15 |
| G08 真实健康 | WS黑洞、IPC不通、worker不ready、Provider拒绝、发送失败 | 分层状态/诊断可判；任务错误不伪装WS断线；云端presence按部署确认期限失效或降级 | A04/A24、#42 |
| G09 资源与隔离 | 至少10轮、单/四Bot、真实饱和对照 | 每轮settled后连接/订阅/worker/计时器无额外残留；一个Bot终态不阻碍其他Bot；128登记等上限明确拒绝而非清空未知记录 | A05/A17 |
| G10 消息与收尾 | 断网前/中/后触发、重复RECV、ACK丢失、活动中断 | 服务端实际replay/ACK边界明确；支持窗口内不重复执行；最终卡片/文本不把ACK当完成；不承诺#78完整历史 | A10/A16、#30/#78 |
| G11 平台与Provider | 两模式×已配置Provider，macOS全矩阵，Windows/Linux支持矩阵 | 每个事故涉及Provider分别执行控制、S03、S06、S08及新任务探针；不以fake或单Provider代表全部；平台缺口有影响、责任角色与#14等入口 | A13/A15/A23/A27 |
| G12 工程交付 | 全量测试/类型/lint/docs/包外tgz及verified-review | 无未处置critical/high；medium有修复或明确处置；主线规则与指南一致，发行包公有API可用，未跑项公开 | A18-A27 |

G02/G06的CLI和SDK结果必须分别存在；G04不能由SIGSTOP或改时钟替代。Windows/Linux硬件不支持的行允许N/A并给依据；已有系统支持但无设备只能NOT_RUN/BLOCKED。若未验项影响对外承诺，则对应承诺保持未验，不能用平台gap登记代替通过。

# 回归检查 R1-R7

| ID | 入口 | 最少覆盖内容 |
| --- | --- | --- |
| R1 | `test/im-connection-state-machine.test.js` | 初始离线、5/10/15/15、Retry-After、reason12终态对照/未来安全分类、半开、迟到回调和close |
| R2 | `test/kernel-heartbeat.test.js`、`kernel-worker-supervision.test.js`、`kernel-worker-recovery.test.js` | 时钟间隔、真阻塞、迟到pong、快速预算后低频恢复、清理失败、停止时无迟到启动 |
| R3 | `test/kernel-recovery-matrix.test.js`及高层invoke测试 | 旧/新client/session、ACK丢失一次接纳、3次/10秒修复耗尽、TTL/gap/instance变化后新请求 |
| R4 | `test/recovery-dual-mode.test.js` | 现有两模式试验加Gateway先启动、黑洞、重复故障；低层submit对照外另覆盖实际invoke；各模式独立计数 |
| R5 | M1计划新增的`test/recovery-probes.test.js` | public导出、依赖/输入合同、checkpoint保留旧client、拒绝额外Kernel、失败清理、无网preflight |
| R6 | `test/extra-status-logs.test.js`及状态/投递/容量回归 | 现有白名单/背压/三文件边界；#118接纳前与接纳后丢流对照；新任务仍可执行，饱和如实拒绝 |
| R7 | `pnpm test`、静态/docs和包外tgz | 跨包调用、其他Extra、公开SDK和装配未退化；Windows显式选表包含适用新增测试，不整文件放宽skip |

# 真机矩阵登记

原[完整S01-S14定义](../93-sleep-wake-recovery/acceptance.md#真机故障矩阵)继续适用。下面仅S01/S08/S10有当前macOS/Codex真实子集；其余保持初始状态。实际每种Provider/负载/频道/Bot数各建trial，不能用一次PASS覆盖整个组合。

| 原ID | 场景 | CLI | SDK |
| --- | --- | --- | --- |
| S01 | 在线及仅锁屏控制 | 在线控制PASS；锁屏NOT_RUN | 在线控制PASS；锁屏NOT_RUN |
| S02 | 真睡眠1-2分钟 | NOT_RUN | NOT_RUN |
| S03 | 真合盖约1小时 | NOT_RUN | NOT_RUN |
| S04 | 过夜与至少10轮，电池和AC | NOT_RUN | NOT_RUN |
| S05 | 唤醒后离线5-10分钟再恢复 | NOT_RUN | NOT_RUN |
| S06 | 清醒断网1分钟和1小时 | NOT_RUN | NOT_RUN |
| S07 | Wi-Fi/热点/IP变化及适用VPN | NOT_RUN | NOT_RUN |
| S08 | WS黑洞、DNS/IM/Provider分别失联 | 局部WS关闭/鉴权失联PASS；其余NOT_RUN | 局部WS关闭/鉴权失联PASS；其余NOT_RUN |
| S09 | Gateway正常和异常生命周期 | NOT_RUN | NOT_RUN |
| S10 | Kernel与worker分别终止 | direct活动worker丢失PASS；其余NOT_RUN | direct活动worker丢失PASS；其余NOT_RUN |
| S11 | 重启登录，在线及初始离线自启 | NOT_RUN | NOT_RUN |
| S12 | 两种启动顺序和worker延迟 | NOT_RUN | NOT_RUN |
| S13 | 注销登录或宿主重开 | NOT_RUN | NOT_RUN |
| S14 | owner竞争/Token变化/认证拒绝 | BLOCKED：部署合同 | BLOCKED：部署合同 |

本轮loopback结果只在verification记录为受控基线，不改写上述真机格。发生G04失败时先保留现场、再做plan中的独立workaround trial。
