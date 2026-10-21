---
type: Acceptance
title: Issue 71 架构与行为验收矩阵
description: 以调用进程 PID、统一公开 API 与所属 Run 清理验收库内架构，分别记录外部集成证据。
tags: [architecture, testing, lifecycle, ipc, invoke]
status: locally-validated
---

# 验收口径

独立评审整改已按[整改方案 C01-C12](remediation.md#本轮验收证据)验证，覆盖注入依赖终态保存、截止后拒绝及三个公开模块的实际 tgz 验证。本轮证据见[实施记录](implementation.md#评审整改验证)，不沿用历史通过记录。

本 worktree 已实施并完成三个评审项的库内整改。当前以 main@70f0247ac7dc00cc9729b366eba64ea8288b5b78 为协议及行为基准，具体重验结果与未实测边界见[实施记录](implementation.md)。下表定义验收目标，不代表每种外部环境均已实测。变更尚未提交，本轮为实施者自查，未声称已通过新一轮独立评审。fake Provider、Node 进程、真实 Electron、真实 Provider/IM 是不同证据类别，不能互相替代。

2026-10-20 用户收敛本次范围为 octo-runtime 库本身：CLI 直接加载同一公共 SDK 为主要验收，另用包外普通 SDK fixture 检查公开合同。A07/A09 属于外部 Electron 集成验证，保留原始目标但移出本次库内阻塞项；不要求进入外部 Electron 工程。A22 只执行适用于本次库内变更的检查，不因保留外部验收描述扩大工作范围。

| 编号 | 通过标准 | 验证证据 |
| --- | --- | --- |
| A01 | 方案逐条满足 #71 六项实施前要求，接口、迁移、失败语义和 CLI/Electron 示例与实际调用一致 | 架构核对记录，列出审查者/方式及未决项；未审不能写 reviewed |
| A02 | SDK 无 startOwnedKernel/OwnedKernel/startExtra/OwnedExtra、兼容 alias 或等价外部服务 launcher | 源码、dist、公开 d.ts、发行包静态扫描，加调用链审查；名称扫描不能证明无换名实现 |
| A03 | 工厂、initialize/status/client.invoke/控制/close 签名一致，包外仅依赖主发行包公共出口 | CLI 与包外普通 SDK fixture 严格编译，skipLibCheck=false，禁止源码相对 import、workspace 路径映射或 ambient stub 绕过 |
| A04 | executor-kernel start 的 manager 最终启动 run；run 的 PID 等于 KernelStatus.pid，socket 所有者即该 PID | fake manager 的真实 run 子进程 + 原生 manager 实测；OS socket/PID 核对，进程树无额外顶层 Kernel |
| A05 | channel-gateway start 启动自己的 run 进程，控制 socket 属于该进程；连接已选 Kernel | 进程树、两端实例 ID 与 socket PID；只启动 Gateway 时不出现新 Kernel |
| A06 | Gateway 停止后，已有 Kernel PID/instance/endpoint 保持，另一个 Extra 和 App 的活动 Run 继续到原终态 | 多调用方并发真实进程测试，检查原 ref 和 seq，不以新 Run 成功替代旧 Run 连续性 |
| A07 | Electron 主进程直接构造服务，Kernel socket 属于主进程 PID，Gateway 原生初始化无需 runner | 真实 Electron 主进程 PID、status.pid、OS socket、调用路径与主进程 fixture 记录 |
| A08 | 没有外部 Node、Runtime CLI 或外部服务进程替代原生构造 | CLI 与包外 SDK 的调用链和真实进程树证明服务由调用进程构造；内部执行 worker 与顶层服务分别识别 |
| A09 | 内部 worker 只执行 Core/Adapter，真实 Electron 打包后能执行及回收；宿主无需 nodePath、改 Runtime 源码或改 fuse 策略 | 实际 Electron/内置 Node/OS/打包/fuse/worker 路径记录；开发模式和打包应用分别验证；未验证平台明确列出 |
| A10 | CLI 与包外 SDK Gateway 均使用同一个普通可导入服务实现 | 执行路径审查及双方行为测试；entry 不包含独有初始化、状态或清理逻辑 |
| A11 | Direct App、Gateway 与无关 fixture Extra 使用同一个 KernelClient.invoke，保留低层 primitives | 配合 #69：discovery、native/canonical、原源终态、ACK 丢失无重提交、原游标续流、gap/expired/实例变化的回归 |
| A12 | 取消、审批/追问、native response 保留原身份与语义 | 覆盖接纳前 abort、接纳中 abort、执行中显式 cancel、控制 ACK 未知；不得把 ACK 当终态 |
| A13 | iterator.return、订阅 signal、client.close、socket 关闭只结束消费，不隐式取消 Run | 独立观察者仍查得原 Run 并接收到原源终态；与 owner shutdown 的显式取消分开测试 |
| A14 | 启动失败和启动期间 close 不留迟到资源或 ready，不误关既有同端点服务 | worker readiness、插件异步初始化、endpoint 冲突、日志/模块失败、初始化未结束的故障注入 |
| A15 | 重复 initialize/close、close-before-initialize、致命错误触发 close 的行为符合设计 | Promise/调用次数和实际资源检查；失败后的再次 close 不能伪报 complete |
| A16 | Extra owner shutdown 拒绝新工作，取消所属 Run 后允许有界尾部事件及终态存储写入 | 与 #66 联验；等待真实源终态及业务尾部后清理插件资源，SQLite 始终由宿主创建、维护和关闭 |
| A17 | 真实依赖未结束继续占额，清理超时/失败及未知接纳返回 incomplete，阻止冲突替换 | 挂起 Promise、迟到 resolve/reject、dispose 拒绝、socket/manifest 释放失败；验证其他独立资源仍尝试关闭 |
| A18 | Extra 保持整体加载/关闭与泛型依赖；Gateway-specific 类型不扩散到通用 facade | Gateway 与自有 D 的无关 Extra 包外编译/运行；动态 Context 下一轮读新值而无需重载 |
| A19 | Playboard 临时服务使用相同工厂及 invoke，退出仅关闭自身实例 | 临时 endpoint/PID、常驻 Kernel 与 Home/profile 前后对照 |
| A20 | 所有当前指南、exports、声明和发行检查与统一合同一致 | 按迁移清单逐项检查；实际 tgz 离线安装、公共模块解析与包外运行；破坏性迁移说明完整 |
| A21 | 既有身份、凭据、配置和应用 SQLite 数据不变，无重登记/重置 | 隔离的既有 Home/数据库副本运行启动、失败、关闭、重配前后对照；凭据只比较摘要不输出正文 |
| A22 | 跨包行为与适用平台检查通过，真实业务证据单独记录 | pnpm 全仓检查、POSIX/Windows 端点及后代回收；真实 Electron renderer/主进程和 im-test 联验分开记录 |

## 本地验收结果

执行环境：macOS、Node 24.19.0、pnpm 11.19.0；使用工作区 fake Provider/测试 Adapter，以及实际 CLI、socket、worker 和发行 tgz，不使用外部 Electron 工程。

| 项目 | 本次证据与边界 |
| --- | --- |
| A01 | 已按 issue、设计、源码和公共 API 做实施者自查；未宣称独立评审通过 |
| A02/A03/A08/A10/A18/A20 | 构建、AST 架构约束、公开声明检查、CLI 及离线发行包的严格类型与运行 fixture 通过；旧 launcher、专用 entry、依赖 IPC 代理已删除 |
| A04/A05 | cli-foreground/cli-channel 与发行验证证明实际 CLI run PID 等于 Kernel/Gateway 报告 PID；manager 合同由现有 fake manager 测试覆盖，未注册真实系统自启服务 |
| A06/A11/A12/A13 | host-sdk-lifecycle、kernel-invoke、kernel-clients 等通过：停止一个 Extra 不影响共享 Kernel/无关 Run；两种输出视图、交互、显式取消、原身份 ACK 查回、原游标续流及消费退出语义有回归证据 |
| A14/A15/A16/A17 | component-startup、extra-startup、host-sdk-lifecycle 等通过：启动取消、迟到初始化、依赖未结束、失败回滚、重复关闭、源终态/业务尾部顺序与 incomplete 所有权均有故障注入 |
| A19/A21 | Playboard 保留隔离 Home/profile 和身份，发行测试验证卸载不删 Home；宿主自己创建并关闭 SQLite，注入查询/保存函数，Extra 成功与失败关闭后宿主仍可查询。未迁移生产数据库，也未对真实用户凭据做副本验收 |
| A22 | 本轮类型、lint、命名、格式、全仓测试与实际 tgz 检查结果见[整改验证](implementation.md#评审整改验证)。Windows 原生端点及真实 Provider/IM 未实测 |
| A07/A09 | 外部 Electron 验证不在本次库内范围，未执行，也不因 CLI 通过标为已实测 |

## 实施阶段检查入口

复用现有 `test/kernel-clients.test.js`、`kernel-worker-supervision.test.js`、`host-sdk-lifecycle.test.js`、`component-startup.test.js`、`cli-channel.test.js` 和 `scripts/verify-release.mjs`。按库内矩阵补齐真实 CLI/SDK 进程 topology 与包外普通 SDK fixtures；具体新增测试文件在实施时登记，不能列一个不存在的文件并声称执行通过。

```sh
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm test
pnpm format:check
uv run --with pyyaml python .octospec/scripts/lint.py
git diff --check
```

发行验证使用实际构建 tgz 调用 `node scripts/verify-release.mjs <archive>`。包外普通 SDK 类型 fixture 必须保留 `--strict --skipLibCheck false`，安装主包后编译，不引用源码；必要的 Provider 二进制按 Adapter 角色单独列明。

需要线上调试时仅连接 `https://im-test.deepminer.com.cn/`，凭据不进入日志、截图或文档。没有证据的项目保留未验收，不能以“功能正常”豁免 A02/A04/A05/A08 的库内架构约束。A07/A09 外部验证独立跟踪，不能因本次 CLI 检查通过而标为已实测。
