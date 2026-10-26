---
type: Journal
title: Issue 182 渠道本地产物交付实施与验证
description: 记录 IM 文件卡与内嵌图片交付、企业文档路由撤销及实际验证证据。
tags: [channel, delivery, context, testing]
timestamp: 2026-10-26T00:00:00Z
---

# 实施与接口证据

从 `origin/main@78bb88a` 建立 `feat/182-channel-artifact-delivery`，随后同步 `6bbbd91`、`81284c9`，保留上游规则和记录。按[任务](../../tasks/182-channel-artifact-delivery/brief.md)及[设计](../../tasks/182-channel-artifact-delivery/design.md)实施。可执行性自评 96/100 表示准备度，不表示测试通过率。

Gateway 在每次调用前注入权威 `extra.im/artifact-delivery`，计入原 Context 预算，冻结可信配置派生的交付合同。默认 mode=channel，显式 tools 关闭自动交付。成功 final 后由 workflow 核验、上传 IM 附件和改写当前 final；用户主动要求上传、保存网盘或发布仍走普通 ToolCall，已有云 URL 不重复上传。不改变 Kernel、Host、Adapter 的通用业务职责。

用户从群聊产品体验复核后撤销自动企业服务路由：群里发文件不应引入文档 ACL、授权、新成员及转发访问障碍，服务可用不等于协作意图。已更新 GitHub Issue #182，删除企业服务开关、探测、HTML 发布、Markdown 创建/导入、文档授权及相关专项测试和脚本。在线协作、发布、文档权限与分享卡只归明确的普通 ToolCall。

普通本地文件链接上传后额外发送原生 type=8 文件卡；字段为 url/name/size/extension，沿原 WS 加密、稳定编号、ACK、取消和位置观察路径确认，不使用互动卡服务。最终 Markdown 的链接文字和已替换附件地址保留，文件卡不能替代它。仅图片引用保持内嵌，不额外发文件卡；同图还有下载链接时上传复用并最多一张文件卡。文件卡各有独立回执，失败/未知结果在同条 final 明确提示，保留成功上传的链接。完整准备 Promise 在文本重试时复用，不重复卡片。

IM 附件使用 `GET /v1/bot/upload/presigned?filename=...&fileSize=...`，原样使用返回的 PUT、contentType 和 contentDisposition 直传已核验字节；不向对象存储转发 Bot Token。只交付独立 downloadUrl，不使用签名上传地址，不剥离签名伪造公开地址。测试环境旧 multipart 接口已返回 HTTP 410。

Markdown AST 选择有效引用，token 源区间替换地址，保留正文、图片语法、alt 和 title；不重序列化正文。不处理代码、引用、HTML 或未使用定义；共享定义有受保护引用时局部展开，组合嵌套改写避免重叠。文件 realpath 去重、根目录约束、regular file、打开描述符身份及读后状态检查，加上单文件/合计/数量/MIME/时间预算，限制读取和上传范围。

同一 final effect 缓存整个准备 Promise，上传后才计算 mention 偏移，沿原发送及回执链发送。部分失败保留成功地址，在同条 final 列出稳定失败原因，不重跑模型。stop/reset 取消准备并禁止旧代次发送；reset 不取消仍执行的模型；关闭沿原共享有界 drain。

# 自动化与本地审查

本轮 verified-review 范围为基线 `81284c9ed92066ce7cf34c1b84b608b9336279bf` 之上的工作区（dirty），逐文件复查 31/31 文件，无跳过文件。本机 Darwin arm64 / Node 24.19.0，未运行 Windows 文件系统联验。审查计划沿配置 → Context → 成功终态 → 本地文件核验/上传 → 原生卡片 → mention/最终文本逐层跟踪，检查授权快照、重复引用与重试、独立回执、取消/代次和企业业务边界；同时读调用方及原有 WS 确认窗口。实际运行覆盖真实 IM 往返以及失败/未知回执和取消注入。复查后没有未处理的 medium 及以上问题。

审查发现并修复一项合同冻结问题：执行结束后从公开可变 SDK 配置重新计算策略，可能使上传与执行前 Context 不一致。现改为 createImInvocation 返回本轮策略快照，复制 roots/MIME 数组，并由最终投递复用；专项回归通过。复查后没有未处理的 medium 及以上问题。

