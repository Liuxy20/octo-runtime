# Issue 246 验证记录

2026-10-29，基线 `ba2a706380bf244bc428b3465c0487c5b58e6975`，验证对象为分支 `fix/246-gateway-projection-window` 的修复代码。

## 修改范围

- Gateway 投影明细最多五条；公开摘要和进度最多 180 码点预览，原文不再全轮累计。模型步骤关联只保留可见窗口及当前步骤，次数独立累计。
- 有限近期退役身份帮助过滤迟到更新；不保存完整历史 ID 集合。步骤关联已移出窗口的迟到消息不恢复旧正文，首次公开摘要仍计数；显式 final 独立接纳。
- 活动工具只保留现有元数据和有限输入，完成后释放；不保留完整工具输出。final 用独立消息表维护原有更新/拼接语义。
- 尚未结束步骤中的消息仅保留通道、步骤、淘汰标记和计数标记，正文随五条窗口淘汰。步骤完成、run 终态或 dispose 释放身份元数据；不能仅在消息完成时删除分类，否则同一步骤内的迟到帧可能在近期退役缓存滚动后进入 final。
- 重试换投影、断流换投影及整轮收尾显式 dispose。外层 finally 保证提前退出或收尾异常也释放正文；final 的读取和投递机会在清理前保留。
- 卡片 finish 后释放调度器和诊断/typing 回调，保留 messageId 等既有按钮关联。连接关闭时也释放，即使关闭报告失败仍保留错误并清理这些内存引用。调度 dispose 丢弃待发进度并取消 timer，真实在途发送仍由原路径结束，不提前假报排空。

不修改 Kernel、Provider 执行与正文、公共协议结构、工具执行、最终回复单次报文 256 KiB、任务/模型等待期限、其他 Extra、CI workflow 或默认测试入口。隐私补充修复在 OpenCode 既有归一化函数中显式补充 final 通道，其余产品改动仍属于 Gateway。

## 环境与检查

Windows 11 企业版 Build 22621、x64、普通用户；Node.js 24.22.0、pnpm 11.19.0。离线验证使用合成事件与 fake Kernel，未调用真实模型。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，819 包复用缓存，锁文件未修改 |
| `pnpm typecheck` | 最终构建与根类型检查通过 |
| `pnpm lint` | 通过，使用最终稳定构建产物 |
| `pnpm lint:names` | 通过，无 findings |
| 修改文件的 Prettier check | 通过 |
| 仓库默认 `format:check` 等价命令 | 662 个原有 CRLF 检出文件报格式差异；`core.autocrlf=true`，未修改的 package.json 工作树为 CRLF、HEAD 为 LF。没有格式化无关文件 |
| 相同全仓 Prettier 检查加 `--end-of-line auto` | 通过，用于确认除现有检出换行外的格式 |
| `git diff --check` | 通过 |

## 手动专项

```text
node --expose-gc --test .octospec/tasks/246-gateway-projection-window/regression.mjs .octospec/tasks/246-gateway-projection-window/edge-cases.mjs .octospec/tasks/246-gateway-projection-window/review-regression.mjs .octospec/tasks/246-gateway-projection-window/privacy-regression.mjs
```

专项文件手动执行，不匹配现有默认测试 glob。

隐私补充修复后的最终版本 41/41 通过，无失败、取消或跳过。原 34 项及新增 7 项手动回归共同执行，耗时约 21 秒。

- 直接投影 2,000 轮事件与数 MiB 公开文本，明细始终不超过五条，累计模型/工具/公开摘要各 2,000，最终回复完整。
- 经 ImRuntime 和 fake Kernel 消费 1,000 轮大量进度/工具事件，未请求取消，final 正常返回，随后清空投影。
- delta 更新单条有界预览，迟到更新不恢复近期已淘汰记录，省略 channel 的旧进度不进入 final，公开分类提升和显式 final 使用独立路径。
- 原步骤已离开近期窗口时，首次公开摘要计数但不恢复旧正文；模型轮次保留累计编号。
- 长工具移出可见窗口后仍接纳其完成状态，不保存原始输出、不重新增加展示行。
- 成功、失败、取消、流异常、卡片收尾失败、最终投递失败和关闭路径均验证投影清空；最终文本在清理前可完整读取。
- 保留卡片对象和按钮 ID 后释放诊断回调，WeakRef/显式 GC 验证连续 1,000 轮 fake invocation 的投影可回收。该证据证明所测引用链可释放，不等同于进程 RSS 恒定或真实持续一天任务验收。

## 边界与压力验证

