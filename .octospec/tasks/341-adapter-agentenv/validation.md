---
type: Validation
title: AgentEnv 直传验证
description: 区分既有回归、本地手动专项、包外消费及真实 Provider 的验证状态。
tags: [adapter, protocol, testing, validation]
---

# 验证基线

初始 main d5aeae707fcda0b138b360136f164c085c9a5e87；提交前整合 4d7e272d1bb30957c815410f68758a9d2445d708。环境为 macOS arm64、Node v24.22.2、pnpm 11.19.0。工作树有本任务修改；所有专项手动运行，不增加默认测试 selector 或 GitHub CI。

# 初轮证据

初始基线工作树既有全量：1516 项，1455 通过、61 跳过、0 失败。Adapter 合并专项 489 项：486 通过、3 live 跳过。334/335、Claude preparation、Codex service lifecycle、136 配置快照专项 89/89；公开 SDK 合同 8/8；OpenClaw 故障帧 29/29。随后发现远端 main 新合入 #342，以上结果不代替整合后的最终验证。

# 最终验证

| 命令/检查 | 结果与证据 |
| --- | --- |
| pnpm typecheck（含完整 build/schema 生成） | PASS，/tmp/octo-341-integrated-typecheck.log |
| pnpm lint、pnpm lint:names | PASS，/tmp/octo-341-integrated-lint2.log、/tmp/octo-341-integrated-names.log |
| pnpm test:suites | PASS，1516 项：1455 通过、61 跳过、0 失败；/tmp/octo-341-integrated-full-final.log |
| 手动 AgentEnv 直传与原语义负例 | PASS，49/49；direct/RPC 私有条目保序、空信封不补值、默认信封隔离、并发可信选项、结构预算及错误复用清理边界；/tmp/octo-341-integrated-direct.log |
| 17 文件生命周期/配置专项 | PASS，268/268，含 #339 Engine 所有权、334/335、Codex 256/512 审批与 EPIPE、service lifecycle、async、136、ACP 清理；/tmp/341-main339-manual-final.log |
| Adapter 准备与关联回归 | PASS，214/214，含全部 Harness getter、探针前预算、目录错误码、准备清理和单次 notice；/tmp/octo-341-adapter-final-main2.log |
| pnpm docs:check | PASS，37 组双语页、75 篇 Markdown、10 个 JSON、6 个 Mermaid、11 个公共 bean 及 4 个执行示例 |
| SDK145 合同、OpenClaw 故障帧 | PASS，分别 8/8、29/29；公开 SDK 四份 fixture 严格类型检查及 executor/host 实际运行通过；14 个改动验证 JS 语法通过 |
| node scripts/pack-release.mjs --version 0.0.341 | PASS，仅构造本地 runtime/client tgz，未发行；/tmp/octo-341-integrated-pack.log |
| node scripts/verify-release.mjs 绝对路径/runtime-0.0.341.tgz | PASS，离线安装、公开类型、SDK/CLI Kernel、恢复探针、卸载保留 Home；/tmp/octo-341-integrated-release.log |
| OCTO_CLIENT_TEST_VERSION=0.0.341 node --test test/manual/runtime-client-309.test.mjs | PASS，11/11，npm/pnpm 仅 client 与双包消费、真实包外类型和旧 IPC 拒绝；/tmp/octo-341-integrated-client.log |
| node test/manual/codex-service-package-313.mjs 绝对路径/runtime-0.0.341.tgz | PASS，包外严格类型、3 次 direct + 3 次 IPC、PID 复用与 owner 清理；/tmp/octo-341-integrated-service-package.log |
| 修改文件 Prettier、git diff --check、OKF lint | PASS；历史删除源码的 5 个链接固定到删除前版本，不改历史结论 |

以上专项有重叠，不将用例数相加。首次并行全量与本地打包同时执行时，OpenCode 2 秒版本探针发生一次超时；保持生产及测试超时不变，孤立探针复跑和最后独立全量均通过。首次 lint 与 clean build 并行时依赖声明被清理，最终在构建后重新运行通过。

真实 Provider、原生 Windows 路径和 IM 消费者为 NOT_RUN；61 个既有跳过项不是通过。包外进程使用本地假 Provider，验证实际 IPC、PID 所有权和资源回收，不证明在线模型或原生 Windows 行为。

Standards、Spec 与测试/验证 JS 定制审查剩余问题均为 0。相对目标 main 的 .github diff 为空；package.json 仅新增公开 adapter-sdk 入口与依赖，既有默认测试 selector 不变。专项仅本地手动，不新增 workflow/job/矩阵/触发条件/必需状态或 Gate。提交后只创建 PR，不启用 auto-merge、不合并或发布。
