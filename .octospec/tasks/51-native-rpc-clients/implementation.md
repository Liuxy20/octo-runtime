---
type: Implementation
title: Issue 51 Go/Python 原生 Client 与 playboard 实施记录
description: 当前 Go/Python 完整 SDK、包内示例、Rust 移除决定及各阶段真实验证记录。
tags: [protocol, schema, native, ipc, testing]
timestamp: 2026-10-24T00:00:00Z
---

# 当前交付范围

Go 的 codec、lifecycle、transport 三份单测进一步合并为 `client_test.go`，保留全部 10 个顶层测试，合并后 `go test -race ./...` 通过；SDK 不再有独立 transport 实现文件。`pipe_windows.go` 仍是既定的 8 行 Windows API 绑定，自动编译选择，不由使用方挑选或复制。

按用户最新要求，每语言只保留一份生成源码和一份手写实现，codec、生命周期及 transport 全部合并。Python 为 `octo_runtime_generated.py` + `client.py`，`__init__.py` 仅导出公开 API；Go 为 `octo_runtime_generated.go` + `client.go`，另有 8 行 `pipe_windows.go` 自动绑定 Windows 专用 API。删除独立 rules、transport、codec、lifecycle 等源码文件；同一份完整 SDK 源码全平台使用，使用方不选择或复制平台文件。SDK、demo 和相关代码注释改为英文，保留核心所有权及取消竞态说明。

合并后两语言各完整重跑 45 项测试通过，含每语言 354 条协议样例、仓外安装及包内 demo；生成文件改名、Python 实现迁入 client.py 后再次重跑相同套件。Python wheel 断言仅含 client.py、octo_runtime_generated.py 和薄导出 __init__.py，并验证两种公开导入得到同一 Client。Go race 在合并后通过；Python 七项单测和生成器两项回归在迁移后通过。Linux/Windows amd64 全模块交叉编译通过，仅为编译证据。生成源码 2 文件、1959 行；手写实现 Go 1966 行、Python 1218 行，Go 平台适配另 8 行。

2026-10-24 用户最新决定：仅交付完整 Go/Python SDK，移除 Rust SDK、demo、emitter、生成源码、Cargo 锁和工具链要求。生成仅需 Node/gofmt，检查仅需 Node；manifest 当前包含 2 个生成源码。两套示例就是各自语言包中的普通文件：Go 的 `examples/demo_playboard.go`、Python 的 `demo_playboard.py`，不另建 demo 工程。Native 不接入 GitHub CI。当前验收范围见 [brief](brief.md) 和 [plan](plan.md)。

下文三语言、Rust 工具链和旧 CI 结果保留为历史。历史结果不意味着当前 Rust 支持或完整跨平台验收已完成。

本轮 Go/Python 完整本地套件各 **45 项通过、0 失败、0 skip**，每语言 **354 条协议样例**，覆盖改名后的包内 demo 及仓外消费。Go race、Python 七项单测、生成器两项回归及生成产物完整性检查通过。生成源码头部直接记录 octo-runtime Schema commit、Schema/生成器 SHA-256；manifest 另外记录生成器 commit，未提交目录不冒充已固定版本。

yujiawei 报告的无 rg 测试失败已修复：非 Git fixture 先解析真实临时目录，再移出所有 Git 祖先，兼容 TMPDIR 在 checkout 内和 .git 文件式 worktree。默认环境与 TMPDIR/TMP/TEMP 均置于真实 worktree 内分别 **9/9 通过**，子进程 PATH/Path 清空；新增回归覆盖嵌套临时目录。生产扫描的 Git ignore 保护保留，CI 已安装并文档声明 ripgrep。

命名测试修复后、源码合并前，完整 `pnpm test:suites` 通过：Node 1746 项中 1706 通过、40 个既有 skip、0 失败；UI 35 项通过。源码合并不修改 TS 实现；上文原生套件为合并后的重跑结果。完整 OKF 仍仅有下述四处既有 frontmatter 错误。

