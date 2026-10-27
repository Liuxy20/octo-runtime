---
type: Verification
title: Issue 194 实施与验证
tags: [extra, cli, configuration, verification]
timestamp: 2026-10-27T00:00:00Z
---

# 最终实现

分支 `codex/194-extra-commands`，基线 `a7c33b64064b8a54f59f70178873983ba143c1b3`；交付前按用户授权 rebase 到 main@f0bacb01590084523c21dc9996d05738c9a06a44，提交并创建 Draft PR。平台 macOS / arm64，Node.js v24.19.0，pnpm 11.19.0。

- 独立 `/commands`，apiVersion=1，命令树、选项、位置参数、输出、退出码与取消合同从主包 `/extra` 导出。根帮助只读 manifest，详细帮助只加载选中命令模块。
- CLI 分阶段路由；--home/--manifest/--json/-h/--help 均为全局参数，现支持位于自有命令前后（原版位置限制已按用户要求取消）。-- 后是位置参数。生命周期命令保留旧参数语法且不导入 commands。
- 三个业务接入是 channel-gateway、channel-wecom、webui；configure 只暴露核心配置。Gateway/WeCom 使用各自现有 imBotIdentity，WebUI 为 Home 内单例。configure 更新同 ID、追加不同 ID，config set 完整替换并拒绝重复身份。
- 同一个 config.json、权限与写锁；CAS 比较整份声明，保留 module/enabled。交互不占写锁；取消前不写，开始原子写入后以实际结果为准。保存提示明确需要整个 Extra 重启，不自动启动或启用。
- 旧 extraset/extraget 外壳接口继续保留；config get 明确返回可能含凭据的业务 JSON。普通保存和错误不输出凭据，未知第三方 handler 错误折叠。

# 初始基线验证结果

所有命令在本 worktree 执行；测试凭据仅在临时目录/内存按次随机生成，未使用真实认证值。

| 检查 | 命令/证据 | 结果 |
| --- | --- | --- |
| 构建及严格类型 | `pnpm typecheck`；`/tmp/octo-194-final2-typecheck.log` | PASS，退出 0 |
| Node 全量 | `pnpm test:suites`；`/tmp/octo-194-final2-tests.log` | PASS，1952 项中 1898 通过、54 跳过、0 失败 |
| UI | 同一 `pnpm test:suites` | PASS，35 通过，2 个测试文件 |
| ESLint | `pnpm lint`；`/tmp/octo-194-final-lint-pass.log` | PASS |
| 命名 | `pnpm lint:names`；`/tmp/octo-194-final-names.log` | PASS，findings=[] |
| 文档 | `pnpm docs:check`；`/tmp/octo-194-docs2.log` | PASS，双语链接/代码一致，4 个执行示例通过 |
| 改动格式 | 对 Git 改动及未跟踪的 TS/JS/JSON 执行 `pnpm exec prettier --check` | PASS，`/tmp/octo-194-format-check.log` |
| 空白错误 | `git diff --check` | PASS |
| 发行包 | `node scripts/pack-release.mjs` | PASS，生成 dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz |
| 包外安装与命令 | `node /tmp/octo-194-verify-release.mjs "$PWD"`；`/tmp/octo-194-release-verification-final.log` | PASS，npm 离线安装实际 tgz；三个 Extra 的帮助、配置、重复请求、extraget、读回及 POSIX 0600 |
| 第三方实际安装 | 上述发行验收脚本另用 npm 安装独立包，通过 Home manifest 发现 `loop-daemon login` | PASS，不改 CLI，服务入口若被导入会抛错；帮助及命令运行成功 |
| 包外公开类型 | 上述脚本 `tsc --strict --module NodeNext --target ES2022 --skipLibCheck false --noEmit --types node` | PASS，主包 ExtraCommand 合同及三个 commands 子路径 |

