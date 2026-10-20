---
type: Acceptance
title: Gateway 与 Windows 生命周期验收矩阵
description: 用真实事件顺序、进程句柄和发行包验证两项 P1，不以退出码或取消 ACK 代替清理。
tags: [testing, lifecycle, channel, windows, ipc]
timestamp: 2026-10-20T00:00:00Z
status: in_progress
---

# 记录口径

2026-10-20 修订：Gateway G/I 验收继续有效；下文 Windows Job/broker W 矩阵属于已撤回方案，不再要求引入原生实现。当前 Windows 检查仅证明 Node.js 生命周期、Gateway drain 和发行包行为，不能证明父进程先退或 Runtime 强杀后的后代必然回收。新增必须满足：公共产品无 Go helper、原生 addon、随包/隐式下载二进制；取消 Promise 立即被观察；drain 期间所有规则/历史持久化及必需卡片终态失败进入 incomplete，重复关闭保留失败，其他 finalizers 仍被尝试。

下表保留验收要求；已执行范围见[实施记录](implementation.md)和[脱敏验收记录](../../journal/shared/2026-10-20-gateway-drain-windows-owner.md)。未覆盖的子场景不得随整行测试通过而自动计为完成。每项记录 SHA/dirty、OS/架构、Node/Go、命令、预期、实际、耗时、PID/创建身份与脱敏日志。
使用闩锁控制 admission、cancel ACK、session.update、terminal、final send 和 close；不靠增加 sleep 掩盖竞态。
“通过”必须满足结果与资源两类断言；平台跳过、环境不可用、交叉编译分别记录，不能计入通过数。

## Gateway

| ID | 操作/故障 | 必须观察到的结果 |
| --- | --- | --- |
| G01 | 普通完成，无 stop | 既有文本、binding、卡片投影与 final 身份不变，无额外模型调用/网络步骤 |
| G02 | 已接纳任务后 Extra stop，cancel ACK 先返回，terminal 后返回 | ACK 后连接和原订阅仍存活；真实 terminal 与 Gateway 消费/保存完成后才关闭；final 最多一次 |
| G03 | stop 后到达 session.update，再到达取消终态；并发规则失效 | 当前 session/generation 保存成功，store 在写入后释放；跨代次更新拒绝；不补造 Provider binding；保留较新的rulesContext revision和历史游标 |
| G04 | terminal=completed 与 cancel 交错；重复 terminal | 原已接受 completed 不改 cancelled；不重复投递；重复/非法帧按原协议处理 |
| G05 | cancel ACK 有、terminal 无；Kernel disconnect 或 ACCEPTANCE_UNKNOWN | 到 drain 截止仍是未确认；无新 invoke，cleanup.complete=false，必要的 final 使用原未确认投影 |
| G06 | final 失败、网络离线、发送挂起或无 ACK | 不重建连接；所有尝试共享剩余时间；失败可见，connector/store/log 仍尝试关闭 |
| G07 | 排队、准备中、退避中、审批 pending、stop 与 reset/新消息并发 | 停准入立即生效；准备取消不产生迟到 invoke；无 retry；原交互失效；新代次不受旧回调覆盖 |
| G08 | 两个 Extra、共享 Kernel、另有 attached Run，只停 Gateway | 只取消 Gateway 所属 Run；兄弟 Extra/Run/Kernel 保持可用；附加客户端 close 不变 |
| G09 | 重复/并发 stop，dispose/store/日志失败及截止 | 同一清理结果，独立 finalizer 均被发起；失败不能重复 stop 变成功；同名替换被阻止 |
| G10 | initializer 未完成或 owner 退出；WeCom/无业务 drain 的插件回归 | 初始化能取消；独立 runner 无迟到 ready；4秒/4.5秒预算不叠加；无关 Extra 不被强制执行 Gateway 回复策略 |

G02/G03 必须有真实独立 runner+Kernel 版本，不能只测同进程 ExtraPlugins。
自动化至少覆盖 Gateway 受控 fake transport；另以 im-test 验证真实业务 final 到达与断连顺序。

## Windows

