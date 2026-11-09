---
type: Validation
title: Issue 334 与 335 联合验收
description: 应用提示词及工作目录归调用方的离线、包外与真实 Provider 验证证据。
tags: [validation, protocol, workspace, packaging]
---

# 对象与环境

main 基线 `3f83ecf4607c658fba7664caa6ccb2787ab92baa`；#334 实现 `7a76a454`，#335 实现 `b645a474`，审查整改 `df754e94`。本地 macOS arm64、Node 24.22.2、pnpm 11.19.0，操作人 `superalsrk`。#334/#335 生产变更前分别完成 96/100 准备度与独立实施前双轴审查。用户明确无兼容、业务方预建目录、缺目录有错误码；Gateway #23 已取消，Work App 不涉及。

## 已执行的检查

| 范围 | 命令与结果 |
| --- | --- |
| 安装 | `pnpm install --frozen-lockfile --ignore-scripts`，674 包，lockfile 未变 |
| 类型/构建 | `pnpm typecheck` 全 workspace/public 通过；最终整改后完整重跑通过；重新运行 Schema 类型生成器无 diff |
| 静态 | `pnpm lint`、`pnpm lint:names`、`pnpm format:check` 通过 |
| 全量 | `pnpm test:suites`：最终整改后 1609 项，1548 通过、61 既有条件跳过、0 失败，约 19 秒 |
| 显式专项 | `node --test test/manual/caller-prompts-protocol-334.test.mjs test/manual/caller-workspace-protocol-335.test.mjs test/manual/caller-workspace-core-335.test.mjs`：16/16，无跳过 |
| 输入整改专项 | `node --test test/manual/caller-content-routing-334.test.mjs`：35/35，无跳过，公开入口到 ACP/Grok/Codex 实际 Adapter 分支 |
| MCP 失败专项 | `node --experimental-test-module-mocks --test test/manual/claude-preparation-334.test.mjs`：4/4，无跳过；Node 模块 mock 实验性警告不影响结果 |
| 文档 | `pnpm docs:check`：37 对页面、75 Markdown、8 JSON、6 Mermaid、11 Context 示例，4/4 运行示例 |
| 打包 | `node scripts/pack-release.mjs --version 0.0.335`：基于最终生产整改 df754e94 重打 Runtime/client 两个 tgz；仅本地验证版本，未发布 npm，源码仍为 0.0.0；以下包外检查均重跑通过 |
| Client 包外 | `OCTO_CLIENT_TEST_VERSION=0.0.335 node --test test/manual/runtime-client-309.test.mjs`：11/11，npm/pnpm 独立/双包离线安装、Schema 资产、公开类型及服务行为 |
| Runtime 包外 | `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.335.tgz`：全局离线安装、文档/SDK 编译、原生 Kernel、恢复探针、CLI 与卸载保留 Home 均通过 |
| OKF | `/tmp/octo-runtime-332-spec-venv/bin/python .octospec/scripts/lint.py`：最终记录新增后重跑，713 单元、20 规则、3334 链接通过 |
| 范围 | 相对 main 的 `.github/workflows`、根 package.json 和 lockfile diff 为空；无新增默认专项入口 |

专项覆盖旧字段的空串/null/显式 undefined 拒绝、旧 item 拒绝、标准 Schema/runtime 对齐、负向 TypeScript 编译、普通混合输入顺序、首轮/续接/显式 fallback 无额外注入、原 MCP/env 行为。目录专项通过真实 Core/IPC 两种视图核对五个 WORKDIR 原因码、零 Provider 调用、真实子进程 cwd、调用方临时目录、删除后的续接不补建、外部/preset 无本地路径、POSIX 非 root 权限失败；本机权限用例实际执行，没有跳过。

## 验证中修复

- native 输出白名单最初缺少 WORKDIR 原因码，构建失败。同步 Schema、生成类型/常量及结构化失败校验后通过；不把它们改写成 HOST_EXECUTION_FAILED。
- 原测试仍期待系统指令注入或 Core 隐式 cwd，改为调用方显式路径/普通输入与精确无注入断言。异步目录检查使 mock clock 的旧单 tick 假设失效，改为等待实际 Provider 进入后再推进时钟，保留原清理期限断言。
- 第一轮全量中两个缺路径测试停在等待未启动 Provider 的 Promise；只终止本次两个所属测试进程，修正测试调用方后完整重跑通过。该轮不计为通过。
- OpenCode 删除文件 I/O 后 async 无 await，改为保持 Promise 返回和错误拒绝的实现，单包重构建与 ESLint/全量检查通过。
- 删除源码后两处历史链接改为不可变基线 GitHub 链接，保留历史语义，不把旧设计写成现行合同。
- 最终审查修复公开文本/parts 的选择：显式纯文本 modelInput 和恢复文本不会被当前 parts 覆盖；恢复 parts 优先，有图片仍执行恢复守卫。35 项专项覆盖首轮、续接、三种真实 Adapter 缺会话分支、正文相等和混合图片顺序。
- Claude MCP 写入和清理同时失败时抛出保留原始 cause 的 AggregateError；4 项模块 mock 专项覆盖主错误、双错误、成功清理及无 MCP 路径。更新已过时的工作区工具导出规则。

## Non-gating live acceptance

执行命令为 `node scripts/verify-dual-protocol-live.mjs codex` 与 `node scripts/verify-dual-protocol-live.mjs claude-code`。脚本使用当前 Core/Adapter、显式存在的 cwd 和调用方普通提示词，不调用工具；只输出身份、计数和状态，不输出凭据或 Provider 正文。验证来源为 `d3a4dbae` 加实施 dirty 工作树（随后提交为 `b645a474`）；不是正式发行产物的真实模型验收。

| Provider/版本 | native | canonical |
| --- | --- | --- |
| Codex CLI 0.164.0 | completed，29 帧、0 次 canonical 转换；run `a5d0b073-8dea-4fef-96eb-bb446904a45f` | completed，23 帧/23 次转换；run `0ab2906c-4e4a-4dcf-9010-09b67470aad9` |
| Claude Code 2.1.306 | completed，100 帧、0 次转换；run `69733f31-07a2-429a-8472-6e7cb6e0d9a6` | completed，53 帧/72 次转换；run `4f5c3662-76f9-4795-aa34-1ed617750b4a` |

每次由独立 AgentExecutor 拥有执行并在 finally 等待 shutdown；脚本正常退出。原生会话/用户 Home 未删除。其余 Adapter 的真实模型、真实多模态、真实恢复和 IM 均未执行；其输入/注入映射由离线 fake Provider 回归覆盖，不能视为线上证据。Windows/Linux 本机执行未验，远端 CI 结果另记。

## 交付边界

Run7、Contextv3、IPC2、Adapter transport2 不变，没有兼容转换或 npm 发布。Gateway 当前旧消费者仍会发送已删除项/mode；本次只读审计并明确升级缺口，不声称端到端迁移。最终实施审查见 review.md；远端正式 PR、检查、人工批准和 main 合并状态以实际查询为准。
