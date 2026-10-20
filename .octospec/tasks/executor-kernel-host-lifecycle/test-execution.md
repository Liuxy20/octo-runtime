---
type: TestPlan
title: Kernel 故障、独立 Extra 与平台验收执行方案
description: 将32项验收映射到测试入口、受控进程fixture和可观察断言。
tags: [testing, protocol, lifecycle, ipc, extra]
timestamp: 2026-10-20T00:00:00Z
---

# 执行口径

以下文件是实施时须创建的测试入口，目前尚不存在，不能记作运行通过。
测试不按32项机械复制32个文件；复用既有Core/协议/清理回归，新增跨进程和所有权边界测试。
行为合同见 [design](design.md)，结果清单见 [acceptance](acceptance.md)。

## T01–T10 测试入口

| ID / 新入口 | 验收映射 | fixture / 核心断言 |
| --- | --- | --- |
| T01 `test/kernel-ipc-contract.test.js` | A01、A06–A08 | 共用Schema/正反JSON、requestID/Unicode/截断/边界、身份与代次；未知可选native数据保留。 |
| T02 `test/kernel-clients.test.js` | A03–A07、A13 | 独立Kernel与两个真实client进程；ACK闩锁、receipt查回、close不cancel、repair不invoke。 |
| T03 `test/kernel-worker-supervision.test.js` | A04、A09–A13 | 真worker启动失败/crash/OOM-like/同步阻塞/静默、兄弟Run、终态竞态、次数预算、后代回收。 |
| T04 `test/extra-process.test.js` | A14–A16、A19 | 真runner和两个Extra；单项reload、先Extra后Kernel、最终投递顺序与disposal失败。 |
| T05 `test/extra-dependency-proxy.test.js` | A17–A18、A23 | 真宿主和Extra、可控回调Promise；5秒/8占额、取消/断线/跨epoch/迟到结果。 |
| T06 `test/host-sdk-lifecycle.test.js` | A20–A23 | direct/attach/own四例、逐阶段启动失败、rollback、重复stop、账号切换和锁。 |
| T07 `test/cli-components.test.js` | A24–A28 | CLI真进程、平台backend fake runner；两个指定命令组×六个动作、精确argv、exit/JSON、独立服务、自启和临时Kernel；原生binary由SDK fixture覆盖。 |
| T08 `test/kernel-package-boundaries.test.js` | A02、A27、A32 | 生产依赖图/导出/命令/bin负向守卫；Kernel无Extra，Core无IPC，旧daemon包和API已删除。 |
| T09 `scripts/verify-kernel-platform.mjs` | A26、A30 | 原生UDS/pipe、受管树、OS服务和native fixture；区分平台不可用与通过。 |
| T10 仓库外tgz fixture及具名真实Host记录 | A29、A31–A32 | tgz-only Node/TS、skipLibCheck=false，公开入口与默认隔离；CLI/SDK各一份真实业务记录。 |

M1运行T01/T02；M2增加T03；M3a运行T04，M3b运行T05；M4运行T06；M5运行T07/T08；
M6运行全部与T09/T10。M0先落实T01的Schema fixtures，不把全部T01通过设为未有服务时的进入条件。

T07逐项断言两组help仅列uninstall/install/start/restart/stop/run；install不启动另一服务，
uninstall只删目标服务定义，start/restart不隐式install，stop重复执行为受控幂等，run使用前台进程。
启动ChannelGateway前Kernel不存在时，不出现新Kernel子进程；停止Kernel后Gateway PID保留且execution unavailable。
自启选项只改目标服务，全局status分项报告；第三方Extra/Loop公开命令不作为本次两组验收的隐含要求。

## 可控进程fixture与闩锁

- `test-support/kernel/fake-adapter.mjs`：真实worker加载，使用执行环境中的测试控制端点；支持回显、审批、等待、失败、生成终态和挂起清理。计数记录在测试控制端，避免靠Kernel日志判断调用次数。
- `test-support/kernel/kernel-host.mjs`：通过真实服务入口启动Kernel，仅在测试注入beforeReceiptAck/afterTerminalAccepted闩锁；不在生产公开IPC增加测试管理方法。
- `test-support/kernel/client.mjs`：独立Node进程执行固定动作，通过父子IPC报告receipt/seq/terminal及句柄退出，不与Kernel共享内存。
- `test-support/kernel/worker-fault.mjs`：只对自身fixture执行exit、受控非零退出或同步死循环；由测试父进程负责清理。测试外层watchdog不会被死循环阻塞。
- `test-support/extra/controlled-extra.mjs`：注册真实onDispose/onStatus与执行端口；提供先投递后关闭连接的事件序列，故障用显式闩锁控制。
- `test-support/native-component/main.go`：仅标准库；打印非秘密argv/config/endpoint、保持进程并接受stdin-json shutdown。没有Loop业务或Go执行client，不依赖#51成品。

所有闩锁用到达通知和释放命令；不靠固定sleep碰竞态。fixture的test hook仅存在测试入口，
不打包生产图；静态守卫检查生产入口不能导入test-support。

## 必须按步骤验证的高风险场景

### F01 ACK丢失与断订阅

1. beforeReceiptAck暂停，等待测试控制端报告Core首帧和Kernel已登记receipt，保存真实完整身份。
2. 断开客户端连接，再释放ACK闩锁；client只能get原LookupKey并subscribe，捕获Provider开始次数。
3. 连续事件中主动断订阅，再用最后连续seq续订；另一个client继续工作。
4. 断言调用次数为1、未出现cancel、续订只从after+1开始、最终终态唯一。
5. 另测接纳尚未完成时断连：查回截止后必须ACCEPTANCE_UNKNOWN；服务端后来接纳也不得触发第二次invoke。

