---
type: Plan
title: Issue 346：实施顺序与验收矩阵
description: 按依赖顺序迁移宿主绑定、各 Provider 与 CLI 装配，并定义显式手动验证和交付条件。
tags: [architecture, adapter, testing, lifecycle]
---

# 实施顺序

M0-M3 已实施，M4 检查结果逐项记入 validation。新专项入口为 `test/manual/host-execution-346.test.mjs`，真实 OpenCode 入口为 `host-execution-346-live.mjs --live`；均不进入默认 selector。

| 阶段 | 具体工作 | 进入下一阶段的依据 |
| --- | --- | --- |
| M0：最小合同 | 在 adapter-sdk 复用 CommandSpec 补足本地启动绑定，区分宿主解析 helper 与纯执行 helper；用 OpenCode 两路径及 ACP factory 验证原型；静态 metadata 与 defineAdapter 复用 | A01-A05、A09 的类型/行为原型通过；不需要更改 wire schema、不要求所有 Adapter 采用统一工厂 |
| M1：执行底层 | 拆开 probeCommand 的搜索和单目标检查；迁移 JSON-lines、ACP client、Grok client 和 Windows shim/Node 选择；最终环境来自显式快照 | A02-A05、A08、A10、A13 通过；最终 spawn 不再调用发现 helper |
| M2：Provider 与 CLI | 按 design 的逐类表迁移全部内置命令工厂；Codex owner 捕获启动绑定；CLI 包装工厂、缺安装包装与两入口接线；DSH/OpenClaw 作边界回归 | A06-A09、A11-A12、A14 通过；默认缺安装不阻塞 Kernel；失效目标不换安装 |
| M3：消费者与文档 | 迁移默认实例、manifest、public 导出、仓内 SDK/fixtures/手动脚本及双语 docs；同步 architecture、adapter-metadata、environment 规则 | A01、A09、A12、A15；包外消费显式构造成功、旧零参调用不再作为支持示例 |
| M4：本地验收 | 运行离线全量、显式专项、受影响真实 Provider 与包外验证；记录 SHA/dirty、平台、版本、终态和清理 | 验证结果逐项记录；未验平台或真实环境独立列出；不能以评分代替通过 |

## 验收矩阵