| ID | 操作/故障 | 必须观察到的结果 |
| --- | --- | --- |
| W01 | 目标一开始即创建孙进程；在关联窗口注入暂停/失败 | 挂起时目标不能执行用户入口；Job 关联成功才运行；失败无目标/后代残留且无 ready |
| W02 | leader 创建持续工作的孙进程后主动退出 | 记录 leader 已退出；原 Job 后代仍可观察并被回收；完整结果以 active count=0 为依据 |
| W03 | cancel/stop、重复/并发 close、目标退出与取消交错；owner在握手/OpenProcess前后退出 | 一次实际清理；新challenge响应前不得启动目标，不把重用PID当原owner；不查询重用PID杀新进程；句柄释放，兄弟与后续调用正常 |
| W04 | 直接杀 broker；杀 owner；杀 Kernel/worker；组件 owner 死且 Extra 同步阻塞 | Job handle 生命周期触发回收；组件正常可调度时允许有界 drain；阻塞时外部 broker 仍能超时回收 |
| W05 | Node parent/child 的 fd3：ready、status、依赖 call/result/cancel、stop ACK、disconnect | 与既有 Node IPC 完整往返，数据通道无 broker 帧；owner 死确实触发 disconnect；无复制句柄导致 EOF 挂起 |
| W06 | 原生 exe、Node、现有 cmd shim、空格/中文/引号/元字符 argv、env、cwd | 目标观察值逐项一致，无新增 shell 拼接；已有不支持形式保持原拒绝；status.pid 指向目标 |
| W07 | 宿主/CI 外层 Job、拒绝嵌套、句柄查询失败、broker资源缺失/错架构 | 普通用户无需提权；不能归属即启动失败；无 taskkill/普通 spawn 成功回退；有界 incomplete 阻止替换 |
| W08 | ACP、NDJSON、Codex、ZCode、Host Node/native、Kernel worker 分别运行 W02/W03 | 所有本仓 owned launch 路径完成接线；共享 Provider 不因单 Run 取消而被错误终止 |
| W09 | 并行创建/取消 100 次，外加一个不相关哨兵进程 | 清理后进程/句柄回到预热范围；哨兵持续可用；没有历史 PID/Job 泄漏或持续增长 |
| W10 | 最终 tgz 在干净 Windows 离线安装、运行和卸载 | 两架构资源及摘要可验证；实际架构 executable 可运行；无 Go/编译器/网络要求；卸载保留 Home |

Windows 真机独立观察 fixture 孙进程：保存 PID+创建身份和活动信号，确保不是只断言 broker/leader 退出。
受管集合之外的 WMI/独立服务不得被杀；这类外部工作不写成 Job 回收保证。

## 集成与证据

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| I01 | Linux/macOS 全仓检查与 POSIX 进程组回归 | build/types/lint/格式/Node/UI、原进程组父先退与流预算全部通过；无平台逻辑泄露到公共 API |
| I02 | 包外 SDK TS 与 CLI/独立 Extra | skipLibCheck=false；旧调用代码编译；owned/attached/direct 边界、runner入口、public exports 不漂移 |
| I03 | Windows10/11 普通用户，Codex/Claude真实Provider，SDK宿主 | 启动→执行→取消/完成→关闭→重启；后代无残留；应用构建并重启，记录精确产物；桌面桥若修改需实际renderer验证 |
| I04 | im-test 真实 SDK Gateway 与 CLI，各含执行中停止/重载、发送失败、兄弟隔离 | 已接纳任务得到真实最终状态/未确认反馈；final 在断链前尝试；不恢复旧Run或重置身份；失败与未验项如实记录 |

I03 的 Provider 无 Windows 原生运行入口时，记录 Provider 的实际阻塞原因及替代的已支持真实 Provider，
不能以 fake Provider 代替全部真实模型验收，也不能将此任务宣称关闭 #14 全部验收范围。

## 测试入口与执行位置

| 入口 | 覆盖 | 执行位置 |
| --- | --- | --- |
| 拟新增 `test/gateway-shutdown-drain.test.js` | G01–G07/G09，受控 transport、任务/存储/投递闩锁 | 三平台 Node24 |
| `test/host-sdk-lifecycle.test.js`、`test/extra-startup.test.js`及拟新增独立drain fixture | G02/G03/G08–G10，真实进程+Kernel | 三平台 Node24 |
| 拟新增 `test/windows-process-owner.test.js` 与私有 broker 原生测试 | W01–W07/W09 | Windows CI及Windows10/11；POSIX跳过有理由且不计通过 |
| 既有 adapter-tool-lifecycle/native-cleanup/process-group 与专项fixture | W08、I01 | 三平台，Windows不删除核心行为断言 |
| `scripts/verify-release.mjs`、`scripts/verify-windows-release.mjs` | W10、I02 | 最终tgz包外离线运行 |
| 真实宿主/Provider/IM操作记录 | I03/I04 | 原生桌面及im-test；凭据不入日志 |

表中的测试入口已实际建立，精确命令与执行范围记入 journal；现有文件与focused命令先核对实际名字，
不得为使计划命令可执行而创建只返回成功的占位测试。
