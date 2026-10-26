---
type: Design
title: 恢复缺口的源码依据与修复决策
description: 区分现有主线能力、验收工具缺陷、待复现产品边界和部署侧决策。
tags: [channel, ipc, lifecycle, architecture, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 固定基线事实

以下路径基于 `8af836068780ebb76581225254ad7bef18cc8170`。从初始`a35aeae`同步后，相关Gateway/Kernel/Host恢复源码及规则字节未变；DSH作为新增Provider纳入后续已配置Provider矩阵。行号用于定位，实施前重新核对。源码确认不等于事故复现。

| ID | 源码入口 | 本轮确认的事实与动作 |
| --- | --- | --- |
| F01 | `packages/octo-runtime-extra-channel-gateway/src/application/im-channel.ts:217,257` | 暂态首次连接会重试，退避已为 5/10/15/15 秒；沿用实现和现有状态机测试 |
| F02 | `packages/octo-runtime-extra-channel-gateway/src/transport/wukong.ts:324,351` | 25 秒检查一次，距最后包大于 90 秒时关闭；服务端 DISCONNECT 仍全部不可重试，包含 12 |
| F03 | `packages/octo-runtime-executor-kernel/src/heartbeat.ts:21,33,57` | 长间隔或回拨废弃旧 probe，新 probe 有完整 5 秒期限；不能将旧心跳缺陷列作未修复事实 |
| F04 | `packages/octo-runtime-executor-kernel/src/supervisor.ts:131` | 快速额度后持续串行 15 秒冷却，清理或所有权失败仍终止替换；不重绑本地监听 |
| F05 | `packages/octo-runtime-executor-kernel/src/client.ts:176,234,345` | 高层 invoke 管理登记；订阅沿原身份有界修复；ACK 不明查询原请求，不重新提交 |
| F06 | `packages/octo-runtime-host-sdk/src/extra-service.ts:101` | kernel_available 来自 status.execution_ready；它不证明 Provider 认证或回复已投递 |
| F07 | `scripts/verify-channel-connection-live.mjs:108,130,166` | 仍有旧 host 依赖、旧 cancel 名和 5/10/20/30/30 秒断言；现有重连验收入口不能作为新合同证据 |
| F08 | `scripts/verify-im-diagnostic-live.mjs:8,88` | 内部 spawnWorker/invokeFrames 仍存在，但 Gateway 的 host 依赖不符合当前 kernel 合同；迁移为公共服务入口时同步保留诊断断言，不能误报内部导出已删除 |
| F09 | `test-support/recovery-kernel-probe.mts:6,23` | 只导出函数，走 submit/subscribe；矩阵函数没有故障 checkpoint，不能直接作为 CLI 或跨睡眠高层 invoke 验收 |
| F10 | `test/recovery-dual-mode.test.js:37` | 两模式实际服务、loopback IM 与 counted fake Provider；仅覆盖离线503、WS断线和活动worker丢失，CLI Windows 分支跳过 |
| F11 | `.octospec/scripts/lint.py` | 当前已允许 docs 目录；旧任务的 docs 断言冲突不适用于新基线，本轮基线是四份旧文件缺少 frontmatter |

# 关联工作处置

| 来源 | 本规划使用方式 | 实施边界 |
| --- | --- | --- |
| [#93](https://github.com/Mininglamp-OSS/octo-runtime/issues/93)、[#42](https://github.com/Mininglamp-OSS/octo-runtime/issues/42) | 核心验收：新 direct 和 IM 请求恢复，在线状态不冒充完整执行健康 | 两个 P0 的关闭各自对照验收，不因 PR96 合入关闭 |
| [PR96](https://github.com/Mininglamp-OSS/octo-runtime/pull/96) | 现有共享恢复与状态日志 | 保留实现及测试，不恢复旧退避策略 |
| [#47](https://github.com/Mininglamp-OSS/octo-runtime/issues/47)、[#48](https://github.com/Mininglamp-OSS/octo-runtime/issues/48)、[#49](https://github.com/Mininglamp-OSS/octo-runtime/issues/49) | 本地服务、客户端及宿主的责任 | 旧 issue 的 owned/proxy 草案已被 [#71](https://github.com/Mininglamp-OSS/octo-runtime/issues/71) 与当前架构原生服务合同取代 |
| [#139](https://github.com/Mininglamp-OSS/octo-runtime/issues/139) | 两份 live 脚本的旧 host 绑定是已记录的验收工具问题 | M1 处理同一根因，不另建重复 issue，不算产品网络恢复故障 |
| [#120](https://github.com/Mininglamp-OSS/octo-runtime/issues/120) | 其他 live 脚本存在旧输入签名和 runtimeLimits | 本任务接入的工具必须迁移；其余 Provider 验收入口按该 issue 协作，不全仓改写 |
| [#142](https://github.com/Mininglamp-OSS/octo-runtime/issues/142) | Windows 裸 npm/octo-cli 启动失败 | M1 复用平台命令解析；先做无网版本查询，再允许 live |
| [#118](https://github.com/Mininglamp-OSS/octo-runtime/issues/118) | 已知接纳前错误被展示成 unknown 的诊断混淆 | M3 加正反对照；不能据 unknown 文案断言 Kernel 已接纳或 socket 坏了 |
| [#78](https://github.com/Mininglamp-OSS/octo-runtime/issues/78) | 断网前中后触发、ACK 与 replay 观察 | 不引入持久任务队列、不自动重放、不承诺完整历史恢复 |
| [#30](https://github.com/Mininglamp-OSS/octo-runtime/issues/30) | 活动任务中断和最终卡片真实性 | 复用现有3秒 drain/4秒清理预算，离线不能承诺通知必达 |
| [#14](https://github.com/Mininglamp-OSS/octo-runtime/issues/14)、[#134](https://github.com/Mininglamp-OSS/octo-runtime/issues/134)、[#131](https://github.com/Mininglamp-OSS/octo-runtime/issues/131) | Windows 真机、任务XML、异常后代清理 | #134 已在其他 Windows 基线复现；本轮仅确认 issue 内容，未在 macOS 重现 Windows 故障；平台门槛保留 |

# D1 部署 reason 12 与在线状态

M2 由 IM 服务维护角色提供实际部署 revision、reason-code 表、12 的全部触发点、是否能区分旧连接淘汰与有效 owner/Token 替换，以及服务器连接/心跳的在线过期规则。旧任务记载的本地 octo-im 源码只能作为线索，本轮未核实该 checkout 或部署，不升级为部署事实。

| 取证结果 | 后续实现 |
| --- | --- |
| 可信机器字段明确表示暂态关闭，且原 owner 仍有效 | 在 Gateway 最窄错误分类边界允许重试，沿用单连接清理、代次和退避；旧 SDK 调用方无需额外重连 |
| 可信证据表明其他有效 owner 接管、Token失效或认证拒绝 | 保留 failed，不自动抢回；其他 Bot 保持各自恢复；明确提示所属宿主/用户处理认证或所有权 |
| 仅一个 reason12 同时表示两类情况，客户端无法可靠区分 | reason12 保留终态；IM 服务需提供可验证的机器合同及版本兼容策略，未部署并验证前 G03 阻塞 |

不得仅根据重试次数、休眠时间或可读 reason 文本授权接管。若服务合同新增字段，M2 先确定 wire 格式、版本协商与旧服务行为，再改客户端和 fixture；未知字段组合按原终态处理。

Gateway 的 online 只表示业务 WS 建联；本地 status 分别展示服务、IPC、execution_ready 和 Bot 状态，Provider/任务/投递失败用各自诊断。服务端维护实际 presence 与失联过期；客户端在网络分区中不能立即发布离线。以部署确认的过期上界检查第三方可见 presence，不新增 REST 心跳或云端在线账本。过期上界未取证则 G08 不通过。

# D2 执行边界与无重跑

故障发生后先保存原 Kernel PID、instance、endpoint、worker generation，再对同 endpoint 检查 status/list 和真实高层 invoke。每次新探针使用唯一 runId/invocationId，结果未知时保留原身份，不再次 invoke。四组测试在同一 Kernel 上组合故障前保留/故障后新建 client 与已有/新 session；已有 Provider session 必须由故障前实际成功回执得到，不能仅复用一个本地字符串冒充原生续聊。

| 观察 | 修复入口与反例 |
| --- | --- |
| status/list 也无法到达，OS 监听与原进程不符 | server/endpoint/宿主生命周期；复现 bind/close 竞态，不能仅凭 socket 文件存在就 unlink/rebind |
| IPC可达，execution_ready=false | supervisor/process/heartbeat；覆盖真正 worker 阻塞、清理失败和冷却，不取消所有权保护 |
| worker就绪，只有旧Provider session失败 | 对应 Adapter 的会话/传输；不静默换模型、Provider或session，明确错误与新session对照 |
| Provider接纳/终态存在，观察失败 | client/源窗口；原ref/连续seq修复，缺口、过期、instance变化按合同报错 |
| direct调用成功，IM无回复 | 按接收、准入、准备、执行、卡片、最终投递逐层定位，检查队列与旧abort污染 |
| socket/订阅或占额逐轮累积 | 责任层回收已确认资源；未结束依赖和未知执行仍占额，不清空登记或提高上限掩盖 |

不预设上述哪一分支就是原事故原因。针对 #118 的接纳前展示失败、明确拒绝与接纳后丢流分别计数，前两类不得伪报已执行未知，后一类继续保守 unknown。已接纳 Run 无法恢复时保留 lost/unknown；新请求在容量允许时仍可完成。达到现有128条未知登记等真实上限应明确拒绝；无限处理新请求不是本计划承诺，扩容或回收未知记录需要独立合同。

# D3 工具与证据

M1 为两份 live 脚本增加不连网的 preflight：在网络、账号读取和服务启动前选择该模式；检查有效公共导出、当前 InvokeInput、kernel.invoke/cancelInvocation/respondInteraction、退避以及平台 carrier。错误认证输入在运行期生成，不保留旧固定凭据占位值。入口不得吞掉原始 spawn errno 或把工具失败算产品恢复失败。

扩展已有 `test-support/recovery-kernel-probe.mts` 为实际可调用的 checkpoint runner，保留低层序号检查，另加公共高层 invoke。runner 在故障前持有客户端，在人工 continue 后创建 fresh client；不启动或替换被测后台 Kernel。新 native 宿主入口使用直接 import 模块和显式 workerEntrypoint，不把现有 manifest fixture 推广为 SDK 接入要求。每个阶段都检查真实终态及清理结果，失败后继续回收独立资源并保留原 cause。

诊断日志继续使用现有状态白名单，不加入 message/session/run 标识或正文。专用 trial 的关联身份只保存在仓库外受保护证据中，公开结果仅保留脱敏关联代号、计数和稳定错误码。测试不能清空真实 Home、争抢生产 Bot 或切断用户当前网络；真机故障在专用目标上按手工步骤执行。
