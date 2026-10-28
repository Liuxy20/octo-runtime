---
type: Task
title: Issue 188 实施与验证
description: 模型等待状态机、原卡片 footer 和真实 IM 故障注入的验证证据与边界。
tags: [channel, delivery, testing]
---

# 实施

- 基线 `origin/main@59cb21a14259b6dc828f8791b8117ba1f3689f4c`，分支 `fix/188-model-wait-feedback`。实施前可执行性自评 96/100。
- `execution/model-wait.ts` 以单调时钟消费 CanonicalEvent；不保存消息正文。`ImTask` 拥有每次尝试、停止和清理；取消失败可由用户再次 Stop，同一在途取消仍去重。
- `ImRuntime` 的计时器和源事件复用 presentation 出口。`reasoning-frame.ts` 只更新原 `progressText` footer，恢复清除；取消中保留 active 模板与 Stop，确认后进入请求超时卡片。最终文本区分确认结束与停止未确认。
- Gateway 默认 Core limits 防止首帧 60 秒及生命周期进展口径干扰 300 秒策略；显式 Context limits 优先。Core 修正长交互结束后的首帧预算基点，并识别活动等待；正式工具和活动工具分别持有预算，人工等待暂停各自重叠时间，整轮期限不暂停。产品阈值仍归 Gateway。
- 服务端 `ai.reasoning-process@0.4.0` / `0.4.1` active 模板中的 `progressText` 位于展开区底部。首次等待时展开原卡片以显示 footer，不新增卡片或阶段。

# 已运行验证

