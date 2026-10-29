---
type: Validation
title: Issue 234 本地验证与全局安装
description: 已完成实现、构建、专项和真实只读接口验证；用户确认真实群聊验收通过。
tags: [channel, context, testing]
timestamp: 2026-10-29T18:02:00+08:00
---

# PR 244 合并预算前过滤复审修复

复审发现 972ab40 的过滤发生在 loader 合并校验之后：合法静态 32 个宿主 extra.im 加合法动态 1 个业务项，仍因中间 33 项阻断准备。用户明确要求先过滤宿主 extra.im 再合并，已按此修复。通用 loader 增加显式同步来源选择入口，两个来源分别通过原有协议与容量校验后，由两个 Channel Extra 提供过滤函数，再合并并校验实际有效项。通用层不识别业务命名空间，默认行为不变；单个来源本身非法和真实业务超限仍拒绝。宿主回调每轮只执行一次，收到完整配置独立副本，共享回调池、超时取消和迟到结果保护保持。

新增专项先在旧构建复现 Gateway/WeCom 静态 32+动态 1 的失败，再在修复构建验证通过；另覆盖动态 32+静态 1、单来源各自合法但合并超过 64 KiB、无回调、真实业务 33 项仍拒绝、输入不变、默认 loader 不过滤、非法来源不被选择掩盖、超时后继续占额及迟到结果不执行选择。Gateway 夹具显式设置既有默认 bot_name，完整回调配置断言移至回调外，避免测试断言被业务准备错误捕获而掩盖原因。

本地验证：pnpm build、tsc --noEmit、lint、lint:names、format:check、docs:check（4/4 执行示例）均通过；完整 Node 集合 2381 项，2290 通过、91 原条件跳过、0 失败，继续使用与当前 Node 二进制一致的独占路径，未筛选或新增跳过。WebUI 35/35、六份手动专项 77/77、loader/清理/归属联合 30 通过及 1 原条件跳过。双轴只读复审 Standards 0、Spec 0，原 P2 已关闭。Octospec lint 仍仅有 Issue #137 三份既有 frontmatter 错误，无新增错误。

日志 `/tmp/octo-244-budget-{red,build,focused,full-tests,manual,ui,types,lint,names,format,docs,octospec}.log`。相对 origin/main 的 .github、scripts、package.json、pnpm-lock.yaml 无差异，不扩大 CI。按用户授权提交、推送并在 PR 解释修复；本次未全局安装、重启或重新进行真实群聊验收。

# PR 244 渠道命名空间归属修复

用户明确 extra.im 整个命名空间只由 channel-gateway/channel-wecom 构造，宿主静态及动态项不生效；规则如需更新，应由渠道内部按业务合同读取。进一步要求误配仅 warning 后忽略，不因同名冲突阻断 AgentRun。全局 octo.control/instructions 的特殊合并保持。规则、架构、Context 人格示例约束、任务设计及双语接入说明同步，取代旧的宿主同名 history 保留约定；本次不新增外部配置源接口。

两个 Extra 的宿主 Context 准备边界过滤 extra.im，仅记录 ignored_items 数量的 warning，不输出原材料；Gateway build_im_contexts 与 WeCom transport 直接构造路径同样过滤。Gateway dispatcher 统一替换三项稳定说明，普通轮全部省略，刷新轮由渠道生成，不再因同名宿主项而跳过或误确认刷新。historyRetry 完整保留渠道冻结快照；其他合法宿主项及 instructions 的顺序、重复、静态/动态既有取值均保持。

本地验证：

- pnpm build、tsc --noEmit、lint、lint:names、format:check 通过。
- 完整 Node 原有测试集合：2381 项，2290 通过、91 原条件跳过、0 失败。沿用字节一致的独占 Node `/tmp/octo-244-node-b3bLE7/node`，避免全局 octo-cli 影响既有“未安装”夹具；未筛选测试或增加跳过条件。
- WebUI 35/35；六份手动专项 74/74。新增 ownership 专项验证两个 Extra 的静态/动态保留项被 warning 忽略后仍进入 AgentRun、真实 transport/buildContext、任意 extra.im key、其他业务项及全局重复指令保留、输入不变、普通/刷新/恢复/冻结重试。原生命周期专项加入同名宿主说明，验证 1/30/60、reset/new 与冻结卡片重试。
- 修改既有 HG-29 的冲突断言为“忽略宿主项并正常生成渠道缺口”，没有新增默认测试项；相关三文件联合 61/61。
- docs:check 与 4/4 执行示例通过；首次发现新链接违反现有“不带片段链接”的文档约束，改成整页链接后通过。
- Octospec lint 仍仅有 Issue #137 的三份既有 frontmatter 缺失，未新增错误；git diff --check 通过。

日志为 `/tmp/octo-244-context-ownership-{build,types,lint,names,format,docs,full-tests,ui,manual,focused}.log`。相对 origin/main 的 .github、scripts、package.json、pnpm-lock.yaml 无差异；核对当前远端 27c837d 的六平台构建/发行检查和 CI Gate 均成功，本次专项仍只显式本地运行，不扩大 CI。

本轮按用户授权完成本地修改及 commit，不全局安装或重启服务。此前用户真实群聊验收对应原已安装构建，不能据此声称本次命名空间修复已上线验收。

