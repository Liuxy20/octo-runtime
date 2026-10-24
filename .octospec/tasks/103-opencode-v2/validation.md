---
type: Task
title: Issue 103 OpenCode 2 真实验收
description: OpenCode 2.1.3、DeepSeek、MCP、审批、失败及测试 IM 的脱敏验证记录。
tags: [adapter, testing, interaction, mcp]
timestamp: 2026-10-23T05:00:00Z
---

# 环境与基线

- Runtime 初始基线：origin/main@445d2bb24f6ffc27bb4414c835e6a0b365f9f25b；已按用户要求 rebase 到 cc49c8b4ce2d04fd2389585d00ffcf8806b4af72，分支 research/103-opencode-v2；最终实现由同 PR 的提交确定。
- macOS 26.6.2 / darwin arm64，Node 24.19.0，pnpm 11.19.0。
- 用户安装的 `/Users/lvsijia/.opencode/bin/opencode`：`opencode v2.1.3`。验收时 npm `@opencode/cli` latest 亦为 2.1.3。
- 用户已有模型配置：provider deepseek，model deepseek/deepseek-flash。认证由宿主已有配置提供；不修改、不输出认证文件。
- 测试 IM：im-test.deepminer.com.cn；orbtex-opencode 接收，orbtex-codex 发送。原始账号文件只通过环境指定，不复制到仓库。
- 最低版本选择 **2.1.3**，也是验收时最新稳定 2.x。未宣称 2.0.0 支持。

## 兼容矩阵

| 实际版本 | probe | full_access | ask | 结论 |
| --- | --- | --- | --- | --- |
| 2.1.3，最低支持/当前最新 | available | CLI 真模型、工具、续聊、MCP、取消、错误通过 | ACP 初始化、配置、真模型、工具、续聊、审批、MCP、取消、错误通过 | 通过 |
| 1.18.30，独立真实 arm64 二进制 | 明确拒绝 | 不先 probe 直接 invoke 仍拒绝 | 不先 probe 直接 invoke 仍拒绝 | OPENCODE_VERSION_UNSUPPORTED，含检测版本及 V1 不再支持 |
| 2.0.0 / 2.1.2 / 预发布 / 3.x | fixture 拒绝 | fixture 拒绝 | fixture 拒绝 | 版本门禁回归，不是这些版本的真实集成证据 |

V1 使用 npm pack 解包至临时目录，没有全局安装。实际样本 opencode-darwin-arm64@1.18.30，完整性 sha512-KO4FJGZpgmSz+NNQ6PizynT5qAzVfoZI5HJLpyD0tYNqePPu87g2/UgVmNW663Bock2r75koLZFjR5waZiFiqw==。旧 nvm 全局 opencode-ai@1.18.30 已按用户要求卸载，V2 安装保持原样。

## 真模型场景

`scripts/verify-opencode-v2.mjs` 通过公开 AgentExecutor.invoke 执行，未直连模型代替 Runtime；每个场景断言恰好一个终态。

| 场景 | CLI full_access | ACP ask |
| --- | --- | --- |
| shell 写文件、读工具、本轮环境值与真实 workdir | completed，2 个工具 | completed，2 个工具及 2 次审批往返 |
| 同一 providerSession 续聊，重复首轮记忆标记 | completed，同 sessionId | completed，同 sessionId，无历史答案重放 |
| 活动模型/工具期间取消 | cancelled | cancelled |
| HTTP MCP 发现并调用 octo_echo | completed | completed，真实审批往返 |
| MCP 合成 Authorization header | 服务端收到正确工具调用与 header | 服务端收到正确工具调用与 header |
| 显式 model + effort=high | completed，V2 model#high | 未实现 setter，按既定合同提示未应用 |
| 拒绝写文件审批 | 不适用 | cancelled，目标文件不存在 |
| 无效 JSON 配置 | failed，未启动执行传输 | failed，未启动执行传输 |
| 实际错误 provider apiKey（V2 settings.apiKey） | failed | failed |
| 不存在的 provider/model | failed | failed |