- 原生文件卡改动前，在 `81284c9` 上 `pnpm typecheck`、lint、命名、docs 与格式检查通过；Node 全套 1856 通过、50 跳过、0 失败，WebUI 35 通过。它们不代替本轮回归。此前默认并发曾出现 DSH 临时目录清理和 Grok 两秒探测超时，降低测试并发后全套通过。
- 本轮 `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm docs:check`（4/4）和 `pnpm format:check` 通过。全量 Node：1846 通过、50 跳过、0 失败（并发 4）；原生卡片专项最终 25/25 通过，新增失败/未知回执覆盖。全量与专项各自计数，不相加作为独立用例数。WebUI 未改，沿用此前 35/35 结果。
- 专项检查图片/下载共享上传、reference、正文链接与文件卡并存、type=8 加密 WS payload、ACK/取消/位置观察、独立编号和回执、failed/unknown 卡片状态、`cards:false` 不关闭原生卡片及文本重试不重复发送；stop/reset/shutdown 取消交付且不重跑生成。
- Context 容量边界夹具调整自动辅助材料数量/长度，继续验证原降级和重试冻结合同；诊断子进程从所有文本 part 查找哨兵。
- `git diff --check` 通过。`uv run --with pyyaml python .octospec/scripts/lint.py` 仍报告基线 7 个缺失 frontmatter：dsh-upstream-sdk 的 brief/upstream-feedback、systemd-directive-paths 的 brief/review，以及 2026-10-22-systemd-directive-paths、2026-10-24-124-sass-build-fix、2026-10-26-dsh-upstream-sdk 三份 journal。本次文档无新增错误；不将此全库检查标成通过，也不修改无关文档。

# 真实测试环境证据

用户先仅授权上传与匿名下载，随后提供仓库外保护账号文件并明确授权测试环境端到端测试。脚本只读取环境变量指定的账号文件，仅允许 im-test；不提交凭据，不输出消息正文或签名上传地址，不使用生产配置。专用测试群 `GW_REVIEW_20261024133729` 中逐一校验 Bot 成员和唯一真人测试账号，使用 orbtex-codex 发起、orbtex-opencode 响应。

- `scripts/verify-channel-artifacts-live.mjs`：实际产品函数上传 HTML 和 PNG，匿名下载 SHA-256 一致，同图仅上传一次；不发消息。
- 旧附件分支曾完成真实模型生成后两次 Gateway 上传、匿名下载核对和内嵌图片；下一轮显式 ToolCall 上传零次二次上传、无重复 final。标记 `ARTIFACT_cc449dc1`。这版尚无原生文件卡。
- 旧企业服务分支曾发布并读回 HTML/Markdown，标记 `ARTIFACT_3de94410`；该分支现已撤销，对应专项脚本已删除。这些历史文档不作为本版交付目标，也没有执行无授权删除。
- 当前 `scripts/verify-channel-artifacts-im-live.mjs` 使用真实 Codex 与测试群：生成 HTML/Markdown/PNG 后三次 Gateway 上传，消息历史确认两张 type=8 原生文件卡（game.html/report.md），最终文本同时保留两条附件链接及一张图片语法；匿名下载三份文件，SHA-256 均与本地生成内容一致。`cards:false`。下一轮显式 ToolCall 上传成功，Gateway 新增上传为 0，旧 final/卡片历史保留，最终文本无重复。两轮均仅一次模型调用、成功终态。
- 之前 Chrome 实际客户端已证明 640×360 PNG 成功解码并内嵌显示，旧企业 HTML 文档也曾可读，但这不替代本版原生卡片视觉验收。早期 1×1 PNG 的测试只证明上传，已替换为可见图片样本。本版卡片及链接的服务端历史证据已通过。新建隔离 Playwright Chrome 加载测试站后停留在 Web 登录页（无 pageerror）；所提供 uk 用于用户 API 权限，不假定它是 Web 登录凭据。因此本版客户端截图验收未完成，不能由服务端历史推断为通过。

当前 HTML 按原始文件交付，不再套用在线 HTML 服务内容策略。长期下载 URL 已检查不含临时签名，未等待跨日有效期；Windows、其他部署和跨重启事务恢复仍未实际验证。

# GitHub 交付

用户授权本地 verified-review 通过后提交并建立本需求自己的 PR。GitHub 内容和 commit message 使用英文，保留配置作者，只添加一次 Codex trailer。创建 PR 后将每 15 分钟跟进固定到该 PR，处理有效意见并汇总 commit/普通 push，直到 APPROVED 且无待处理 changes-requested；不改写其他人改动、不强推、不自行合并。

## PR #187 同步最新 main

