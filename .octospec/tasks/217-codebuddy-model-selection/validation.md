---
type: Task
title: CodeBuddy 217 实施与验收
description: 区分离线回归、真实 CodeBuddy 请求模型、Host 终态与 IM 送达证据。
tags: [adapter, channel, testing]
---

# 基线与实现

2026-10-28，基线 `59cb21a14259b6dc828f8791b8117ba1f3689f4c`，macOS arm64 / Node 24.19.0 / pnpm 11.19.0 / CodeBuddy 2.177.1。
按 [brief](brief.md) 的 96/100 准备度实施。生产改动仅在 CodeBuddy adapter：

- 不再依赖 session/new.model；新建和恢复均以本次广告目录校验显式模型，再调用原生 setter 并核对响应确认值。
- config option 优先，支持实际 configId、分组 options 及 models 旧接口。空/缺失目录、未知模型、原生拒绝、缺失/错误确认均不发送 prompt。
- 本次原生已确认目标模型时无需 setter。省略/空模型不设置；不以请求或旧 binding 补造回执，不修改会话身份。
- #216 的订阅失败、原始 _meta 消息、空输出守卫与传输清理保持有效。Core、Kernel、Gateway 生产逻辑及公共协议不变。

# 修复前后与自动化

新增测试首先运行于未修复的基线构建：11 项中 10 项失败、1 项通过。确认新建请求 model-b 实际执行 model-a；未知模型、缺失确认仍 prompt；Gateway 经真实 Kernel/worker 将未知模型报告 completed。
修复构建后专项通过；末轮新增目录缺少 configId、setter 等待期间取消两项后，CodeBuddy 两文件合计 **55/55 通过**。
Gateway 离线回归使用实际 ImRuntime、KernelClient.invoke、本地 IPC、独立 worker、CodeBuddy adapter 和标准错误投影；仅 IM transport 和 ACP 上游为 fixture。
同一宿主 session store 在完整 Gateway 配置重载后保留 binding，测试新建/切模/非法新建/非法恢复/原生 setter 拒绝/订阅拒绝/有效恢复。原生模拟状态及 prompt 审计证明失败选择不执行旧模型；7 次 transport 均关闭。

自动检查使用既有入口，日志位于本机 `/tmp/octo-217-*.log`。首次 lint 指出分组 options 的 unknown 收窄问题，显式收窄为 unknown[] 后通过，不引入 any。

| 检查 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 通过，无依赖或 lockfile 改动 |
| pnpm typecheck（含 workspace build） | 最终源码通过 |
| node --test test/codebuddy-model-selection.test.js test/codebuddy-outcomes.test.js | 55 通过、0 跳过 |
| pnpm test:suites（最终） | Node 2105 通过、56 跳过、0 失败；WebUI 35 通过 |
| pnpm lint / pnpm lint:names | 通过，命名 findings=[] |
| pnpm format:check | 最终源码通过 |
| OctoSpec lint（uv / pyyaml） | 通过，448 个 OKF 单元、20 条规则、3154 个链接 |
| git diff --check | 通过 |

首轮全量为 Node 2103 通过、56 跳过、WebUI 35 通过。增加上述两项边界测试、将测试观察入口改为真实 KernelClient.invoke，并完成类型收窄、注释和知识记录后，已对最终源码重新执行全量测试与静态检查；结果如上。

# 真实 Gateway / CodeBuddy / IM

命令入口为 `scripts/verify-codebuddy-model-im-live.mjs`，使用用户提供的仓库外 QA 账号文件和既有 Channel_QA 测试群，接收 Bot 为 orbtex-codebuddy，发送 Bot 为 orbtex-codex。真实环境仅为 im-test；凭据不写入命令参数、报告或仓库。
先检查两账号 config 与群成员资格；只接受发送 Bot 的真实 mention，关闭卡片与 typing，通过标准 final 文本验收。宿主复用 MemoryImSessionStore，按整个 Gateway 配置重载切换模型。

末轮使用实际 **KernelClient.invoke**，只旁观它原有 subscribe 的 Host 控制帧；不重放、不新增第二条执行或观察流。独立 worker 注册真实 adapter，ACP client 全量透传 CodeBuddy CLI。末轮 **7 个场景全部完成断言，5 次实际主 Agent 请求，7 个 ACP transport 关闭，Kernel cleanup.complete=true**。

| 场景 | 请求模型 | 原生确认及主 Agent 实际请求模型 | Host / canonical | IM 回读 |
| --- | --- | --- | --- | --- |
| 新建非法模型 | 随机不存在 ID | 无 setter/prompt、无主 Agent 请求 | failed / run.failed | 完整错误含原模型 ID |
| 新建有效模型，区别于默认 | hy3 | 默认 DeepSeek → setter hy3 → 实际 hy3 | completed / run.completed | 合成标记送达 |
| 同一 session 切模 | hy4-preview | setter hy4-preview → 实际 hy4-preview | failed / ACP_MODEL_REQUEST_FAILED | 原生拒绝完整送达 |
| 同一 session 非法切模 | 随机不存在 ID | 无 setter/prompt、无主 Agent 请求 | failed / run.failed | 完整错误含原模型 ID |
| 拒绝后有效选择 | hy3 | setter hy3 → 实际 hy3 | completed / run.completed | 合成标记送达 |
| 已广告模型订阅回归 | deepseek-v4.1-flash | 原生确认及实际请求均为 DeepSeek | failed / ACP_MODEL_REQUEST_FAILED | 原始“企业订阅已到期”送达 |
| 省略模型 | 未提供 | 原生默认及实际请求均为 DeepSeek，无 setter | failed / ACP_MODEL_REQUEST_FAILED | 原生拒绝送达 |

