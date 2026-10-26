---
type: Review
title: Issue 93/42 真实 IM 双模式恢复验证
description: 记录用户提供账号后的真实测试站、Codex、UK回读、网页和受控故障证据，不替代睡眠及部署合同验收。
tags: [testing, channel, lifecycle, ipc, invoke]
timestamp: 2026-10-26T03:20:00Z
---

# 范围与授权

用户在规划交付后提供受保护Bot账号Markdown、UK用户权限JSON及`https://im-test.deepminer.com.cn/`，明确要求端到端测试。使用现有专用QA群（指纹`d010c2b3cd5a`）、`orbtex-codex`和另一个测试Bot，UK仅用于用户权限下的限定群搜索回读；网页使用已有登录态和已有Bot好友关系。没有创建好友、强制抢占owner、更新Token、修改共享服务或提交代码。

首轮真实验证源码基线`8af836068780ebb76581225254ad7bef18cc8170`，分支`codex/93-42-recovery-plan`，dirty为本任务文档和验证工具。环境：Darwin/arm64、Node.js`24.19.0`、pnpm`11.19.0`、真实Codex CLI`0.164.0`、octo-cli`0.18.0`（commit`d564a63bbd8ec2dd4305a40a64fe0179ca9c667f`）、Chrome`155.0.8059.86`。没有修改产品逻辑。

SDK通过主包公共服务工厂在当前进程直接构造Kernel和Gateway；自有worker原生import Codex Adapter并调用公共`serveWorker`，没有manifest或CLI代启。CLI通过实际`executor-kernel run`、`channel-gateway run`两个进程构造服务。两模式均以公共`KernelClient.invoke`执行真实Codex；测试输入构造复用仓库fixture及workspace协议整理函数，不声称该整理函数是主包公开导出。

# 复跑入口

从本worktree根执行，先完成`pnpm build`。在调用方设置`OCTO_CHANNEL_QA_ACCOUNTS`为受保护Bot文件路径，`OCTO_CHANNEL_QA_USER`为受保护UK文件路径。参数和报告不包含凭据值。

```sh
node --unhandled-rejections=strict scripts/verify-recovery-live.mjs --browser
node --unhandled-rejections=strict scripts/verify-recovery-live.mjs --cli --browser
```

`--browser`要求macOS Chrome已登录测试站、现有orbtex-codex会话可打开、输入框无用户草稿及系统自动化权限。脚本定位测试站标签，在真实composer输入，再用系统Enter键发送，随后同时核对Bot历史与页面中完整等于唯一marker的回复节点；发送提示中的marker不算回复。没有截屏，不把DOM观察写成截图证明。不使用`--browser`仍验证真实群消息链。

控制和原始结果置于本次独占的0700临时目录，配置为0600。凭据只进入内存、octo-cli子进程环境和CLI的临时Extra配置；结束后删除临时Extra配置。只对本验证进程的测试站鉴权请求注入失联，并终止该进程捕获的实际WS；不改变系统网络。SDK/CLI共用同一账号，必须串行执行。

# 8af8360 基线结果

| 模式 | 九项恢复断言 | UK同一回复回读 | 网页DM | 原服务保持/worker代次增加 | 清理 | 总结果 |
| --- | --- | --- | --- | --- | --- | --- |
| SDK | PASS | PASS | PASS | PASS | PASS | PASS |
| CLI | PASS | PASS | PASS | PASS | PASS | PASS |

九项断言是三次真实IM回复（初始暂态离线解除后、WS丢失后、活动worker丢失后），两次direct控制（基线、WS恢复后），以及worker恢复后旧/新client × 旧/新实际Provider session的四组高层invoke。旧session必须回传相同Provider session ID、`resumeOutcome=resumed`并回忆先前marker；新session由真实Provider新建，不用虚构session ID冒充续接。每个IM marker检查唯一回复，未将其推广为任意重放下的副作用去重证明。

活动worker故障在真实shell工具开始后触发：旧invoke返回`RUN_OUTCOME_UNKNOWN`，脚本不重提该Run；恢复只执行新的请求。Kernel PID/instance和Gateway PID在试验前后保持，worker代次增加；这不是整个服务重建后的通过。该trial未注入Gateway活动IM Run中的worker丢失，不能替代原矩阵的全部active场景。

SDK最终报告位于`/tmp/or-recovery-live-YMuia9/report.json`，2026-10-26 03:16:58Z至03:19:36Z，exit 0。从局部鉴权拦截解除到IM成功约30.0秒；WS故障拦截解除后到IM与direct均成功约33.4秒。记录包含实际定时器和Provider耗时，但没有独立网络/DNS/Provider探测定义完整`t_ready`，因此不是G02正式计时或生产SLA。