# PR 244 CI 修复与完整本地回归

16:34 用户报告PR #244失败并要求完整本地测试。远端运行 `40840478427` 在四个Linux/macOS Node24/26任务中均只有 `test/context-configuration-protocol.test.js:55` 失败，构建、类型、文档通过，两个Windows发行验证成功。根因是本任务为 `data_format` 新增了仅含 `if.required` 的Schema条件，旧目录覆盖测试直接访问 `branch.if.properties.name`，漏同步该消费者导致TypeError；不是该日志证明的Agent执行失败。修复只将已有测试过滤改为 `branch.if?.properties?.name`，保留完整目录与Schema名称集合相等断言，不改产品代码、Schema、生成产物或测试数量。

本地在原提交 `c87d02f4feb2` 加本次测试修复的工作树复现红灯（27/28），修复后Context配置/协议联合260/260通过。继续执行完整 `pnpm test:suites`：WebUI35/35通过，Node共2381项、2289通过、91跳过、仅“缺失octo-cli”断言因当前Node目录确有全局CLI而失败。该本机基线问题此前已有独立复现，不修改该测试或全局安装。

为按同一测试集合验证缺失安装场景，将当前Node v24.19.0原样复制到独占临时目录（SHA-256一致），用 `/tmp/octo-244-node-b3bLE7/node --test test/*.test.js packages/octo-runtime-protocol/test/*.test.js` 完整重跑：**2381项、2290通过、91按既有条件跳过、0失败**。没有名称筛选、跳过开关或默认测试范围调整；仅使 `dirname(process.execPath)` 不再含本机全局octo-cli。专项五文件另跑68/68通过；Go/Python协议各434 fixture通过，证据 `/tmp/octo-244-native-protocol-evidence.json`。

`tsc --noEmit`、lint、lint:names、format:check、native:check、docs:check（4/4执行示例）及diff检查通过。日志 `/tmp/octo-244-ci-fix-{full-tests,isolated-full-tests,manual-tests,native,format,names}.log`。`.github`、scripts、package.json和锁文件相对main无变化，不扩大CI。不改已验收产品行为，也不重装或重启在线服务；此前用户真实群聊验收继续有效。托管CI以推送后的新运行结果为准。

# 真实群聊验收与 PR 授权

16:09 用户明确反馈“真实群聊效果我已经真实验收了”，本任务实际群聊验收记为通过，验收人为用户吕思佳。当前已安装构建为 `0.0.0 / 96a6f58cf1ec (dirty)`、构建时间 `2026-10-29T07:56:57.902Z`，macOS；后续文档更新未重装或改变该运行产物。该结论来自用户实际验收反馈，区别于 Agent 先前仅只读接口及离线 fixture 的证据；用户未补充逐场景记录或原生版本，不推断全部 Provider、所有压缩场景或长期记忆已逐项验收。下文历史记录中的“待人工验收”由本段更新。

用户同时授权完成后提交 PR；提交保留原 Git 作者并附 Codex trailer，PR 使用英文、关联 Issue #234，P2 #243 继续独立待办。不授权合并、发行或扩大 CI。提交前重新运行 lint、lint:names、format:check、native:check 均通过；文档检查与原专项结果见下文。

# 架构合同与文档同步

16:06 按用户要求回写 Octospec 架构、Context、reset 和无状态合同，以及中英文架构、会话指南和 Extra 说明。统一最近20条/完整messages JSON数组8000 Unicode码点，明确身份、时间、结构和转义计入，主历史与恢复补充共用窗口/预算；补齐首轮保留自身、正常接续凭完成/归属/成功投递/内容指纹有限省略、同次fallback恢复与冻结重试。reset旧文案“正常续聊不自动重新拉取”和“fallback只影响下一条”已修正；架构中的旧产物工作区默认限制和preset判远程条款也同步到当前实际文件读取策略。稳定规则默认30轮与动态事实分离由Gateway负责，通用执行层不新增业务策略。

本轮只改文档，`pnpm docs:check` 通过（18组双语页、37份Markdown、22个JSON示例、16个Mermaid图、12个内置Context示例及4/4可执行检查），`git diff --check` 通过。Octospec lint仍仅Issue #137三份既有frontmatter错误；相对origin/main的`.github`、`scripts`、`package.json`及`pnpm-lock.yaml`无差异。未重编译、安装或重启，当前运行构建仍为下文15:59交付版本，人工群聊验收状态不变。

# 保守接续历史：最新交付

15:59 用户进一步要求总 JSON 预算提高至 8000、消息上限由 15 提高至 20。本次最终口径为同频道/子区最近最多 20 条、完整 messages 数组最多 8000 Unicode 码点；不新增配置或压缩消息结构。查询规划、返回后截取及格式化统一复用 `IM_HISTORY_MESSAGE_LIMIT=20`。既有三项跨度断言改为 19/20/21 的边界，API 夹具返回 25 条验证最近 20 条；Unicode 超长尾部和媒体省略夹具同步跨过 8000 边界，主历史与恢复历史仍共用同一总预算。当前接入文档及规则同步，历史日志保留当时额度。