最初 `pnpm test` 已完整通过一次（1895 通过/54 跳过、UI35），审查修复后增加 3 个回归，最终重新 typecheck + test:suites 得到表中结果。一次 lint 与 clean/build 同时运行导致产物暂时缺失，未视为源码缺陷；构建完成后串行 lint 通过。包外 TS fixture 首次遗漏 TypeScript 6 的显式 `--types node`，补齐与仓库发行脚本相同参数后通过，未改产品类型掩盖错误。

# 行为与故障覆盖

`test/extra-commands.test.js` 有 27 项专项测试，包含未配置/disabled、全部帮助层级、CRLF/Unicode、两渠道 ID 去重与不同端点、保存回执与业务 JSON 分离、完整 JSON 替换、重复身份/非法 URL/非法端口/超量输入拒绝、profile 拒绝、核心字段保留、凭据不回显、损坏配置不覆盖。

并发覆盖两种路径：同进程快照与 extraset 冲突，以及两个真实 CLI 进程先读同一快照、在无锁 stdin 交互后按顺序提交；前者保存，后者明确 EXTRA_CONFIG_CONFLICT，原配置保留。新锁尚未写完时不可抢占；初版多个竞争者回收同一陈旧锁时使用独占 reclaim 目录和二次 owner 检查，只有一个写入者进入；目录方案现已被 PR 评审修复取代，见追加记录。取消测试在 stdin 未结束时返回 130，解除监听并不创建配置。

外部模块覆盖根帮助不 import、选择来源、忽略同名条目、文件模块声明、旧包无 exports、缺少可选导出、依赖损坏、API 不兼容、保留名称/重复命令/宿主选项冲突、嵌套命令、`--` 字面量、非法退出输入与可控退出码。普通异常正文不会成为公开凭据。

# 边界

- 初始基线尚无 #192；交付基线已包含 #196，全局发现的追加验收见下文。复用现有发现机制，不另实现扫描。
- 本次改动是离线配置入口。没有执行真实 IM/WeCom 认证或消息投递，没有新增业务网络登录。外部 login 是命令扩展 fixture，不能证明业务认证成功。
- 未做 Windows/Linux 原生平台验证，54 项条件跳过保留事实。没有测试真人交互终端 prompt；stdin 及 signal 已覆盖。
- 命令扩展是可信同进程代码，须自行观察取消与关闭资源；不提供恶意 JS 沙箱或远端副作用回滚。
- 不重置任何用户 Home、身份、凭据或运行服务。提交、push 与 Draft PR 已获本轮用户授权；不合并 PR。

逐文件审查与修复见 [verified-review](review.md)。

# 最新 main 集成与交付验证

用户后续授权同步远程 main 并提交 Draft PR。交付基线为 `f0bacb0`（#195、#196）；rebase 仅 `.octospec/index.md` 出现文本冲突，双方任务入口均保留。命令模块改为复用全局安装身份校验，防止发现后移除/替换包时加载祖先同名包。新增全局命令回归通过；文档已改为内置 > Home > 全局 catalog。

以下检查在上述基线加本 PR 最终代码上重新执行，平台与工具版本保持不变：

