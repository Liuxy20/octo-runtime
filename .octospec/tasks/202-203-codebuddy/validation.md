---
type: Task
title: CodeBuddy 202/203 实施与验证
description: 记录回归证据、Kernel 公共入口验证及未执行范围。
tags: [adapter, protocol, testing]
---

# 首轮实施与验证（历史）

下列首轮 9bcfc35 记录中的白名单、脱敏及配额分类已被用户最新要求替代；当前合同与本轮证据见末尾追加章节。

2026-10-28，基线 `aac7ec7765ec055eff02328babefcf5d719c0c6a`，macOS arm64 / Node 24.19.0 / 项目 pnpm 11.19.0。
完整方案已先追加到 [#202](https://github.com/Mininglamp-OSS/octo-runtime/issues/202#issuecomment-6449817635) 与 [#203](https://github.com/Mininglamp-OSS/octo-runtime/issues/203#issuecomment-6449818563)。

生产改动仅涉及 CodeBuddy adapter：

- 新建和续聊回执均只包含原生响应确认的模型；未知时省略。usage 同样不再输出 model: undefined。
- 解析 Provider 私有失败元数据，缺失/损坏正文仍失败；保留脱敏中文消息和白名单内的 RPC/HTTP/Provider code、category，配额证据优先于普通 429 限流。
- 失败优先于部分输出和空输出守卫；空/空白/思考/仅工具不能成功。支持的结果正文仅补无流式 final 的成功；取消继续返回 cancelled。
- 失败/取消关闭未终结工具和步骤，client 的原有关闭归属不变；Core/Kernel 及公共协议未修改。

## 验证证据

修复前在独立 worktree 构建基线后执行新增用例，确认默认模型 Kernel 源帧包含 HOST_FRAME_INVALID、Host failed；直接 adapter 的订阅拒绝仍产生 run.completed。测试准备阶段纠正了内部 InvokeRequest 必须带 agentConfig、公共 submit 返回 ref 等 fixture 使用方式，未为这些测试准备问题修改生产层。

修复后新增测试 **37/37 通过**：

- 默认/空/显式 agentConfig，确认/未知模型的新建与恢复，不把未应用请求值或旧 binding 写入回执；对原始 payload 直接调用 assertJsonValue，不经序列化移除 undefined。
- Core 正常/订阅/部分输出后失败/空/空白/仅思考/仅工具/取消；检查唯一 canonical terminal、Host terminal 和传输关闭。
- 捕获的订阅错误保留完整中文续费说明、HTTP 429、Provider code 14015、quota，公共分类为 OH-PRV-4004 且 retryable=false；普通 429 为 OH-PRV-4005。
- 缺失、损坏、null、数组、数字及对象错误正文安全失败；运行期生成的非功能性敏感值被脱敏，未知 metadata/header/request/details 不进入公开证据。
- 三种结果正文载体、不重复已有流式文本、失败时不补结果正文、失败与取消优先级及 usage JSON 安全。
- 真实 createKernelService 在当前进程构造、内部独立 worker 注册 adapter，attachKernel 经实际本地 IPC 执行 submit/subscribe/get 和 invoke。正常默认模型、订阅拒绝、部分输出拒绝、空/思考输出和取消均核对 canonical 与 Host 终态；订阅错误经 IPC 后仍保留中文消息、14015 与非重试配额分类。

| 检查 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 通过，无依赖及 lockfile 改动 |
| pnpm build / pnpm typecheck | 通过 |
| CodeBuddy 最终单独 tsc 构建 | 通过 |
| 新增专项 test/codebuddy-outcomes.test.js | 37 通过，0 跳过 |
| 专项 + adapters/acp-message-segments/adapter-tool-lifecycle | 102 通过，1 跳过 |
| pnpm test:suites / Node | 2070 通过，56 跳过，0 失败 |
| pnpm test:suites / WebUI | 35 通过 |
| pnpm lint | 通过；首次与清理式构建并发导致缺失 dist 的误报，待构建完成后重跑；真实新增 unknown 收窄错误已修复 |
| pnpm lint:names | 通过，findings=[] |
| pnpm format:check | 通过 |
| pnpm docs:check | 类型、文档约束及 4 项运行测试通过 |
| OKF lint | uv run --with pyyaml python .octospec/scripts/lint.py 通过；系统 Python 缺 PyYAML，使用隔离 uv 环境，不改项目依赖 |
| git diff --check / 协议生成文件及 lockfile drift | 通过 |

## 自查与边界

按方案逐项核对 diff：修改归 CodeBuddy 原生适配，不放宽 Host 校验，不增模型默认/切换、账号探测、续费、重试或会话重置。公开消息使用既有脱敏函数，结构化 evidence 只投影白名单；没有凭据或原始 Provider 元数据入库。37 项新增用例已纳入现有全量入口。

上述 Provider 数据均为离线 fixture，Kernel/worker/IPC 为真实组件。未运行真实 CodeBuddy CLI/账号、外部 Work App/Electron 或真实 IM；没有据此声称已复测用户真实企业订阅。Linux/Windows 原生执行与托管 CI 状态以 PR 为准。没有部署、发布或合并。

## 用户确认的原始 ACP 错误详情与评审修复

基于 PR #216 的 `9bcfc35` 继续修改。用户明确要求不脱敏、不解析 _meta、不筛选字段，公共错误消息后直接拼接原始 _meta 的 stringify；并已确认失败判定仍沿用 ACP 的明确失败信号，不能仅因成功响应带 _meta 就判失败。

- CodeBuddy 删除错误 JSON.parse、providerError 白名单及 quota/rate-limit 推断，统一 `ACP_MODEL_REQUEST_FAILED`。公共目录新增 `OH-PRV-4010`，对应消息 `ACP 模型请求失败。`；实际消息严格为公共消息加换行及 JSON.stringify(update._meta)。
- Core 对此独立码的消息原样保留，避免后续 sanitize 再改写原始内容；其他错误的现有脱敏、分类和返回结构不变。无通用 ACP、Kernel、schema 或协议生成文件改动。
- 修复 yujiawei 指出的 stopReason 数字/对象导致 toLowerCase 抛错；终态 reason 也只使用字符串，异常类型不会污染模型步骤。原始 _meta 不因此裁剪。
- 66 项针对性回归通过，0 失败/跳过。覆盖拒绝/失败识别、成功结果携带 metadata、畸形 stopReason、原始 metadata 的未知字段/类凭据文本/嵌套 JSON 字符串及空白，以及独立 worker/真实 Kernel IPC 的 submit/subscribe/get/invoke。
- 原始内容对比使用运行期随机生成的非功能性测试值；不是读取或提交真实账号凭据。检查 adapter、Core 及实际 worker/IPC 输出与期望序列化字符串一致，未使用脱敏后的替代值作为期望。

| 本轮检查 | 结果 |
| --- | --- |
| pnpm typecheck（包含全 workspace build） | 通过 |
| 专项 codebuddy-outcomes + failure + adapter-failures | 66 通过 |
| pnpm test:suites / Node | 2078 通过、56 跳过、0 失败 |
| pnpm test:suites / WebUI | 35 通过 |
| pnpm lint / lint:names / format:check | 通过，命名 findings=[] |
| pnpm docs:check | 通过，4 项运行检查通过 |
| OKF lint | 442 个单元、20 条规则、3135 个本地链接通过 |
| git diff --check / lockfile 与协议生成漂移 | 通过，无漂移 |

本轮复核未发现遗留阻塞项。真实 Provider 账号、外部 Work App/IM 和原生 Windows 未重测；托管 CI 将针对新提交重新执行。不自动合并、部署或发布。

## 同步 main 并解决冲突

按用户要求将 `origin/main@c51d5cf` 合入 PR #216 分支。仅 `.octospec/index.md` 和 `.octospec/log.md` 同位置新增任务记录冲突，保留 CodeBuddy 与 Issue 160 两边记录；ACP 错误处理逻辑未改动。

合并后 CodeBuddy、公共错误分类、adapter 失败及 main 新增的 stateless-live-probe 专项共 81 项通过，0 失败/跳过；OKF lint 444 个单元、20 条规则、3139 个本地链接通过，`git diff --check` 通过。本次未重复执行此前已通过的全量测试，远端 CI 将针对合并提交重新执行。

## ACP 消息原文例外的范围修正

针对 `7a34104` 的新评审指出 Core 以错误码让整个 detail 绕过脱敏，超出了用户只保留 message 中原始 _meta 的要求。新增回归先在旧实现复现：外层 executionEnvOverrides 原样进入失败 payload。

修复将 message 与外层字段分开：外层无条件使用原有公共脱敏；仅 ACP_MODEL_REQUEST_FAILED 的字符串 message 保持原文。既不解析也不脱敏 message 中的 _meta，不改变 ACP 失败识别。回归同时覆盖 CodeBuddy 与携带相同错误码的自定义 Adapter，检查外层环境变量、authorization、token、嵌套 error/diagnostic 脱敏，普通诊断字段保留，message 与原始序列化结果完全相等。

- pnpm typecheck（含全 workspace 构建）通过。
- CodeBuddy、failure、adapter-failures 专项 67 项通过，0 失败/跳过；包含原有真实 Kernel worker/IPC 原文保真测试。
- pnpm test:suites：Node 2094 通过、56 跳过、0 失败，WebUI 35 通过。
- pnpm lint、lint:names、改动源码与测试的 Prettier 检查通过；OKF lint 与 git diff --check 通过。

未运行真实 Provider 账号或外部 Work App/IM；此次远端 CI 结果以新提交为准。