相关回归仍为 501/501 全通过，无新增默认测试项、CI 或脚本修改。build、两修改模块 ESLint、Prettier、docs:check 和 diff 检查通过。正式打包、全局安装完成，版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T07:56:57.902Z`（北京时间 15:56:57），tgz SHA-256 `9488f0eb1ef5c9074a16c0c9ddff7d1fdf1c83df8b613d2b3c73565a8fb1703f`。全局两个修改模块逐字节匹配编译产物；安装包实测上限 20、25 条输入保留最近 20 条、6000 字符正文完整保留、超长 JSON 精确截断至 8000 码点。

确认各 Bot 工作和队列为空后重启 Gateway，PID `29081 → 36647`，6/6 Bot online、kernel_available=true、working/queued=0、errors=[]，新构建已加载。没有改用户配置、reset、提交或推送，既有服务定义 drift 保持。日志 `/tmp/octo-234-history-8000-{build,tests,docs,pack,install}.log`；真实群聊验收仍待用户进行。

15:50 用户明确先将 history 总字符限额从 1500 提高到 3000，保持完整 messages JSON 数组口径、最多 15 条和原消息结构；没有实施参与者表、字段缩写、独立正文额度或新增配置。仅修改 Gateway 历史格式化器的容量判断、正文尾部候选长度及对应旧断言，Unicode 截断夹具扩充到 4000 字符以继续验证边界。当前规则、任务设计和中英文接入文档同步为 3000；下文此前 1500 的验证是历史记录。

本次相关回归 501/501 通过，build、修改模块 ESLint、Prettier、docs:check 和 diff 检查通过；CI 范围、脚本及默认测试选择未变。正式打包、`npm install -g` 成功，版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T07:47:40.896Z`（北京时间 15:47:40）。tgz SHA-256 `0ca465a5fb1fb5a42949bd2ad394824598a82a067f6978b60533fa32430c1c43`。全局 history-messages 模块与编译产物逐字节匹配，安装包实测 2000 字符正文完整保留、超长输入完整 JSON 精确截断至 3000 码点。

确认全部 Bot workingTasks/queuedTasks 为 0 后重启 Gateway，PID `19826 → 27606`；6/6 Bot online、kernel_available=true、working/queued=0、errors=[]。未改用户配置、reset、提交或推送；既有服务定义 drift 保持。日志为 `/tmp/octo-234-history-3000-{build,tests,docs,pack,install}.log`，真实群聊验收待用户执行。

15:35 用户要求重启，已确认六个 Bot 的 workingTasks/queuedTasks 均为 0 后执行 `octo-runtime channel-gateway restart --json`。Gateway PID `78649 → 16097`，6/6 Bot online，kernel_available=true，working/queued=0，errors=[]。进程命令核实使用 Node v24.19.0 全局入口，对应构建 `2026-10-29T07:27:42.116Z`，本次 Gateway 修改已加载。未 reset、未修改配置或重装服务定义；既有 definition_content drift 保持。下文 15:32 的未重启状态已由本次操作更新，人工群聊验收仍待用户执行。

15:32 按用户授权完成实现、code-review、完整构建、release pack 和 `npm install -g`。产品修改仅在 Gateway 内，最多 32 条正常 completed final 投递凭据按 Provider 保存；接续读取后核对具体位置和 payload 指纹，首轮/reset/补位/未知/编辑/控制/失败提示保留。同次窗口按原预算拆为互不重叠的主历史与恢复材料，fresh fallback 本轮即可拿回被排除消息。旧 ACK 不再直接跳过查询，窗口不扩大，不补读分页。

双轴 [审查记录](conservative-history-review.md)：Standards 与 Spec 均无未解决问题；一个职责注释建议已修正。实施前准备度单独为 96/100。新增专项为 `test/manual/channel-conservative-history.mjs`，未扩大默认 CI glob。

| 验证 | 本次结果 |
| --- | --- |
| `pnpm build` | 通过，含原有 WebUI bundler 指令警告 |
| 类型、ESLint、docs:check | 全部通过，文档执行检查 4/4 |
| `node --test test/im-*.test.js test/model-context.test.js test/manual/channel-context-lifecycle.mjs test/manual/channel-message-trigger.mjs test/manual/channel-history-identity.mjs test/manual/channel-artifact-local.mjs test/manual/channel-conservative-history.mjs` | 501/501 通过，无跳过；新保守历史专项 25 项 |
| Codex 真实 Adapter fixture 两种 fallback | resume 失败、resume 后首次 turn/start 失败均在当次新会话输入补回，正文/query 各出现一次 |
| 冻结恢复重试和 ACK 边界 | 无新 API 读取，主 Context/恢复输入保持；提前或 reset 后迟到 ACK 无资格 |
| `git diff --check` | 通过；相对 origin/main 的 `.github`、`scripts`、根 package.json/lockfile 无差异 |
| Octospec lint | 仅 Issue #137 三份既有 frontmatter 错误，无新增文档/链接错误 |

本次全局版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T07:27:42.116Z`（北京时间 15:27:42）。安装入口 `/Users/lvsijia/.nvm/versions/node/v24.19.0/bin/octo-runtime`。产物 `dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 的 SHA-256 为 `1d2b8b8967c363b98c66eac10e0a6d1ce8d073f8f09f04904799ac8701902c0f`。八份相关全局编译模块逐字节/哈希均匹配 worktree，直接导入全局包的指纹冒烟通过。

