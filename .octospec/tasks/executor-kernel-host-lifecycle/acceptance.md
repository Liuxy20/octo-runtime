---
type: Acceptance
title: ExecutorKernel 与独立服务功能验收矩阵
description: 按真实进程、执行次数、故障与资源结果验证 47、48、43 和 49 的目标。
tags: [testing, lifecycle, ipc, extra, runtime]
timestamp: 2026-10-20T00:00:00Z
---

# 状态与证据规则

本轮已实施运行代码并完成本地自动化。下表保留验收目标；具体通过范围及未验项见 [实施记录](implementation.md)，单个测试通过不等于整行场景矩阵全部完成。
每项记录源码 SHA、平台/Node、fixture/命令、预期与实际结果、PID/进程树、耗时、清理结果和通过/失败/待验。
逻辑时序使用闩锁或可控时钟，故障边界用真实进程；只对本次 fixture 发信号，不操作用户正在运行的 Runtime。

合同依据已细化到 [design](design.md)；全部A项对应的测试入口、闩锁、命令和平台位置见
[test-execution](test-execution.md)。A14–A16/A19属于M3a，A17–A18属于M3b。
选定设计、测试计划通过文档核对不代表上述功能验收已执行。

## 功能验收点

| ID / 阶段 | 操作或故障 | 必须观察到的结果 | 方法与证据 |
| --- | --- | --- | --- |
| A01 / M0 | 固定 API/wire 与 #51 交接 | methods/receipt/身份/错误/容量/取消/交互/代次/终态均有行为说明；JSON 不含函数、AbortSignal 或模块实例 | Schema 正反 fixture；TS 类型/生成物可重复；记录交接版本。 |
| A02 / M0 | 盘点旧入口到新组件 | imports、runner、配置、端点、服务 ID、锁、公开入口、tgz 全有去向；保留 #46 执行语义 | changes 逐文件去向及删除点；旧 daemon 无兼容壳或双轨交付。 |
| A03 / M1 | 外部 owner 启 Kernel，两个独立客户端执行 | 同 Kernel/worker PID；list、native/canonical、事件流正常；关闭客户端 A 后 B 和 Kernel 仍工作 | 真实独立进程，记录 PID、receipt 和唯一 Provider 启动计数。 |
| A04 / M1 | Kernel-only、无登录/无 Extra 本地执行 | worker/Core ready 并完成调用；没有业务外联、隐式安装或 Extra 加载 | 隔离临时 Home、fake Provider，观测子进程和入口依赖。 |
| A05 / M1 | 断开订阅、client.close、ACK 前后丢连接 | 已接纳执行不因断订阅取消；查回原身份；无法确定接纳时报真实错误，不重发 invoke | 闩锁控制接纳/ACK；Provider 启动次数始终最多一次。 |
| A06 / M1 | 原流续订、错 stream/generation/cursor、TTL/缺口 | 只返回原流连续帧；错身份、过期及缺口真实失败；不新执行，不假恢复 | 缩短时钟、固定游标、源流 fixture，核对 run/stream/seq。 |
| A07 / M1 | native/canonical 审批追问、取消及终态竞态 | 只答原 pending interaction；错误/晚答拒绝；cancel 接纳与 confirmed termination 分开；终态唯一 | 双模式受控 Adapter、回答写入闩锁、取消前后计数和资源结果。 |
| A08 / M1 | 慢读、连接/请求洪峰、超大/截断/非法 NDJSON | 各 pending/队列/连接/帧有界；精确错误，不静默丢终态或拖死兄弟客户端 | 中央容量阈值内/等于/超出三点；记录队列水位和协议错误，不以字节限额承诺 RSS。 |
| A09 / M2 | worker 启动 throw/超时、crash、强杀、模拟 OOM | 启动前无假 ready；受影响 Run 报真实 failure/lost；原错误与回收结果均保留 | 专属真实 worker fixture，记录退出码/信号/清理和耗时；模拟退出不称真实内存耗尽。 |
| A10 / M2 | worker 同步死循环；另测模型长时间无输出 | 父进程在固定探活预算内检测阻塞并升级回收；健康 event loop 的模型静默不误杀 | 原生进程死循环与静默 fake Provider 分开；记录 ping/pong/检测时间。 |
| A11 / M2 | 同 worker 多 Run，在最终终态前/后杀 worker | 所有受影响在途 Run 真实 lost；Kernel 已接受终态保留；新 worker 可服务后续调用 | #46/#51 共用 source-lost fixture；核对旧调用不再 invoke。 |
| A12 / M2 | 连续启动失败/短时崩溃、backoff 中 stop | 替换次数/时间受预算限制；耗尽 unavailable；stop 后无迟到 worker；只清理受管后代 | 可控 restart 时钟加真实 child，记录 attempt、进程树消失、incomplete。 |
| A13 / M2 | Kernel 被杀，owner/服务管理器显式恢复 | 客户端 pending 以真实连接失败结算；新连接恢复后续调用；旧 stream 不假恢复、不重放 Run | 真实 Kernel PID 故障；记录 owner 策略与旧/新实例代次。 |
| A14 / M3 | 三个内置 Extra 与第三方模块独立启动 | 均有独立于 Host/Kernel/worker 的 PID，只使用指定 endpoint；无 DaemonRuntime 依赖 | 独立 runner fixture；模块从已安装位置解析，Kernel 无业务 import。 |
| A15 / M3 | 停止/重启/改配置一个 Extra | 仅目标 PID/连接变化；Kernel、其他 Extra 与其在途 Run 继续运行 | 两个 Extra 并发，核对 PID、事件和 Provider 启动次数。 |
| A16 / M3 | Extra 先于 Kernel、权限拒绝、断线后重连 | execution unavailable 与业务外联状态分开；不启动/安装/替换 Kernel，不重复 invoke | 真实不存在/拒绝端点、Kernel 重启；记录状态和子进程。 |
| A17 / M3 | 宿主函数读取值 A，修改为 B 后下一轮 | 下一次已准入任务使用 B；Extra 不重载；Kernel 不持有 callback 或加载业务数据 | 两个真实进程依赖代理，捕获进入 fake Provider 的本轮 Context。 |
| A18 / M3 | 代理取消/超时/饱和/迟到响应/断线 | 实际未结束操作仍占额；迟到数据不进模型；无旧快照兜底；关闭释放可释放资源 | 可控宿主 Promise、call ID/代次、队列水位；同步/异步回调分别验证。 |
| A19 / M3 | Extra 受控关闭、投递离线、disposer 失败 | 先停准入、打断所属任务、在预算内尝试最终投递再断连接；真实报告未完成，不停共享内核 | im-extra-disposal/extra-sdk-disposal 等原回归迁移，加真实 runner/端口清理。 |
| A20 / M4 | 运行 direct/attach/owned/Extra 四例 | topology 明确；direct 共享故障域；默认仍隔离；SDK 无 CLI 调用/输出解析 | 仓库内与外部 Node/TS fixture，观察 PID 与导入副作用。 |
| A21 / M4 | 一个 attach client 关闭，owned 显式 stop/restart | close 只释放 client；管理操作只影响该 owner 服务；Extra 独立进程不连带重启 | 两宿主客户端和两个 Extra；负向测试 attach 无隐式管理能力。 |
| A22 / M4 | spawn/ready/Extra 初始化各阶段失败，重复/并发 stop | 只回滚本次新建资源；所有独立清理均尝试；未确认清理保留锁/所有权与首个错误 | 逐步注入故障，文件锁/端口/进程树核对；failed disposer 不因重复 return 假成功。 |
| A23 / M4 | logout、账号/租户切换和旧加载迟到完成 | 旧代次停止接纳并清理；旧回调不能写入新代次；无关 Extra/共享 Kernel 保留 | 账号代次闩锁、已排队卸载和 proxy pending；原身份/配置前后核对。 |
| A24 / M5 | executor-kernel和channel-gateway两组各执行uninstall/install/start/restart/stop/run | 六动作help、路由、exit code一致；服务ID/配置/锁/自启独立；不连带另一组；全局status分项返回 | T07覆盖2×6动作，install自启选项、独立前台run及backend fixture；真实平台服务单列。 |
| A25 / M5 | extraset保存/禁用声明后channel-gateway restart | 仍写home/extras/name/config.json，完整替换且受保护；只目标重启；保存与生效状态分开 | cli-extra-directory/extras回归；改配置前后PID、完整JSON和权限；不加reload子命令。 |
| A26 / M5 | 启动配置的原生 fixture binary，含空格 argv/路径 | executable、argv/cwd/config/endpoint 边界准确；能独立停止重启；缺失明确失败、不安装 | 真正编译的原生小程序回显非秘密参数并接收关闭；不实现 Loop。 |
| A27 / M5 | 检查旧 daemon 已从最终代码及产物移除 | 无旧包/bin/API/命令/service ID/运行导入；历史文档引用不作为兼容接口；用户身份和配置保留 | 静态依赖守卫、tgz导出/bin负向测试；旧 daemon 命令走普通未知命令，不启动任何服务。 |
| A28 / M5 | playboard 临时执行；Kernel/Extra 部分不健康 | 临时停止不影响常驻 Kernel；status 区分进程、IPC、worker、外联和执行终态 | 常驻和临时实例并存；结构化状态断言及无输出解析的 SDK 复用。 |
| A29 / M6 | 全工程检查和仓库外 tgz 消费 | 构建/类型/lint/格式/Node/UI/公开声明通过，隔离默认和独立 Extra 随包可用 | 下方命令；发行 fixture 只依赖 tgz，skipLibCheck=false。 |
| A30 / M6 | macOS/Linux UDS，真实 Windows named pipe/服务 | 多客户端、worker 故障、后代回收、Extra 独立启停和原生 binary 有实际平台证据 | CI/真机日志含 SHA/OS/命令/结果；缺平台标待验。 |
| A31 / M6 | CLI 与具名 SDK 宿主在 im-test 用真实 Provider | 执行/流/交互/取消/失败/重载/恢复闭环；真实拓扑符合本计划 | https://im-test.deepminer.com.cn/；记录宿主/版本/入口、构建与重启；不记录凭据。 |
| A32 / M6 | 迁移前后语义、状态与文档检查 | Run7/Context v3、空/重复/保序输入、权限审批和原用户状态保留；新指南准确；未验项明确 | 原回归加隔离 Home 文件对比；#43/#47/#48/#49 原要求逐条映射，#50/#51 留具名交接。 |