# 历史：移除 Rust 前的交付

2026-10-24 verified-review 四项修复：三语言首次 drain 的期限约束此前控制任务及排队取消，不在截止后新增 cancel，未确认执行仍保留 unresolved；Go 接收器按实际字节检测无 LF 超限并复用读缓冲，Context 预算扣除 Go 对 U+2028/U+2029 的额外转义；Python 在 codec、identity、RPC、执行环境和订阅入口统一省略 UNSET，显式 null/零值及 opaque 数字保持原义。SDK 核心入口和取消/超时分支补充中文所有权、返回值及失败边界注释。本轮没有修改生成产物或新增 native CI。

新增确定性回归：真实 Kernel/fake Provider 下占满四个取消额度，drain 返回后才放行 ACK，三语言均只发出四次 cancel，第五次在队列中过期；重复 drain 复用首次结果。Go net.Pipe 验证 `lineBytes+1` 且无 LF/EOF 时立即返回 HOST_FRAME_TOO_LARGE，并覆盖边界及尾行；共享协议验证两种 Unicode 标量、字面转义和 65,536 字节 ±1 边界。Python 单测覆盖公开 encode/rpc、identity、环境参数和不修改原输入。

本轮本机 macOS arm64 三语言完整本地套件各 **45 项通过，0 失败、0 skip**，每语言 **354 条协议样例**，包含 demo 与仓外安装消费。Go 1.25.0/1.26.1 race、Rust 1.85.0 全 target 单测及 1.98.1 Clippy、Python 3.11.16 七项单测、生成器两项回归及九个产物 hash 检查通过。Linux/Windows 实机、真实 Provider 和全量 TS 套件未在本轮重跑。

