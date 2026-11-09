---
type: Validation
title: agentEnv 与中断实施验证
description: 四参数调用、环境隔离、可定位中断和独立发行包的实测证据。
tags: [architecture, protocol, lifecycle, validation]
---

# 2026-11-08 本地验证

> 历史证据：本页记录当时的实现与候选验证，不是当前安装指引。其中 npm 2.0.0、client ^2.0.0 及其发布前置条件已被后续[发行版本决定](../client-release-version/brief.md)取代；当前 Runtime/client 沿 1.1.11 → 1.1.12 发行，候选验证及未发布边界见[当前验证](../client-release-version/validation.md)。IPC v2 不要求 npm 2.x。

[规划](brief.md)准备评分为 96/100，不代表实现质量或真实 Provider 验收。本记录针对两个 worktree 的未提交修改，承接 Issue 328；没有提交、推送或发布。

## 实测结果

| 范围 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| Runtime 构建 | `pnpm run build` | 全工作区成功 |
| Runtime 回归 | `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js` | 1606 项：1545 通过、61 跳过、0 失败 |
| Runtime 静态检查 | ESLint apps/packages、根 tsc --noEmit、lint-names | 通过 |
| 双语文档 | `pnpm run docs:check` | 类型通过；37 对页面、75 Markdown、8 JSON、6 Mermaid、12 内置 Context 样例；4 项执行示例通过 |
| 当前文档链接 | tracked + untracked，过滤已删除文件后 auditDocumentLinks | 161 篇、1530 链接、35 锚点，0 错误 |
| Gateway 构建/类型 | `tsc -p tsconfig.json` / `--noEmit` | 通过 |
| Gateway 回归 | `node --test --test-concurrency=4 --test-timeout=20000 test/*.test.js` | 561 项：560 通过、1 跳过、0 失败；最终生产代码 tgz 重装后再次通过 |
| 实际 npm 包外消费 | Gateway `scripts/verify-package.mjs GATEWAY.tgz RUNTIME.tgz CLIENT.tgz` | 独立临时目录 npm install 成功、CLI bin/命令/配置/日志、公开类型、client 与真实 Kernel RPC、关闭注册保留 Kernel 均通过 |
| 独立复审 | Standards / Spec reviewer | 最终未关闭问题分别为 0 / 0；另行复跑相关专项通过，见 review |
| 变异测试 | 将 registry.rejected 的记录身份保护从 !== 反转为 ===，重新构建并跑专项 | 测试失败，变异被杀死；finally 恢复源码、重建后 5 项通过 |

回归含预提交 interrupt、同步句柄身份、冻结快照、旧句柄身份复用、未消费 return/throw 释放、ACK/断流边界、恢复正文/图片、凭据隔离和业务投递尾流。Gateway mock 严格验证四参数和 IPC v2；业务断言读取实际模型 parts，不把旧 Context 结构重新塞回 Runtime。

## 历史 npm 2.0.0 候选和复现（已被取代）

以下命令、依赖范围和注册表安装前置条件仅保留 2026-11-08 当时的实测证据，不应继续用于安装、生成锁或安排发布。当前使用 1.1.12，见[发行版本验证](../client-release-version/validation.md)；该记录只证明本地候选通过，不证明 npm 已发布。

Runtime 保留源码版本 0.0.0，`node scripts/pack-release.mjs --version 2.0.0` 生成完整 Runtime 与独立 client 两个真实 tgz。Gateway manifest 使用 client ^2.0.0，完整 Runtime 仅为测试 devDependency。最初 file tgz 安装只为本地联调，最终 manifest/lock 不含 file 路径或本机地址。

Gateway 的 `scripts/lock-runtime-candidates.mjs RUNTIME.tgz CLIENT.tgz` 从两个 tgz 提取包元数据和真实 sha512，交给 pnpm update 两个显式包并使用 --lockfile-only 生成锁；临时仅对本次作用域提供候选元数据，最终下载地址为 npm registry，未伪造发布时间。没有手改 integrity。2.0.0 尚未发布，干净的注册表安装须先发布这些匹配候选；重新打包后必须重新生成锁并复验。