上述 16 个 Run 最终 shutdown.cleanup=complete。正常、失败及取消后进程检查仅保留用户原有共享 `opencode serve --service`，没有本轮 run/acp/private serve/sleep 遗留。未停止或接管用户原有共享服务。CLI 工具帧可能只有终结态；usage 在原生实际提供时保留，不伪造缺失 token 数。

## 真实 IM 往返

`scripts/verify-opencode-im-live.mjs` 在双方已加入的测试群运行：测试消息显式 mention 接收 Bot，Gateway 限定测试 sender 和群，Kernel 服务由当前宿主原生构造，内部独立 worker 调用同一 OpenCode Adapter。

结果：真实 WebSocket 入站 -> Gateway -> KernelClient.invoke -> worker -> AgentExecutor -> OpenCode 2.1.3 -> DeepSeek -> Gateway 投递。恰好 1 个 Run，run.completed；按消息发送者及随机标记确认服务端群历史中实际收到 Bot 回复。Gateway、Kernel 和临时目录均关闭。

测试 Bot 之间直聊返回平台 not_friend；因此采用共同测试群验证，没有把好友限制当作 Adapter 错误。

## 可复现命令

```bash
pnpm build
OCTO_OPENCODE_COMMAND=/absolute/path/to/opencode node scripts/verify-opencode-v2.mjs
node scripts/verify-opencode-v1-rejection.mjs
OCTO_OPENCODE_COMMAND=/absolute/path/to/opencode \
OCTO_CHANNEL_QA_ACCOUNTS=/protected/path/to/test-accounts.md \
OCTO_CHANNEL_QA_GROUP=<test-group-id> \
node scripts/verify-opencode-im-live.mjs
node --test test/opencode-v2.test.js test/adapters.test.js test/context-mcp.test.js
```

## 回归与工程检查