本轮没有重启服务、reset、修改用户配置、提交或推送；常驻 Gateway 须重启才能加载该构建，不能将安装等同于运行态已更新。真实模型/IM 群聊尚待人工验收：创建 MD → 未 mention 发送“讲一个冷笑话” → 再 mention，正常接续 history 只补新消息；reset/new 或补位时仍保留自身历史。共同 Gateway 路径适用于 OpenClaw、Codex 和 Claude Code，真实长期 Provider 记忆不由本地 fixture 保证。日志为 `/tmp/octo-234-conservative-{build,types,lint,docs,regressions,pack,install,octospec}.log`。

# 早先触发事实、身份缓存与结构化历史交付

14:48 按用户要求重启已安装服务。重启前 Gateway 六个 Bot 的 workingTasks/queuedTasks 均为 0；先执行 `octo-runtime executor-kernel restart --json`，再执行 `octo-runtime channel-gateway restart --json`，两项均成功。最终 Kernel/worker/Gateway PID 为 `78466/78468/78649`，execution_ready=true、kernel_available=true，6/6 Bot online，working/queued=0、errors=[]。进程命令核实使用 Node v24.19.0 的全局安装目录，对应本次已安装构建 `2026-10-29T06:45:36.583Z`。未安装的 WeCom/WebUI 未启动；未改配置或 reset 会话。既有 service definition_content drift 保持，未重装服务定义。日志为 `/tmp/octo-234-p2-{kernel,gateway}-restart.log`。

14:46 用户要求再次编译及全局安装：`pnpm build`、`node scripts/pack-release.mjs`、`npm install -g` 均成功。当前全局版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T06:45:36.583Z`（北京时间 14:45:36），tgz SHA-256 `d39cb91ee8b20b9f46c3a9f46ea86f8b31fadd2882a86ee46a891d060de48b03`。全局入口位于 Node v24.19.0 环境，build-info 及 OpenClaw/Core/Gateway 六份关键编译模块共七份文件哈希均匹配，直接导入全局 OpenClaw Adapter 成功。本轮自上次验证仅新增文档与 TODO 注释，未重复行为测试；未重启服务、修改用户配置、提交、推送或扩大 CI。远端产物仍为 P2 待办，未实现。构建/打包/安装日志为 `/tmp/octo-234-p2-{build,pack,install}.log`。

14:43 远端 OpenClaw 按用户最新决定列为 [P2 / Issue #243](https://github.com/Mininglamp-OSS/octo-runtime/issues/243)，仅增加架构说明、[待办](remote-artifact-backlog.md)及 Adapter 连接解析/final 出口两个 TODO，未实现远端转换。Prettier、单文件 ESLint、git diff --check 通过；相对基线的 `.github`、`scripts`、`package.json`、`pnpm-lock.yaml` 无差异。Octospec lint 仅报告 Issue #137 三份既有文档缺 frontmatter，无新增文档或链接错误。#243 标签核实为 P2，#234 仍为 P0。本轮未 build/install、重启、提交或推送，当前全局安装版本仍以下一段本地修复记录为准。

14:20 本地 OpenClaw MD 交付失败已修复。原实现以 agentSource=preset 预先判为 remote-file-unavailable，尚未读取实际路径。用户明确要求成功 final 的本地 Markdown 引用均按 Gateway 文件系统实际尝试，无需增加配置；已删除 locality 标记与 localWorkspaceAccessible 模型字段，默认不限制到工作区，原显式 allowed_roots 仍作为限制。未增加配置项、未修改用户配置、未改变 OpenClaw 工作区或下载远程产物。

相关回归 476/476 通过，含 manual 默认 OpenClaw/Codex/Claude Code 跨工作区绝对路径、图片/文件卡区分、缺失文件、显式空目录/越界/symlink、伪造 Context 和冻结策略；原生卡及上传重试既有回归通过。build、类型、lint、docs:check、diff 检查通过，无 workflow、脚本或默认测试范围变化。使用用户当前配置和实际 MD 文件验证本机读取 2091 字节并准备一张文件卡，上传为 stub，真实上传和发送均为零；真实 IM 验收待用户执行。

正式打包与全局安装成功，当前版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T06:14:55.152Z`（北京时间 14:14:55），tgz SHA-256 `9c565e48befbd70b1f7460a1b87515a40b2e7d03bb8972a3784422eb5b7679c6`。空闲重启 Gateway 为 PID `53073`，kernel_available=true、6/6 Bot online、working/queued=0；三个相关模块安装哈希与 worktree 一致，直接导入全局包确认无推断 locality gate。安装前新快照的五份配置哈希全部不变。根因、最终决策及 agentSource 讨论已同步至 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6489515140)。未提交、推送或 reset。

agentSource 另作当前架构核对：剩余行为是 Core/Gateway/WeCom 的默认目录与空目录校验、preset 目标 ID 校验、Core 的 Adapter agentSources 准入和协议传输。OpenClaw metadata 已有 workspace=false 且接受两种来源，存在重复建模，不能因仍有引用证明保留价值。本次仅解除附件依赖，未删除公共协议/Core/native 的该字段。以下为早先交付记录。