## 工程检查计划

本地已执行命令和结果见实施记录；跨平台/真实环境项目单独待验。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm format:check
pnpm test:suites
pnpm pack:release
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
uv run --with pyyaml python .octospec/scripts/lint.py
git diff --check
```

typecheck 已包含构建，后续 test:suites 复用产物；pack:release 的独立构建用于验证最终归档。
原 `executor-core`、`host-run-service`、`host-stream-*`、`daemon-ipc-disconnect`、
`sdk-host-extras`、`extra*-disposal`、`cross-service`、`runtime-endpoint` 作为回归来源迁移复用，
不能用其旧结果替代新 Kernel/runner 进程合同。

## 本轮规划检查

- 已完成：主目录干净且 main 快进检查完成；新分支 HEAD 与 origin/main 均为 `6fb8ca5`。
- 已完成：规划前执行全仓知识校验；基线有 14 处旧跨仓库链接失效，未修改这些历史链接。
- 细化检查已完成：7份OKF文档的frontmatter、本地链接、context YAML、规则ID、A01–A32连续编号及T01–T10覆盖、C01–C24编号、两组CLI命令一致性、96分加总和新增文件空白检查通过；`git diff --check`通过。
- 已完成：写入后全仓知识校验仍只报告与基线相同的 14 处跨仓库失效链接，没有新增错误；不能记作全仓检查通过。
- 以上是规划阶段历史检查。实施阶段已修改运行代码，原 main 目录仍干净。当前结果以 implementation 为准，平台服务与真实 Provider/IM 待验。