已提交 `9314195` 并建立 [PR #187](https://github.com/Mininglamp-OSS/octo-runtime/pull/187)。用户要求解决最新 main 冲突，本轮合并 `origin/main@167205ccd113e0795a7f7d9c5c24beeba9c56e5d`，唯一冲突为 `.octospec/log.md` 同一天新增记录，保留双方内容。知识目录、Channel 规则及产品代码自动合并；保留 main 的规范 `OCTO_TOKEN` 注入、CLI/IPC 和 Windows 控制台修复。附件交付、正文下载链接和内嵌图片合同不变，不改写已有提交。

同步后 `pnpm typecheck`、lint、命名、格式与开发文档检查全部通过；全量 Node 1863 通过、54 跳过、0 失败（并发 4），包含文件卡 failed/unknown 回执、链接保留、mention、去重、取消和工具身份回归。`git diff --cached --check` 通过，OKF 仍仅有前述 7 个基线 frontmatter 错误。按 verified-review 复核冲突解法及自动合并的 Channel 规则；上游工具环境、CLI/Kernel 文件与 main 一致，没有额外产品代码改写或未处理的 medium 及以上问题。本轮不重复未变更的线上测试或 WebUI 检查；Windows 专属检查未在本机执行。使用英文 merge commit 和普通 push 更新同一个 PR。

## PR #187 P2：展示收尾期间的停止空窗

Jerry-Xin 对 `ede73df23b68d8b720876e0de5e7b833d195a014` 提出 changes-requested：`presentation.finish()` 等待前已移除 task 和 active invocation，而交付 controller 等待后才注册，导致期间 `/stop` 回复无可停止执行，之后却继续自动上传。意见位于 review 正文，没有行内待解决线程。此问题已复现，前述初次本地审查未覆盖该时间窗口，不能用原无发现结论替代本次整改。

用户讨论后授权最小修复及公开产品决策：最终交付完成前的 `/stop`、`/cancel` 取消本轮剩余工作，模型终态和交付状态独立。模型已经 `completed` 时不再次请求取消、不改写终态、不重跑；已经上传的文件和已发送消息不回滚。等待展示收尾期间也必须有可取消的交付登记，不新增“模型完成后忽略 stop”的产品阶段。原因是行为一致性与改动范围：用户不应在收到无可停止反馈后继续遭遇自动上传，也无需为模型完成后另设停止规则。决策同步到 Channel 规则和任务设计，并按用户要求在 GitHub PR 使用英文评论。

修复只将交付 controller 的登记提前至 task 删除前，并在 `finish()` 后检查同一取消状态；提前退出也进入 finally 清理。执行中的取消、reset 不取消原模型、代次保护和共享 shutdown drain 沿用既有路径。展示 finish 自身不保证可强制中断，其延迟或报错不能恢复已撤销的交付资格。

验证基线为上述完整 SHA 的 dirty 工作区，Darwin arm64 / Node v24.19.0。新增 gate 用例延迟真实 Runtime 所调用的 presentation finish，通过实际 `prepareArtifactReply` 核验本地 game.html；模型源、展示、上传及发送为受控替身，不代表真实 IM 或客户端视觉验收。

- 同一命令 `node --test --test-name-pattern='presentation cleanup' test/im-artifact-delivery.test.js` 在旧实现 3 通过、2 失败（退出 1）：`/stop` 与 finish 报错后 stop 两条都启动了 1 次上传，期望为 0。证据 `/tmp/octo-runtime-187-p2-before.log`。早期夹具曾错误要求 workingTasks 为 0；该指标包含尚未完成的 session tail，移除该错误断言后才执行上述有效复现。
- 修复后同组 5/5 通过（退出 0）：stop/reset/shutdown/finish 报错后 stop 均不启动上传、文件交付或 final，模型只调用一次、已完成模型取消调用为 0、终态仍 completed；正常对照完成一次交付且链接保留。再次 stop 反馈无可停止执行，证明交付登记已释放。
- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check` 通过；`pnpm docs:check` 包含 4/4 运行用例通过。全量 `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js`：1868 通过、54 跳过、0 失败，退出 0，67.56 秒；包含原有执行中及上传中取消等相邻入口。日志 `/tmp/octo-runtime-187-p2-node.log`。
- 本地 verified-review 只针对本次增量 7/7 文件，无跳过；复核计划为登记交接、stop/reset/shutdown 调用方、异常与提前退出清理、已确认执行终态、测试故障注入及规则、设计、验证记录、日志与上下文的一致性。逐文件和二次风险复查后，没有未处理的 medium 及以上发现；这不是对整个 PR 新增的一次完整独立审查。
- `git diff --check` 通过；OKF 校验仍为前述 7 个基线 frontmatter 错误，本轮无新增。本轮没有重新运行真实 IM、WebUI 或 Windows 文件系统测试，既有客户端原生卡片视觉缺口保持未完成。GitHub APPROVED 必须由后续真实 review 确认，不由本地检查替代。