| 检查 | 证据 | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | `/tmp/octo-194-main-typecheck.log` | PASS |
| `pnpm test:suites` | `/tmp/octo-194-main-tests.log` | PASS：Node 1960 项，1906 通过、54 跳过、0 失败；UI 35 通过 |
| `pnpm lint` / `pnpm lint:names` | `/tmp/octo-194-main-lint.log`、`/tmp/octo-194-main-names.log` | PASS |
| `pnpm docs:check` | `/tmp/octo-194-main-docs.log` | PASS，含 4 项可执行示例 |
| 修改的 TS/JS/MJS/JSON Prettier / `git diff --check` | `/tmp/octo-194-main-format.log` | PASS |
| `node scripts/pack-release.mjs` | `/tmp/octo-194-main-pack.log` | PASS，实际 tgz |
| `pnpm test:global-extras dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | `/tmp/octo-194-main-global-install.log` | PASS：隔离 npm/pnpm v11 实际全局安装、独立安装组、混合环境、安装/移除后重读；自有 configure 帮助、保存回执及 extraget 配置读回通过 |
| `node /tmp/octo-194-verify-release.mjs "$PWD"` | `/tmp/octo-194-main-release.log` | PASS：包外 npm 离线安装，三 Extra 帮助/配置/去重/权限、Home manifest 外部 login、strict TypeScript 公共类型 |

增量 verified-review 已复核冲突解决、自动合并和全局来源适配；无待修复 medium+。上述日志是本机执行证据；仓库保留测试与验收脚本。实际包安装只在独占临时目录进行，没有修改用户全局环境。全局 fixture 的服务初始化由测试主动终止；不是业务认证或消息投递验证。PR 保持 Draft，不自动合并。

# PR #197 评审修复验证

以 `fd5b7db` 为基线修复两项 P2，未改变三个 Extra 的业务范围或配置合同。回收锁不再使用无 owner 目录。真实进程退出、连续回收者退出、活跃回收者排他和旧宿主参数的回归已纳入仓库测试；修复前两项复现失败，修后通过。

| 检查 | 证据 | 结果 |
| --- | --- | --- |
| `pnpm typecheck` | `/tmp/octo-197-review-typecheck.log` | PASS |
| `node --test test/extra-commands.test.js test/global-extra-discovery.test.js test/cli-lifecycle-races.test.js` | `/tmp/octo-197-review-focused.log` | PASS，47 项 |
| `pnpm test:suites` | `/tmp/octo-197-review-tests.log` | PASS，Node1965项：1911通过/54跳过/0失败；UI35通过 |
| `pnpm lint` / `pnpm lint:names` | `/tmp/octo-197-review-lint.log`、`/tmp/octo-197-review-names.log` | PASS |
| `pnpm docs:check` | `/tmp/octo-197-review-docs.log` | PASS，含4项可执行示例 |
| 改动代码 Prettier / `git diff --check` | `/tmp/octo-197-review-format.log` | PASS |
| `node scripts/pack-release.mjs` | `/tmp/octo-197-review-pack.log` | PASS |
| `pnpm test:global-extras dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | `/tmp/octo-197-review-global-install.log` | PASS，隔离 npm/pnpm v11 全矩阵 |
| `node /tmp/octo-194-verify-release.mjs "$PWD"` | `/tmp/octo-197-review-release.log` | PASS，实际 tgz 包外命令/去重/权限/strict 公共类型 |

平台与未做真实渠道联调的边界不变。硬链接在同一目录内发布锁，测试验证进程退出后的恢复；不将其表述为断电或文件系统损坏后的恢复保证。当前基线旧 CI 全绿不能作为修复后 CI 结果，推送后重新运行远端检查。

# 全局参数位置扩展

用户明确要求 `webui configure --home ... --session-store-path ...`，并要求 --home 保持全局归属。以 `193f830` 为基线，只调整 CLI 全局解析：预扫描 --home/--manifest 确定命令来源，再对原始 argv 完整解析；三个 Extra 的命令声明和业务逻辑均未改动。全局参数不进入业务 options，Extra 仍禁止声明宿主保留参数。

新增三个回归覆盖命令前/中/后与嵌套命令、重复宿主参数、业务缺值、Home/显式 manifest 选择先于导入、等号中的字面 --home 和 -- 后的位置参数。专项50项通过；全量 Node1968项：1914通过/54跳过/0失败，UI35通过。typecheck、lint/names、docs:check、改动代码格式、git diff --check、发行包构建和原包外验收通过。包外脚本另将调用改为所有 --home 均置于命令参数后，实际 tgz 三 Extra 配置/去重/权限、外部命令与 strict 类型均通过。

证据前缀 `/tmp/octo-197-global-position-`：`typecheck.log`、`focused.log`、`tests.log`、`lint.log`、`names.log`、`docs.log`、`format.log`、`pack.log`、`release.log`、`trailing-release.log`。旧版本新增用例失败记录为 `before.log`。本次未重跑全局安装矩阵，其既有证据见前节；无业务联调或用户 Home 修改。

