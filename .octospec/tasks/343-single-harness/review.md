---
type: Review
title: Issue 343：所有权与复用合同复核
description: 对照用户要求及现行规则复核实现，并记录已修正问题和验证范围。
tags: [architecture, adapter, lifecycle, testing]
---

# 复核范围

2026-11-09，本机 macOS arm64、Node.js 24.22.2、codex-cli 0.164.0。初始实现者自查基线为 4d7e272d；本轮已 rebase 到 origin/main 与 HEAD 同指向的 bf665881095690fdfe3d2aca5796ca9f18e53bd0。

单实例阶段范围为 `git diff HEAD --` 加全部未跟踪文件，共 34 个文件（25 个已跟踪变更、9 个未跟踪文件）。追加文档与源码接入决策后的复核见本文末尾。生成目录和依赖不在范围内，未因文件大小缩减覆盖。独立 Standards/Spec Agent 执行 code-review 两轴，主 Agent 串行执行 verified-review 的逐行、候选过滤和运行验证。

大改动先固定不变量再逐文件审查：CLI 类型唯一；owner 单进程；AgentEnv 原样传给 Adapter 并由其读取 bean，不恢复 agentConfig 或配置投影；逐线程隔离；活动路由及时释放；取消/恢复/回收保留真实归属；不重放；不扩大 CI。追踪 CLI 工厂回滚、Engine acquire、共享 stdio、线程 ACK、交互及调用方测试和文档。

# 已修正问题

- 配置分池违反同类型默认单实例要求。删除配置键和 service Map；owner 只保存一个 service，cwd、环境、MCP、模型、容量和流设置均不参与进程选择。
- 原八活动 channel 和启动等待人数限制妨碍复用。删除这些接纳门槛；所有调用等待同一次启动，取消只解除自己的等待。
- 累计 4096 个 thread 后拒绝新 thread，以及全进程 4096 条交互配额，同样越过宿主的资源决策边界。删除配额拒绝和 #usedThreads 历史集合。临时路由随调用释放，不保留已结束 thread 或业务 session 映射；无 turnId 交互仅根据本调用是否创建新 thread 判定，resume 明确拒绝。补充同 owner 和外部 owner 的 resume 反例。
- 实现过程中自行引入 maxRetainedBytes 和每 lease 16 KiB 估算，缺少需求依据。用户指出后已完整删除实现、公开配置、错误码及相关设计条文，不以估算内存限制并发 Agent 数量。
- 共享发送器原八条控制消息预留会使百路同时取消触发连接失败。复用中央队列条目数 4096，保留当前 main 普通 64 MiB、控制 64 KiB 的传输容量和背压语义；百路取消专项验证全部真实终态与服务存活。
- 单进程不再能通过请求私有进程环境向 MCP 传值。改用原生 thread 的显式 stdio env 和 HTTP http_headers；保留原生 MCP 专用 env 优先级、命名冲突拒绝和平台环境变量合并规则。
- 并发输出断言原先用字符串 includes，不能严格排除相邻编号串线。改为逐调用比较完整 completed message 文本。
- #339 回滚测试的两个示例工厂原来声明相同类型。按新通用唯一装配合同改为不同类型，使测试继续覆盖第二个工厂失败后的资源回滚。

# 合同检查

CLI 在已声明类型重复时先于 import/工厂拒绝；未声明类型需构造后校验，并先登记资源用于回滚。此约束只适用于 CLI 装配，不向 SDK 增加通用 Engine 基类，也不改变其他 Adapter 的逐轮执行模型。

共享进程 argv、环境与启动目录只取 owner 输入；每轮配置经 thread/turn 传递。低层 buildCodexCommand 仍用于显式独占命令构造，managed owner 不调用它。逐轮 codexServiceRevision 明确拒绝；账户隔离由宿主显式建立独立 owner。

共享 RPC ID、thread/turn 关联、交互归属、同 thread 忙检测、旧代隔离、不重放、先回收后恢复和 owner 最终关闭沿用原有实现。Kernel/Adapter 只能释放自己的 scope/lease。doctor 将 Kernel 和 app-server 列为 CLI Host 拥有的平级资源，Kernel 标明 in-process，不增加虚假 PID。

