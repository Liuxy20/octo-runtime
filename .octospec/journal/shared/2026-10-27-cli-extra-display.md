---
type: Journal
title: CLI 与 Extra 命令统一展示验证
description: Commander 帮助树、完整声明子命令、双语文档及本地全局安装证据。
tags: [cli, extra, documentation, testing]
timestamp: 2026-10-27T00:00:00Z
---

# 实施与验证

基于 `origin/main@aa16c894b2b2` 新建独立 worktree，分支为 `codex/cli-extra-display`。需求、边界和验收见[简报](../../tasks/cli-extra-display/brief.md)。

CLI 使用 Commander 统一原生命令和递归 Extra 声明的解析、帮助与示例。根帮助只读有效目录元数据，命令用途来自 manifest 的 description 或全局包描述；不再单独展示 Components、namespace 或占位命令路径。选中 Extra 的业务命令才加载 commands，服务生命周期和完整声明读写不依赖命令模块。

完整声明入口变为 `<extra> extraset/extraget`，旧顶层写法隐藏兼容，并共享原有存储及原子写入。删除内置 config set/get 和 configCommands 生成器，保留各 Extra 自有 configure 及第三方自主声明的业务命令。Kernel 没有 Extra 声明，不新增无消费方的配置入口。根帮助和 version/--version 均展示版本、commit 和 build 信息。

中英文 docs 的 CLI 入门、Extra 命令指南、模块载入说明及三个插件的中英文 README 已同步。Gateway、WeCom 的完整声明均列出 adapter.model/effort，并在示例下说明两项可省略、使用所选 Harness 自身默认值。configure 更新省略字段时保留旧值；恢复默认值须从完整声明删除字段并 extraset。

验证结果：

- 完整 workspace 构建通过；TypeScript noEmit、ESLint、命名检查、改动代码的 Prettier 检查及 git diff --check 通过。
- `pnpm test:suites`：WebUI 2 个测试文件共 35 项通过；Node 2047 项中 1993 通过、54 跳过、0 失败。
- `pnpm docs:check`：示例类型、文档链接/结构检查与 4 项真实本地 SDK 示例测试通过；两个语言树的 Gateway/WeCom heredoc JSON 另行解析，确认 model/effort 字段齐备。
- 发行包离线安装及独立消费验证通过，覆盖 Commander、公共类型、内置 Extra、WebUI 资源、原生 Kernel、独立 Extra、状态回调及卸载保留 Home。
- 首轮全量仅有旧根帮助文案断言失败；已更新为统一帮助、隐藏 manifest 的合同，并完整重跑通过。
- OctoSpec lint 使用 uv 临时环境提供 PyYAML 后运行，仍报告 7 个未修改的旧文件缺少 frontmatter；本次新增知识单元、规则索引与本地链接没有新错误。

按用户授权执行 `npm install --global --offline --ignore-scripts dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`，安装成功。全局可执行文件位于 `/Users/lvsijia/.nvm/versions/node/v24.19.0/bin/octo-runtime`；其 command-tree.js、main.js 和 manifest.json 与本 worktree 构建结果逐字节一致。全局根帮助、Gateway 帮助及 WeCom extraset 帮助通过，npm 确认版本为 `0.0.0`。版本元数据为 `aa16c894b2b2 (dirty)`、`2026-10-27T04:13:53.181Z`，如实标记本地未提交构建。没有提交、推送、PR 或发布操作。

本次是本地 CLI 展示、解析与文档验证，没有调用真实渠道凭据或执行线上 IM/模型联调；不能将此记录视作渠道端到端验收。

## 帮助元数据、排序与 Examples 修正

用户指出首版帮助丢失构建元数据，明确要求恢复根帮助版本/commit/build，同时将前四项固定为 executor-kernel、channel-gateway、channel-wecom、webui。现已修正：只为有效目录中的条目应用优先顺序，其他命令按名称排列；Extra 内公共命令先列，前六项为 install、uninstall、start、stop、restart、run，其余公共命令之后保留业务声明顺序。