### F02 终态与worker死亡先后

1. 两个Run共享同worker，暂停其中一个Provider finalizer；另一个正常完成。
2. worker退出发生在Kernel接受最终终态前：未终态Run出现连续error/lost；已终态兄弟不变。
3. 第二组在afterTerminalAccepted闩锁后杀worker：get/subscribe仍取得同一终态，不追加lost。
4. 再提交新Run，确认新worker PID/generation，旧Run的Provider启动次数均不增加。

### F03 同步阻塞、模型静默和背压

1. fake Adapter在worker主线程进入无限循环，Kernel父进程开始记录lastPong及发信号时刻。
2. 主循环探活在design的6秒检测目标内判故障，完成平台升级回收；测试父进程另设20秒防挂截止并负责清理。
3. 对照组模型30秒不产出，但worker主循环响应ping；必须保持同PID，不触发重启。
4. 加慢读客户端使业务输出进入背压，同时保持主循环可响应ping；不得因业务队列满自动判死。持续无drain只关闭慢订阅。
5. 真实OS时序记录调度偏差；超过目标则保留失败待定位，不能把20秒外层watchdog当成服务承诺。

### F04 代理超时后的真实占额

1. Host回调创建8个不会立即结束的Promise；Extra端按时返回timeout，第9个必须BUSY。
2. 关闭/切换账号/重建Extra的尝试不能绕过Host占额或failed ownership。
3. 释放1个真实Promise后只恢复1个额度；迟到的旧结果不进入任何Provider输入。
4. 回调先返回A，宿主更新数据后下一轮返回B；Extra PID/外联保持不变，Provider收到B。
5. 完成全部实际Promise后再stop可确认资源释放；finally拒绝或无确认不得因重复stop变成功。

### F05 回滚、单Extra重载和账号代次

1. 已有外部owner Kernel与Extra B，宿主附加后启动Extra A，在每个资源取得点分别注入失败。
2. 观察本次取得资源全部尝试释放，外部Kernel和B PID不变；原始错误和cleanup结果同时保留。
3. 重载A：先关准入、取消其Run、投递尝试、断业务连接、退出确认、新A ready；顺序不可颠倒。
4. 旧scope load迟到完成、旧卸载排队、新账号同时创建，旧动作不得作用于新实例。
5. 不把同账号OS互信误当逐App安全隔离；测试的是句柄/业务作用域合同。

## 三平台与原生binary执行入口

原生fixture工具链仅用于开发/CI，显式安装Go；不属于产品运行时自动安装。构建命令固定：

```sh
go build -o test-support/native-component/bin/component ./test-support/native-component/main.go
```

Windows输出名使用component.exe；T09根据平台选择。CI显式setup-go并缓存工具链，所有进程
使用独立临时Home/管道/服务ID。测试结束必须清理，即使中途失败。

| 平台 | CI/执行位置与动作 | 必须记录 |
| --- | --- | --- |
| macOS | 现有check job构建后运行T01–T08；T09使用launchd-user临时服务 | UDS0600、同PID多client、worker/后代消失、单Extra服务启停、原生argv和shutdown。 |
| Linux | 现有check job运行T01–T08；T09使用systemd-user会话 | UDS/进程组与user service；CI无user manager时服务子项标不可用，转真实用户会话执行。 |
| Windows | 现有verify-windows-release job在typecheck后增加T01–T08；T09使用真实pipe与Task Scheduler | 主机OS/Node、真实pipe流/交互/取消、worker阻塞回收与后代确认、用户任务状态和.exe路径含空格。 |

T09每项输出passed/failed/unavailable，不以skip当pass；脚本分组可通过`--require-services`
要求user manager存在，否则服务项不可用时退出非0。M6 A30关闭条件必须有三个平台的完整证据，
CI不可用项须由真机补齐；明确的进入条件不依赖用户重新批准已授权的测试。

## 运行命令与真实业务记录

新增测试落地后执行以下入口，尚不存在的文件不能在本轮声称运行：

```sh
pnpm typecheck
node --test test/kernel-ipc-contract.test.js test/kernel-clients.test.js test/kernel-worker-supervision.test.js
node --test test/extra-process.test.js test/extra-dependency-proxy.test.js test/host-sdk-lifecycle.test.js
node --test test/cli-components.test.js test/kernel-package-boundaries.test.js
node scripts/verify-kernel-platform.mjs --require-services
pnpm lint
pnpm lint:names
pnpm format:check
pnpm test:suites
pnpm pack:release
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
```

T10先提供本仓可维护的Node SDK Host示例（四种拓扑和代理），再执行CLI与该Host的真实Provider/im-test联验。
第三方App自身接入由#50具名确认，不假称本仓示例等于第三方生产App。
记录文件为本任务`evidence/<场景>-<平台>.md`：SHA、OS/Node、宿主/版本/入口、命令、闩锁步骤、
实际PID/generation/计数、时限、资源结束和结论；只记脱敏元数据。

A31的每种入口都覆盖：普通流、审批/追问、取消、Provider失败、单Extra重载和Kernel重启后的新任务。
断网最终投递只能记真实尝试/失败；不因通道恢复就补造旧任务完成或重放输入。