单实例阶段相对目标分支的 .github、package.json、scripts 和 pnpm-lock.yaml 无差异；追加源码接入阶段仅移除两条 Adapter exports 并迁移既有发行检查入口。专项仍在 test/manual 显式执行，未增加默认 selector、工作流或检查依赖。测试证据及未覆盖平台见 [验证记录](validation.md)。

# Standards 轴

确认 1 项 medium，已修复，证据为 reproduced；最终独立复审无剩余 medium 及以上问题。

**S1：原生专项的 JSON 回执未完成即对读取方可见。** 新增 `test/manual/343-single-harness-live.mjs` 子进程原先直接写最终文件，父进程只重试 ENOENT；文件创建到写完之间读到空内容会让验收报解析错误，违反 engineering 的原子发布规则。

当前修复原文：

```js
fs.writeFileSync(process.argv[2]+'.tmp',JSON.stringify({value:process.env.AGENT_VALUE,own:process.env.MCP_OWN}));
fs.renameSync(process.argv[2]+'.tmp',process.argv[2]);
```

临时探针对实际生成的脚本放大文件创建至写完窗口 150 ms。`node /tmp/octo343-review-receipt.mjs` 修复前退出 1，报 Unexpected end of JSON input；修复后同命令退出 0，目标首次可见即完整。日志 `/tmp/octo343-review-receipt-before.log`、`/tmp/octo343-review-receipt-after.log`；临时脚本不提交。同类扫描发现既有 `test/codex-envs-live.test.js` 也直接发布，但其读取捕获解析错误，未复现同样失败；仍统一 tmp+rename，不改变 live 开关或默认跳过行为。

# Spec 轴

确认 1 项 medium，属同类既有缺陷，已修复，证据从 read-confirmed 升为 reproduced；最终独立复审无剩余 medium 及以上问题。

**P1：无归属的早到通知跨调用残留。** `service.ts` 原先仅在匹配 thread ACK 或进程结束时释放 #early；最后一个 thread/start 结算后，无法归属的通知仍占据 128 项缓冲。下次正常调用的合法早到通知触发 CODEX_SERVICE_ROUTE_BUFFER_EXCEEDED，导致共享连接失败，违反临时路由释放与无历史状态合同。该问题在 main 已存在，按用户同类问题 autofix 要求修复。

当前修复原文：

```ts
const abandoned = [...this.#early.values()].flat();
this.#early.clear();
this.#earlyBytes = 0;
this.#earlyItems = 0;
```

`#discardUnclaimedEarly()` 仅在没有待决 thread/start 时执行，覆盖响应、写失败、撤销写入和 release；先清空，再拒绝其中孤立反向请求。手动回归首次收到 128 条无归属消息，第二次收到合法早到通知。命令 `node --test --test-name-pattern='unclaimed early' test/manual/343-single-harness.test.mjs` 修复前退出 1，第二次调用 run.failed；修复后退出 0，两次 run.completed、孤立请求被拒绝且仅启动一次。日志 `/tmp/octo343-review-early-before.log`、`/tmp/octo343-review-early-after.log`。同类扫描未发现其他已完成 thread 历史缓存。

# Rebase 与运行发现

main #344 删除旧输入，改为 AgentEnv 直传。本轮解决 9 处冲突，更新 Adapter 的 bean 读取和相关调用方测试/示例；没有 agentConfig 兼容层，没有恢复配置池或配额。当前专项 120 项通过，全量 1455 通过/61 跳过；真实 100 个并存 thread 只启动一个 app-server，环境/MCP 隔离且最终回收成功。完整命令见 validation。

零模型原生 resume 补验确认初始 MCP 已连接且工具为合成 value_first；已加载和 unsubscribe 后 resume 均返回 -32600 no rollout found。临时 thread 未产生可恢复 rollout，因此本轮无法证明 resume 替换或移除环境/MCP 的真实效果；不将受限探针视为产品缺陷。独占 Home、进程和探针已清理。三轮真实模型结果属于旧基线，不能代替此项验证。