13:59 用户确认删除模型侧独立自动 history-gap，已实施：提交模型前将不完整、读取失败或省略事实合并为 `extra.im/history.payload.note` 的一句英文。正常完整历史无 note，成功空结果不额外增加说明；无正文但有异常说明时 messages 为 []。显式宿主项不改写，冻结重试投影幂等；内部缺口/游标保留，note 本身不构成已交接消息证据。相同 Gateway 路径覆盖 Codex、Claude Code 和 OpenClaw。Octospec、规则、示例及中英文文档已同步。

相关回归 471/471、build、类型、lint、docs:check、git diff --check 通过。最初一项预算夹具因合并减少 Context 数量而不再触发降级，改为按实际字节预算施压后通过，并明确断言 note-only 请求不返回正文交接证据。专项仅手动执行，没有改变 workflow、脚本、默认测试选择或 CI 依赖。本轮为输入投影修改，不重复未改变的真实 API 验证；真实模型群聊仍待人工验收。

最新全局版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T05:55:03.542Z`（北京时间 13:55:03），tgz SHA-256 `a59217ec3df30db9823a6d6f6b04a1103dc23d5e76fbf2fae6add332afc7082a`。正式打包和 npm install -g 成功，安装后的 history-context、dispatcher 编译模块与 worktree 哈希一致，直接导入全局安装包验证失败说明合并至 history。空闲重启后 Gateway PID `36252`、kernel_available=true、6/6 Bot online、working/queued=0，五份配置哈希保持不变。决策已追加至 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6489208712)。未提交、推送或 reset。以下均为早先记录，其中 13:50 的待决建议已由本次用户确认取代。

13:50 消息时间交付：自动历史 messages、嵌套引用/转发和 message-trigger 的 sentAt 均使用原始发送时刻，按运行进程的系统时区输出带明确偏移的 ISO 时间，例如 `2026-10-29T13:36:53.000+08:00`。不以当前处理时间替代缺失时间，不猜测时间单位；缺失或非法时间为 null，截断消息保留时间。上海、UTC、尼泊尔和纽约冬夏令时检查通过；相关回归 470/470 通过，build、类型、lint、docs:check 和 diff 检查通过。真实测试接口只读核对原始时间与身份，未发送消息或启动真实模型。

已重新打包、全局安装并在空闲时重启 Gateway，当前版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T05:46:37.286Z`（北京时间 13:46:37），tgz SHA-256 `4e4305983d692fde55b6f0ea9e6f18e7277553244a644a3345153214f1762f6d`。Gateway PID `28477`，Kernel/worker 保持 `72774/72826`，execution_ready=true、kernel_available=true、6/6 Bot online、working/queued=0。六份相关全局编译模块与 worktree 哈希一致，安装前新快照中的五份配置哈希均未改变。需求与验证已同步至 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6489088230)。未提交、推送或扩大 CI；真实模型群聊验收仍待用户执行。

用户另询问 history-gap 是否必要。当前建议是保留 Gateway 内部缺口与游标交接状态，模型侧不强制保留独立 Context，确有遗漏或读取失败时再提供简短事实说明；该建议尚未实施，不计为已接受的删除决策。以下均为早先交付记录。

13:36 按用户要求重新执行完整 pnpm build、release pack、npm install -g，均成功；无产品源码修改，不重复执行已通过且未受影响的测试。当前全局版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T05:34:35.848Z`（北京时间 13:34:35），tgz SHA-256 `717bf4f0493a95a13b43d6584ea2d419f44ddca517d0cc8e82f485590c1b7f82`。确认空闲后 Gateway 重启为 PID `17319`，6/6 online、working/queued=0，Kernel execution_ready=true、kernel_available=true。stable-context、artifact-policy、message-trigger 三个全局编译模块哈希均与本次 worktree 构建一致；安装前重新记录的五份配置哈希全部保持一致。未 reset、未提交或推送。以下为早先构建记录。

13:33 最新历史目标指引交付：history-instructions 从六句收敛为一句英文，只约定结合相关前文理解当前意图、遵循最新相关修正、不因旧任务出现在历史中就重新执行。不指定加载、工具调用、何时澄清或具体推理步骤。history-gap 仍只提供 status/earlierMessagesOmitted 两个事实字段，内部读取与水位交接保持。首轮回归 84/86，两个 near-budget 冻结重试夹具因提示词缩短而不再逼近上限；调整固定填充量后 86/86 通过，包含真实输入载体、预算、重试和历史交接检查。build、修改模块 lint、Prettier、git diff --check 通过，不将本地 fixture 冒充真实模型验收。

已全局安装，直接导入安装包核对精确历史指引。当前版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T05:30:03.594Z`（北京时间 13:30:03），tgz SHA-256 `e45edc1e9871cf7b381aba3642a626aff0904471817a122836b63faa6eaf1f76`。空闲重启 Gateway 为 PID `14415`，Kernel/worker 保持 `72774/72826`、execution_ready=true、kernel_available=true、6/6 Bot online、working/queued=0，五份配置哈希不变。目标式决策已写入 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6488832644)。未提交、推送或改变 CI 范围；以下安装记录均为历史，人工群聊验收仍待用户执行。

