---
type: Acceptance
title: Issue 93 双模式验收与证据合同
description: 将恢复、终态、无重复执行、状态日志和真机矩阵映射为可观测断言。
tags: [testing, channel, ipc, lifecycle, stream]
timestamp: 2026-10-22T00:00:00Z
---

# 统一断言

实施后的逐项状态见[实施与验证记录](implementation.md#验收映射)，受控回归与真机结论分别记录。`PASS` 必须附 evidence 文件、mode、build 和时间；缺少环境用 `UNEXECUTED`，失败用 `FAIL`，不适用用 `N/A + 原因`。CLI 通过不能填入 SDK 栏。T1 的 180 秒是拟定验收界限；Retry-After 的延期不直接算通过。下方 S01-S14 真机矩阵仍全部未执行。

| ID | 验收动作 | 必须观察的结果 | 阶段 |
| --- | --- | --- | --- |
| A01 | 首次 AUTH/REGISTER DNS、网络、timeout、429/503 失败后恢复 | 原 Extra 服务不重新 initialize 即上线；离线时 retrying、非 online | M2 |
| A02 | 连续暂态失败并推进 timer | 等待严格为 5/10/15/15/15 秒，成功后回到 5 秒；延迟唤醒只触发一次，不补跑；长 Retry-After 不绕过/溢出 | M2 |
| A03 | 单 owner reason12、第二进程/设备、Token 更新、401/403/拒绝 | 部署语义有证据；暂态可恢复，真替换不夺回；其他 Bot 不被带停；未知 12 不假通过 | M0/M2 |
| A04 | WS 黑洞无 close，乱序 error/close，迟到 handshake/pong | 检测失联、一次回收/重连；旧 epoch 不修改新状态；fresh IM 仍可执行 | M1/M2 |
| A05 | 挂起后恢复中 close/abort；清理失败/不 settle | 停止后无迟到连接；真实未回收保持 incomplete，不能并发 owner；内部正常断网清理可结束 | M2 |
| A06 | Gateway 先于 Kernel，离线登录启动，两种组件顺序 | Gateway 保持自身状态，Kernel 就绪后同一 client 发新请求；无服务重建、无 SDK 重连代码 | M2/M5 |
| A07 | 故障现场同 endpoint status/list/invoke 与 OS listener 对照 | 能定位 listener、worker、Provider 或观察层；不把 socket 存在/WS online 当作执行通过 | M0/M3 |
| A08 | 父子暂停、仅父暂停、墙钟跳变、两种 pong/tick 顺序 | 健康 worker 不因旧时间差直接误杀；真实失联仍在新探针完整预算后回收；旧 pong 无法确认新 probe | M1/M3 |
| A09 | worker crash、阻塞、快速额度耗尽、连续启动失败、清理失败 | 旧 Run 唯一 lost、无重跑；快速额度耗尽后串行15秒冷却，环境恢复后同Kernel新调用通过；close取消冷却；清理失败不启动替身 | M3/M7 |
| A10 | invoke 已接纳但 ACK 丢失；cancel/respond ACK 丢失 | 只查原身份；Provider admission/副作用为 1；未知控制不重发，未写出请求为 0 | M3 |
| A11 | 订阅断线、3 次/10 秒修复耗尽、gap、TTL、实例改变 | 原 ref/连续 seq 恢复或准确失败；不造终态、不续到新实例；native/canonical 都满足 | M3 |
| A12 | 中断旧任务后发新任务，四组 client/session 交叉 | 原服务对象继续工作；新请求真实完成；旧 unknown 不自动重跑、不污染新 repair/abort/队列 | M3/M5 |
| A13 | 两模式的每个可恢复场景 | t_ready 后目标时间内新 direct Kernel 与新 IM 请求完成；WS online 单独不通过 | M5 |
| A14 | SDK 公共入口直接构造、配置/Provider 同 CLI | 宿主与服务 status.pid 相同；服务未外部 CLI/Node 代启；恢复不重建对象、PID、initialize | M1/M5/M6 |
| A15 | CLI 真实登录自启、在线/离线、重启与退出 | 由已安装用户服务自动启动；每组件独立；未登录不声称运行；正常网络恢复不靠 OS 反复重启 | M5 |
| A16 | 断网前/中/后消息、ACK 丢失和重放 | 记录 server replay/ACK 合同和本地去重范围；支持窗口内无重复执行；缺口/未知与 #78 分开，不声明全量补偿 | M0/M5 |
| A17 | 至少十次循环，记录每轮资源及饱和对照 | settled 后 socket/订阅/timer/worker 不逐轮累计；无卡住队列；未确认占额如实报告并解决永久阻塞；不扩大上限掩盖 | M3/M5 |
| A18 | 前台 Extra run 与后台 logs --json 对照 | 相同状态行确实写 stdout 且有镜像；包含生命周期、连接、重试等待、Kernel 可用性和清理失败 | M4 |
| A19 | 输出 payload 含假的 Token/聊天/模型/工具内容 | logs 仅白名单组件状态；无 message/session/run 标识、正文/工具参数/原始异常；SDK 默认 stdout 静默 | M4 |
| A20 | 默认 logs、--lines、--json、无日志、停止后读取 | 默认最近200条正序；NDJSON可解析；参数上下界、读取4MiB上限、无日志与权限失败符合 D2 | M4 |
| A21 | --follow、SIGINT、小时轮转、截断、UTF-8 跨块、symlink | 不重复整文件、不跨 Home/Extra、不越目录跟随；退出释放资源且不改变服务状态 | M4 |
| A22 | 日志高压/磁盘失败/stdout 慢或断管 | stdout待写≤128条且≤1MiB；无无限队列、不阻塞恢复；dropped 可见；三个实际文件/100MiB限制生效 | M4 |
| A23 | macOS/Linux/Windows 后台启动后读 Extra logs | 共同状态镜像可读；无 Windows shell 重定向依赖、无 worker NDJSON 污染；未实测平台如实 gap | M4/M5 |
| A24 | status 展示与故障追踪 | service/IPC/worker/Bot/观察/投递分别可判断；安全错误码能追到失败层，查询不启动模型 | M4 |
| A25 | 全量 lint/types/tests/docs + 包外 tgz strict fixture | 共用实现与公开导出成立；现有调用/清理合同未退化；不以 workspace 成功代替发行包 | M6 |
| A26 | 检查源码、拓扑、数据与文档 | 无 Gateway 重启 Kernel、定时整服务重启、身份重建、聊天持久化、新原生依赖；15秒新合同与终态限制一致 | M6 |
| A27 | 汇总事故与两模式证据 | 两层失败边界均有证据；reason12安全策略成立；真实一小时/重复/自启已测；平台gap写明角色与后续入口 | M6 |

# 真机故障矩阵

每行在 CLI 与 SDK 分别执行。除纯生命周期/终态对照外均运行 idle 与 active；可接收消息的行覆盖 DM 和有效 group/thread 触发、单 Bot 与四 Bot。active 保存旧 Run 的真实结论，再单独验证恢复后新请求。模式、负载、入口、Bot 数量分别作为证据维度，不能合成一个 PASS。

| 场景 | 故障/持续时间 | CLI 特有检查 | SDK 特有检查 | 关联断言 | CLI / SDK |
| --- | --- | --- | --- | --- | --- |
| S01 控制 | 持续在线；锁屏/解锁但不睡眠 | 两个独立用户服务 | 最小直接构造宿主 | A07/A13/A14 | 未执行 / 未执行 |
| S02 短睡眠 | 真合盖/系统睡眠1-2分钟 | 服务PID保留 | 对象/PID/initialize保留 | A04/A08/A12/A13 | 未执行 / 未执行 |
| S03 报告睡眠 | 真合盖约1小时 | 保存两阶段故障及分步workaround | 独立复现共享层，不外推事故 | A03/A07/A12/A13 | 未执行 / 未执行 |
| S04 延长与重复 | 过夜、≥10次循环；AC与电池 | 无服务重启/残留累积 | 无宿主重建/残留累积 | A08/A17 | 未执行 / 未执行 |
| S05 唤醒仍离线 | 无网5-10分钟后恢复 | 服务存活、不可用诚实 | 同服务后台恢复 | A01/A12/A13 | 未执行 / 未执行 |
| S06 清醒断网 | 1分钟、1小时两档 | 与真实挂起区分 | 相同依赖/Provider | A02/A12/A13 | 未执行 / 未执行 |
| S07 网络切换 | Wi-Fi→热点→Wi-Fi、IP变化、适用时VPN开关 | 不靠restart刷新路由 | 不靠host重建传输 | A04/A12/A13 | 未执行 / 未执行 |
| S08 部分/静默故障 | 分别黑洞WS、DNS失败、IM不可达、Provider不可达 | 本地IPC仍可辨识 | 共同错误与超时 | A04/A07/A10/A11 | 未执行 / 未执行 |
| S09 Gateway生命周期 | 正常关闭/重启；单独异常终止 | 原生管理器恢复，健康Kernel不动 | 宿主按公共close/新建；非普通唤醒路径 | A05/A12/A15 | 未执行 / 未执行 |
| S10 Kernel/worker生命周期 | 分别restart/kill Kernel、kill worker | Gateway随后可用 | 仅显式故障可由宿主重建Kernel；worker内恢复 | A09/A11/A12 | 未执行 / 未执行 |
| S11 重启与登录自启 | 主机重启后登录；联网与初始离线 | 不手动start，两种服务顺序 | 宿主自启策略直接initialize；不要求SDK装OS服务 | A01/A06/A15 | 未执行 / 未执行 |
| S12 启动顺序 | Gateway先/Kernel先/延迟worker ready | 同独立服务 | 同原生对象实现 | A06/A14 | 未执行 / 未执行 |
| S13 注销/登录或宿主重开 | 实际用户会话行为 | 用户服务策略与残留owner | host重开按支持生命周期 | A05/A14/A15 | 未执行 / 未执行 |
| S14 owner与终态 | 第二进程、第二设备、Token更新、无效凭据、拒绝 | 无自动抢占循环 | 同策略、其他Bot健康 | A03/A19/A24 | 未执行 / 未执行 |

macOS 执行全部矩阵。Windows 和 Linux 执行其支持的 suspend/resume、用户管理器启动/离线/顺序及 logs；硬件不支持的行填 N/A 原因，未具备环境填 UNEXECUTED。无法执行时在 evidence 表给出平台、缺口、执行角色、关联后续 issue/入口和影响，禁止写“三平台验证完成”。若缺口影响声明的恢复保证，不能以记录 gap 代替该保证的验证。

# 每个 trial 的证据字段

`trial_id / mode / scenario / idle|active / DM|group|thread / bot_count / build / OS / Node / Provider / fault_start / wake / link_up / DNS_ready / IM_ready / provider_ready / t_ready / Retry-After / retries_and_codes / identities_before_after / direct_probe_existing_fresh / IM_reply_receipt / old_RunRef_and_seq / old_outcome / admission_count / side_effect_count / resource_counts / t_admitted / t_terminal / t_reply / recovery_ms / manual_intervention / verdict / evidence_paths`。

证据用外部受保护目录保存，任务文档只记录脱敏引用和结论。计数器必须来自 fixture/Provider 接纳和输出回执，不能仅统计请求发送次数。自然恢复试验的 manual_intervention 必须为 false；workaround trial 明确为诊断，不计自然恢复 PASS。