两个轴最终各有 1 项已修复 finding、0 项未解决 medium 及以上问题。没有提交、推送或修改用户服务；真实吞吐和平台未验范围见 validation。

# 文档一致性与源码接入追加复核

用户明确删除 `/adapters/codex`、`/adapters/dsh` 聚合导出，纯原生统一源码 workspace 按需接入，并要求 docs 写清 CLI + 独立 client 的另一场景。追加后的完整范围为 106 个文件（含未跟踪任务和专项），仍以 bf665881 为基线。对 package exports、调用点、源码依赖图、现有发行验证、双语 docs、包 README 和规则进行双轴独立复核；主 Agent 运行实际打包和消费者验证。

- Spec 轴确认 1 项 medium 文档遗漏，read-confirmed：client README 仍要求创建服务或直接 Core 必须依赖 CLI 全量包。已改为源码 Kernel/Core、公共辅助包及所选 Adapter，并补中英文场景链接；独立复审确认闭环。
- Standards 轴确认 1 项 medium 同类文档遗漏，read-confirmed：Adapter 编写指南和 metadata 规则仍将 CLI `/adapter-sdk` 聚合路径作为原生 authoring 接入建议。已统一源码 workspace 包，并明确 private 包不独立 npm 发布；独立复审确认闭环。
- 同类扫描修正 Core 的旧配置解释职责、Kernel 的取消与 Provider 所有权、DSH 唯一公开 Adapter、SDK 旧 workdir 字段和部署入口旧发行包接入说明。历史任务保留明确历史归属，不冒充现行设计。
- 运行发现既有发行检查把全部 docs 示例复制到仅安装 CLI 包的目录；源码 import 迁移后真实编译报 TS2307。现有文档编译与执行改为源码 workspace，保留发行物通用公开 API fixtures；同命令重验通过，没有新增检查项或 CI 依赖。

源码公共层无 Codex/OpenClaw/DSH Adapter 反向依赖，所选 Adapter 的依赖图未强制引入其他 Adapter。CLI 继续携带并加载自己的 manifest 装配项，client 不携带 Adapter；模块选择和进程首次调用启动分别描述。helper 注释准确声明泛型不做运行时校验、缺失 undefined、返回原引用和 Adapter 校验责任。

最终无剩余确认 medium 及以上问题。用户已授权 commit、push 并提交目标为 main 的 PR，明确暂不自动合并；交付动作完成后由 PR 记录提供最终标识。

# PR 345 首轮 CI 修复

首个提交 f85a7356 的 CI run 42626868888 六个矩阵均失败。四个 POSIX 构建矩阵在测试阶段报大量 Codex spawn ENOENT，两个 Windows 矩阵在 Playboard 原生 IPC 场景报退出和清理失败。根因是本次实现将 managed server 的 spawn cwd 设为 CODEX_HOME；本机 ~/.codex 存在掩盖了干净 runner 缺目录的问题。

该 finding 为 medium、reproduced。本机以不存在的 CODEX_HOME 运行既有 actmode/Playboard 场景，修复前同样失败。最终 managed spec 不设置 cwd，spawn 自然继承宿主目录；可选类型及 service 传参同步更新，独占低层命令仍保留显式 cwd 合同。CODEX_HOME 的显式配置 → 服务环境 → ~/.codex 顺序不变；thread/start、thread/resume、turn/start 仍使用本次 invocationWorkdir。

新增手动回归验证缺失 CODEX_HOME 不妨碍 fake server 执行、不创建数据目录、spawn options 无 cwd 属性；100 路回归仍确认单进程及逐调用目录。旧相对可执行文件回归改为从宿主目录解析夹具，仍覆盖文件替换不重启 owner。架构规则、设计及中英文 README 同步更正，不改变 CI 范围。远端最终结论另行读取，不用本地通过冒充 CI 通过。
