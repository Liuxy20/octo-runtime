---
type: Review
title: Issue 51 规划可执行性评估
description: 根据需求覆盖、代码边界、生成方案和验收闭环评估规划准备度，并明确平台和实现证据缺口。
tags: [architecture, protocol, schema, native, testing]
timestamp: 2026-10-23T00:00:00Z
---

2026-10-24 范围更新：用户已移除 Rust，仅交付完整 Go/Python SDK 和包内 demo，且不接入 native CI。以下评分保留初始三语言规划历史，不代表当前验收完成；现行范围见 [brief](brief.md)。

# 结论与口径

以下保留 2026-10-23 的规划评估。2026-10-24 用户决定覆盖原方案中的模板和 CI 要求：保留完整 SDK，客户端源码单份维护，精简生成模型和规则，不接入 native GitHub CI。当前实施与本地验证见 [implementation](implementation.md)。

本轮规划准备度自评 **96/100**，满足用户要求的 95+。评分回答“实施者是否知道改哪里、遵守什么行为、按什么顺序做、如何证明完成”，不表示成功概率、工程量完成比例、测试通过率或独立评审结论。当前没有 SDK 实现或产品互操作证据。

| 维度 | 满分 | 得分 | 评分依据 | 扣分依据 |
| --- | --- | --- | --- | --- |
| 需求与范围 | 15 | 15 | Issue 原要求及追加三语言均映射 A01-A40；排除 Loop、托管/安装、业务 retry；所有权明确 | 无关键范围缺口 |
| 数据和生成方案 | 25 | 24 | 权威 Schema、方法/result/通知、IR 关键字、presence/opaque、三语言 codec、高层模板和漂移检查均指定 | 完整复杂 Schema 的模板编译和具体依赖 lock 仍需 M0/M1 实测 |
| 状态与故障 | 25 | 24 | ACK unknown、原流修复、全身份、cancel/control unknown、两种输出、4 路 drain/128 登记和预算具体 | 取消、task drop、partial write 的交错需真实实现验证 |
| 实施任务与边界 | 15 | 15 | M0-M7 的输入/文件/动作/退出/失败处理、三语言先后顺序、无隐含未合并前置 | 无范围内的待用户决策阻塞 |
| 验收与交付 | 20 | 18 | 40 条可观察断言、九格平台/18 格工具链、包外无 Node、CI Gate 和真实 Provider 分开 | Windows I/O completion/三语言平台和真实 Provider 环境尚未执行，不能提前计为证据 |
| 合计 | 100 | 96 | 所有项见 brief/design/plan/acceptance | 4 分为待实现及待实测的不确定性 |

## 评估时已核对并消除的分歧

| 容易造成不同实现的缺口 | 规划决定 | 验收 |
| --- | --- | --- |
| 把 issue 当 Go-only | native/go、native/rust、native/python 三套完整交付，每套都有同样高层功能 | A13-A40 |
| 只生成类型，客户端方法和 invoke 仍各自手写 | schema method 映射 +公共行为表 +语言模板生成全部高层，手写 transport 不选方法/恢复分支 | A09-A12 |
| 使用 WorkerRpc 的 stdio 方法调用公开 Kernel | 固定公开 8 方法及各自 result/通知 envelope | A01/A08 |
| 用指针/Option/None 把 null/absent 合并 | 显式 presence，codec 测 null/空/0/false；opaque 单独保留 | A03-A05 |
| TS 已有 opaque 大数能否无损穿透 | native codec 保真与 TS 已解析数值分开验，明确服务 IEEE-754 既有限制 | A04-A05 |
| Schema 条件/custom keyword 被生成器忽略 | 可达关键字清单，条件及 x-octo refinement 映射，unsupported 先失败 | A01/A10-A11 |
| ctx/deadline/Task.cancel 都等同断开 | 显式执行取消与观察关闭分别映射，deadline 触发 cancel 而非伪造终态 | A22-A25/A30 |
| 线程 Future 已取消就释放 Windows handle | overlapped cancellation 后确认 completion，保留实际在途额度 | A35-A36 |
| Go/Rust/Python 编译过即“调通” | 每语言实际 TS Kernel 的 receipt/流/交互/取消/恢复/清理，额外真实 Provider 验证 | A13-A40 |
| 只在本机验 UDS 就声明支持 Windows | 九格 OS IPC 必测，交叉编译和 skip 不算通过 | A36 |
| --check 只看 tracked git diff 漏新文件 | 临时生成比较完整预期集合，测新增/删除/陈旧文件 | A09/A11 |
| 新 workflow 与现有 CI Gate 无关 | native matrix 和生成 job 加入 needs，故障时 gate 必败 | A38 |

## 剩余风险及消除路径

R1：复杂 Schema 的 union/refinement/presence emitter 工程量较大。M0 先冻结完整可达闭包和约束映射，M1 用完整 schema 产出模型/validator/client 并通过 schema mutation 测试；未支持不能降为 any/map。若需要调整生成方案，先更新 design 和评分，再扩三语言。

R2：Python Windows 最容易出现底层 I/O 仍在等待而 task 已取消的泄漏。M0 必须做最小 pipe spike，M5 做 transport 单测，M6 做真实 pipe 故障及 100 次取消/关闭循环。未有 Windows 机器时继续独立开发，不能关闭这一验收格。

R3：平台依赖版本和最低工具链兼容尚未锁定。选型已有官方实现依据，M0 固定精确版本与 lock；先选择兼容最低版本的依赖，若确有无法兼容的必要条件，记录实证和影响后修订方案。不能临时删除最低版本 CI。

R4：真实 Provider 的认证、模式和交互可触发性取决于测试部署。M6 从受保护配置运行 opt-in harness，逐语言留实际证据；缺少凭据不阻塞 fixture 工程，但不能拿 fixture 宣称线上通过。当前无需向用户索取凭据，规划本身不启动真实服务或模型。

上述是明确的实施验证任务，不是留给实现者自行决定的核心语义。进入实施的工作起点固定为 M0；当前用户授权只到规划，不自动执行 SDK 开发、commit 或远端写入。

## 本轮实际检查

已通过 GitHub CLI 读取 issue 全文（无评论），从最新 origin/main 新建独立 worktree，核对当前 Protocol/Kernel/TS client/fixture/CI 源码及平台传输官方资料。未借用其他分支的未合并实现。

基线完整 OKF lint 非零，原因是三个已有文件缺少 YAML frontmatter：`systemd-directive-paths/brief.md`、`systemd-directive-paths/review.md` 及相应 `2026-10-22-systemd-directive-paths.md` journal。它们在创建 worktree 后、编辑前已复现；本任务不改这些文件。新增任务与 journal 会单独检查 frontmatter、YAML、链接、A01-A40/M0-M7 覆盖和 git diff 空白；完整检查结果见 [journal](../../journal/shared/2026-10-23-51-native-rpc-plan.md)。