Examples 统一置于 Usage 后的独立区块，根示例只依据当前有效目录生成，服务动作提供通用示例，插件 examples 由同一布局渲染，嵌套组按子命令生成帮助入口示例。根帮助仍不导入插件或运行 handler。双语 docs 与规则同步该合同。

本轮 CLI 构建、TypeScript noEmit、ESLint 通过。107 项相关回归通过、6 项跳过，覆盖元数据在不同 cwd/时区的稳定性、无效时间回退、有效目录排序、公共动作与插件声明排序、Examples 位置和加载隔离。首轮全量结果仍为上文记录，不冒充本次重新执行的完整测试。

本轮 docs:check（含 4 项 SDK 示例测试）、改动代码 Prettier、git diff --check 与新版发行包离线验证通过；发行验证新增根帮助元数据、前四项顺序及 Examples 断言。已再次安装到同一 Node 全局目录，核对三个内置 Extra 的公共命令顺序、Examples 区块以及全局 help.js/command-tree.js 与本 worktree 构建逐字节一致。更新后的构建时间为 `2026-10-27T05:17:19.591Z`，仍如实标记 `aa16c894b2b2 (dirty)`。

## 插件 README 刷新

用户指定 GitHub main 上的 Gateway README.zh.md，要求清理过时内容。已核对远端页面与当前 worktree：main 仍有旧 config set/get 和必填 model 的说明，本地已按新命令合同删除。进一步刷新 Gateway 中英文 README 的独立启动、公共命令顺序、可选 model/effort、完整声明与 SDK config 的边界、当前 Context 历史准备、状态摘要及前台重启说明。WeCom 中英文 README 同步区分首次使用 Harness 默认值与 configure 更新保留旧值，JSON 示例统一使用 codex，与 configure 示例一致。

本次仅修改文档，未重新构建或变更全局 CLI。docs:check 及其 4 项示例测试通过；额外解析四份 README 的 Markdown AST，验证 4 份完整声明在运行期替换凭据占位后通过当前 JSON Schema，中英文代码块完全一致，32 个本地链接有效。Prettier 与 git diff --check 通过。GitHub main 页面须在本 worktree 的改动实际合入后才会更新，本次没有提交、推送或合并。

## 品牌文案与完整 JSON 示例

根说明改为 `Manage the local Octo Agent runtime and independent services.`，同步发行校验并重新构建、全局安装。

用户进一步要求用 `<<<` 和完整 JSON 替代帮助中的文件重定向。组件与 extraset 帮助现展示 Bash/Zsh here-string；Gateway/WeCom 示例包含 Bot、凭据占位、adapter、model/effort，WebUI 包含端口和绝对会话存储路径。manifest 的可选 configExample 只提供公开业务配置示例，帮助渲染器不按名称拼业务字段，也不读取已存配置。离线 extraset 帮助尽量读取目录，目录损坏时退回通用外壳，实际配置修复路径仍不导入命令或依赖目录。中英文 Extra 命令指南同步示例、可选模型字段与元数据合同。

验证：workspace 构建、TypeScript noEmit、ESLint、命名检查、docs:check 和 git diff --check 通过；69 项针对性测试通过。完整 test:suites 通过，WebUI 35 项通过，Node 2051 项中 1997 通过、54 跳过、0 失败。新增真实 Bash 测试覆盖示例的单引号、变量及命令替换字面量，三个内置声明在内存替换凭据占位后通过各自 Schema。

已打包并使用 npm 离线全局重装；从全局 CLI 的 extraset 帮助提取三个实际示例，在临时 Home 用 Zsh 执行，确认写入/读回 JSON 一致、文件权限为 0600，随后清理临时 Home。没有写入现有用户配置、启动服务或调用渠道/模型，也没有提交、推送或发布。

