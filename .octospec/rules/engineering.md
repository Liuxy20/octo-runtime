---
type: Rule
title: Runtime 开发与验证约定
description: TypeScript、协议生成、进程通信与验证证据的维护要求。
tags: [typescript, protocol, testing, integration]
timestamp: 2026-10-20T00:00:00Z
id: runtime-engineering
tier: repo
priority: 80
load_bearing: false
inject_when:
  paths: ["apps/**", "packages/**", "scripts/**", "test/**", "test-support/**"]
  touches: [typescript, protocol, testing, integration]
source: self
supersedes: []
---

# Runtime 开发与验证约定

## 需求与方案的强制范围检查

每个新增或修改需求必须先执行[基础架构的产品意图归属检查](architecture.md)，在对应 brief 记录业务目标、决定权归属、显式输入、合同内动作、越界动作及对其他接入产品的影响。先由第一性原理判断是否属于 octo-runtime，再选择实现位置；不能从旧兜底或技术实现方便反推职责。

评审必须拒绝下列设计：基础层替产品决定模式/思考强度/会话生命周期；省略字段触发未经约定的体验策略；为上游错误在下游猜测补造意图；将单产品默认推广至 SDK、CLI 和其他 Extra。明确合同内校验、原生映射、权限、资源并发保护及真实故障处理仍由各执行模块承担，但不能以这些技术责任为由改变业务意图。不得要求宿主理解 Provider 私有参数来弥补 adapter 未接线。

本要求是架构与评审约束，不宣称自动化检查能够识别全部职责越界。发现越界应修改方案和责任归属，而非仅添加风险说明或测试后保留越界行为。

