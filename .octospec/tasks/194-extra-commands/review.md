---
type: Review
title: Issue 194 verified-review
tags: [review]
timestamp: 2026-10-27T00:00:00Z
---

# 审查范围与方法

使用 verified-review 的串行双轨：先逐文件核对本次工作区新增/修改，再执行真实 CLI 与发行包验证。基线 main `a7c33b64064b8a54f59f70178873983ba143c1b3`，dirty=yes，macOS arm64 / Node v24.19.0 / pnpm 11.19.0。

初始审查范围包含 44 个文件（含本报告、验证记录及 journal）：CLI 路由/输出/帮助/存储、模块清单条目、Host SDK 合同、三个 Extra 业务命令与 package exports、主包公开转发、专项测试、双语指南及入口、OKF 规则和记录。每个文件单独检查；无锁文件、二进制或生成代码进入 diff，无跳过文件。编译/打包产物是验证对象，不是源码审查文件。

检查计划：

1. 路由与声明：追踪根/组件/嵌套帮助、宿主选项归属、字符串值与 `--`、保留名称、退出码。
2. 身份与存储：核对业务 imBotIdentity、旧字段保留、module 来源、CAS、写锁、取消与原子保存边界。
3. 导入与发行：核对元数据无服务加载、缺失导出/损坏依赖分流、公开类型及实际 npm 安装路径。
4. 凭据与文档：核对错误正文与输出、帮助是否标明凭据返回、CLI 与 SDK 责任，以及中英文示例一致性。

# 已复现并修复

- **medium / bug，apps/cli/src/extra-commands.ts，optionName / routeExtraCommand**：原先 `token.replace(/^--/, "")` 会把裸命令 `json` 当作宿主选项；调用 `loop-daemon json` 返回 2。改为只有 `--` / `-h` 才产生选项名。Tier: reproduced。回归 `A custom command named json is not mistaken for a host flag`，修前失败、修后成功。
- **medium / bug，apps/cli/src/extra-commands.ts，结果输出分支**：原先 `value.saved === true` 推断保存回执，导致合法业务配置包含 saved 字段时 config get 丢失 JSON 输出。改为 ExtraCommandResult.message 明确提供普通终端文本，value 始终按 JSON 输出。Tier: reproduced。回归 `config get always returns business JSON even when it contains a saved field`，修前 JSON.parse 失败、修后完全一致。
- **high / concurrency，apps/cli/src/state.ts，acquireProcessLock**：引入命令读改写时核对到旧锁初始化窗口和并发陈旧锁回收窗口；不得让回收者删除另一个新写入者的锁。初始修复拒绝未知 owner，并以独占 reclaim 目录+二次 owner 检查串行回收（此目录方案已被下方 PR 评审修复取代）。新锁窗口与多竞争者回收测试均通过；旧代码 `owner !== undefined && processAlive(owner)` 对空锁不能阻止进入（已用 HEAD 原始 state.ts 独立转译执行，空锁仍进入写入者；退出 0 表示缺陷成功复现，Tier: reproduced；临时模块已删除）。陈旧锁竞态路径为 read-confirmed，修后竞争验证通过。修后同时验证旧生命周期竞争测试，避免仅验证新命令调用方。

两个输出/解析复现记录：`/tmp/octo-194-review-repro.log`，当时 2 项均失败，失败属于产品边界复现。修后专项和全量通过；见验证记录。锁回收测试从进入事件控制排空，不以外部固定时间提前释放锁。

审查过程中还补齐未导出命令的旧包兼容、未知 handler 错误去私密正文、业务 JSON/回执显示分离与双语文档入口；最终不存在待修复的 medium 或更高等级发现。

# 运行证据与限制

`pnpm typecheck`、最终 `pnpm test:suites`（Node1898通过/54跳过、UI35通过）、lint/names、docs:check、格式检查均通过。实际 tgz 在仓库外 npm 离线安装，三个 Extra 及另装第三方包命令通过，公开合同 strict TypeScript 编译通过。完整命令、证据及未覆盖范围见 [验证记录](validation.md)。

不能将 fixture login 视为真实业务认证，初始 manifest 验收不能作为 #192 全局发现证据，不能将 macOS 通过视为 Windows/Linux 验收。初次审查未提交或创建 PR；后续用户已授权同步 main 并交付 Draft PR。

# 同步最新 main 的增量审查

交付基线 `f0bacb01590084523c21dc9996d05738c9a06a44`，包含 #195 文档和 #196 全局发现。知识目录冲突保留双方任务入口；其余自动合并逐项复核。发现命令模块直接解析服务路径会绕过新增安装身份检查，改为复用 resolveExtraModule，仅解析、不导入服务。新增回归覆盖选中来源、服务不执行、原安装移除和链接替换时拒绝祖先回退；实际 npm/pnpm 安装脚本增加自有 configure、帮助和 extraget 读回。验证结果见 validation.md 的追加记录。