Gateway 包先显式 tsc 构建，再 `npm pack --ignore-scripts --pack-destination /tmp`，包外验证显式安装三个 tgz，不访问 Runtime checkout 私有模块。首次普通 npm pack 的 prepack 被本地 pnpm 依赖状态检查拦下，未将其计作成功；后续上述显式构建/打包和真实消费成功。最终锁生成脚本已实际执行成功；追加审查发现旧 install --lockfile-only 会复用同版本旧锁，改为定向 update 并校验输入 hash 后，独立审查者用不同字节的同版本候选确认两项 integrity 均正确更新。

## 限制

- 未验证真实模型、真实 IM、原生 Windows/Linux 服务或用户现有系统服务；Windows 凭据大小写覆盖为平台分支模拟。
- 包外 Kernel 使用受控 Adapter，证明包/IPC/资源所有权，不等于真实 Provider 兼容性验收。
- 旧 SDK 对象入口、contexts、cancelInvocation 和 IPC v1 均不兼容；需协调升级 Runtime/client/Gateway。
- 当时的 npm 候选安装按 ^2 范围解析，不会后台自动更新或跨 major；该历史范围已被上述 1.1.12 决定取代。
- 历史删除文件仍可能被基于 git ls-files 的纯 cached 文档审计列出；本次审计过滤实际不存在的文件，同时纳入新增文档。


## PR 329 评审修正验证（2026-11-08）

本轮相对已提交 00bd48d 修正取消 ACK 状态和双语 MCP 指引，继续用户授权的提交/PR/合并；不发布 npm/tag。准备评分不代替以下实测。

- `npm run build`、根 `tsc --noEmit`、ESLint、format:check、lint:names 与 octospec lint 全部通过。
- `npm run docs:check` 通过：37 对页面及 4 项可执行文档测试。
- 显式本地专项：async-supplement / async-questions / async-recovery / agent-env-process、agent-env-invocation 和 opencode-v2 合计 **74/74 通过**。新增 6 项覆盖取消 ACK/未知/并发/恢复与公开四参数真实 Kernel→子进程环境传递，未扩大默认 CI glob。
- `node --test --test-concurrency=4 test/*.test.js packages/octo-runtime-protocol/test/*.test.js`：**1606 项，1545 通过，61 跳过，0 失败**。远端评审提到的 OpenCode instructions-path ENOENT 在本轮专项与完整回归均未复现，没有放宽断言或修改 Provider 逻辑。
- Standards 与 Spec 独立复审均无未关闭问题；Standards 另行独立运行新增 6 项通过，见 review。
- 本轮未进行真实 Provider/IM 或用户服务操作。先前 head 00bd48d 的托管 CI 全部通过，不代表本轮新提交的 CI 结果；外部审批尚待重新确认。


## 用户澄清 agentEnv 边界后的文档验证

基线 bf8d6f63038dfb237767110ba500278815ba5413；仅修改架构、工程规则、两语言概念/交互文档和共享示例注释，执行实现不变。

- `npm run docs:check`：示例类型检查、37 对页面检查、4 项可执行示例全部通过。首次检查指出 docs 内新增片段链接不符合既有检查器约束，已改为页面链接后复验，未修改或绕过检查器。
- 当前文档链接检查：161 篇、1542 链接、38 锚点，0 错误。
- octospec lint 与 `git diff --check` 通过；Standards / Spec 独立复审各 0 个未关闭问题。
- 本轮为文档澄清，没有重新运行完整执行回归或重新打包；此前 bf8d6f63 的完整回归、包外验证及六组托管 CI 证据仍仅归属于该提交。
- 未验所有外部应用的 providerEpoch/绑定管理，也未进行真实 Provider/IM 操作。SDK 不新增全环境签名或自动失效行为。