- 最终 Node 全量使用 `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js`：1714 项，1674 通过、40 跳过、0 失败。UI 35 项通过。
- OpenCode、ACP 清理、流量限制、MCP 和 effort 相关回归：84 项全部通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm docs:check`、`pnpm format:check` 及 `git diff --check` 通过。
- 首轮默认高并发全量为 1713 项，1671 通过、40 跳过、2 项 Kernel 恢复计时超时；两个失败文件独立复测 6 项全部通过。随后新增 ACP 清理异常回归，再运行上述低并发全量通过，不将首轮失败隐去。
- OctoSpec lint 仅报告 3 个基线已有文件缺少 frontmatter：systemd-directive-paths 的 brief.md、review.md 及对应 2026-10-22 journal；本任务无新增错误。
- 固定实现提交 `81f316e` 的双轴审查通过，Standards 与 Spec 均无需要修复的问题，见 [review](review.md)。

## PR Secret Scan 误报核验

PR #116 的 Gitleaks 8.30.1 首轮扫描报告 `ad4e357a1d53e07bd12b7d1ebbd0d10d79dfb46b:scripts/verify-opencode-v2.mjs:generic-api-key:203`。该行是错误认证场景写死的无效测试值，来源为本任务测试代码，不是从账号或认证文件读取的值；两传输以此实际执行均返回 failed。该做法已按下文用户明确的禁止入库约束撤回，不保留固定值。

CI 采用 depth=2 的 PR merge checkout，暂缺父历史，因此将整份文件归到浅边界 ad4e357。在保留原始历史的隔离仓库复现同一版本及范围后，实际引入指纹为 `81f316e88c324e374b613dc6a12437da130fa5ff:scripts/verify-opencode-v2.mjs:generic-api-key:203`。仅将该原始历史指纹加入 `.gitleaksignore`，同步命名检查要求的规范化 SHA256 快照。首次收尾曾将测试值简化为更短的固定值；用户进一步要求禁止提交凭据占位值后，改为运行期生成。未豁免文件、路径或规则，未修改原始提交历史。

本地工具下载归档 SHA256 为 b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5，与官方 8.30.1 darwin arm64 校验表一致。验收结果：

- 保留历史隔离 clone，范围 `445d2bb..ad4e357`：加入精确例外后 0 告警，退出 0；加入前只报上述原始指纹，退出 1。
- 新建隔离 canary 提交，在同文件原 203 行及邻近 204 行放入非功能性密钥样式；PR 范围扫描在两处均报 github-pat，退出 1。
- 完整历史扫描在新增 canary 前有 135 个既有告警，本次样例无告警；新增后为 137，指纹集合比较确认仅增加上述两处 canary，原 135 项未被隐藏。因此这次验证证明例外范围有效，不宣称整个历史扫描通过。
- 当前测试值简化后重新运行 16 个真实场景全部通过，最终 cleanup=complete；命名检查与 7 项命名回归通过。
- 独立 Standards 收尾复核确认指纹、原始提交、规范化哈希和无效值修改准确，无剩余问题。远端 PR review 同时提出的唯一 P2 为本项扫描失败，本次修复覆盖该意见；托管重验以 PR 最新检查为准。

## 凭据禁止入库约束纠正

用户明确禁止在仓库提交 API Key，并要求写入架构设计约束。此前无效值是本任务写入的固定测试样例，不是读取用户配置或测试账号得到的凭据；仍不应以其非真实或扫描通过作为保留硬编码的理由。

已将禁止提交凭据值（含固定测试占位值）的合同写入 [architecture](../../rules/architecture.md#凭据值严禁进入代码仓库)。验收脚本的错误认证值改为每轮在内存调用 randomUUID() 生成；MCP 模拟服务的 Authorization 值同样仅在运行期生成，服务端记录请求 header，由验收脚本在工具调用回执中比较本轮收到的值。这证明 header 传递，不证明服务端会拒绝错误认证。实际认证沿用宿主已有配置，脚本不新增实际凭据读取或持久化，不输出这些测试值。历史扫描例外只对应原始非秘密固定样例，不作为提交实际凭据的许可。

运行期随机值版本重新执行 16 个真实场景全部通过，shutdown.cleanup=complete。脚本 AST 检查确认 apiKey 与 Authorization 两个字段均无字面量值，Gitleaks 8.30.1 对当前脚本 stdin 扫描退出 0；格式与 diff 检查通过。OctoSpec lint 仍仅有前述 3 个基线 frontmatter 错误。

## Rebase 到最新 main

2026-10-23 按用户要求从 `6700e16` rebase 到最新 `origin/main@cc49c8b4ce2d04fd2389585d00ffcf8806b4af72`。知识目录新增条目冲突保留双方内容，main 的安全整改及本任务凭据禁止入库约束均保留。`git range-diff` 确认原四个提交的差异仅为目录上下文；逐文件比较确认 OpenCode、共享 ACP/SDK 入口、本任务回归及三个真实验收脚本与 rebase 前一致。本轮不重复未改变的真实模型/IM 测试，原证据仍按原始提交记录。

原实现提交 `81f316e` 对应 rebase 后 `12abf7ae87b5162731d7ee6631ce050ce929619e`。保留真实引入历史的 PR 范围扫描确认唯一告警仍是同一已核验的固定无效历史样例；精确例外仅同步该提交 SHA，命名检查规范化哈希同步为 91c998b5156daffb8479d70b4a5ab785f94eeb3e7fae2a18c2a24f81d9f2abd8。当前源代码仍只在运行期生成非功能性测试值，没有重新引入固定凭据值。

更新基线后的验证结果：

- `pnpm install --frozen-lockfile` 通过并完成全 workspace 构建，保留 main 的锁文件及 Vitest 4.1.12 升级；根 TypeScript noEmit 检查通过。
- Node 全量使用 concurrency=4：1731 项，1691 通过、40 跳过、0 失败；包括 main 新增的安全及发行进程回归。UI 35 项全部通过。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check` 通过；命名回归包含在 Node 全量内。
- Gitleaks 8.30.1 对 `cc49c8b..HEAD` 的 PR 范围扫描退出 0；`git diff --check` 通过。没有修改检测规则或扩大例外范围。
- 四个重放提交均保留原配置作者及唯一 Codex trailer；远端更新使用明确旧 head 的 force-with-lease，避免覆盖并发更新。

## yujiawei 最新审查修复

2026-10-24 对照针对 `9ca69ac` 的审查修复真实缺陷。零退出且缺失最终文本时直接返回唯一 `run.failed`，错误码为 `OPENCODE_INCOMPLETE_OUTPUT`；不再在资源清理成功后抛出普通 Error 导致 Core 保守报告 incomplete。文本判定与 normalizer 一致，接受空字符串及 part 包装文本，拒绝非字符串；两种 step-start 均重置上一轮文本状态。