服务装配或进程生命周期需求还必须执行[统一原生服务原则](architecture.md#统一原生服务构造与部署边界)的拓扑、所有权和公共 API 检查。功能通过不能替代架构通过；CLI 服务进程和 Electron 主进程必须直接构造对应服务，严禁外部 Node 代启。库内以 CLI 直接加载共同 SDK、实际 PID/socket 和包外 SDK 类型及行为为主要证据；外部 Electron 集成独立跟踪，不作为库内改造前置条件，不以增加测试数量豁免架构问题。

## 工程与验证要求

- 使用严格 TypeScript ES modules，不显式使用 `any`；类型引用使用 type-only import，错误必须显式处理。
- 核心实现及接入使用代码必须遵守下文的核心代码注释要求；该要求覆盖全部公共执行层及 Extra。
- `pnpm build` 将源码 Git commit 与 dirty 状态写入 CLI 的 `dist/build-info.json`；版本命令及根帮助展示构建时的 `commit:<12 位短 SHA>`，未提交修改标记 `(dirty)`。发行物保留此元数据，运行时不查询用户当前目录的 Git；缺少 Git 来源时显示 `commit:unknown`，不得伪造为干净提交。
- 同一文件的 `buildTime` 为构建流程捕获的 UTC ISO 8601 时间，帮助和版本显示 `build:`；旧或无效元数据显示 `build:unknown`，不得用运行、安装或 commit 时间代替。发行矩阵共用一次构建会话时间；同版本恢复必须校验并复用原发行物时间，仍以完整 archive integrity 阻止不可变版本内容漂移。
- 协议 wire types 从 JSON Schema 生成。修改协议时同步 schema、生成类型、样例、调用端及测试，不手工只改生成文件。
- CLI/SDK 到 Kernel 使用 Unix socket / Windows Pipe 上的 NDJSON JSON-RPC 2.0；Kernel 到 worker 使用 stdio NDJSON JSON-RPC 2.0，独立 Node IPC 承载主循环心跳。Extra 生命周期由调用进程中的原生服务管理，业务依赖同进程直接调用；可选 controlEndpoint 仅查询状态，不代理依赖、不代启服务。具体形状见 [本地传输合同](local-execution.md)。Provider 差异封装在 `octo-runtime-adapter-*` 内。
- 自动化测试使用 fake Provider，不调用真实模型。真实接口调试连接 `https://im-test.deepminer.com.cn/`，分别记录自动化检查与实际联调结果，不把 mock 结果当作线上证据。
- 按改动范围运行 `pnpm lint`、`pnpm typecheck` 和相关测试；跨包合同变更运行 `pnpm test`。纯文档改动检查 OKF 格式、索引与链接，无需触发真实模型执行。
- 生命周期测试从合同事件开始计时：进程启动/握手、失联发现、退避和清理分别对应各自预算；fixture 的人工延迟须放在被验证的真实预算内。子进程写出 PID 不等于父进程完成身份登记。
- 跨进程 fixture 先确定本次结果再发布通知，避免观察方恢复环境反过来改变已记录的尝试。启动拒绝须保留原始 cause 和完整聚合清理事实，不能吞掉后只报轮询超时；重复验证须在任一次失败时立即失败。
- 修改 Run / Context 协议后，同步构建 Worker、Runtime 和桌面应用，重启受影响的本地进程，验证内置运行时注册及执行。仅完成全局链接不算重启验证。
- UI 或真实桌面接口变更，还须通过 CDP 驱动真实 renderer，对着线上测试环境验证；具体方法遵循生态根目录的开发约束。
- 凭据从受保护配置读取，不进入知识文件、模型上下文、日志、截图或提交。Provider workdir 不代表操作系统安全隔离。

## 核心代码注释要求

- 覆盖 Executor Core、Executor Kernel、Host SDK、公共传输/进程管理、Extra 核心流程及接入示例。新增或修改这些位置时，须检查并同步补齐关键注释；评审将缺失或失真的关键合同注释视为需修复项。
- 公开接口和主要入口用就近的中文 JSDoc 说明职责、必要输入、返回结果含义、调用顺序及资源所有者；接入示例须说明谁负责取消、消费尾流、业务收尾和关闭。类型已表达的字段不逐项重复。
- 复杂状态转换、跨进程 JSON 边界、身份/代次校验、实际在途额度、取消与超时竞态、恢复与重放限制，用短注释解释原因和不可破坏的条件。明确区分接纳 ACK、取消 ACK、执行终态、业务投递确认与资源清理完成。
- 注释必须与实现及可验证保证一致；行为变更同步更新，禁止承诺无法保证的后代回收、幂等、内存上界或重载行为。引用历史任务不能代替当前行为说明。
- 不要求逐行注释、机械翻译代码或给显然的赋值加说明；优先帮助 AI 和人类判断为何这样做、如何正确接入，以及失败后还能否重试。

## 稳定版单 registry 交付

- 源码保持 `0.0.0`；稳定 annotated tag `vX.Y.Z` 注入发行版本。完整 CI 验证的同一份 tgz
  只发布到 npm 官方仓库 `https://registry.npmjs.org`，并作为 GitHub Release 附件，不走 stage/审批转正。
- npm 使用 `NPM_TOKEN` 与 provenance；不发布、查询或回退到 GitHub Packages，不请求
  `packages` 权限。GitHub Release 是附件交付，不是另一个 npm registry。
- npm 已有版本必须匹配完整 SHA-512；恢复时只从 npm 验证并复用已发布归档的源码
  commit、clean 标记和构建时间。鉴权或网络错误不得当作缺包，上传后的可读性检查必须有界。
- 版本专属 dist-tag 不等于预发布流程。npm 与 Release 资产字节一致的最高完整稳定版自动
  推进 latest；两端已有稳定版 latest 都是不可回退的下界。RC 等预发布不进入候选集，不改 latest。
  dry-run 零远端写入。


## 历史密钥扫描的验收

- 历史告警逐条核验来源及实际用途，仅对有依据的非秘密内容添加原始 `commit:file:rule:line` 精确例外。
  待确认项和未处置真实凭据继续阻塞；禁止目录、字段、整个提交或检测规则的宽泛豁免。
- 固定基线 SHA 和 refs，临时仓库保留原始历史使例外实际生效，再新增非功能性 canary，
  验证原路径、原行号及邻近行的新密钥模式仍被完整历史和 PR 扫描拦截。
- 本地验证与托管 CI 分别记录；操作步骤和例外依据见
  [CI 指南](../../.github/CI.md#secret-scan历史告警与精确例外)。

架构与协议版本的约束以 [基础架构](architecture.md) 为准。本文件是开发要求，不表示上述所有链路在本次变更中均已验证。