同版本独立基线与最终构建的边界对照：

| 合成输入 | 未修改基线 | 修复版 |
| --- | --- | --- |
| 513 条短公开进度 | 接纳 512 条，第 513 条抛 `IM_RESULT_TOO_LARGE`，最终状态未知 | 全部接纳，只保留五条，final=`FINAL_OK` |
| 300 条、每条 1,024 个“字”的公开进度 | 接纳 85 条，第 86 条使累计文本超过 256 KiB 而抛错 | 全部接纳（累计约 900 KiB），只保留五条，final=`FINAL_OK` |

迟到消息与资源生命周期覆盖：

- 一条仍在输出的消息移出窗口并跨越 400 条新消息后，迟到帧可能省略 channel。有限退役集合不能替代在途分类，否则进度可能按缺省 final 拼入最终回复。改用不含正文的在途消息元数据。
- 已离开近期阶段的私有消息首次公开摘要后，多个 delta 不应重复增加 reasoningCount。计数标记跟随在途生命周期，旧正文不回窗。
- 对照适配器确认 OpenClaw 等会发送 `message.update/status=streaming` 替换快照；不能把所有 update 当作完成并提前清理分类。仅修正 Gateway 的分类元数据生命周期，不修改适配器或公共协议。
- 另外覆盖 432 个重叠工具逆序结束、超长 Unicode 预览、调度器在途发送期间 dispose、终态覆盖待发进度和发送失败诊断。
- 压力专项处理 100,000 轮、700,000 个合成事件；每 20,000 轮显式 GC 采样 retained heap，并断言窗口、计数和 final 完整。复用合成正文，不将其宣称为真实网络吞吐或持续 24 小时负载。

最终压力采样 `heapUsed`（字节）：9,066,280 / 9,063,232 / 8,991,680 / 9,043,560 / 7,904,016；首末差 -1,162,264 字节。此结果支持本合成负载下没有随展示历史增长的保留堆积累，不证明任意负载下进程内存恒定。

最终源码构建、根类型检查与 ESLint 通过。

## 相关回归

```text
node --test --test-concurrency=2 test/im-*.test.js test/channel-*.test.js test/gateway-*.test.js test/adapter-failures.test.js
```

PowerShell 实际按这些前缀展开测试文件后传参。共 500 项：495 通过、4 失败、1 条件跳过，无取消。四个 Windows 权限/符号链接失败在未修改的同版本基线单独复现；跳过项沿既有 Worker 平台条件跳过。本次只同步与五条展示窗口相关的既有断言。

## 边界与审查

完整 Node 测试集合在修复版和同版本基线各尝试 195 个文件，并发 2、单文件外部预算 60 秒；存在基线失败、清理波动和超出测试预算的文件，不能宣称全仓全绿。此预算属于测试编排，不是产品超时合同。本记录仅用其说明验证边界，不扩张 Issue #246 的修复范围。

真实 IM/Provider、24 小时运行、跨系统测试、托管 CI 和部署未执行。在线 Bot 的原工作树与运行产物未修改，不发业务消息、不重跑原事故任务。

自审重点：五条窗口同步释放文本、关联步骤有界、在途工具独立、final 不提前清理、卡片和最终投递取消权保持、失败事实不被释放流程覆盖。旧的 512 条投递回执窗口及单次发送 256 KiB 保持不变。

## Rebase 后复验

整合基线 `main@01d0ca5d3f62f1e9dc5999ed84da4797e9acafef`。任务索引保留双方条目；`im-channel.ts` 完整保留上游上下文初始化、恢复及收尾逻辑，只重新接入投影替换时的释放和覆盖最终投递的外层 finally。相对该基线的产品 diff 仍限定为六个 Gateway 文件。

- `pnpm typecheck`：构建与根类型检查通过。
- 上述 26 项手动专项：26 通过，无失败或跳过，包含 100,000 轮事件和 1,000 次调用回收。
- `node --test --test-concurrency=2 test/im-protocol.test.js test/im-runtime.test.js test/im-extra-disposal.test.js test/im-pre-execution-failure.test.js test/im-final-mention.test.js test/im-new-session-history.test.js test/im-context-gap.test.js`：97 项，96 通过、1 条件跳过、0 失败。
- Gateway 源码 ESLint、修改源码及专项的 Prettier、diff 空白检查通过。

本次复验针对冲突交汇处的展示、终态释放、上下文衔接和最终回复路径，不重新扩展到完整仓库测试或范围外修复。前述 500 项回归和全仓尝试保留为初次基线验证记录。

## Review 缺陷修复与复验