PATH 按本机 `node:path` 规则解析：POSIX `resolve(cwd, "/usr/bin")` 仍是 `/usr/bin`。相对和空项按本轮 cwd 解析，保留宿主显式 PATH 顺序；实际执行固定为 probe 返回的绝对路径。额外修复 Windows 自定义命令的根相对与盘符相对路径，使用本轮 cwd 及本机盘符规则，无固定系统目录或盘符。

- 先加回归、未改产品代码时：22 项中 13 通过、9 失败，复现终态、文本判定和 Core 清理问题；PATH 优先级回归已通过。
- 修复后新增原生可执行文件测试，OpenCode 文件 23 项全部通过，覆盖唯一终态、空文本、包装帧、step 重置、Core 清理和临时文件删除。
- 原生路径测试通过硬链接或复制本机 Node 可执行文件，真实探测 PATH 与版本，断言 Node 被明确判为不支持的 OpenCode。测试无 shebang 依赖，覆盖绝对、相对、空 PATH 项及 Windows 扩展名、根相对／盘符相对路径；Windows Node 24/26 CI 已接入。本机执行只证明 macOS，Windows/Linux 结果仍须看当前 head 的托管 CI。
- workspace 构建、根类型检查、lint、命名、格式及文档检查通过。Node concurrency=4 全量 1742 项：1702 通过、40 跳过、0 失败；UI 35 项通过。
- 当前修改重新执行 16 个真实 OpenCode 2.1.3 / DeepSeek 场景，全部符合预期终态，最终 shutdown.cleanup=complete；未重复未受影响的真实 IM 往返。
- 两个独立子审查分别核对 Standards 和 Spec，均无待修复问题，见 [review](review.md#yujiawei-最新审查逐项处理)。

首轮将 `rg` 不可执行的意见按审查环境缺少已声明前置依赖处理，CONTRIBUTING.md 已要求安装实际 ripgrep，macOS/Linux CI 显式安装。用户随后要求补齐测试可移植性，非 Git 回退及回归见下文；Git 仓库仍保留已有 ignore 枚举合同。

`e056b6c` 的托管 Secret Scan、Linux Node 24/26 和 macOS Node 26 通过；Windows Node 24/26 在新增原生路径测试中因 `.EXE` 与 `.exe` 的字符串大小写断言失败。程序已实际启动并返回版本，但尚未完成后续路径场景，不能登记 Windows 路径验证通过。断言改为比较双方 realpath，以文件系统解析结果验证目录选择，兼容 Windows 的扩展名大小写。该跟进仅修改测试及记录，产品代码不变；当前提交的 Windows 完整结果仍以重新运行的 CI 为准。

## 最新 P2 与托管重验

`1467724` 的 Windows Node 24/26 完整 job 均通过，涵盖原生路径及发行安装；Linux Node 24/26、macOS Node 26 同样通过。macOS Node 24 首轮在未修改的 process-group-cleanup.test.js 中因 NDJSON parent-exits 场景报 PROCESS_CLEANUP_TIMEOUT，600ms 的清理预算内未确认进程组消失；不把原因推断成已证实的 runner 波动。本机单独复测该文件 11/11 通过；仅重跑失败 job 和 CI Gate 一次后，当前 head 六个 job 及 CI Gate 全部通过。没有改变清理预算或跳过该测试。

Jerry-Xin 随后在其他 Node 安装上独立复现同 head 的另一个 P2：复制或硬链接到临时目录的动态链接 Node 因缺少相对原生库 SIGABRT，无法打印版本。托管 runner 通过不能否定这个可移植性缺陷。本轮改为 POSIX fixture 通过原位置 Node 的绝对 shebang 执行；Windows 保留已验证的原生 exe 场景和 realpath 目录选择断言。当前本机未安装 reviewer 的动态链接 Node 构建，不宣称已在该构建上重验；结构上不再搬迁 POSIX Node，普通 Node 下相应场景全部通过。

命名测试在缺少真实 rg 时原先会因空 stdout 再抛 JSON 解析错误。先将测试 PATH 主动清空，8 项全部失败；加入仅非 Git 目录的 Node 遍历回退及真实 Git 祖先检测后 8 项通过，含外部链接指向 Git 子目录的拒绝场景。Git 根仍明确报 RIPGREP_REQUIRED，不静默降低忽略规则。脚本只在 rg ENOENT 时回退，保留其他错误；遍历跳过排除目录和链接，respectsGitIgnore=false，如实标记结果。Windows CI 现运行同一组测试，不依赖是否预装 rg。

新增工具终态白名单回归及 README 的 PATH/UNC 说明，未修改产品状态映射。相关 OpenCode／命名共 32 项通过；符号链接边界补修后命名 8 项再次通过。独立规范审查无问题，独立需求审查的链接边界已修复并复审通过。UI 和 16 个真实 OpenCode 场景的产品代码未改变，沿用上一轮明确记录的结果，不宣称重新执行。

本轮最终 Node concurrency=4 全量 1744 项：1704 通过、40 跳过、0 失败。根命名检查、全仓格式及 diff 检查通过；OctoSpec lint 仍仅有前述 3 个已有 frontmatter 错误。生产 TypeScript、依赖和锁文件未变，构建／类型结果沿用上一轮；新 head 的托管结果不能由上一 head 的绿色代替。

## 最新 main 与环境别名复核

2026-10-24 从 a5f5cac rebase 到 origin/main@c01c0c9144b74028b3f08ab59d9e27ed7ed8a9ff，新增主线 5 个提交，无冲突；8 个 PR 提交经 range-diff 全部保持内容。原始实现提交现为 15575e62f3644f1fcdfb8798cd44c090f863edba；单条历史扫描指纹同步该 SHA，规范化摘要更新为 55a5f30d872a99b923e9ac3de8018e93e5fb90db554cfa8749b4c7e9823bdb75，不扩大例外范围。

新增 Windows 环境别名场景涵盖 Path／Pathext、混合大小写、重复键、空 PATHEXT 及调用方对象不变。按 Node 子进程字典序首项策略选值；POSIX 仍区分大小写。本机不能执行 Windows 专属分支，已纳入同一 Windows Node 24/26 原生路径测试。

普通 ACP 子类回归在修复前确实因 TypeError 原样上抛而失败；修复后验证 Error／TypeError／SyntaxError／RangeError 及 code=undefined 均包装并保留 cause，结构化容量错误及 close 失败保持原对象。最初额外的 OpenCode 注入测试错误地把 acpClientFactory 放入 context，未实际注入，已删除无效测试；不将该失败当作产品缺陷证据。版本 banner 独立回归证明 opencode v2.1.3 已被支持。

- frozen-lockfile 安装 main 新依赖，workspace build、根类型检查、lint、命名、全仓格式、文档检查通过；文档测试 4 项通过。
- Node concurrency=4 全量 1745 项：1705 通过、40 跳过、0 失败；其中 OpenCode 文件 25 项通过。UI 在更新后的 happy-dom／lucide 依赖上重新执行，35 项通过。
- 实际 OpenCode 2.1.3／deepseek/deepseek-flash 的 16 个场景重新执行，预期终态全部通过，最终 cleanup=complete；未重复真实 IM 往返，未修改用户 Provider 安装。
- Standards／Spec 独立审查均无新增发现。diff 检查通过；OctoSpec lint 通过 uv 临时提供 PyYAML 执行，仍仅报告 3 个既有 systemd frontmatter 错误。
- 新 head 的托管矩阵与 Secret Scan 待推送后验证；本轮未另行运行本机 Gitleaks，不把之前扫描结果当作 rebase 后结果。

## 证据边界

未在 Windows/Linux 做真实 OpenCode E2E；未测其他 2.x、其他模型、ACP 图片/表单/终端扩展或实际 Electron App。ACP effort setter 尚未实现，CLI 不传 model 时不猜测默认模型来套用 effort。合成子进程回归覆盖版本超时、异常退出及 stop 后非零退出，不能代替相应 OS 上的原生集成证据。Core 对其他未经此 Adapter 收敛的异常仍可能保守报告 incomplete，不将其解释为所有 Provider 清理问题已解决。
