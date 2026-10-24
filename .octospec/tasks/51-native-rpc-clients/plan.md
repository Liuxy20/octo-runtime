---
type: Plan
title: Issue 51 Go/Python 交付执行计划
description: 两套完整原生 SDK、包内 demo、共享生成与本地互操作的执行和验收步骤。
tags: [architecture, protocol, schema, ipc, native, testing]
timestamp: 2026-10-24T00:00:00Z
---

# 当前范围

2026-10-24 用户移除 Rust，交付范围为完整 Go/Python SDK 和各语言包内的 `demo_playboard` 示例。删除 Rust 源码、emitter、生成产物、依赖锁与构建/测试入口；后续其他消费者可自行实现，不保留本项目 Rust 支持承诺。Native 不接入 GitHub Actions 或 CI Gate。

保留原里程碑编号便于追溯：`M0 → M1 → M2 → M3 Go → M5 Python → M6 → M7`；M4 Rust 已取消。用户已授权 commit、push、PR 和 merge，包发布未授权。历史三语言运行证据保留为历史，不算当前交付要求。

# 实施与退出条件

| 阶段 | 实施位置与动作 | 退出条件 |
| --- | --- | --- |
| M0 合同 | Protocol Schema/behavior、TS 权威 checker 与 fixtures；八方法 params/result/通知、InvokeInput 字段对照见 [contract-diff](contract-diff.md) | A01-A08/A39 合同部分可追溯；保持 IPC 1、Run 7、Context v3；不静默改变现有合法行为 |
| M1 生成 | `native/codegen` 只保留 Go/Python emitter；模型、规则、行为常量、RPC 由共享输入生成；客户端/生命周期各语言单份维护 | A09-A12/A37；2 个生成源码和 manifest v2，输入/生成器/各文件 hash 一致；重复生成字节一致，未知关键字与缺工具在写回前失败 |
| M2 联调 | `native/tests/run.mjs` 默认 all=go+python；共享 driver、TS fixtures、真实 Kernel/fake Provider、故障 relay | 每语言独立报告，缺工具失败；请求计数及 barrier 证明无重发；测试宿主回收自己启动的服务 |
| M3 Go | `native/go` 完整公共 RPC、lazy Invoke、身份恢复、取消、交互、registry/drain；包内 `examples/demo_playboard.go` | Go race 单测与共享套件通过；module zip 下载至仓外空 cache，独立 demo 在无 Node PATH 下调用真实 Kernel |
| M5 Python | `native/python` 完整 async SDK；所有手写代码及私有 Unix/Windows transport 统一在 `client.py`；`__init__.py` 仅导出；包内 `demo_playboard.py` | Python 3.11+ 单测与共享套件通过；wheel/sdist 独立构建，新 venv 隔离运行；UNSET/null、opaque 数字和取消完成边界保持 |
| M6 平台/包外 | 两语言 × macOS/Linux/Windows 六格；各语言最低/当前版本；显式真实 Provider 验证单列 | A31-A38/A40 有实际证据；交叉编译、API stub、skip 不算平台通过；未执行保持待验 |
| M7 交付 | SDK/示例 README、当前任务和规则、英文 PR；SDK 核心入口及竞态的英文注释；每语言 2 个实现文件及 1 个编译适配或包导出文件 | A01-A40 逐项证据；相关生成/文档/diff 检查通过；远端批准与合并状态以 GitHub 为准 |

# 执行命令

从仓库根目录执行。测试 Kernel 需要既有 TS 开发环境；已安装 SDK 的消费者不需要 Node、Schema 或生成器。

```sh
pnpm install --frozen-lockfile
pnpm build
uv sync --project native/python --frozen --python 3.11
node native/codegen/generate.mjs
node native/codegen/generate.mjs --check
node --test native/tests/codegen.test.mjs
(cd native/go && go test -race ./...)
uv run --project native/python --frozen python -m unittest discover -s native/python/tests -p 'test_*.py'
node native/tests/run.mjs --language all --evidence .tmp/native-evidence.json
```

两套 demo 的构建和启动见 [native README](../../../native/README.md)。`run.mjs` 使用测试宿主自己的临时服务；真实 Provider 使用独立命令，只附着用户指定的既有 Kernel：

```sh
node native/tests/live-demo.mjs --endpoint "$OCTO_KERNEL_ENDPOINT" --language all
```

真实调用会使用所选 Provider；已有文本完成证据不代替真实审批/追问和取消。不得为测试重启共享服务，证据不得包含输入正文、原始 Provider 载荷或凭据。当前未验证的平台和压力项见 [implementation](implementation.md) 与 [acceptance](acceptance.md)。

# 失败与回退

命令非零阻塞对应验收项；不得自动 skip 或把 unknown 解释成成功。RPC ACK 不确定时仅查询原身份，不自动重发副作用；首次 drain 总截止时间约束所有控制任务和排队取消。Windows 取消 I/O 后须确认 completion 才释放资源。

TS 改动限定于权威定义派生与必要校验；移除可选 native 包不改变 Home、配置或会话数据。SDK 不拥有 Kernel/Provider，不做业务副作用补偿。
