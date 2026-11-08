---
type: Task
title: Issue 159 三份真实验证脚本的执行依赖迁移与离线启动检查
description: 修复两处残留 Kernel AgentExecutor 导入，并让三份真实脚本在实网验收前验证同一执行依赖装配路径。
tags: [testing, integration, architecture]
---

# 目标

维护者运行 act-mode、IM Context 和 Codex forwarding 验证时，应先能加载当前构建产物、构造执行器并注册 Adapter。缺失导出或构造错误必须在离线阶段暴露，不能被解释为 Provider 行为失败。

来源：[GitHub #159](https://github.com/Mininglamp-OSS/octo-runtime/issues/159)、Loop `ORT-58`。用户以“开始实现”认可本规格，随后授权检查 YAML metadata 并提交 PR；实现与本地结果见 [validation.md](validation.md)。同步主线后文档阻塞已消除，专项通过；Codex live 证据与未执行的 IM 验收分别记录，不表示完整 issue 已验收。

## 基线与现状

- 基线：`a5a32835882deab5e2364b559dd06bf1675c1335`，分诊时 fetch 后的 `origin/main`。
- 交付基线：`c35b261b31573bc2f08a16eeced12f18705b2560`；已同步主线，其中包含 #267 的 metadata 修复，本 PR 不重复修改这些文件。
- Worktree：`/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-159`；分支：`fix/159-live-script-executor`。
- [act-mode 脚本](../../../scripts/verify-actmode-live.mjs)仍静态导入 Kernel 的 `AgentExecutor`；[forwarding 脚本](../../../scripts/verify-codex-forwarding-live.mjs)默认路径仍动态取得该旧导出。当前 Kernel 未导出该类，Core 为唯一实现。
- [IM Context 脚本](https://github.com/Mininglamp-OSS/octo-runtime/blob/bf9ff6b599b0e325362698acd3cebd9ac1363467/scripts/verify-im-context-live.mjs)在 `d0e34377` / PR #262 已改为 Core 导入；本项只补充它的离线入口及必要装配复用，保留已有修复。
- 原 issue 的三份脚本失败证据属于旧基线 `8214292132d260c04cf72218580bef741788dd4a`。本轮分诊只做源码核对与三份脚本的 `node --check`，未构建或动态复现，不将语法通过表述为模块加载通过。

## 产品意图与责任归属

业务目标是恢复仓库维护者的验证工具，属于本仓范围。验证作者显式选择脚本、Provider、模式及测试账号；脚本负责装配执行依赖、消费结果和检查断言；Core 负责既有执行合同，Adapter 负责原生适配。离线模式只验证装配，不决定产品默认值或发起业务请求。

本项沿用脚本显式嵌入 Core 的拓扑：执行器与脚本处于同一 Node 进程，脚本是 composition root 和资源所有者；真实执行时 Adapter 可启动现有 Provider CLI。离线模式不启动 Provider、Kernel worker、IPC 服务或 Extra。其他 SDK/CLI/Electron/Extra 产品的默认接入及生命周期不受影响。

## 关键合同

### 1. 导入与装配

- act-mode、forwarding 从 `packages/octo-runtime-executor-core/dist/index.js` 获取 `AgentExecutor`，不在 Kernel 增加兼容导出。
- IM Context 保持已迁移的 Core 来源。
- 每份脚本内部将其执行器构造和 Adapter 注册集中到局部装配函数，由 live 路径和离线路径共同调用。可以接受现有的日志参数和 Adapter 包装参数；不得为离线模式另写一套 Core 导入或直接构造替身。
- act-mode 注册现有五个 Adapter：`codex`、`claude-code`、`kimi-code`、`opencode`、`mcode`；forwarding 和 IM Context 注册 `codex`。离线检查须核对 `host.list()` 的类型集合，无需调用 Provider 原生探测或模型。
- IM Context 的动态上下文 Adapter 包装仍负责原来的指令断言与调用计数；局部装配函数必须用于其 live 分支，不能仅供离线检查使用。
- 装配成功后的执行器由调用脚本关闭。新增离线路径须等待 `shutdown()`，检查 `state === "closed"`、`cleanup === "complete"`，且两类未清理 ID 数组为空；不以退出码代替清理事实。act-mode live 路径补齐对应的 `finally` 关闭；其他路径保留既有资源关闭顺序，不重构业务生命周期。

### 2. 显式离线入口

三份实际脚本各增加独立参数 `--check-startup`，调用方式为：

```bash
node scripts/verify-actmode-live.mjs --check-startup
node scripts/verify-im-context-live.mjs --check-startup
node scripts/verify-codex-forwarding-live.mjs --check-startup
```

- 完成真实模块加载、同一装配函数调用、Adapter 元数据核对及关闭后结束，不进入 live 主体。
- 离线分支位于账号文件读取、身份校验、网络请求、日志目录/工作目录创建、Extra 加载和 `invoke` 之前；允许加载既有依赖模块，但不允许模块加载副作用触发上述动作。
- 仅要求已安装 workspace 依赖和同一版本的构建产物；无需 Provider CLI、登录状态、Bot 凭据、测试群或网络。
- IM Context 未设置 `OCTO_CHANNEL_QA_ACCOUNTS`，或将该值指向不存在的路径时，离线模式仍应通过，因为它不读取账号文件。
- 成功输出一行 JSON：`{ "check": "startup", "script": "<脚本文件名>", "adapters": ["<已注册类型>"], "cleanup": "complete" }`，退出码为 0。该输出不是 live 成功结果，不包含账号、提示词或凭据。
- 缺构建产物、缺导出、构造/注册/清理失败均返回非零并保留原始诊断；不能捕获异常后仍输出成功或以 skip 代替失败。
- forwarding 的原生 `--check-endpoint <receiptPath>` 子命令保持独立行为；与 `--check-startup` 同时出现时，在任何联网前明确拒绝，不能因参数顺序触发实网请求。
- PR #278 复审补充：forwarding 只接受空参数、单个 `--check-startup` 或精确的 `--check-endpoint <receiptPath>`。未知、重复、缺失或多余参数在加载执行器/联网前失败。回执必须是调用方私有 `octo-codex-forwarding-*` 临时 cwd 中的绝对 `receipt.json`；独占打开成功后才请求固定端点，拒绝已有目标及符号链接。该约束不承诺同账号恶意进程之间的沙箱隔离。
- IM Context 的旧 `--delivery` / `--delivery-disconnect` 拒绝逻辑继续有效；与离线参数组合也不得绕过该拒绝。现有合法 live 参数不改变含义。

### 3. 手动离线回归入口

在本任务目录增加 `verify-startup.mjs`，显式执行三个实际脚本的离线参数，不复制它们的装配实现：

```bash
node .octospec/tasks/159-live-script-executor/verify-startup.mjs
```

- 使用 `process.execPath` 和绝对脚本路径启动独立子进程，工作目录固定为仓库根目录，每个进程设置有限超时（15 秒）并收集 stdout/stderr、退出码和 signal。
- 子进程移除 Provider/Octo 凭据及 QA 账号路径，至少补跑 IM Context 使用不存在账号路径的反例；保留操作系统运行和包加载所需环境。不输出原始环境变量。
- 子进程通过任务目录中的 Node preload guard 禁止 `fetch`、HTTP(S)/Socket 联网和 `child_process` 业务启动；先安装 guard 再加载实际脚本，ESM 内建导出须同步。触发禁止动作就抛错并使该用例失败。父进程启动被测 Node 属于测试编排，不在禁止范围。
- PR #278 复审补充：guard 同时禁止 `worker_threads.Worker`、`cluster.fork` 及 Node fs/fs.promises 的写入、创建、删除、元数据修改和可写 open，包含只读 FileHandle 上的修改操作；保留模块加载所需只读 IO。手动 runner 加入这些 API 的真实调用反例。保护对象是这里列出的 Node API，不宣称拦截原生扩展、内部绑定或主动绕过补丁的代码；不是 OS 沙箱。
- 只有子进程正常退出、JSON 回执匹配脚本名/Adapter 集合/清理状态，才计为通过；缺失导出导致没有回执时仍须直接报告原始模块错误。
- 覆盖 forwarding 冲突参数及 IM 已废弃参数的拒绝，断言非零并保留具体诊断，避免“任何失败都算通过”。
- 保留对两处旧导出来源的失败检出能力：离线参数必须实际走同一导入/装配路径，不能绕过默认路径中仍遗留的错误。代码审查核对该调用关系，`node --check` 或源码字符串扫描只作为补充。
- 脚本及 guard 放在任务目录，不匹配默认测试 glob；不接入 `package.json`、默认测试命令、GitHub workflow 或现有 job 的脚本链。

### 4. 保留真实验证含义

| 脚本 | 必须保留的当前有效行为与断言 | 真实运行前提 |
| --- | --- | --- |
| act-mode | 显式 `plan`、`default`、省略模式的三轮；原会话续接字段；`MODE_PASS`；`run.completed`；模式 applied/effective 及省略时无模式证据；拒绝意外交互 | 指定 Provider 已安装并认证；记录实际 Provider、模型及版本 |
| Codex forwarding | 原生工具执行指定只读命令；回执 endpoint/status；随机 marker 回传；至少一个工具完成；完成终态；无旧 executionFeatures 字段；临时回执清理 | 已认证 Codex；原脚本固定公开 HTTP 端点可达；不是向 IM 发信 |
| IM Context | 当前默认 Context 构造断言，以及 `--dynamic-contexts` 的指令、单次加载/调用、结果 marker；保留 logging/lifecycle 等既有断言 | `im-test` 两个 QA Bot、现有隔离群、`octo-cli`；动态上下文另需已认证 Codex |

不以离线回执、纯 mock、缺环境的跳过或独立 `--check-endpoint` 成功替代这些 live 断言。IM Context 不恢复 PR #262 删除的 WS 业务发送/未知通知场景。forwarding 固定只读 HTTP 探测与 IM Context 的测试环境分别记录，不混称真实 IM 验收。

## 范围外

- #120 的双协议 `invokeFrames` 旧签名与 retry 的 `runtimeLimits` 旧字段。
- 生产 Core/Kernel/Adapter/Extra API、协议能力、重试、模式策略或会话策略变更。
- 为恢复脚本引入 KernelService、IPC、worker、兼容 alias 或新 Provider 能力。
- 扩大 GitHub CI、默认测试或必需检查；提交、推送、PR、合并和发布不在本次写 spec 授权内。
- 将非 macOS 或未运行的 Provider/模式/IM 分支表述为本轮已验收。

## 验收

以下为已认可的验收计划；实际执行结果以 [validation.md](validation.md) 为准。

| 编号 | 可观察条件 | 证据 |
| --- | --- | --- |
| A1 | 三个实际脚本加载、构造并注册预期 Adapter，退出 0，关闭确认完整 | 手动 `verify-startup.mjs` 逐脚本回执和汇总 |
| A2 | 离线检查无需账号/Provider CLI，未触发网络或业务子进程，错误账号路径也不被读取 | 受 guard 保护的子进程结果及 IM 错误路径用例 |
| A3 | forwarding 冲突参数、IM 废弃参数在联网前明确拒绝；缺失导出等启动错误返回非零且保留诊断 | 手动检查的反例结果、同一装配路径审查 |
| A4 | 原有效 live 断言与原参数语义保留；新增离线输出不能混为 live 成功 | 相对基线的逐项 diff 和 code-review |
| A5 | live 的指定场景真实执行原断言，逐项记录通过/失败/阻塞/未运行 | `validation.md` 的独立 non-gating live acceptance 段落 |
| A6 | CI 范围及检查入口均未扩大 | `.github`、`package.json`、默认脚本链及实际检查列表对照 |

实施先使用 Node.js 24、pnpm 11，运行：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node .octospec/tasks/159-live-script-executor/verify-startup.mjs
pnpm lint
pnpm lint:names
pnpm exec prettier --check scripts/verify-actmode-live.mjs scripts/verify-im-context-live.mjs scripts/verify-codex-forwarding-live.mjs .octospec/tasks/159-live-script-executor/*.mjs
python3 .octospec/scripts/lint.py
git diff a5a32835882deab5e2364b559dd06bf1675c1335 -- .github package.json
```

没有生产 TypeScript 或跨包合同变更时，构建及手动启动验证是主要运行证据；若实现扩大到这些位置，应重新审查范围并执行相应 typecheck/相关回归，不借此扩大 CI。

具备环境时，独立执行并记录：

```bash
node scripts/verify-actmode-live.mjs
node scripts/verify-codex-forwarding-live.mjs
OCTO_CHANNEL_QA_ACCOUNTS=/protected/path/to/qa-accounts.md node scripts/verify-im-context-live.mjs
OCTO_CHANNEL_QA_ACCOUNTS=/protected/path/to/qa-accounts.md node scripts/verify-im-context-live.mjs --dynamic-contexts
```

`validation.md` 绑定实际 SHA/dirty、时间、平台、Node/Provider 版本、脱敏命令、逐项结果及清理事实。A1-A4/A6 是本地实现验证；A5 独立报告。缺真实环境写 `BLOCKED` 和缺项，未运行写 `NOT RUN`，不宣称完整 issue 验收通过；已执行且失败的验证须按流程失败处理，不能当作环境跳过。

## 实施顺序

1. 在原 worktree 核对 brief 和当前基线，迁移两处导入，整理各脚本局部装配函数并增加离线分支。
2. 增加任务目录的显式手动 runner/guard，验证三个实际入口和参数反例；对照表保留所有当前 live 断言。
3. 构建、静态检查、手动离线验证；按环境执行独立 live 验收，分别归档结果。
4. 使用 code-review 执行仓库规范和规格双轴审查，修复本项问题并重验受影响检查；记录工作区和版本。提交及远端交付遵循已有授权；公开 commit/issue/PR 使用英文及规定 attribution。

## 已确认决策与剩余事项

已确认：修复当前两处残留、覆盖三个实际入口；沿用 Core 直接执行；保留 #262 已修复与已删除场景的边界；不处理 #120；不扩大 CI。

用户通过“开始实现”整体认可以下具体决策：

1. 使用三份脚本的 `--check-startup`，局部复用 live 装配，不增加生产 API。
2. 使用任务目录的显式手动 runner/guard 保证离线边界，不加入默认检查。
3. 将真实 live 作为独立验收记录；缺环境不伪装通过，也不据此宣称 issue 完整关闭。

没有未决实现选择。全仓文档检查的既有阻塞已由主线修复；用户已授权提交、推送和创建 PR，未授权合并。IM QA 环境仍未配置，保留为独立未验边界。

## 可执行性自评：97/100

需求与现状定位 20/20；职责与范围 20/20；装配与失败合同 20/20；离线验收可复核性 20/20；实网环境与交付条件 17/20。扣分来自真实 Provider 登录、Bot/隔离群和外网可达性尚未核验。评分表示规格准备度，不表示离线测试或线上行为已经通过。
