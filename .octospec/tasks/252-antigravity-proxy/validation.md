---
type: Validation
title: Antigravity Gateway 代理验证
description: 非 TUN 下 Bot Context 注入的真实 Provider 结果、IM 阻塞及文档检查。
tags: [documentation, testing, adapter, envs]
timestamp: 2026-11-01T00:00:00Z
---

# Non-gating live acceptance

执行者 Codex，用户本轮授权。源码 `85411725`，构建时干净；随后仅修改文档。macOS arm64、Node 24.22.2，agy 1.4.12，用户确认非 TUN。系统代理没有改动，代理为本机 `http://127.0.0.1:7890`。默认原生账号和模型，未采集标识。没有验证工具、续聊、真实取消、其他 Harness 或 Windows/Linux。

## PASS：配置到真实模型

仓外脚本 `/tmp/ort78-gateway-config-live.mjs`：先清除宿主八个大小写代理变量，再创建真实 `config.bots[].context.items` envs 列表，经 `validateImBots`、`createImInvocation`、独立 Kernel 和真实 Antigravity Adapter 运行无工具短文本请求。配置中只有该 Bot 带代理。

命令：`pnpm build`；`node /tmp/ort78-gateway-config-live.mjs`。

结果：12,219 ms，预期标记出现，唯一 `run.completed`，宿主代理键前后均 `[]`，Kernel `cleanup.complete=true`，临时目录删除。报告 `/tmp/ort78-gateway-config-report.json`。不修改生产源码或用户配置，不通过全局 export 代理。该边界覆盖 Gateway 配置校验/调用装配，不包含真实 IM 接收和投递，也没有建立 Extra 实际 TCP 直连证据。

## BLOCKED：完整 QA IM 回读

仓外脚本 `/tmp/ort78-gateway-live.mjs --discover` 使用现有 QA 账号文件，从 config 诊断到 group list 时，服务端返回 `err.server.bot_api.auth_failed`。在发送任何消息、创建测试 Runtime 或修改群之前停止。已请用户在本机更新受保护 QA 凭据，不在聊天粘贴 token。未尝试切换身份、路由或其他账号来绕过拒绝；本轮没有发出 QA IM 消息。

恢复后在现有专用 QA 群验证完整 Gateway、真实 Provider、唯一成功终态及最终 IM 标记回读。当前只执行了预检，不能把预写脚本余下路径视为已经通过。

# 文档与静态检查

- `pnpm docs:check`：33 对中英文页面、67 个 Markdown 文件、52 个 JSON 示例、16 个 Mermaid 图及 12 个内置 Context；4 项文档示例测试通过。
- `node /tmp/ort78-doc-check.mjs`：14 个内置 manifest Harness 均有双语专题；30 个 Gateway JSON 经当前完整声明 Schema、Bot 配置、Context 及 dispatcher 校验通过。示例中 `<BOT_TOKEN>` 是必须替换的占位符，检查时仅在内存中替换为运行期生成的虚构值，不保存凭据。URI 格式亦显式检查。
- `node scripts/check-developer-docs.mjs --scope current`：最终 131 个当前文档、1858 个链接、87 个片段，0 错误。85 个外部链接不由此脚本抓取；安装来源另外通过官网读取核对。
- 默认 `python3 .octospec/scripts/lint.py` 因本机缺 PyYAML 未执行检查；使用隔离工具环境重跑 `uv run --with pyyaml python .octospec/scripts/lint.py` 通过，最终 575 个 OKF 单元、20 条规则、3786 个本地链接。未修改仓库依赖。
- `git diff --check` 通过。相对固定基线 `.github`、package/lockfile、运行源码及默认测试差异为空；全部新增内容是文档与知识记录。

所有专项仅本地显式运行。未跑全量测试、其他真实 Provider 或跨平台验收。

# 双轴审查

固定基线 `8541172563da2d35d44165218ee0bf428d13cb37`，包含未跟踪的新文档，未创建提交。code-review 的 Standards 和 Spec 由两个独立只读审查者并行执行。

- Standards：1 项低优先级发现，validation.md 元数据应为 Validation；已修正并由原审查者复核通过，不保留 Reference 分类。新增 journal 与 index 收尾记录亦复核通过，其余无确定规范问题。
- Spec：0 项发现；覆盖 14 Harness 及公共 Gateway 专题，完整 IM 和严格直连证据限制已明确。