基于 `1003fc55` 核对并复现三项 P2；补充评审没有新增独立根因。最初新增的五个断言在修复前全部失败。修复仅涉及 Gateway 投影器和本任务测试/记录，未修改适配器、SDK、Kernel、公共协议或 CI。

- 真实 OpenCode 归一化器只结束模型步骤、不逐条结束 reasoning 时，步骤所属身份在 `model_step.finished` 释放。回放 100,000 个已完成步骤，GC 后每 20,000 步采样为 9,049,168 / 9,038,392 / 8,979,544 / 9,046,672 / 8,986,648 字节，展示始终最多五条。
- 真实 ACP/OpenCode 的 terminal-only 工具保留可用名称、命令短预览、失败状态和提供的耗时，不虚构开始时间、不保存完整输出；重复或已淘汰工具不重复计数。
- 未结束步骤保留精确身份/分类信息，已完成消息跨越 400 条新记录后不会复活、重复计数或成为 final；步骤结束后释放身份。已关闭步骤的带步骤身份迟到帧拒绝进入当前展示，真实 OpenCode 省略 channel 的新最终正文及显式 final 提升仍正常。
- 身份元数据规模随尚未完成步骤的身份数变化；没有模型步骤事件的兼容输入按隐式单步处理、在 invocation 结束时释放。此方案不保留已结束步骤的整轮身份历史，不承诺任意单个无限长步骤的恒定内存，也未新增任务中断阈值。

最终检查：`pnpm typecheck`（含完整构建）通过；Gateway ESLint、修改文件 Prettier 和 diff 检查通过；手动专项 34/34 通过。相关九个测试文件（上次七个集成文件，加 `adapter-tool-lifecycle.test.js`、`acp-message-segments.test.js`）共 104 项：103 通过、1 条件跳过、0 失败。

阈值核对：`RETIRED_WINDOW` 仍为 256，单次发送 256 KiB 及投递回执 512 条均未修改；只移除了展示累计 512 条/256 KiB 导致执行中断的条件。本轮仍未运行真实 IM/Provider、24 小时或跨系统验收。

## 跨已结束步骤且省略分类字段的补充修复

Jerry 与 yujiawei 指向同一根因：`c023d0d9` 仅保留未结束步骤的身份，旧步骤结束且近期缓存滚动后，省略 channel/stepId 的旧消息会被按当前步骤和默认 final 解释。PR 合入 main 后的 `d9b0fa62` 投影器源码相同。使用合法 `private_reasoning`、commentary 及工具事件复现了私有尾帧进入 final、旧进度进入 final 和工具重复计数。

修复后的发布依据：

- 通道只能来自当前帧、仍已知的消息分类，或同一非空稳定消息 ID 的已知 final。陌生消息及匿名/空 ID 的无通道尾帧不默认 final，不发送未知正文。
- 现有消息缓存记录携带一个来源布尔值，区分真实 ID 与匿名合成 key；同名字符串不能跨来源借用分类或 final 身份。来源标记随原记录清理，不新增缓存表或生命周期。上述匿名用例同时核对两种来源互相碰撞的情况。
- 已存在已结束步骤时，陌生非 create 进度/摘要及陌生工具终态没有自身 stepId，不再借用 currentStep；已知在途工具仍按原状态收尾。
- OpenCode 原生 text 在已有归一化函数中显式补充 `channel: final`，不改变正文或执行；真实 OpenCode 增量/替换快照和 ACP terminal-only 归一化路径均回归。协议字段仍可省略，但缺少可验证分类的消息不会自动发布为 IM 正文。
- 身份继续按步骤释放，不新增全轮 tombstone/ID 表，不增加缓存容量或新的执行中断阈值。

新增七项用例中六项在修改前失败，另一项确认真实 ACP 的新 terminal-only 工具已带正确步骤。修复后七项通过，并与原 34 项共同得到 41/41。覆盖 private_reasoning/旧进度/旧工具、跨步骤及 400 条滚动、双字段省略、匿名与空 ID 尾帧、稳定 final ID 连续帧、真实 OpenCode 与 ACP 输入。

基于 `d9b0fa62` 完整重建后，`pnpm typecheck` 通过；最终根类型复验、ESLint、修改文件 Prettier 和 diff 检查通过。十一文件相关回归（前述九文件，加 `opencode-v2.test.js`、`adapters.test.js`）188 项：167 通过、21 项平台条件跳过、0 失败。没有为了处理范围外失败修改 OpenClaw 等其他源码；本轮没有真实 IM/Provider、跨系统或 24 小时验收。