- 首轮全套：WebUI 35 通过；Node 2109 通过、56 跳过、0 失败。补充消息元数据继承和长交互回归后 Node 2113 通过；最终修复 Stop 并补真实 IPC 回归后，全套 WebUI **35 通过**；Node **2115 通过、56 跳过、0 失败**。
- 最终状态机、重试、渠道、交互、清理、准备失败及 watchdog 八组回归 **152 通过**，包含 20 项 model-wait 测试和超时/文本 Stop/卡片 Stop 三条真实 KernelClient/IPC 取消。
- 边界覆盖 29,999/30,000/60,000/299,999/300,000ms、迟到计时器、全部九次提示、公开内容恢复、私有 reasoning/用户回声/重复快照、并行工具与交互、队列、Stop、dispose、取消拒绝、取消后源流故障与迟到成功。
- `pnpm typecheck` 通过；最终 Core build、根 `tsc --noEmit`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check`、`git diff --check` 通过。OctoSpec lint 通过（447 单元、20 规则），系统 Python 缺 PyYAML，改用 `uv run --with pyyaml python .octospec/scripts/lint.py`，未更改仓库依赖。改动文件与账号文件的 Token 值比对无匹配。

# 真实 IM 故障注入

入口：`OCTO_CHANNEL_QA_ACCOUNTS=<仓库外账号文件> node scripts/verify-model-wait-im-live.mjs`。使用用户指定测试账号，只连接 im-test 和既有 Channel_QA 群。真实 WS/API/服务端卡片/Kernel IPC，执行端使用可控 fixture，**不是真实模型延迟样本**。不修改用户运行服务或全局凭据；脚本关闭自己创建的 Gateway/Kernel 后删除自己的临时目录。

首轮 30 秒提示于约 30.337 秒出现；300 秒后验收脚本断言失败。补安全诊断后复验，首条提示约 30.322 秒，30/60/90/120/150/180/210/240/270 秒全部更新原卡片，300.004 秒调用一次取消；12 个卡片版本依次到“正在请求停止”和真实 `run.cancelled` 后的“请求超时”。失败原因是脚本只在 HTTP 截获最终文本，而正常 final 走 WebSocket。随后真实历史回读确认两次超时各有“模型已连续 5 分钟未返回输出，本轮请求已超时。已确认执行结束，可以重试。”。修正脚本为基于本轮前后消息 ID 的服务端历史回读；测量允许 100ms 的 Gateway/执行入口交接偏差。

恢复场景首轮实测 30 秒提示、35 秒公开输出清除、长工具期间无提示、最终 completed。该轮脚本的“卡片移动”误报来自 `Response.json()` 丢失 64 位消息 ID 精度；改为复用产品已有 `parseOctoJson`。恢复最终复验通过：首提示 30488ms、首次内容 35035ms、总投递 70683ms，同卡片编辑 3 次；长工具期间无提示，无取消或重放。上述两类失败为验收脚本问题，保留失败事实，不算作成功的整次脚本运行。

组合场景的 Stop 首次因 fixture 匹配到历史 QA 标记而超时，改为取追加在 prompt 末尾的本条标记；随后真实 Stop 复现既有产品问题：本地 abort 使公共 invoke 尾部校验丢弃真实取消终态，展示 `结果未知`。运行中的用户 Stop 改为保留原观察流，尚未执行/退避及强制期限的中止保持。修复后真实 Stop 脚本整次通过：30355ms 首次提示、31631ms 完成投递、同卡片编辑 3 次、真实 `run.cancelled`、stopped 卡片、无 RESULT_UNKNOWN 诊断。真实 IPC 三种取消和最终八组 152 项通过；最终全套 Node 2115 通过、56 跳过，WebUI 35 通过。

真实 Codex 正常回复复验通过：同一原卡片递增编辑 2 次、真实 `run.completed`、最终文本从服务端历史回读匹配；首次 final/commentary 内容在执行交接后 **6166ms** 出现，总投递约 7285ms，无取消或重放。这只是一个正常样本，不能推断线上 TTFT 分布。入口增加 `OCTO_MODEL_WAIT_REAL_MODEL=1`；故障场景可用 `OCTO_MODEL_WAIT_MODES=recover,stop` 单独复验。

# 范围与未验证项

- 没有线上 TTFT 分布数据；30 秒是异常静默提示门槛，不是预期响应时间，已有内容后的静默同样计时。
- 未运行真实模型的慢响应实验，未通过真实客户端 renderer/CDP 截图检查卡片视觉位置；模板源码与真实卡片 API 证据不能替代客户端渲染验收。历史 sync 返回原始卡片体，编辑后的 renderer 内容还需消费平台卡片更新，不能拿原始历史体当最新版卡片。
- 用户后续授权本地审查、修复并提交 PR；合并和部署不在授权范围，用户此前运行的服务未重启。

# 本地双轴审查与修复

审查相对固定基线 `59cb21a14259b6dc828f8791b8117ba1f3689f4c`，Standards 与 Spec 并行独立执行，详见 [review.md](review.md)。Standards 的清理证据、Core 中文注释与活动工具预算三项，以及 Spec 的仅活动等待被 Core 首帧误取消一项均修复。

活动等待回归先复现三种等待被首帧误取消；修复后 78 项定向测试通过。复审补充活动工具独立 idle/wall、真实 canonical/native 进度与人工等待重叠三个回归，先红后绿；最终三组 **81 项通过**。正式工具/交互与活动独立持有等待，结束一个不会提前解除另一个；正式终态只移除匹配活动，不清除并行项。

真实 im-test 再验恢复与 Stop 两场景，整次脚本通过：恢复首提示 30350ms、首内容 35042ms、总投递 70630ms、原卡片编辑 3 次、completed；Stop 首提示 31486ms、总投递 32631ms、原卡片编辑 4 次、真实 run.cancelled/stopped。恢复场景的长工具期间无模型静默提示。执行端仍是受控 fixture，真实 WS/API/Kernel IPC，与前述真实 Codex 正常样本分开。

清理脚本只有确认 Gateway 关闭且 Kernel close.complete 后才删除临时目录；关闭失败或不完整时保留目录和结构化清理事实。

最终全部审查修复后：全套 Node **2126 通过、56 跳过、0 失败**，WebUI **35 通过**；Core build、根 TypeScript noEmit、lint、命名、格式、docs 检查均通过。OctoSpec lint **448 单元、20 规则**。提交前重新 fetch，`origin/main` 仍为固定基线 `59cb21a`。真实客户端截图仍未执行，不因自动化全绿而视为已验收。
