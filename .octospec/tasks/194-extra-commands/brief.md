---
type: Task
title: Issue 194 Extra 自有配置命令
tags: [extra, cli, configuration]
timestamp: 2026-10-27T00:00:00Z
---

# 目标与边界

基于 main@a7c33b64064b8a54f59f70178873983ba143c1b3，在 codex/194-extra-commands 实现 #194；首批业务仅 channel-gateway、channel-wecom（用户所称 wecom）、webui。用户最初授权实施和 verified-review；后续明确要求同步远程最新 main、提交并创建 Draft PR。交付前已 rebase 到 main@f0bacb01590084523c21dc9996d05738c9a06a44（含 #195、#196）。

业务目标是无需编写 extraset 外壳即可配置 Extra。Extra 决定参数映射、校验、身份与去重；CLI 决定命令分派、Home 文件保护、并发保存与输出。显式参数只映射现有核心配置，不增加登录流程、Provider 安装、模型默认策略或服务热更。SDK 原生装配无需命令模块。

# 实现合同

- 可选 `./commands` 模块导出 apiVersion:1 和声明式命令树；同一选中清单来源解析服务和命令。文件模块可通过清单 commands 字段显式声明。未声明可选导出与损坏模块分别处理。
- 根帮助只列清单名称；选中 Extra 才加载 commands。import 必须无业务副作用。生命周期优先，损坏 commands 不影响 stop/status/logs。
- 主入口分阶段解析。宿主 --home/--manifest/--json/--help 保留，命令前后均由全局解析器消费；CLI 预扫描选定 Home/manifest 后加载命令，完整解析保留原 argv 检查业务参数缺值。自定义命令拒绝 --profile。参数值按声明消费，`--` 后仅为位置参数，-h/--help 等效。不允许覆盖宿主或生命周期名称。
- `configure` 的业务参数全部与配置字段同名：Bot 使用 bot_id、api_url/ws_url、adapter_type/workdir/model/effort/provider_agent_id；凭据通过 bf_token/app_secret 直接传原文。WebUI 仅 port，首次会话路径从宿主 Home 推导为 extras/webui/sessions.json，高级路径通过 config set 配置，JSON 字段不改名。全局参数不改名，移除旧业务参数别名与 credential-stdin。省略项保留原值，其他创建项使用现行业务默认。
- Gateway/WeCom configure 均按 bot_id upsert，改 api_url/ws_url 仍更新原项；旧跨 endpoint 同 ID 合并并保留首项省略字段。WeCom 更新省略 ws_url 保留旧值，新 Bot 才使用默认地址。WebUI 按 Home 内 webui 单例合并。重复请求不追加重复 Bot；完整 config set 中重复身份拒绝，避免静默丢弃不同凭据或配置。
- `config set` 从 stdin 读取完整业务对象，经 Extra 校验替换 config；`config get` 显式返回可能含凭据的业务配置，帮助注明。旧 extraset/extraget 外壳及完整替换语义保持。
- 命令先读取配置快照，交互/校验在锁外完成，保存以相同 setup lock 做修订比对和原子替换。主锁与回收锁先写完整 PID/随机身份，再通过同目录硬链接原子发布；回收者持有同协议的回收锁并再次核对原记录，退出后可继续恢复，防止并发删除新锁。旧格式不完整 owner 仍保守拒绝。并发修改返回冲突，未配置与损坏配置不能混同；保留 enabled/module，不部分写入。保存只表示持久化，reload_required=true。
- composition root 是当前 CLI 进程；不构造 Extra/Kernel 服务，不增加进程/socket。CLI 拥有 IO、signal 与写锁；Extra 拥有业务函数。删除映射：无服务 API 删除，旧 whole-argv 解析只用于既有命令。
- #192 已通过 #196 合入交付基线；复用统一 catalog，命令模块沿同一全局安装来源加载并复用安装身份校验。保留 Home manifest 接入，补充 npm/pnpm 实际全局安装命令验收。

# 可执行性评估

准备度 96/100（实现决策清晰度，不是成功概率）：范围/责任 20/20，现有配置/身份复用 20/20，解析/加载合同 19/20，并发/失败合同 19/20，验证路径 18/20。初始剩余边界为 #192 尚未落地主机全局发现，以及不涉及本次配置行为的真实渠道认证；交付同步 main 后，全局发现纳入集成验证。没有阻断实施的产品决策。

# 验收

1. 三 Extra configure/config set/get、重复身份、保留旧字段、非法输入无写入。
2. 独占 Home、无 Kernel、未配置、disabled、双层帮助、-- 边界、无凭据输出。
3. 第三方包位于 workspace 外，选中来源一致，未选中及服务入口不执行；无导出/坏导出/API版本/冲突隔离。
4. 并发冲突、取消、失败与权限；原 extraset 脚本继续工作。
5. build/typecheck/lint/names、跨包全量测试、实际发行包检查；verified-review 逐文件阅读和执行验证。

# PR #197 评审修复

以 `fd5b7dbb5a6ed56b208ce1f2ec9d7dd2f9af3990` 为修复基线。两项 P2 均通过新增回归在原代码上复现：回收进程在创建目录后退出导致永久 SETUP_IN_PROGRESS；宿主等号布尔参数被新路由提前拒绝。

锁修复必须同时保护活跃写入者、允许主锁及回收锁的 owner 退出后恢复。先完整写入独占临时文件，再以同目录硬链接原子发布；回收前持有同协议回收锁并比较完整旧记录，释放时核对随机身份。回收锁名哈希保持固定长度，并只依赖文件名，使 Home 的符号链接别名共享同一互斥点。发布前退出产生的临时文件不参与互斥；旧格式无有效 owner 的锁继续保守拒绝，不按时间删除。所有使用 Home setup lock 的调用者都在验证范围内。

参数修复复用旧宿主语义，Extra typed boolean 保持严格。补充命令前后与根帮助回归。安装验收接受 pnpm 的共享 store 和活动 global/v11 目录，仍验证真实目录边界和 npm/pnpm 环境隔离。

# 文档入口收敛

用户要求各 Extra README 与 CLI 文档优先展示 configure 的参数命令，使用反斜杠逐行书写且示例不带 Home；extraset/extraget 作为手写完整 JSON 的进阶接口。同步中英文 README、CLI 入门和命令指南，明确 configure 按 ID 更新、config set 业务整体替换、extraset 声明整体替换的不同范围。