12:52 最新产物文案交付：默认 channel 模式的 artifact-delivery guidance 只保留“如果最终交付物是本地文件”，使用绝对路径 Markdown 链接、图片使用 ! 的格式约定；不包含上传/发送工具指令，不干扰用户明确指定 octo-cli 的操作。原后处理与显式 tools 配置保持。相关产物、mention 和周期专项 48/48 通过，build、lint、Prettier、git diff --check 通过；已全局安装，直接导入安装包确认精确指引。

当前版本 `0.0.0 / 96a6f58cf1ec (dirty)`，最新构建 `2026-10-29T04:45:26.831Z`（北京时间 12:45:26），tgz SHA-256 `25d3b5351f98cbcc88866f872a5c794ee343382175edcdec8dd6e27d5a995516`。本轮只改 Gateway 指引，在任务/队列为空时重启 Gateway，PID `80709`；Kernel/worker 维持 `72774/72826`，execution_ready=true、kernel_available=true、6/6 online、working/queued=0，五份配置哈希不变。需求同步至 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6488193963)，未提交、推送或扩大 CI。下文各次安装为历史记录，真实模型人工验收仍待用户执行。

最新频道命名修正：`message-trigger.conversation.id` 为原始频道 ID，type 仅为 `dm`、`group`、`group_topic`。子区保留完整频道 ID，group/topic 各自 ID、名称仍单独保留；guidance 简短说明 channel ID/type。三种类型精确结构断言与真实测试子区接口验证通过，相关 468/468 回归通过；build、类型、lint、docs:check、git diff --check 通过。

本次最终全局版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建 `2026-10-29T04:36:41.637Z`（北京时间 12:36:41），tgz SHA-256 `9e2b6a4df94f3dd56001ebf0d80938a2c5c4272c6895aff46bca6bbfb0ada008`，安装后 message-trigger 编译模块哈希与 worktree 相同。空闲重启全部已安装 Runtime 服务后 Kernel/worker/Gateway PID 为 `72774/72826/72889`，execution_ready=true、worker ready、6/6 Bot online、working/queued=0，五份配置哈希不变。最新决策见 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6488081967)。未改 CI、未提交或推送。以下 12:28、11:46 与 10:40 安装记录均为历史记录，真实模型群聊验收仍待用户执行。

- `message-trigger` 以一行英文 guidance 说明当前会话、群/子区名称与 ID、真实发送者 UID/姓名/人或 Bot、接收 Bot、原始发送时间及实际 @ 目标。发送者始终独立于 mention 目标；时间未知为 null，绝不替换为处理时间。
- 可选 API 补全失败保留真实 ID，名称为 null、类型为 unknown，HTTP/网络/无效 JSON 失败后仍进入 AgentRun；不重试、不切换查询接口，用户取消继续传播。
- UID/Bot ID 的可信名称与类型使用每个 Transport 的内存缓存，按 API/Bot/Space 隔离，固定十分钟过期，读取不续期，最多 2,000 项；失败/缺失不缓存，不影响准入或出站 mention 的成员核验。
- 自动历史按旧到新发送 `messages: [{uid, username, content}]`，所有正文统一为带 type 的 content，文本为 `{type:"text",text:"..."}`；连续发言不合并，姓名不从消息自报字段推断。
- 回复保留引用与回复，转发保留嵌套消息，富文本保留图文块顺序，媒体只携带已有地址并标记 read=false。嵌套最多四层、128 节点；完整 JSON 数组不超过 15 条和 1,500 个 Unicode 码点，截短/省略显式标注，身份不截短。
- 模型中的 `history-gap` 仅保留 status、earlierMessagesOmitted。游标、范围和交接证据保留在 Gateway；预算移除、空历史、API 失败及冻结重试不错误清除待补缺口。完整模型示例见 [history-context.example.json](history-context.example.json)。

最终 `pnpm build`、类型检查、lint、lint:names、docs:check、native:check、git diff --check 均通过。本轮 `node --test test/im-*.test.js test/model-context.test.js test/manual/channel-context-lifecycle.mjs test/manual/channel-message-trigger.mjs test/manual/channel-history-identity.mjs` 共 468/468 通过，无跳过。覆盖缓存 TTL/隔离/容量/失败、结构化历史/嵌套/截断、消息身份和名字可信性、时间单位、可选 API 失败后继续 AgentRun、历史缺口与实际交接。真实测试 API 的 Bot、用户、群名、子区名及历史只读验证通过，发送消息和真实模型调用均为 0。全仓既有测试与 Octospec lint 的限制见下文，未宣称全部全绿。

重新打包并 `npm install -g` 成功，版本 `0.0.0 / 96a6f58cf1ec (dirty)`，构建时间 `2026-10-29T04:25:48.893Z`（北京时间 12:25:48）。tgz SHA-256 为 `32bbe000e7b4291d9c0de7c7943efbab4ee604f9e63df81e98849c5f6aa31124`；本轮六个关键模块的全局安装文件与 worktree 编译文件哈希一致。

