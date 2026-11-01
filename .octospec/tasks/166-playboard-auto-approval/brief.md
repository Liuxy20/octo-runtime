---
type: Task
title: "Issue 166：Playboard 自动审批完成与入口默认值"
description: "让自动审批在两种输出模式下完成，保留外部回答失败边界，并仅调整 Playboard 的缺省审批策略。"
tags: [cli, invoke, interaction, protocol, adapter, testing]
status: pr-preparation
spec_baseline: 8d79537deee2e8d050749d0129e6d36ec3bd7d1c
implementation_baseline: 4a0f53b50723422d90f051944ae19eb28f60712a
delivery_baseline: 42102c60103a9b18166c499b0c74a23e0d2295c6
---

# 目标与依据

Playboard 的 JSON stdin 调用在 Adapter 自行处理审批时必须继续消费事件，直到真实执行终态；需要外部回答的交互仍以 `PLAYBOARD_INTERACTION_REQUIRED` 失败。CLI 与 SDK 对同样有效审批策略下的执行必须具有一致的可完成性。

依据：[Issue #166](https://github.com/Mininglamp-OSS/octo-runtime/issues/166)、[补充默认值评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/166#issuecomment-6513424328)、ORT-63 分诊评论 `cb537bd8-1f19-4226-a4c2-9f7bcb910827`，以及用户本次“拉取最新代码、开始写 spec、必须有 YAML”的要求。

本文描述待实现合同；机器可读合同及验收编号见 [spec.yaml](spec.yaml)，规则读取记录见 [context.yaml](context.yaml)。三份文件一同审查，不将规划写成已交付能力。

## 当前事实与价值

- 原分诊在 `db427e85` 的同版本构建上复现：fake Codex 经真实 CLI/Kernel/worker/Adapter，canonical/native 的显式 full_access 均退出 1；SDK 两种模式均 resolved 并 completed。ask CLI 均及时失败。
- 本阶段已 fetch 并将原分支 rebase 到 `origin/main@8d79537d`。核对最新源码，Playboard 仍遇所有 pending/requested 即抛错；Codex 仍先发该通知再自动答复。审批缺省仍是 ask。分诊运行结果属于旧 SHA，本阶段未声称重新完成运行验收。
- 普通 provisioned 的缺省 workdir 已使用 `process.cwd()`；preset 可由 Provider 管理目录。现有 Playboard 测试覆盖 ask 失败，缺少 full_access CLI 成功验收。
- 修复价值为恢复脚本、一次性工具调用和流水线的可完成性，建议 P2。无需引入通用交互式 stdin 或重构整个审批系统。

## 产品意图与责任归属

| 项目 | 本次合同 |
| --- | --- |
| 业务目标与决定权 | Playboard 宿主选择其缺省策略；显式输入继续由调用方决定 |
| 显式输入 | InvokeInput.approvalMode、Context 的 octo.security/approval_policy、workdir/workspace、protocol_mode |
| CLI 合同内动作 | 仅补未指定的审批默认值，消费公共交互事实，返回真实退出结果，关闭自身临时 Kernel |
| Adapter 合同内动作 | 依据有效策略与具体交互类型决定自动处理，发布所需事实并负责唯一响应及状态变更 |
| Protocol/Core/Kernel | 校验和保真传递新增事实，沿用身份、响应范围、执行及清理合同 |
| 越界动作 | CLI 猜 Provider 方法或正文、替 Adapter 答复、全局改 SDK 默认、自动接受追问、扩大授权范围 |
| 其他接入影响 | 通用 SDK 缺省 ask 不变；新增可选字段可供其他宿主消费，本项不强制更改其 UI/策略 |

拓扑沿用 CLI 进程直接构造临时 Kernel → 内部 worker/唯一 AgentExecutor → Codex Provider。CLI 拥有临时 Kernel 和临时目录，Adapter 拥有所属 Provider，SDK 宿主拥有自行构造的服务。不新增进程、服务工厂或调用 API。

## 输入默认值

1. 仅 Playboard 入口在顶层 `approvalMode` 和 Context `octo.security/approval_policy` 均未提供时，补 `full_access`。不得修改共享 `prepareInvokeInput` 的 ask 默认。
2. 只有顶层时保留该值；只有 Context 时由既有解析器使用 Context；两者均有时相同值有效、冲突按现有合同拒绝。null、空字符串、非法策略或非法 Context 不当作省略，不得用默认值掩盖校验错误。不得修改调用者 Context 快照或把宿主默认写入模型文本。
3. 普通 provisioned 在缺少顶层 workdir 和 Context workspace 时使用 CLI 进程的 `process.cwd()`，不得使用 Runtime Home、临时 socket 目录或 worker 另选目录。继续保留显式目录、冲突校验、路径合法性和 preset Provider 管理目录语义。
4. 保留 protocol_mode 缺省 native、stdout 逐行 JSON、stderr 诊断和既有 Home/profile 参数语义。

## 交互输出合同

本规格选择在公共交互事实中增加可选布尔字段 `responseRequired`，不通过延时、全局权限开关或 Provider 私有方法名猜测。以下是待实现设计，不代表基线已有该字段。

| 位置 | 取值与含义 |
| --- | --- |
| canonical interaction.requested 的 payload.responseRequired | false 表示 Adapter 已承担自动响应；true 表示需外部回答 |
| native control `{type: interaction, status: pending}` 的 responseRequired | 同上；Provider native payload 保持原样，不插入此字段 |
| 缺省字段 | 消费方按需外部回答处理，旧 Adapter 不会被误判成自动处理 |

1. Codex 在发布 pending/requested 前按当前交互分类和有效审批策略确定响应归属。仅已经选择本次自动响应路径的 approval 可以标 false；ask 审批、question、elicitation 标 true。未知或不支持的方法沿现有明确失败路径，不得标 false 后悬挂。
2. canonical 的 false 仅对 kind=approval 合法；question/elicitation 携带 false 必须拒绝。两处字段如存在均须为 boolean，拒绝 null、数字和字符串；native 字段仅允许在 pending 上出现。native 无 kind，分类事实由可信 Adapter 负责，CLI 不解析私有请求代替分类。
3. false 只说明无需外部回答，不证明批准已写入、Provider 已执行或 Run 已完成。保留 requested/pending、resolved/expired/invalidated 和原身份；自动响应完成仍以现有写入确认点发布 resolved/full_access_policy，不预先发布成功。
4. CLI 先输出合法事件；遇 pending/requested 且 responseRequired 不等于 false，立即以现有错误失败，不等待交互到期或用户输入。手动专项从收到交互帧到进程退出设置 5 秒观察上限，排除初始化耗时。
5. 遇 false 时 CLI 继续消费同次执行，既不发送响应也不重新 invoke。自动写入失败、映射失败、过期、失效、Provider 失败、lost、缺失终态及清理失败沿既有错误路径退出非零。resolved 不单独决定退出码；只有 completed 且清理成功才退出 0。
6. 多次或并发交互分别处理；自动审批之后出现外部追问仍必须失败。重复响应、过期响应和取消竞态的既有范围校验不得放宽，自动审批只处理一次。

## 实施边界与兼容

- Protocol：在 `schema/protocol.schema.json` 的 InteractionRequestedPayload、HostControl 分支增加可选字段；同步 `src/index.ts`、`src/run-protocol.ts` 的类型与校验，重新生成 TS 与 native Go/Python 产物。Run=7、Context=v3、IPC=1 和 Adapter transport=2 保持现有版本。
- Codex：修改 `src/app-server.ts` 的交互发射点，保持 native 原始载荷、响应 ID、写入确认、唯一控制者与清理逻辑。
- CLI：修改 `apps/cli/src/playboard.ts` 的默认值装配与事件判定，保留既有取消、输出背压及 primary/cleanup 错误聚合。
- Adapter SDK：核对 `src/approval.ts` 已有 canonical 自动响应路径，对其实际自动处理的审批发布同样事实。其他 Adapter 不实施自动处理的路径仍按缺字段保守处理，不逐个改写全部 Provider。Claude native 等未覆盖路径不宣称本次新增支持。
- Core/Kernel/转换器：检查新增字段在序列化、源窗口、订阅、canonical 投影与就近处理时完整保留，不从请求策略补造字段。
- 文档：实现时同步 InvokeInput/输出规则、Playboard CLI 中英文说明，明确“Playboard full_access 默认”和“SDK ask 默认”的差异及 preset 例外。

兼容性：新消费者对无字段旧事件仍保守失败；旧 strict native 校验器可能拒绝新字段，因此升级 Runtime/worker/相关 SDK 产物需配套，不承诺跨版本旧客户端兼容。新字段不新增权限或响应方法。实际接入检查不能仅凭生成 hash 推断通过。

## 验收与验证计划

所有新增专项放在 `scripts/manual/166-playboard-auto-approval.mjs` 及同目录 fixture，以显式命令运行，不接入默认 glob、package scripts、workflow、job、matrix、自动触发条件或必需状态。已有测试可因默认值变化将“需人工审批”场景改成显式 ask，保留原检查范围。

| 编号 | 场景 | 可观察通过条件 |
| --- | --- | --- |
| A1 | CLI canonical/native 的显式 full_access 和完全缺省策略 | 仓库 fake Codex 经真实 CLI/Kernel/worker/Adapter；每组合连续 3 次退出 0，有合法唯一 completed，自动响应仅一次 |
| A2 | 显式 ask 与策略来源 | 顶层 ask、Context ask 均及时报原错误；full_access 两种来源均可完成；冲突和非法值仍拒绝且不误用默认 |
| A3 | full_access 下 question/elicitation | canonical/native 均在交互帧后 5 秒内报原错误；没有自动回答或 completed；覆盖先自动审批后追问 |
| A4 | 协议字段与旧事件 | true/false/缺字段在允许位置通过；类型错误、canonical 非审批 false、native 非 pending 字段拒绝；无字段 pending 仍及时失败；TS 与 Go/Python codec 一致 |
| A5 | SDK 与传播 | 同配置 SDK canonical/native full_access 均 resolved/completed；SDK 缺省仍 ask，可由原 responder 回答后完成；字段经 IPC/订阅保真，native payload 无修改 |
| A6 | 自动处理失败 | 注入写入失败、过期/失效和 Provider 失败，不出现成功退出；resolved 不能遮蔽后续失败，未发生额外批准或重复 invoke |
| A7 | 取消与回收 | pending 自动写入期间取消、SIGINT、SIGTERM、正常完成与异常输出关闭均按原结果处理；观察所属进程退出和临时目录释放，清理 incomplete/拒绝必须非零并保留主错误 |
| A8 | 目录与输入 | 不同 CLI cwd 启动且缺省目录时实际 Provider cwd 等于 CLI cwd；显式 workdir/workspace 保真，冲突拒绝，preset 不被强加 cwd，调用者 Context 未改写 |
| A9 | 真实 Codex，non-gating | 可用环境下 canonical/native 各完成一次隔离临时目录工具操作并核对产物、真实终态和清理；记录 Provider/平台/模型版本；Windows 原问题单独重验 |
| A10 | 交付范围 | 生成检查与既有适用回归通过；相对目标 main 的 workflow diff 为空，默认测试入口与实际 GitHub 检查列表无扩大 |

实现后运行 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm test`（既有范围），再显式运行 `node scripts/manual/166-playboard-auto-approval.mjs`、`node native/codegen/generate.mjs --check`。必要时按 native 现有入口显式执行 Go/Python codec 检查并记录命令。实现时同时执行 code-review，处置标准与规格两轴问题。

真实验收遵循 [Provider 独立真实验收](../../guides/provider-live-acceptance.md)，不能用 fake 结果代替真实模型/Windows 通过。涉及公共协议的受影响宿主构建、重启和 im-test 注册执行按现行规则记录；外部桌面集成由宿主团队验证，不扩大本次源码范围。缺环境标 BLOCKED，未执行标 NOT RUN，不将缺失验收写成通过，也不新增 CI gate。

证据绑定完整 SHA、dirty、平台、Node/pnpm/Provider 版本、命令、逐场景终态、自动响应次数和所属资源清理事实。新建 fixture 使用测试专属临时目录，不读真实凭据或操作用户工作目录；临时目录清理须等待所属进程退出。

## 范围外

不增加多轮交互 stdin、自动回答问题、全局 SDK 默认变化、Provider 权限扩大、所有 Provider 重构、持久重试/自动重跑、进程拓扑改造、数据迁移、依赖升级或 CI 范围变化。规格本身不授予提交、推送、PR、发布或合并权限；用户后续“开始实现”已授权按本文实施与验证。

## 决策与可执行性

已确定的需求：自动审批可以完成、真正外部交互仍失败、Playboard 缺省 full_access、普通执行缺省 cwd、保留显式输入。以下为本规格待审查的设计选择，审查通过后作为实现依据：

- D1：采用可选 `responseRequired` 布尔事实；缺字段按需要外部回答处理。
- D2：full_access 默认仅在 Playboard 注入，SDK 保留 ask；保留 preset 的 Provider 目录语义。
- D3：Codex 与共享 canonical ApprovalBroker 发射相同事实；不承诺全部 native Provider 本次均已覆盖。

无必须先补充的产品输入。实施核对项：Core/Kernel 是否存在丢字段的转换点、native 生成校验器对可选字段及条件约束的覆盖、真实 Codex 与 Windows 环境可用性。无法兑现上述合同则返回规格审查，不能静默缩减验收。

可执行性自评 **96/100**：目标与归属 20/20、输入及失败边界 25/25、实现路径 18/20、验收可观察性 24/25、风险与恢复 9/10。差 4 分：字段传播点尚待实现核对（2），跨语言条件校验尚待专项确认（1），真实 Codex/Windows 环境尚未验证（1）。这是规格准备度，不是测试通过率。

## 开发环境

基线：`origin/main@8d79537deee2e8d050749d0129e6d36ec3bd7d1c`。分支：`fix/166-playboard-auto-approval`。Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-166`。主机：`lvsijiaMacBook-Pro.local`。

规格阶段的 YAML 与全库检查已通过。用户已认可 D1–D3 并授权实现；原分支更新到 `4a0f53b50723422d90f051944ae19eb28f60712a` 后完成实现、本地验证和双轴审查。用户随后认可验证并授权更新最新代码、提交和创建 PR；交付基线为 `42102c60103a9b18166c499b0c74a23e0d2295c6`。详情见[验证记录](validation.md)与[审查记录](review.md)，本次不自动合并。
