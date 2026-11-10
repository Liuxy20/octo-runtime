---
type: Validation
title: 模型输出静默通知验证记录
description: 记录两轮真实计时、本地专项、协议文档临时 lint、全量回归及最终发行包验证。
tags: [validation, silence, protocol, testing]
---

# 基线与验收对象

2026-11-10，工作树基线 `7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2` 上的未提交修改，Darwin arm64，Node 24.22.2、pnpm 11.19.0。本记录验收 Runtime canonical model_output_idle；native 无新增类型，Gateway 仓库只建 [issue #34](https://github.com/Mininglamp-OSS/octo-channel-gateway/issues/34)。既有 #348–351 删除闭包同时复验。

# 实际结果

| 检查 | 命令与结果 |
| --- | --- |
| 构建与类型 | `pnpm typecheck` 通过，包含 Schema 生成、workspace build、根类型检查 |
| 基本质量 | `pnpm lint`、`pnpm lint:names`、`pnpm format:check` 通过 |
| 全量回归 | `pnpm test:suites`：1465 项，1404 通过、61 既有 opt-in/环境跳过、0 失败 |
| 本地专项 | `node --test test/manual/model-output-silence.test.mjs`：14 通过、1 显式真实计时项跳过、0 失败 |
| 真实计时 | `OCTO_SILENCE_LIVE=1 node --test test/manual/model-output-silence.test.mjs`：最终源代码15项全部通过、0跳过、0失败；包含两段真实60秒，整个手动套件约121.370秒。源异常/结束分支修复后重新运行，不沿用前一构建结果 |
| 文档 | `pnpm docs:check` 通过：37 对页面、75 Markdown、14 JSON、6 Mermaid、7 公共 Context 示例及4项运行测试；文档子 Agent独立复跑通过 |
| 打包 | `node scripts/pack-release.mjs` 生成两份本地 0.0.0 tgz，无发布 |
| Runtime 包外消费 | `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 通过：离线安装、公共类型、native Kernel、SDK recovery、CLI Kernel、卸载保留 Home |
| client 包外消费 | `OCTO_CLIENT_TEST_VERSION=0.0.0 node --test test/manual/runtime-client-309.test.mjs`：11 项全部通过 |
| 独立协议回归 | 协议子 Agent定向运行201项，全部通过；日志见下方 |

最后背压复核由子Agent独立运行8个实际Core场景，均通过。手动回归也覆盖真实异常、缺终态、非法载荷、成功终态及晚到取消；源next拒绝的cleanup incomplete是既有清理未确认合同，不记为清理成功。

真实计时使用受控 Adapter 和真实本地 Kernel socket/client，不是外部模型服务。第一段无输出时收到 notice，按 seq 重放得到同一帧；恢复一次模型文本后重新计满 60 秒，再收到不同 noticeId，随后正常完成并清理。运行次数为1，序号连续；无第二次 invoke。实际 wall-clock 只验证本机调度环境。

专项还覆盖 fake clock 的59999/60000边界、每区间一次、迟到 timer 的实际 silenceMs、旧通知失效、重叠工具/交互、async 不暂停、排队、10000次订阅/退订有界、取消释放与 native 不订阅、Schema 正反例。Core 实际消息通路覆盖257个身份、新匿名消息/step、空和回退快照、公开性及role继承。

# 临时 lint：不进入 CI

- 删除闭包：`node /tmp/octo-envelope-lint.bBwNmu/check.mjs "$PWD"`，最终源码252、构建306、打包419、文档代码块95、Schema4，0项发现；包括既有4类内存注入自检。报告 `/tmp/octo-envelope-lint.bBwNmu/report.json`。先前旧归档3处 Schema不一致失败，最终打包后独立复跑通过。
- 协议专项：`node /var/folders/76/39mbswr923z8ykj89093khl00000gp/T/octo-protocol-quality-6ta9w1w5/lint.mjs`，三个协议入口110项断言通过，Schema弱化 canary 检出。报告同目录 report.json。检查安全整数、严重度、额外字段、native拒绝及删除导出。
- 文档专项：`node /tmp/octo-doc-quality.sCnw8e/lint.mjs "$PWD"`，检查修改 Markdown 中 JSON 的真实 Schema/运行时语义、通知内外身份和序号、中英JSON一致；4个注入反例检出。知识元数据用 `uv run --with pyyaml python /tmp/octo-doc-quality.sCnw8e/metadata.py "$PWD"`，3个反例检出。最终新增记录后重扫计数见下方收尾记录。
- 计时修复专项：`node --test /tmp/silence-timing-fixed.test.mjs`，2项通过，实际 Core 消息事实交给独立假时钟，证明两个已复现缺陷修复。

临时目录不进入仓库、package scripts、默认测试或workflow，可能被系统清理。主要日志保存在 `/tmp/octo-envelope-lint.bBwNmu/silence-*.log`，协议独立回归为 protocol-quality-tests.log。已有全量测试入口未新增专项；文档检查器只修正已有示例的 Schema 分类。

# 边界

limits.enforcement、model_idle_policy、首帧/整轮/工具预算及默认值保持。首帧60秒预算可以先于静默通知结束执行；observe不是关闭所有预算。notice不请求取消，也不是持续心跳或连接保活保证。

旧版client严格拒绝未知notice code，消费端须同步升级到已支持此code的协议版本，不宣称旧client自动兼容。

未重跑真实Provider、Gateway、Windows/Electron；不宣称跨平台/仓外迁移完成。旧Grok网络限制见前一任务。相对基线 `.github/`、package.json、pnpm-lock.yaml无diff，默认CI范围未增加。无提交、推送、PR或发布。

# 最终文档与范围检查

新增审查/验证/journal后，临时文档lint重扫71份Markdown、26个JSON代码块、2个通知示例，0错误，4个反例仍检出；元数据重扫26份知识Markdown，0错误，3个反例检出。`uv run --with pyyaml python .octospec/scripts/lint.py`通过：757个OKF单元、20条规则、3524个本地文件链接。`node scripts/check-developer-docs.mjs --scope current`通过：161文档、1691链接、42锚点、0错误。`git diff --check`及`.github/package.json/pnpm-lock.yaml`相对HEAD无diff检查通过，最终format:check通过。

## 后续范围更新

以上记录对应静默通知实现阶段。用户随后明确授权另行[删除 enforcement 及兼容分支](../remove-limits-enforcement/brief.md)，因此“保持 enforcement”的阶段约束不再是当前合同；model_idle_policy、有限预算及静默通知保持。