审查未修改源码。审查后只修正文档元数据和更新验证/收尾记录。

# 历史诊断

## PR 交付阶段的最新验证

用户确认本轮按文档交付，并授权本地 CI、审查、提交、推送及 PR。分支已快进到 `origin/main@3f2a810b61fefeafa6ad1571f68362b73494b85a`，没有冲突；真实 agy 证据仍属于前述 `85411725`，不冒充在新提交重跑的真实模型测试。完整 IM 和严格 TCP 直连仍未验收；本次文档 PR 不自动关闭 #252。

- `pnpm typecheck`：通过，包含完整 workspace build。既有 Vite 大包和 use-client 指令警告保留。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`：通过。首次 lint 与 typecheck 的 clean 阶段并行，因构建类型声明暂时缺失失败；构建完成后顺序重跑 lint 通过，源码未因此改动。
- `pnpm test:suites`：WebUI 35 项通过；Node 首轮 2388 通过、1 失败、91 跳过。失败来自 `verification-command.test.js` 的缺失安装用例：它将 `dirname(process.execPath)` 放入 PATH，该目录恰有本机安装的 octo-cli，未发生预期 ENOENT。
- 仅将同一个 Node 24.22.2 二进制复制到仓外 `/tmp/ort78-isolated-node/node`（目录无 octo-cli），对应失败文件复验 8 通过、10 跳过。以该二进制运行同一套 `node --test test/*.test.js packages/octo-runtime-protocol/test/*.test.js`：2389 通过、91 跳过、0 失败。未修改测试、默认开关或宿主安装。
- `pnpm docs:check`：33 对页面、67 个 Markdown、22 个 JSON fence、16 个 Mermaid、12 个 Context 样例；4 项示例测试通过。Harness 配置已改为 shell fence，不计入上述 JSON fence 数。
- 显式本地 `node /tmp/ort78-doc-check.mjs`：14 个默认 Harness，30 个双语完整内联声明，Shell/JSON/Schema/Bot/Context/dispatcher 全部通过；每项有 bot_name，省略 approval_mode。
- `node scripts/check-developer-docs.mjs --scope current`：131 篇当前文档、1880 个本地链接、91 个片段，0 错误；88 个外链按检查器策略未访问。
- `uv run --with pyyaml python .octospec/scripts/lint.py`：590 个 OKF 单元、20 条规则、3838 个本地链接，通过。
- [双轴审查](review.md)：发现均已修复，由两名原审查者分别复核，Standards 与 Spec 剩余确定问题均为 0。
- 相对 main 的 `.github`、运行源码、依赖、生成协议、脚本及测试 diff 为空。没有新增 CI job、矩阵、触发器、required check、Gate 依赖或默认测试开关。

发行打包、隔离全局安装及 `verify-release --require-clean` 在授权提交后的干净工作区执行，最终提交、结果与 PR 链接写入 Loop 任务及 PR，避免把提交前的构建元数据冒充干净提交产物。跨平台及 Node 26 留由既有 CI 验证，本机仅 macOS arm64 / Node 24.22.2。

用户随后澄清：此前要求移除的是小米 mimocode，并非 MiniMax Code。前次删除 mcode 文档属于执行者误解，已恢复其中英文专题及目录入口，当前仍覆盖 14 个默认 Harness。仓库现有 Adapter 包与默认 manifest 中未发现 mimocode。此前“mcode 上游有问题”的归因撤回，不作为 MiniMax Code 的事实记录。

后续文档调整：按用户反馈，配置改为直接内联传入 `extraset`；Antigravity 示例内置完整代理 Context，省略默认的 `approval_mode: full_access`。用户指出 mcode 上游存在问题，已删除其中英文专题及 Harness 指南中的入口和安装行，目前保留 13 个 Harness 专题。上述 14 Harness、30 JSON 与双轴审查结果是调整前记录，不代表当前文档版本；调整后 `pnpm docs:check` 通过（32 对页面、65 个 Markdown、46 个 JSON，4 项测试通过），`git diff --check` 通过。未修改 Adapter 实现。

前序 `49f9b11f` 构建下原生 agy 1.4.12：仅 all_proxy 失败；完整 HTTP/HTTPS 代理变量组合成功，Core→Adapter 同样成功。这不能替代上述最新基线的 Context 隔离运行。agy 1.4.10 的早期失败与本轮版本不同，未归为已确认代码缺陷。