末轮有效请求及恢复均保持原生 session `01a18091-2303-7276-8d41-78c9e5d746ec`。
主 Agent 的实际请求 ID 按顺序为：

| 模型 | 原生 requestId |
| --- | --- |
| hy3 | 01a1809148bb75e7894894dca88a6cef |
| hy4-preview | 01a180917cd27134baa783cad3ba64d2 |
| hy3 | 01a18091ba7976b7a9d56de022727e4e |
| deepseek-v4.1-flash | 01a180924be5731f993754e37f63a4d8 |
| deepseek-v4.1-flash | 01a18092807a7e29ab8a214e2d864ad5 |

证据来自真实 CodeBuddy 日志的 ModelConfig.sessionId 和 ModelProvider Sending request（agent=cli），逐轮按新增 requestId 关联。会话确认来自真实 ACP 响应，Host 状态来自真实控制帧，文本从服务端群历史回读；不依赖模型自称或仅观察 completed。
最小报告只保留 session/model/requestId/终态/送达布尔值；本机末轮完整最小报告为 `/tmp/octo-217-live-invoke-report.json`，命令输出为 `/tmp/octo-217-live-invoke.log`。

```bash
OCTO_CHANNEL_QA_ACCOUNTS=/protected/path/to/octo-im-account.md \
OCTO_CHANNEL_QA_GROUP=<existing-Channel_QA-group-id> \
OCTO_CODEBUDDY_LIVE_REPORT=/tmp/octo-217-live-report.json \
node scripts/verify-codebuddy-model-im-live.mjs
```

# 验收工具修正与限制

- 首次 DM 方案被服务端明确拒绝：两 QA Bot 无好友关系；Bot 建群又要求人类创建者，均未创建资源或发送测试消息。随后只读发现并选用两 Bot 已加入的既有 Channel_QA 群，未修改好友、成员或账号权限。
- 首轮真实群验证已交付“拒绝后有效选择”，但脚本用 includes("unsupported") 错把该场景归为非法模型，断言本身失败。改为精确场景匹配后补跑完整 7 项；不是产品失败，也未将该轮声称为完整通过。
- 真正 ACP client.close 是幂等的。观察包装器原先把重复关闭调用重复记账；包装器改为共用一次 close Promise，末轮核对 7 个实际 transport 关闭。
- hy4-preview 的请求确实切换，但本账号的原生请求失败；未声称付费模型调用成功。DeepSeek 的失败证明订阅错误回归通过，不证明该模型可用。
- setter 原生拒绝、分组目录、旧 models 接口、缺确认与取消由离线自动化覆盖；真实环境没有人为制造 setter 拒绝或清除账号状态。Linux/Windows、其他 CodeBuddy 版本和卡片渲染未在本机实测；托管 CI 状态单列。
- 未修改已部署 Runtime、生产渠道配置、Provider 认证或现有用户数据；测试群消息保留用于核对。未合并、发布或部署。

本地审查见 [verified-review](review.md)。

# PR 218 评审补充：独立非门禁验收

2026-10-28，按用户确认的最小范围，仅补文档，基于 `1c3d4856e518244c0e1b4e5d470b0832387be8fe`。
真实 CodeBuddy 脚本本来就未被默认 test/CI 调用，本次明确标记 non-gating；变更作者负责执行及证据归档，reviewer 核对范围。
重跑时机、现有命令、前置条件和全部 adapter 的共同证据边界见[独立真实验收指南](../../guides/provider-live-acceptance.md)。
既有 CodeBuddy 7 场景是上文固定版本的本次实施证据，不宣称默认 CI 持续调用真实 Provider，也不代表其他 adapter 已验收。

曾在未提交的测试迁移草稿阶段，用名称过滤尝试只发现测试，但本机 Node 24.19.0 仍执行了原生测试。发现后中断，结果为 4 通过、1 断言失败、2 取消；Codex MCP 认证发现断言失败未定位为 adapter 缺陷，不将该次结果声称为真实验收通过。
随后以不访问外部服务的合成测试复现过滤未阻止执行，改用静态检查；进程 cwd 检查未见本次独占原生临时目录的遗留进程。
目录迁移、开关/命令和脚本草稿全部撤回，最终源码、测试、package 命令及 CI 工作流与上述基线一致；本轮文档检查单列，不重复真实模型请求。

最终文档检查通过：Prettier（CONTRIBUTING、CI 指南和 PR 模板）、OctoSpec lint（449 个 OKF 单元、20 条规则、3171 个本地链接）、git diff --check。以 git diff --exit-code 核对 apps、packages、scripts、test、package.json、lockfile 和 CI workflows 与基线无差异；未重复全量测试，原实现全量结果见上文。