此前核对 yujiawei 在 [PR 评审](https://github.com/Mininglamp-OSS/octo-runtime/pull/129#pullrequestreview-5638240688) 的四项意见：命名检查及测试与 main 基线相同，八项测试和本机命名检查通过，现有 CI 已声明安装 ripgrep；Gemini 调用失败是评审覆盖限制；Rust 本地编译/测试证据如上，遵守用户要求不恢复 native CI；生成流程及 manifest 已固定输入/生成器/产物 hash。当时生成代码增量为零，约 1.84 万新增行并非全为生成代码。随后复现命名测试的环境隔离缺陷：当 TMPDIR 位于 Git worktree 内且 PATH 清空时，测试 fixture 会被判断为 Git 工作树，八项中七项失败；默认环境通过不能排除此问题。此缺陷现已修复，结果见本页当前交付记录，不能以与 main 相同认定不存在。

OKF 全量检查未通过：四处既有文件缺 YAML frontmatter，分别为 systemd-directive-paths 的 brief/review/journal 和 `2026-10-24-124-sass-build-fix.md`。本轮修改的任务记录无新增错误；未改动这些无关文件。

第二轮精简：三语言共用去重规则图，等价校验节点由 1,067 减至 597；Rust union 的分支绑定改为单份宏实现，保留全部公开类型、变体及整数/opaque 数字语义。当前 native:check 只需 Node，manifest v2 对输入、生成器及各产物字节做完整性检查；重新生成仍明确要求 gofmt/rustfmt，完整生成一致性另由测试验证。新增空 PATH 检查、不同数值约束和递归引用去重回归；未接入 native GitHub CI。

2026-10-24 此前范围：保留完整三语言 SDK 和 demo；删除复制客户端的模板，客户端/生命周期在各语言包只维护一份源码。模型只生成公共根及类型依赖，验证专用节点保留在规则表；Rust 校验器使用与 Python 共用的规则 IR，替代逐节点展开函数。Native 的 GitHub Actions job、CI Gate 接入、Gate 负例测试和根格式检查接入全部删除；只保留按需本地验证。下文的模板/CI 结果是此前实施历史，不构成当前交付要求。

PR 复审的两项缺陷已修复：Python Unix 关闭会中止未发送缓冲，避免超时或 client.close 无限等待；Rust union 在绑定前按 schema 选择分支，完整保留 message/tool/interaction subject 的 id。新增真实非读端缓冲阻塞测试，以及 ActivitySubject、嵌套 activity、三类 HostFrame、MCP 和不透明数字的类型往返测试。

精简后本机 Go race、Rust 全 target 单测、Python 6 项 transport 单测、生成器确定性/漂移回归通过；三语言真实 Kernel/fake Provider、demo、包外消费完整套件各 44 项通过，每语言 347 条协议样例，零失败/跳过。Linux/Windows 不据本机结果宣称通过。此前托管矩阵的结果仅属于旧版提交。

Go、Rust、Python 三套原生客户端和 playboard demo 均位于当前 worktree 的 `native/`，按用户最后的要求不使用外部 demo 仓库。统一支持 status/list、输入 JSON 或 prompt、native/canonical 流、原回执、get/subscribe、取消、两类回复、等待人工回答和显式回答文件。

代码入口：[Go](../../../native/go/examples/demo_playboard.go)、[Python](../../../native/python/demo_playboard.py)（Rust 示例已移除）。统一操作见 [demo README](../../../native/examples/README.md)；生成和 SDK 所有权见 [native README](../../../native/README.md)。

工作树 `codex/51-native-rpc-clients`，基线 `445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`。未 commit、push、创建 PR、发包或关闭 issue。规划 96 分仅指可执行准备度，不是实施完成比例。

# 代码审查修复

本轮六项审查问题及 Rust 同构取消路径已修复，新增确定性 ACK barrier、整数 token、分块大行及 Windows 最终回收回归，见[修复记录](review-fixes.md)。下面的六工具链 39 项是初始实施历史；修复后的验证单独记录。

后续复审四项已修复；按用户要求把 Python Windows/Unix 异步传输统一在 `transport.py` 内，删除独立 Windows 模块，SDK 包和公开导入入口不分平台。具体回归及证据仍统一记录在上述修复记录中。

# Main 同步与 PR 交付

用户明确授权提交、同步最新 main、创建 PR 并合并，包发布仍未授权。分支已 rebase 到 `main@8214292`，知识目录/变更记录保留双方条目，发行测试同时保留 main 的 Windows 40 秒超时和 native CI Gate 依赖，新增 setup-go 沿用 main 的固定 v7 SHA。

同步后重新安装锁定依赖并构建、类型检查通过；Node 全量 1745 项中 1705 通过、40 个既有 skip、0 失败，UI 35 项通过；三语言完整原生套件各 44 项通过，均含 347 个协议样例及各自 demo/包外安装。生成漂移、lint/names/docs/format 检查通过。首次本机全量测试误与清理构建并行，产生缺少构建产物的失败；上述最终结果为构建完成后的独立重跑。

英文 [PR #129](https://github.com/Mininglamp-OSS/octo-runtime/pull/129) 已创建。首个托管扫描把 Python 的两个 Schema 字节/长度约束名误判为 generic-api-key，局部变量改名为 extension 后重扫。主分支保护要求 CI Gate 成功及一位 reviewer 批准，管理员同样受约束，仓库未开启自动合并；远端合并状态以 PR 为准，不以本记录代替 GitHub 确认。

# 实测结果

本机 macOS arm64，每语言最低/当前工具链分别执行 `native/tests/run.mjs --language <language>`，每格 **39 项通过、0 失败、0 skip**，含 339 个协议样例：

| 语言 | 最低工具链 | 当前工具链 | 包外消费 |
| --- | --- | --- | --- |
| Go | 1.25.0 | 1.26.1 | 标准 module zip → 临时 file GOPROXY → 空 module cache → 独立 CGO_ENABLED=0 binary |
| Rust | 1.85.0 | 1.98.1 | cargo package → 解包至仓外临时目录 → 编译 example |
| Python | 3.11.16 | 3.14.7 | sdist 构建 wheel → 新 venv 安装 → 仓外 demo |

包外测试客户端 `PATH=""`，Python 额外 `-I`、清空 PYTHONPATH 并核对 import 来自新 venv；三语言都实际 list、native/canonical 调用和原回执 get。服务由测试宿主启动，使用真实 Kernel/隔离 worker + fake Provider。

故障覆盖：原 invoke ACK 丢失只 get、不重提，无法确认时保留 unknown；两次订阅断线按原游标恢复；业务错误保留；cancel/两类 respond ACK 丢失不重发；重复 cancel 共享；观察结束不取消、兄弟客户端仍可查；drain 不新增订阅；真实杀死测试 worker 后 native/canonical 均报告 RUN_OUTCOME_UNKNOWN。

真实 Provider 单独执行 `native/tests/live-demo.mjs --endpoint <existing socket>`：Go、Rust、Python 各跑 Codex native/canonical，共 **6/6 正常完成**，每次又用原 ref 查到 completed。Codex 版本 `0.154.0`；测试宿主所安装 CLI 为 `1.1.3`、commit `fe19d3504315`、build `2026-10-22T15:06:34.025Z`，该 CLI 元数据不等价于额外证明服务进程加载的 commit。现有 Kernel instance 与各次回执见 [证据 JSON](evidence/macos-2026-10-24.json)。未启动/重启/停止现有服务。真实审批/追问和真实 Provider 取消尚未覆盖，自动化交互/取消不能代替这些结果。

其他本机检查：Go `go test -race`、Rust clippy/fmt、生成确定性/漂移/未知关键字失败、CI Gate 负例、TS lint/names/typecheck/docs/format 及相关协议/发行测试。TS 全量回归结果见证据。Go Windows amd64 交叉编译另记，仅为编译证据。Rust 的 url/idna 依赖已固定兼容 1.85 的后端，避免最新传递 ICU 把最低编译版本提升到 1.88。

# 验收追踪

“已有”表示列出的本机断言通过；凡有剩余项即不把该 A 项记为完整通过。

| ID | 已有证据 | 剩余项 |
| --- | --- | --- |
| A01 | 八方法、具体 params/result/envelope、真实 IPC | 全部强类型 union/allOf 构造器审计 |
| A02 | 339 样例及 TS 对照新增 6 样例 | InvokeInput/ModelInputPart 全字段逐分支等价 |
| A03 | 原 fixture、Go opaque/null roundtrip、可选字段代码 | 三语言完整三态 roundtrip 矩阵 |
| A04 | 原 fixtures，加 `1.0`/`1e0` 的 typed binding、RPC 与帧身份回归 | 所有整数槽位的完整边界组合 |
| A05 | RawMessage/serde arbitrary_precision/Decimal、Go 大整数测试 | 跨语言所有 opaque roundtrip 与 TS 数值差异专项 |
| A06 | strict Unicode codec 和部分样例 | byte relay 多字节拆包、CRLF 全矩阵 |
| A07 | 开放对象与严格 ref 的原 fixtures | 各业务边界扩展全量变体 |
| A08 | envelope 校验、未知错误注入 | malformed/raw-byte/batch 全矩阵 |
| A09 | 本机重复生成完全一致 | 三 OS 生成比较 |
| A10 | 变更小 Schema 的字段/方法生成测试 | 行为参数变更全分支断言 |
| A11 | 改/删/遗留文件、未知关键字无部分写入、Gate 负例 | 托管 CI 实际失败门禁证据 |
| A12 | 三语言仓外安装/运行、空 PATH | 跨平台执行 |
| A13 | lazy registry、真实 status/list/invoke | 消费前零连接独立计数 |
| A14 | native 正常终态、真实 Codex | text/image/env 组合完整捕获 |
| A15 | canonical 正常终态、worker lost | Provider failed/cancel 全部 canonical 组合 |
| A16 | ACK 丢失 invoke/start 各一次、原身份 get | 部分写入 byte barrier |
| A17 | acceptance unknown、身份/instance 错码 | 真实服务重启与 pending ACK 组合 |
| A18 | 两次断流、连续 seq、原 after_seq | 跨平台执行 |
| A19 | gap/expired/cursor 错码保留 | 真实 TTL/淘汰和恢复总预算边界 |
| A20 | 原 ref/instance 校验 | 每个身份字段 × 每个控制方法变异 |
| A21 | 实现 identity conflict | 重复 Run/RPC id 专项计数 |
| A22 | 写前取消代码 | status/connect/write 精确 barrier |
| A23 | 独立取消 admission 设计 | ACK pending + deadline + ACK loss 联合竞态 |
| A24 | cancel ACK 丢失 unknown、不重发 | 跨平台执行 |
| A25 | 观察关闭不 cancel、兄弟客户端可查；pending admission close/drop barrier | 100 次资源统计 |
| A26 | 两类回复、第二 CLI 回答、Codex 双通知一次回复 | 权限/过期/错 mode 全部反例 |
| A27 | 两类 respond ACK 丢失 unknown、不重发 | 同时取消竞态 |
| A28 | 真 worker kill、两种模式 lost | terminal 后帧、无终态 EOF byte 专项 |
| A29 | fast terminal 保存回执、独立 get | 缺历史与 after=latest 全组合 |
| A30 | 现有正常取消与 source 错误分支 | 精确同时发生的 barrier 矩阵 |
| A31 | 字节上界实现 | 两个阈值 ±1、partial write 原始字节证明 |
| A32 | 按需读、有限缓存实现 | slow-reader 高水位与兄弟调用压力 |
| A33 | 32/128/4 容量实现 | 全部真实饱和边界计数 |
| A34 | drain 完成、不增订阅、缓存首次 deadline | 16 paused streams、deadline 后 I/O 专项 |
| A35 | close/overlapped completion 实现 | Windows 实机及 100 次清理增长检查 |
| A36 | macOS 三语言最低/当前版本 | Linux/Windows 六个平台格子待 CI |
| A37 | macOS 六工具链格子和三种包外消费 | Linux/Windows 最低/当前版本 |
| A38 | TS 回归、18 格 CI 配置、Gate 负例 | 托管 CI 全矩阵及 npm 包门禁本轮实跑 |
| A39 | 三语言原生 demo 与中文 SDK/CLI 文档 | 双语用户文档及全部接入边界审核 |
| A40 | 三语言真实 Codex，native/canonical 六次完成 | 真实审批/追问与取消 |

因此本轮“各语言 demo 在 native 内实施并验证”的目标已经落地；整个 Issue 51 的 A01-A40、M0-M7 **保持实施中**。不以新增 CI 文件或本机成功代替未获得的平台/压力证据。

# 复用结论

- 快速终态可能先于消费者取 registry 发生；demo 必须持有原始调用 key，必要时用原 instance 的 get 保存 receipt，不能依赖 registry 永远存在。
- 原生 request 与 control.pending 可以描述同一次交互；回答文件按原请求 ID 去重，没有显式答案时等待人工输入。
- Go module cache 目录是只读的；包外测试用限定到本次临时 cache 的 `go clean -modcache` 清理，避免 after hook 失败阻断 Kernel teardown。
- Python Task.cancel / Rust Stream drop 不撤回已写出的 admission；登记需保留观察关闭事实，后到回执不能把 phase 错改成仍在观察。

完整 OKF lint 的三个 systemd-directive-paths frontmatter 缺失是基线问题，未修改无关文件；本任务新增记录单独校验。