交付最终范围为 46 个文件（原 44 个，加现有全局发现测试及安装验收脚本）。最新基线验证全部通过：Node1906通过/54跳过、UI35、typecheck、lint/names、文档、格式、两个实际安装验收；增量无待修 medium+。

# PR #197 外部评审修复与增量复核

评审来源：[Jerry-Xin 的两项 P2](https://github.com/Mininglamp-OSS/octo-runtime/pull/197#pullrequestreview-5661276320)。修复基线 `fd5b7dbb5a6ed56b208ce1f2ec9d7dd2f9af3990`，macOS arm64 / Node24.19.0 / pnpm11.19.0。此前无 medium+ 的结论未覆盖以下故障窗口，由本次复现与修复记录补充。

- **P2 / reproduced：回收者退出后永久阻塞。** 新增真实子进程故障注入，在实际 mkdir 返回后立刻退出 42；原实现的后续锁操作返回 SETUP_IN_PROGRESS。改为完整 owner 记录通过同目录硬链接原子发布，主锁与回收锁共用可恢复协议，回收前核对完整旧记录，释放时核对随机身份。修后连续三位回收者在发布后退出，随后三个新进程均可进入；活跃回收者则使三个竞争进程拒绝，主锁内容保持，杀死该回收者后可恢复。主锁发布前/后退出及原有八竞争者测试均通过。旧格式无有效 PID 的锁保守拒绝；遗留临时文件不参与互斥，未声称断电恢复或 PID 重用识别。
- **P2 / reproduced：旧宿主参数被提前拒绝。** 原实现执行 `--json=true version` 返回 2；新实现保留旧宿主布尔参数出现即启用的语义，包括等号值。回归覆盖根帮助、version、生命周期前后、Extra 详细帮助，同时确认业务 `--credential-stdin=true` 仍拒绝。额外检查旧宿主字符串参数的单连字符值，保持旧解析边界。
- **验收脚本限制修正。** pnpm 导入来源允许隔离环境中的共享 store 或活动 global/v11 安装组，按路径段核对目录边界，仍拒绝 npm/pnpm 跨环境来源。当前机器完整实际安装/移除矩阵通过；这不代替评审者其他机器的重跑结论。

修复前复现：`/tmp/octo-197-review-before.log`，两项测试均失败，分别为 INVALID_ARGUMENTS 和 SETUP_IN_PROGRESS。修复后命令/global/lifecycle 专项 47 项通过，全量 Node1911通过/54跳过、UI35通过。其余检查见 validation.md。

本次增量 12 个文件逐项复核：state、extra-commands、专项测试、安装脚本、双语指南、Extra 规则、brief/context/review/validation/journal。审查主线为 owner 发布/回收/释放的竞态、完整记录比较、活跃 owner 拒绝、历史参数语义和业务 boolean 隔离；无跳过文件，无待修 medium+。本地复核不等于远端评审已批准。

# 全局参数位置扩展复核

基线 `193f83085d9e0581bec44ac0c7634fb98a8235bb`。核对新增预扫描仅选择全局 Home/manifest，`--` 截断扫描，等号形式的业务字符串不作为宿主参数，完整解析保留原 argv，避免先删除宿主选项再误补业务缺值。hostOptions 保留名和业务 input.options 分流未改变；三个 Extra 没有增加 --home 定义。逐项复核 CLI 路由/帮助、专项测试、双语文档、规则和任务记录；无待修 medium+。新回归在旧版本失败，在新版本专项50项、全量1914通过/54跳过、UI35以及实际发行包后置全局参数验收通过。

# 原文字段参数与 bot_id 更新的增量复核

基线 `45c5082b47252b729b744f75b3d17ad211a69ec8` 加本轮工作区改动，macOS arm64 / Node24.19.0。范围13个文件，无跳过：CLI解析、Host SDK注释、三个Extra命令、专项测试、双语指南、Extra规则、brief/review/validation/journal。逐文件复核已完成；纯重命名按调用方和帮助契约核对。

审查主线：业务下划线选项与宿主参数仍分流；原文凭据不再读 stdin、不 trim 保存值，错误不包含输入；两个渠道按 bot_id 更新，变更 endpoint 仍更新首项、删除同 ID 后续旧项、保留其他 Bot 顺序和字段；省略 WeCom ws_url 保留已有地址。过滤仅移除首个匹配项之后的同 ID 项，因此首项数组下标仍有效。保存前仍经过业务校验及原有 CAS，不改变 enabled/module 或启动服务。WebUI 初次推导默认会话路径，已有自定义路径/项目保留，config set 按原 JSON 合同完整替换。根帮助仍仅列 Extra 名称，详细帮助按层级读取。

Track B：专项54项，全量Node1918通过/54跳过、WebUI35通过；真实tgz安装后验证两个渠道改地址不新增、不同 ID 追加、原文凭据精确读回和WebUI路径推导；外部命令及strict类型通过。所有检查详见validation本轮记录。审查结束无待修复 medium 或更高等级发现。此前 credential-stdin 和 endpoint+bot_id configure 的描述属于历史版本，现行合同以brief和命令指南为准。