| ID | 场景与可观察断言 | 证据入口 |
| --- | --- | --- |
| A01 | SDK 本地工厂缺绑定/裸命令/相对路径/NUL 在 spawn 前失败；有效构造结果可注册，protocolSupport 类型默认和运行时校验保持；自定义第三方构造不受限制 | 拟 `test/manual/host-execution-346.test.mjs` 与类型 fixture |
| A02 | 独占目录内放 A/B 两个同名 executable，显式绑定 A；修改基础 PATH、本轮 PATH/path、cwd，probe、CLI 和 ACP 均只运行 A；不修改全局 process.env | 同上，spawn/PID/版本标记与执行轨迹 |
| A03 | A 损坏、消失、权限拒绝或版本不兼容时，B 的启动计数为 0；probe 不寻找下一候选，失败分类保真 | 同上；权限场景按实际 OS 记录 |
| A04 | 本地 npm 启动为选定 Node + JS 前缀 argv + 协议 argv；--version 校验 Provider 而非 Node；空格/Unicode 参数逐项保留、shell=false | 同上，fixture argv/版本与最终 command |
| A05 | 宿主基础 env、Run envs、overrides、固定协议变量按既有顺序合并；envs/MCP 和 OPENCODE_CONFIG_CONTENT 仍生效，绑定对象构造后被修改不影响执行 | 同上，快照、并发与脱敏断言 |
| A06 | OpenCode ask/acp 与 full_access/json 使用同一绑定，保留审批、MCP 与 final；按最新用户原则无版本准入与调用前版本探针，旧版/新版/预发布/未知版本均实际验证两路协议，不只测一路 | 新专项及现有 `test/opencode-v2.test.js`、审批相关测试 |
| A07 | Codex probe/启动/恢复使用同一 owner 绑定；不同 PATH/cwd 不换 executable；关闭一个 Core 不终止兄弟通道，owner 最终关闭 | 新专项及 #339 显式生命周期入口；#343 并发单列 |
| A08 | 标准 ACP、CodeBuddy 与 Grok 专用 client 的启动失败/取消/断流均回收本轮资源；close 失败如实 incomplete，不吞原失败 | 新专项及 `test/acp-transport-failure.test.js`、Grok 回归 |
| A09 | 注入 ACP factory 或 Codex provider 时不进行本地命令发现；容器/远程位置由 factory/provider 闭包决定，不 stat 远端路径；协议 lease close 不关闭共享资源 | 新专项注入的 transport/provider 轨迹；真实远程不在本任务能力承诺内 |
| A10 | 原生 Windows 的 PATH/path、PATHEXT、.cmd/.bat/npm shim、相邻 Node、缺 Node、未知 batch 均走宿主解析；最终执行不搜索 cwd/PATH；不转 shell fallback | 新专项原生 Windows 执行，模拟不能代替实机 |
| A11 | CLI 内置集合缺任意默认安装时 Kernel 仍可就绪，该 Adapter list/probe unavailable、invoke 明确失败且不 spawn；模块损坏/非法配置仍触发现有回滚 | 新专项及 `test/adapter-composition.test.js`、manifest 回归 |
| A12 | CLI main、playboard 使用同一宿主选择层；显式配置优先且失效不回退；帮助/版本无发现/启动；第三方 manifest factory/options 保持 | 新专项及 CLI fixtures、`test/adapter-host-manifest.test.js` |
| A13 | 取消/超时/探针失败/启动失败保留实际 cleanup；借用关闭只关本轮；日志不输出秘密环境或整个 launch | 新专项、清理和公共展示回归 |
| A14 | DSH 仍显式 dshBin + 官方 SDK，Electron runtime 同源；OpenClaw 保留 Gateway 连接模式、非空 envs 拒绝，不要求本地 executable | `test/cli-dsh.test.js`、`test/dsh-launch.test.js` 及 OpenClaw 回归 |
| A15 | 包外显式构造、双包导出与 docs 示例可用；HostedAdapterMetadata shape/schema 无新增依赖字段；workflow/默认 selector/Gate diff 为空 | 打包验收、docs 检查与 CI 文件 diff |

## 后续实施命令

新专项只在 `test/manual/` 显式运行，不加入默认 selector。迁移已有回归中的构造调用属于维护原范围，不能借此把整套新增专项嵌入默认测试。

```sh
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm test
node --test test/manual/host-execution-346.test.mjs
node scripts/check-developer-docs.mjs
git diff origin/main -- .github package.json pnpm-lock.yaml scripts
```

最后一条只列部分高风险文件；当前 `package.json` 的 test:suites 直接选择 `test/*.test.js` 和协议包测试，新专项放 `test/manual/*.test.mjs` 不会进入该 glob。实施交付还须逐一检查 package scripts、实际默认测试选择代码、workflow 展开后的检查列表与 Gate 依赖，不能以路径列表为空替代审查。检查入口以实施时 package.json 为准，若命令或路径变化先更新本计划。

真实验收为 non-gating：至少分别运行真实 Codex、OpenCode JSON CLI 和 ACP 各一轮，并确认 owner/transport 回收；其余受影响 Provider 依各自指南执行并记录缺环境项。验证 Node/npm 与 Provider 版本、macOS/Linux/Windows、真实 Electron 分开报告。没有真实模型/账号环境时明确未验，不能把 fixture、类型或版本探针当执行成功。

## 整合与回退

实施开始前重新 fetch main，核对 #343 或其他任务是否修改 Codex owner/CLI factories，更新基线与审计表。冲突按最终所有权合同整合，不恢复裸命令默认。失败时保留原配置/依赖及清理事实，不通过另找安装、删除 Home 或重放已接受请求回退。提交、推送与 PR 需要后续明确授权，英文消息及 Codex trailer 遵守用户要求。
