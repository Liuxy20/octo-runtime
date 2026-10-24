---
type: Plan
title: OpenCode 2 实施顺序与兼容验收矩阵
description: 版本门禁优先、两传输原生适配及真实 Runtime 验收，所有未执行场景明确待验。
tags: [adapter, testing, invocation, interaction, envs, mcp]
timestamp: 2026-10-23T00:00:00Z
---

# 实施顺序

1. 先在 OpenCode Adapter 增加同一路径版本门禁，覆盖 probe 与无 probe 的 invoke。沿既有结构报告明确 error，版本失败不降级。增加 V1、V2、未知/损坏版本、超时、自定义路径、PATH 覆盖测试。
2. 修正 CLI 参数和本轮配置生成，验证 standalone、模型/effort、MCP timeout、用户配置保留、临时目录失败清理和输入保真。
3. 验证 ACP 实进程握手、新建/续聊、模型、权限桥、取消和用量；修正本轮环境覆盖。确定 load 重放与新一轮输出的隔离策略，再决定是否需要 resume。
4. 建立真实 Runtime 驱动脚本和 V2 输出 fixture，覆盖保留的两条传输。不同场景使用受控临时工作目录，避免测试工具修改真实项目。
5. 根据真实结果固定最小版本和传输合同，同步 Adapter README、Provider 指南及受影响规则。文档移除旧 daemon 命令、旧 thinking/autoApprove 字段及“probe 仅检查存在”等过时说法。

如最终只保留 ACP，则需明确验证 full_access 原生权限策略及所有 CLI 原有能力，再删除多余 CLI 路径及其文档；当前调研不擅自切换。

## 版本矩阵

| OpenCode | 来源/定位 | probe | 直接 invoke | 实际模型及工具 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| 1.18.30 | 本机 nvm 目录保留的旧 V1，代表拒绝样本 | 应 error | ask/full_access 均应 error | 不得进入 prompt 或工具执行 | 已查询该路径版本；拒绝行为尚未实现/验证 |
| 2.0.0 | npm 已发布，最低支持候选 | 待验 | 两传输待验 | 待验 | 未安装、未测；不能声明已支持 |
| 2.1.3 | 查询时 npm latest，本机 `~/.opencode/bin/opencode` 已安装 | 待验 | 两传输待验 | 待验 | 固定源码和真实版本查询完成；功能未测 |
| 验收日更新的 latest 2.x | 若已变化则补一行精确版本 | 待验 | 待验 | 待验 | 不滚动覆盖已有版本证据 |

最低候选失败时先判断是 Adapter 缺陷还是上游版本限制，再有依据地选择最低支持版本；报告原因，不预先承诺全部 2.x 均通过。

## 场景矩阵

下表全部为计划，未执行。

| 场景 | JSON CLI/full_access | ACP/ask | 可观察验收 |
| --- | --- | --- | --- |
| V1 与版本检测失败 | 必须拒绝 | 必须拒绝 | 含检测版本或检测失败原因，提示需要2；无 run/acp 主调用 |
| 首轮文本/思考/工具/用量 | 待验 | 待验 | 真实模型输出可见，工具实际执行，事件归属及用量正确 |
| 跨进程续聊 | 待验 | 待验 | 第二轮不重传标记仍能回答，同 session；历史不混入当前输出 |
| 控制指令、Context、特殊字符 | 待验 | 待验 | 输入保真，新会话与续聊合同一致；不从业务历史补材料 |
| 显式 cwd/model/effort | 待验 | 待验 | 实际工作目录和模型正确，effort 有真实应用或未应用回执 |
| env 与同时两轮不同配置 | 待验 | 待验 | 测试工具观察到本轮值，无全局污染、串值或共享服务旧值 |
| stdio/HTTP MCP、工具执行、恢复 | 待验 | 待验 | 连接、发现、实际调用分开取证；header/env 换值生效 |
| 审批允许/拒绝 | 验证 auto 及显式 deny | 验证 once/always/reject | 原请求原响应，实际权限生效，无等待悬挂或重复响应 |
| 中途及等待审批时取消 | 待验 | 待验 | 唯一 cancelled/失败事实，pending 失效，私有后代按实际结果回收 |
| 无效凭据/模型/配置 | 待验 | 待验 | 真实错误，有限时间结束，无伪成功；不自动换账号或模型 |
| Provider 失败/子进程崩溃/EOF | 待验 | 待验 | 唯一终态，原始失败可诊断，清理结果真实 |
| 成功和失败后的资源 | 待验 | 待验 | 本轮临时文件和可观测私有进程已回收，用户配置前后摘要一致 |

## 检查与证据

实现阶段按实际变更运行 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:names` 和聚焦测试；共享层改动再运行全量 `pnpm test`。现有回归入口包括 test/adapters.test.js、test/opencode-message-segments.test.js、test/context-mcp.test.js、test/initial-control-instructions.test.js、test/reasoning-levels.test.js 及共享 ACP/审批测试。

真实验收同时记录 SDK 的 AgentExecutor 和推荐 KernelClient 路径覆盖范围。直接 CLI 或裸 ACP 成功不算 Runtime 端到端成功；fixture 通过不替代真实执行。

逐场景保存精确版本、OS/架构、provider/model、可复现命令、输入概要、事件计数、终态、耗时、PID/清理结果和脱敏证据位置。不得保存 token、完整 env、认证文件、私有配置或无筛选的原生 transcript。不同平台分别标记，macOS 结果不代表 Linux/Windows 已验。