CLI最终报告位于`/tmp/or-recovery-live-7NmH9r/report.json`，2026-10-26 03:20:03Z至03:22:09Z，exit 0；局部拦截解除后的启动/WS恢复观察分别约17.9秒/29.1秒，计时边界同上。两模式各九项恢复断言均通过，另各自完成UK回读与网页DM；不把它们加算为普通自动化测试数量。两次最终trial均完整关闭本次拥有的服务，SDK两组件无errors/pendingResources，CLI两进程均exit 0。新增的CLI清理超时强杀分支未在成功trial中触发。

# 工具失败及纠正

先保留失败，再修验证工具，不把失败改写成产品缺陷：

- 初次导入把workspace的`invocationInput`误写为主包public导出，在任何服务启动前报SyntaxError；改为真实workspace整理函数，服务和调用继续只用public API。
- `/tmp/or-recovery-live-Z2uVPP/report.json`：恢复的前四项通过，UK搜索漏传`channel_type=2`而被服务端校验拒绝；两服务清理完整。
- `/tmp/or-recovery-live-whWSvd/report.json`：搜索参数已正确，但回复同步可见时搜索索引尚未命中，原工具立即失败。随后对同一消息的独立UK查询可见；现改为有限60秒内等待相同回复ID及发送者，不重新发送消息。
- `/tmp/or-recovery-live-D2N1E0/report.json`：九项恢复及UK回读通过，合成KeyboardEvent没有发送composer草稿，网页步骤超时。改为真实系统按键；后续SDK完整重跑通过。一次人工系统Enter发生于该失败收尾附近，不算该trial成功，也不复用其marker。

# verified-review 与自动检查

沿用`verified-review`技能串行审查文档及新验证工具：重点检查账号来源和输出、真实公共合同、SDK原生拓扑、故障归属、旧Run不重提、搜索索引延迟、DOM假阳性、超时和清理。首轮规划的10文件/508行审查留在[历史记录](verification.md)；E2E收尾时扩展范围15个文件、1369行变更（跟踪文件增删加未跟踪文件全文），全部逐文件审查，无跳过、无medium及以上未处置问题。新增runner核对输入/事件/阶段/报告/所有退出分支；faults单独核对测试站路径、socket集合和恢复全局hook；worker单独核对原生装配；probe测试单独核对断言与无真实网络；本文件及原十个知识文件逐一核对授权、历史/当前证据和剩余门槛。Track B为实际双模式E2E及故障注入器测试，非仅静态阅读。

已执行：故障注入器的隔离/单次drop/恢复全局hook测试1通过；`pnpm lint`、`pnpm lint:names`、TypeScript no-emit、新增代码Prettier及`git diff --check`通过。15个变更文件及仓库外trial结果共38个常规文件与实际凭据逐值比对，零命中；追加的8个OKF单元、11条规则指纹及G/R/S/E编号检查通过，全仓知识校验仍仅4个既有frontmatter错误。收尾按trial路径/worker入口检查未发现本轮残留进程。前一轮同基线完整build及46项恢复回归通过；本轮工具不修改产品合同，未重复完整`pnpm test`。

# Low 复核及修复

用户追问medium以下问题后补查确认一项Low：`recovery-live-faults.mjs`的自动安装仅检查环境变量，日志worker继承`NODE_OPTIONS`时也安装轮询。原CLI报告实际记录同次drop的`sockets:0`与`sockets:1`两条事件；前者不代表真实连接断开，属于证据日志噪声。原真实断线和恢复结论保留，不把该Low写成产品恢复缺陷。

用户随后授权修复、提交、同步最新main并创建英文PR，尚未授权执行合并。自动安装现增加`isMainThread`限制；显式调用的SDK注入入口不变。新增测试启动真实Node子进程，以`NODE_OPTIONS --import`预加载，再启动继承该配置的真实Worker；同一drop只允许主线程记录一次。`node --unhandled-rejections=strict --test test/recovery-live-probe.test.js`两项通过，定向Prettier通过。纯格式Low按技能规则省略，此前未保存完整Low清单；这项已确认Low已修复并有回归覆盖。

# 同步 main 后的交付验证