# 原文字段参数、简化 WebUI 与 bot_id 更新

以 `45c5082b47252b729b744f75b3d17ad211a69ec8` 为增量基线，按用户后续决定替换早期参数方案：所有暴露业务参数与配置字段同名，凭据直接通过 bf_token/app_secret 传原文；WebUI configure 仅 port，会话路径首次从 Home 推导；两个渠道 configure 均按 bot_id 更新或追加，改地址不新增同 ID。旧跨 endpoint 同 ID 合并为一项，省略字段取首项；WeCom 省略地址时保留已有值。完整 JSON 配置和运行时身份合同不变。

本轮在 macOS arm64 / Node24.19.0 / pnpm11.19.0 执行：

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck | PASS |
| 命令/全局发现/生命周期专项 | 54通过，0失败 |
| pnpm test:suites | Node1972项：1918通过/54跳过/0失败；WebUI35通过 |
| pnpm lint / pnpm lint:names / pnpm docs:check | PASS |
| 改动代码 Prettier / git diff --check | PASS |
| node scripts/pack-release.mjs | PASS |
| 实际 tgz 在仓库外 npm 离线安装验收 | PASS：三 Extra 帮助/配置/读回/POSIX权限；原文凭据含 Unicode、空格和 CRLF 精确保留；两个渠道更换地址仍只有同 ID 一项，新 ID 追加；WebUI 从 Home 推导路径；外部命令和 strict 公共类型通过 |

证据前缀 `/tmp/octo-197-schema-flags-`：typecheck.log、focused.log、tests.log、lint.log、names.log、docs.log、format.log、pack.log、release.log。包外脚本 `/tmp/octo-197-verify-schema-flags.mjs` 使用后置全局 --home，测试 Home 均为独占临时目录。仓库回归还覆盖旧参数拒绝、凭据省略保留/空值拒绝/无需 stdin、非法地址不写盘、旧跨地址同 ID 合并、其他 Bot 不变、WebUI 高级路径保留。

本轮没有重跑 npm/pnpm 全局安装矩阵，其此前结果见“PR #197 评审修复验证”；本轮重新构建并安装了真实发行包。真实渠道认证、Windows/Linux 原生平台和 TTY 的既有验证边界不变。

# CLI 文档入口更新验证

以 `f8dff5b52e536f1ecc50f6283b977f5c7002cbc2` 为基线，仅修改文档和任务记录。三个 Extra 的中英文 README、apps/cli README、双语 CLI 入门及 Extra 指南改为 configure 优先，extraset/extraget 移入手写 JSON 进阶说明。按实际字段逐项核对参数、bot_id 更新/追加、WebUI 路径推导、config set 与 extraset 的替换范围和独立服务启停。

`pnpm docs:check` 通过：18 对双语页面、37 个 Markdown、22 个 JSON、16 个 Mermaid、4 项可执行示例。临时脚本 `/tmp/octo-197-check-doc-commands.py` 从文档抽取并执行27次 configure/帮助命令，另验证三个 Extra 的业务 JSON 与完整声明往返；三对 README 代码块一致。测试仅使用独占临时 Home，不启动服务、不进行渠道认证。`git diff --check` 通过。日志：`/tmp/octo-197-docs-entrypoints.log`、`/tmp/octo-197-docs-commands.log`。没有代码改动，未重复全量运行时测试。

推送前远端合入 main 的 #199，PR 分支更新至 `deac517a453374d24bc525fc0b312442446c795b`。文档提交无冲突 rebase，保留全部远端改动；同步后重新执行 pnpm typecheck、pnpm docs:check、27次文档配置/帮助及三 Extra JSON 往返，均通过。证据 `/tmp/octo-197-docs-synced-{typecheck,check,commands}.log`。用户明确授权文档提交后将 Draft PR 转为正式评审。