确认任务与队列为空后，全部已安装 Runtime 服务再次重启：Kernel `27356 → 63889`、worker `63890`、Gateway `27481 → 64169`。最终 execution_ready=true、worker ready、kernel_available=true、6/6 Bot online、working/queued=0；五份配置哈希不变。WebUI/WeCom 未安装，未新增服务。未提交、推送、PR 或合并，未改变 CI 范围。请在现有群聊验收真实触发信息和文本/图片/引用/转发历史；真实模型端到端验收仍待用户完成。

# 首轮样例反馈后的最终修正

以下为 11:46 的历史状态；最新构建和安装以上节为准。

- 群聊只携带群规则，子区携带父群和子区两份规则；群来源明确标为 `Octo IM Group's GROUP.md`，话题为 `Octo IM Group Topic Rules`。
- Gateway 版本/来源/automatic 等内部字段不再进入自动规则的执行快照。规则采用显式 `data_format: "text"`，CDATA 直接放入原始 Markdown；未选择文本格式的业务项仍完整 JSON。
- 空字符串、纯空白、404 缺失文档均保留规则项，正文为 `NO RULES`，指引明确撤销此前规则；非空正文不 trim。恢复输入同样处理，避免清空规则后继续沿用旧值。
- Core 在 Context 结束与调用输入之间加入前后各空一行的 `<!-- Query Input -->`，保留原文及图片顺序，适用于普通、多模态及显式恢复输入。该标记不赋予权限。
- Schema、TS 校验、生成的 TS/Go/Python 类型与校验器同步；Core 仅识别通用格式，不识别 IM 群规则业务名。

用户再次要求重新编译、全局安装及全部重启后，完整重跑 build/pack/install。最终构建 `2026-10-29T03:44:46.621Z`（北京时间 11:44:46），版本 `0.0.0 / 96a6f58cf1ec (dirty)`。`pnpm build`、类型检查、lint、lint:names、docs:check、native:check 均通过。最终分隔逻辑的相关 Node 回归 499/499 通过；此前文本格式联合回归 469/469，包括专项 Go/Python 各 6 个显式文本格式有效/非法/回传断言。两种语言各 434 个权威协议 fixture 通过。首次 Python 检查因 worktree 尚未创建 venv 失败，按仓库说明执行 frozen uv sync 后重跑通过，未改 lockfile。新增专项仅在 `test/manual`，没有扩大默认 CI。

最终 tgz SHA-256 `d78fc790a6661be974e391e0f0f3e1bfab358a2fc4fe4802903aa1168a8cfc9a`，已通过 `npm install -g` 安装；`octo-runtime --version` 确认上述构建。直接导入全局安装的 Gateway/协议/Core 联合冒烟验证通过，包含空白规则到 `NO RULES`、英文来源及 Query 分隔。安装后的三个关键编译模块与 worktree SHA-256 完全一致。

