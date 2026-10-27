---
type: Journal
title: Issue 194 Extra 自有配置命令交付记录
tags: [extra, cli, verification]
timestamp: 2026-10-27T00:00:00Z
---

在 main@a7c33b6 的独立 worktree / codex/194-extra-commands 实施，准备度评估 96/100 后直接开发。仅三个内置 Extra 提供业务命令；通用框架供选中 manifest 的第三方包复用。不含 #192 全局扫描，不修改 SDK 服务装配。

可复用结论已写入 architecture/extras：命令模块与服务模块分开，业务参数/身份去重归 Extra，CLI 保持 Home 文件、完整性和并发控制；配置保存回执与运行中应用事实分开。结果显示使用明确 message/value，不从业务字段猜测回执。锁初始化与陈旧锁回收均必须保护新 owner。

最终 Node 1898 通过/54 跳过，UI35 通过；typecheck、lint/names、双语文档、格式、实际 tgz npm 离线安装和严格公开类型通过。外部包通过 Home manifest 提供 login，验证未触发服务入口；该 fixture 不证明真实认证。verified-review 的两个边界复现已修复，无待修 medium+。

详见 [方案](../../tasks/194-extra-commands/brief.md)、[验证](../../tasks/194-extra-commands/validation.md)、[审查](../../tasks/194-extra-commands/review.md)。初次交付保留未提交改动；后续用户授权同步远程 main 并提交 Draft PR。未运行真实渠道认证或进行 Windows/Linux 原生验收。

交付同步至 `origin/main@f0bacb01590084523c21dc9996d05738c9a06a44`，复用 #196 全局发现及安装身份检查，新增命令加载来源回归和实际 npm/pnpm 命令验收；保留 #195 生命周期文档修正。最新验证见 validation.md。

同步后 Node1906通过/54跳过、UI35通过；typecheck、lint/names、文档、格式、实际 tgz、隔离 npm/pnpm 全局命令和包外公开类型均通过，增量审查无待修 medium+。按授权提交英文 commit 和 Draft PR，保留 Codex attribution，不自动合并。

PR #197 的后续评审复现两项 P2：回收目录在 owner 退出后阻塞、旧宿主等号布尔参数不兼容。已将锁改为完整 owner 记录原子发布及同协议回收，保留活跃写入者保护；恢复旧宿主参数语义，Extra typed boolean 保持严格。pnpm 验收允许真实活动安装组目录。修前两项失败，修后专项47项、Node1911通过/54跳过、UI35以及构建/lint/文档/发行包/隔离全局安装全部通过。详见任务 review/validation 追加记录；远端评审仍须独立确认。

按用户要求，--home/--manifest 作为全局参数支持位于自有命令之后。全局路由先确定来源，再完整解析原 argv；业务命令定义未改动，保留参数不允许 Extra 重定义。嵌套命令、重复选项、业务缺值、字面参数及包外实际后置调用均通过。最新全量 Node1914通过/54跳过、UI35，专项50项；验证见任务追加记录。

按用户后续要求，内置业务参数全部与存储字段同名，bf_token/app_secret 直接接收原文，删除 credential-stdin。WebUI configure 简化为 port，首次会话路径由 Home 推导，高级 JSON 字段不改名。两个渠道 configure 统一按 bot_id 更新或追加，改变地址不新增同 ID，保留其他 Bot 和省略字段；WeCom 更新省略 ws_url 不重置旧值。专项54项、Node1918通过/54跳过、WebUI35及构建/静态检查/文档/真实包外安装通过，增量审查无待修 medium+。历史记录保留，当前合同见 brief，详见本轮 validation/review。

CLI 文档入口已按用户要求收敛：三 Extra 双语 README、CLI 入门和命令指南优先展示反斜杠分行的 configure 示例；config set/get 和 extraset/extraget 放到进阶，明确业务对象与完整声明的区别。文档检查和27次实际配置/帮助调用、三个 Extra JSON 往返、README 双语代码块一致性通过；仅文档改动，没有重复运行时全量测试。证据见任务 validation 的文档入口记录。

推送前远端合入 main 的 #199，PR 分支更新至 `deac517a453374d24bc525fc0b312442446c795b`。文档提交无冲突 rebase，保留全部远端改动；同步后重新执行 pnpm typecheck、pnpm docs:check、27次文档配置/帮助及三 Extra JSON 往返，均通过。证据 `/tmp/octo-197-docs-synced-{typecheck,check,commands}.log`。用户明确授权文档提交后将 Draft PR 转为正式评审。