用户授权后以英文提交`92093c7`保存规划、验证入口及Low修复，再将`main@78bb88a154700bdd9cd0eda8c3624a8db2a89c1b`合入，得到`0189eabb3d25fc07b3f9eb8b0e463d85a1c8a6d7`。唯一冲突是知识索引，保留本任务入口与主线最新DSH条目。两项提交均保留配置的Git作者，包含一次Codex协作trailer。

以下真实重跑均以`0189eab`、clean工作区开始，环境及命令同前：

| 模式 | 报告 | UTC 时间 | 结果 |
| --- | --- | --- | --- |
| SDK | `/tmp/or-recovery-live-UJ14Tt/report.json` | 04:14:30至04:16:22 | 九项断言、UK回读、网页DM、身份保持及清理均PASS，exit 0 |
| CLI | `/tmp/or-recovery-live-UGrt2X/report.json` | 04:16:31至04:18:32 | 九项断言、UK回读、网页DM、身份保持及清理均PASS，exit 0 |

两份报告均仅一条`drop`且`sockets:1`，没有日志worker产生的`sockets:0`噪声。旧Run均为`RUN_OUTCOME_UNKNOWN`且`resubmitted:false`；两个模式结束后均没有本轮残留进程，临时凭据配置已删除。SDK启动/WS恢复观察为18819/25505毫秒，CLI为17248/28824毫秒；计时边界仍不是正式G02或生产SLA。

本轮首次带网页的重跑`/tmp/or-recovery-live-Zjfp9u/report.json`在preflight失败，零项恢复断言、没有启动服务；原测试站标签已关闭。重新打开测试站、确认已有登录态并打开现有Bot会话后，上述两个完整trial通过。保留这次失败，不计为恢复缺陷或通过证据。

同步后重新冻结安装，`pnpm typecheck`（含完整build）、`pnpm lint`、`pnpm format:check`、命名检查、`pnpm docs:check`及八文件恢复测试48项全部通过。首次lint与清理构建并行，遇到构建产物暂时缺失导致1120个类型解析错误；构建完成后独立重跑通过，不归为源码缺陷。知识lint为7个缺失frontmatter，逐文件核对均存在于`origin/main@78bb88a`，新增3个来自主线DSH文档；本任务未引入新知识链接错误。

verified-review在前轮15文件逐文件审查基础上，复核主线程限制、真实子进程/Worker回归、索引冲突和本轮交付说明；没有跳过新增差异。已确认Low修复完成，没有medium及以上未处置问题。当前15个变更文件的8个OKF单元、11条规则指纹及本地链接检查通过；变更文件、三次trial产物和PR正文共31个常规文件与实际凭据逐值比对，零命中。真实睡眠及部署边界仍按下节保留，PR关联两个P0，不自动关闭。

# PR 181 审查后的当前结果

yujiawei针对`b515aa0`提出的四项P1及三项P2已逐项核对并修改，见[审查整改](review-remediation.md)。验证工具现共11项测试，恢复集合57项通过；最终`2634d28`的SDK与CLI各九项真实恢复断言、UK回读、网页DM和清理均再次通过。新的CLI失败trial、提示词边界澄清及最终报告均保留在整改记录中，不以一次最终通过抹除先前失败。此后仅回写证据，产品代码不变，外部CI和正式复审仍以PR当前head为准。

# 未验收边界

2026-10-26 后续审查新增QA账号库隔离和普通Gateway规范token覆盖，OpenClaw保持特殊合同。主线已同步至`81284c9`，全量Node1843通过/52条件skip、WebUI35通过，真实双版本CLI离线8项通过。新主线CLI的九项恢复、UK回读及真实网页DM通过；SDK新主线网页trial在九项及UK回读之后因未发出草稿失败，随后网页关闭导致预检失败。最新SDK无网页trial九项恢复、UK回读、身份保持及清理通过。精确基线、报告、失败、清理和review事实核对见[审查整改](review-remediation.md)，不将旧head网页通过挪作新head证据。

S01仅覆盖真实在线控制，S08仅覆盖本进程连接关闭与鉴权失联，S10仅覆盖活动direct中的worker丢失；不将部分场景写成整行PASS。无真实睡眠、合盖一小时、过夜、系统断网/IP/VPN切换、内核整体终止、登录自启、10轮、四Bot、128容量、部署reason12、服务端presence TTL、ACK/replay、卡片、群thread或其他Provider/平台证据。G01旧脚本迁移、无网preflight和手动checkpoint未全部实现，M1/M5保持部分完成。

两个P0保持开放；95/100仍为准备度自评。已有账号及当前macOS/Provider消除了部分环境缺口，部署revision及完整现场执行条件尚未落实，E20仍为0分。