全部已安装 Runtime 服务已再次重启：Kernel PID `24501 → 27356`，worker PID `27357`，Gateway PID `25192 → 27481`。Kernel execution_ready=true、worker ready、Gateway kernel_available=true、6/6 Bot online、working/queued 均为 0。launchctl 中仅安装这两个 Runtime 服务，WebUI/WeCom 未安装。5 份原配置文件 SHA-256 全部保持一致；服务定义既有 drift 未改动。人工群聊及真实模型验收仍待用户执行。最新决策已英文追加至 [Issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/234#issuecomment-6487307028)。

# 交付状态

独立 worktree `octo-runtime-issue-234`，分支 `fix/234-context-lifecycle`，基线 `96a6f58cf1ec8cfb0f33e88b522bea6b6a95e822`。实施前准备度 97/100，见 [assessment.md](assessment.md)。实现和全局安装已完成；未提交、推送、创建 PR 或合并，原主工作区的 `.workbuddy/` 未改动。

| Context | 本次实现的发送或加载时机 |
| --- | --- |
| `extra.im/mention-instructions` | 稳定说明，第 1、N、2N…轮及新/不可续接 Provider 会话；无 actor 数据 |
| `extra.im/artifact-delivery` | 同上；有效策略每轮计算，省略说明不关闭交付，同代次卡片重试冻结原策略 |
| `extra.im/history-instructions` | 同上；承接原历史 guidance 中的固定阅读规则 |
| `extra.im/message-trigger` | 每条实际入站消息；真实 actor、消息/频道和 mention，guidance 一句话 |
| `extra.im/group-rules`、`topic-rules` | 每个新任务查询权威版本，首次、reset/new、版本/状态改变、失效或周期刷新时注入；无游标能力的 store 每轮携带 |
| `extra.im/history` | 首轮有界近期历史，或群/话题存在历史缺口时按原策略读取；非每轮全量历史 |
| `extra.im/history-gap` | 仅为 Gateway 内部自动材料，模型侧不再发送；异常事实合并至 `history.note`，正常历史无说明 |
| `reply`、`resources`、`message-content` | 本条消息实际存在相应材料时装配 |
| 宿主显式静态/动态 Context | 保持原每任务合同，不由 Gateway 按内容去重或自动改为首轮 |
| `octo.control/instructions` | 刷新轮保序追加渠道默认规则，普通轮保留宿主有效项；周期效果由普通模型 Context 保证 |

Bot 配置 `stable_context_refresh_interval_turns` 默认 30，正安全整数；reset/new 重计。只有交给执行的用户任务计轮；准备/展示前失败、控制命令、工具步骤、自动重试及同代次卡片重试不计新轮。可信未提交回退，结果未知保守保留；失败刷新下次补带。普通轮省略的稳定/群规则通过既有 fresh fallback 输入恢复，保留图片。真实准入拒绝空发送者，actor 与被 mention 的 UID 分别表达。

# 本地结果

Node v24.19.0，pnpm workspace 冻结安装成功，无 lockfile 改动。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm build` | 通过；最后产品构建时间 `2026-10-29T02:34:33.232Z`，既有 Vite/use-client 警告未修改 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 构建完成后通过 |
| `pnpm lint`、`pnpm lint:names` | 通过 |
| `pnpm docs:check` | 构建完成后通过，4 项文档执行检查；首次与 clean/build 重叠导致缺 dist，依赖就绪后重跑通过 |
| 相关 `test/im-*.test.js` 和 `model-context` | 433/433 通过 |
| 专项 `node --test test/manual/channel-context-lifecycle.mjs` | 最终 13/13 通过，无跳过 |
| 最后产品构建后的专项、group-rules、pre-execution-failure 联合回归 | 当时 53/53 通过；后续只补充专项断言，无产品改动 |
| 全仓 Node 默认集合 | 2381 项，2289 通过、91 条件跳过、1 失败；不是全绿，见下文 |
| 新增/修改代码及专项 Prettier、`git diff --check` | 通过 |
| `uv run --with pyyaml python .octospec/scripts/lint.py` | 未全绿：Issue #137 的 3 份既有文档缺少完整 frontmatter；本次未修改这 3 份文件 |

全仓唯一失败为 `test/verification-command.test.js:162` 的缺失安装断言。夹具 PATH 包含 `dirname(process.execPath)`，本机该目录实际安装 `octo-cli`，所以期待的 ENOENT 不成立。在未修改的原主工作区独立运行该测试得到完全相同失败，未扩大本任务去修改脚本或环境。

Octospec lint 报错文件为 `.octospec/tasks/137-adapter-protocol-support/brief.md`、同目录 `review.md`、`.octospec/journal/shared/2026-10-29-137-adapter-protocol-support.md`，均为基线已有且本次无 diff 的文档。本任务不修复其他 issue 的历史文档。

专项验证默认 1/30/60、自定义间隔、独立会话、idle binding 重建、排队/reset 代次、失败补带、准备/展示失败、真实 Kernel 未提交拒绝、自动重试、无 position 的冻结卡片重试、配置变化后的冻结产物策略、终态后源流失败及不可续接 handle。Codex 使用 app-server fixture 检查 `thread/resume` 与 `turn/start.params.input`，Claude Code 检查真实 command builder 的 stdin NDJSON，OpenClaw 检查真实 Gateway invocation builder 的 `agentParams.message`；均断言续聊普通输入含周期规则和真实换行。这些是本地协议载体验证，不是三家真实模型端到端验收。

# 真实测试接口

显式运行 `node test/manual/channel-context-live.mjs <account.md> <user-key.json>`，使用用户指定的测试账号文件与 `octo-uk.json`，只连接 `https://im-test.deepminer.com.cn`。通过真实 Bot 身份查询、群发现、群规则和历史 API、用户 Key 搜索，并将真实接口材料送入本地 Context 装配，确认首轮稳定项、普通轮省略和当前 actor 保留。未发送消息、未启动真实模型任务，不保存凭据或消息正文。

# 安装与生效

正式 `node scripts/pack-release.mjs` 成功，产物 `dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`，SHA-256 为 `8ecf7abe390a580dc3b8f817d1f6c875608433f1bd584210fedd3660b0d06603`。使用该 tgz 执行 `npm install -g` 成功。当前 Node 24 全局命令的 build timestamp 与上述构建一致，安装后的 `stable-context.js` 与 worktree 编译产物 SHA-256 一致：`db5a3dda48efb345067ad37be4b5b2f36ba9c95472f519563ff0a26aa88d1bf9`。

确认 6 个 Bot 的 workingTasks/queuedTasks 均为 0 后执行 `octo-runtime channel-gateway restart --json`，PID 由 13188 更新为 72716。最终 6/6 Bot connected、kernel_available=true、workingTasks=0。5 份原配置 JSON 的 SHA-256 前后完全一致，无配置覆盖、reset 或重命名。服务原有 `definition_content` drift 在重启前后均存在，本任务未重装服务定义；当前执行入口已核验为 Node 24 的全局 `octo-runtime`。

# 范围与人工验收

相对 origin/main 的 `.github`、`scripts`、`package.json`、`pnpm-lock.yaml` 均无差异。新增专项仅放 `test/manual/*.mjs`，不加入默认测试 glob、workflow、job、矩阵、触发器、必需状态或 Gate。

现在可在现有本地 OpenClaw、Codex、Claude Code Bot 验收：首条任务有稳定三项，下一条只有当前 actor/mention 和实际需要的材料；reset/new 后再次出现稳定规则；默认第 30/60 轮重带。人工验收尚未完成。真实模型压缩后的保留和原生 IM 展示须实际观察；周期刷新接受轮间可能遗忘，不监听压缩。HTML 等仍按原 IM 文件交付合同，不因减少提示而改变权限或发布行为。