用户补充完整 JSON 示例需包含 module 以识别用途。现从有效目录读取对应 module，三个内置 Extra 的组件与 extraset 帮助均展示各自包名，中英文指南同步。目录缺失不猜造模块；相对模块路径仍省略可选字段，因为既有存储外壳不接受相对路径，避免展示无法保存的示例，不改变配置合同。

本次 CLI 构建、11 项帮助测试、TypeScript noEmit、ESLint、docs:check 通过。已重新打包并离线全局安装，实际核对三个内置 Extra 的两层帮助，再用 Zsh 在临时 Home 执行各自示例并通过 extraget 验证 module 与组件匹配，随后清理。本次未重复全量测试，上文全量结果属于上一轮验证。

## PR 前本地审查与 README Quickstart

审查基线为 `aa16c894b2b2c7ae9a2771cf10a427f7b677c976`，分支 codex/cli-extra-display，工作区 dirty；环境为 Darwin arm64、Node v24.19.0。审查相对 HEAD 的 40 个已跟踪文件及 5 个新增文件，共 45 个文件；锁文件只核对依赖对应关系，不逐行审查生成内容，其余文件分别核对。采用 verified-review 的代码阅读和运行验证，并用 technical-writing-zh 核对操作说明。审查重点是命令解析与动态加载合同、离线修复、完整配置读写、版本元数据、错误脱敏，以及中英文文档与 Quickstart。

复现并修复两处中风险问题：

- 全局 `--version` 在 Extra 路径下无法使用，例如 `channel-gateway configure --version` 原返回退出码 2。原因是查询版本时跳过目录，却继续按没有 Extra 的树解析。用户确认全局语义后，在选择阶段直接返回版本查询；新增覆盖两种 flag、五个组件和三个位置的 30 组调用，以及损坏目录和 -- 后字面版本参数。当前退出码 0，输出同一产物的 version/commit/build，不导入插件。
- 合法自有选项 constructor 被普通对象原型污染读取语义：缺少必填选项时错误返回 0，传入时又与根 opts 的原型属性误判冲突。失败测试已先复现；现通过 Commander 公共 API 显式初始化业务选项为 undefined，冲突判断只检查根对象自有键。缺值返回 2，传值返回 0 且原样交给 handler；其他自有命令测试保持通过。

根 README 的 channel-gateway Quickstart 改为两种可选路径：configure 按 bot_id 更新与 extraset 通过 <<< 完整替换。两者均包含模型选择示例及可省略说明，完整 JSON 含正确 module；文案明确更新保留字段与整体替换的区别、配置保存不启动、启动与重启、读取凭据。补全中英文 CLI 文档和 WeCom README 的 module，补充全局版本参数合同，移除一处失效的 CLI README 标题锚点。

本轮实际验证：

- `pnpm test` 完整构建后执行 WebUI 35 项及 Node 2053 项；Node 1999 通过、54 跳过、0 失败。
- TypeScript noEmit、pnpm lint、pnpm lint:names、pnpm format:check、pnpm docs:check 及 git diff --check 通过；docs:check 包括 4 项本地 SDK 示例测试。
- 从根 README 的 Markdown AST 提取两种实际配置命令，在临时 Home/工作目录用 Zsh 执行，仅在内存替换凭据占位，确认二者保存相同业务配置且符合 Schema。另核对 CLI 文档和插件 README 中 8 份完整 Gateway/WeCom 声明，module 正确且 Schema 通过；没有使用真实渠道或模型。
- 重新打包并执行 verify-release，离线安装、公开类型、内置 Extra、WebUI 资源、原生 Kernel、独立 Extra、SDK 恢复及卸载保留 Home 全部通过。
- 已离线全局重装，并验证 `channel-gateway configure --version`、指定缺失 manifest 的 `channel-wecom -v` 均输出 `0.0.0`、`aa16c894b2b2 (dirty)`、`2026-10-27T07:16:47.406Z`。

结论：当前未发现尚未修复的中高风险问题，满足本地提交 PR 的准备标准。此结论不替代 Windows/Linux、Node 26 的 CI 和真实渠道/Provider 验收；本次未在这些环境运行。OctoSpec lint 仍报告上述 7 个未修改历史文件缺少 frontmatter，没有新增错误。未创建提交、推送或 PR。

## 历史文档元数据补齐

用户随后要求修复上述格式问题。已为 DSH SDK 与 systemd 路径修复的 4 篇任务文档、3 篇历史 journal 补齐 YAML frontmatter，包含 type、title、description、tags 和对应历史日期；正文保持不变。

重新运行 `uv run --with pyyaml python .octospec/scripts/lint.py` 通过：419 个 OKF 单元、20 条规则、3075 个本地文件链接。此前 7 项缺少 frontmatter 的错误已消除，本次仅涉及文档元数据，不需要重新构建或安装 CLI。

## 同步最新 main 与提交准备

用户授权更新最新 main、提交、推送、创建 PR 并按门禁合并。已 fetch 并将工作分支同步至 `origin/main@5c0d2c6`，无冲突。新增上游提交为 Windows 文件保护测试修复；其中任务简报也缺少 frontmatter，本轮仅补齐其元数据，正文不变。

同步后重新执行 `pnpm test`：完整 workspace 构建通过，WebUI 35 项通过，Node 2055 项中 2000 通过、55 跳过、0 失败。TypeScript noEmit、ESLint、命名、格式、docs:check、生成协议无漂移及 git diff --check 通过；OctoSpec lint 通过，计 421 个 OKF 单元、20 条规则、3076 个本地文件链接。平台为 macOS / Node 24，其他平台以 PR CI 为准。

远端 main 保护要求 CI Gate 通过、至少一位 reviewer 批准且讨论已解决；不绕过保护。提交和 PR 使用英文，保留已配置作者及 Codex trailer；不发布 npm。

## PR 206 参数校验范围修复

reviewer 在 `138a74c` 指出 P2：装配所选 Extra 的整个命令树时，每个字符串选项都扫描本次调用的全部原始参数，导致未选中兄弟命令的同名字符串选项误拒绝当前命令的布尔开关。用户明确每个子命令只使用自己的参数和全局参数，并要求修复后重新提交。

新增回归先在旧实现复现 `custom-service check --mode` 返回退出码 2。现将原始缺值边界检查移至选项的 argParser，仅在 Commander 实际消费本命令选项时触发；构建兄弟命令不再校验当前输入。仍保留原始 token 边界，以拒绝祖先参数被取走后将 `--port --home X 123` 拼成合法输入；重复参数、必填和显式等号值规则不变。

回归覆盖同名布尔/字符串选项的两种声明顺序、直接和嵌套路径、普通与别名帮助、全局 JSON 参数穿插，以及兄弟专属选项不得出现在当前帮助或被接受。CLI 构建、TypeScript noEmit、ESLint、命名与改动文件格式检查通过。6 个相关测试文件共 90 项，86 通过、4 项平台条件跳过、0 失败；本轮不重复全量 suite，跨平台验证以新提交的 PR CI 为准。

## 再次同步 main 并解决冲突

按用户要求 fetch 最新 `origin/main@f421f0e`，以 merge 同步已推送的工作分支，保留原提交历史。上游新增 Issue 63 Unix 服务 fixture 隔离；唯一冲突为 `.octospec/index.md` 当前任务列表的同位置新增项，解决时同时保留 CLI 与 Issue 63 两个入口。生产源码无冲突，integration_baseline 更新为 f421f0e。

合并后执行 CLI 帮助、Extra 命令、CLI 生命周期与 cross-service 四个测试文件，111 项全部通过；上游改动文件的 Prettier 检查、暂存差异空白检查和 OctoSpec lint 通过（423 个 OKF 单元、20 条规则、3078 个本地文件链接）。本轮仅合并上游测试及文档，无需重新构建；平台为 macOS / Node 24，跨平台结果以新 PR CI 为准。
