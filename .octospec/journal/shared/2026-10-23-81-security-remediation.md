---
type: Journal
title: Issue 81 与 Dependabot 安全整改验证
description: 最新 main 基线、逐条告警复核、本地检查与交付边界。
tags: [security, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 基线与交付边界

本轮从干净 main 快进至 `origin/main@445d2bb`，建立 `codex/fix-81-security-backlog`。用户初始授权提交、推送和创建英文 PR，后续明确授权按逐条处置流程合并 main。未修改 Git author 配置；提交保留 Codex attribution trailer。

原分析为 CodeQL 2.27.2/security-extended 103 条规则、35 条告警；最新 main [托管重扫](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39889943281)成功，CodeQL 2.27.3、同一 suite/103 条规则、39 条 open：原 #2/#11/#13 旧路径 fixed，新增 #36 至 #42，迁移后的相同缺陷仍修复。全部 42 条及两个 Dependabot 告警的根因、信任边界、处置与依据见 [disposition](../../tasks/81-security-remediation/disposition.md)。没有降低查询集、全局排除路径或批量 dismissal。

# 实现与本地证据

保留身份和 URL 语义，以线性扫描消除 PEM、appSlug 与尾斜杠处理退化。配置、日志、dotenv 和 WeCom 探针在打开后的同一描述符校验并读写；拒绝链接、非普通文件，避免 FIFO 阻塞，配置读取有界。截图使用独占临时目录和文件，重启夹具以 wx 文件认领序号。Vitest 及配套 mocker 升级到 4.1.12，覆盖两个已知 GHSA。

2026-10-23 在 macOS arm64、Node 24.19.0、pnpm 11.19.0 验证：

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names` 通过。
- 最终全量 `pnpm test:suites`：UI 35 通过；Node 1710 项，1670 通过、40 跳过、0 失败。
- 最终针对性回归 28 项通过，包括新增 8 项安全回归、hourly-log、adapter-failures、channel-tool-environment。覆盖超长恶意输入限时、打开后路径替换、链接/FIFO/权限/容量失败和 8 并发进程序号认领。
- appId 用例追加 20 万连字符后跟普通字符的失败后缀，核对既有 48 字符截断结果；旧正则在隔离子进程触发 1.5 秒 timeout，修复后 8 项安全回归全部通过。
- `pnpm docs:check` 通过；发行 tgz 打包成功，包含新 URL helper，未发布 npm。
- `pnpm audit --json`：所有严重级别均为 0；`git diff --check` 通过。
- 修改文件 Prettier 检查通过。`uv run --with pyyaml python .octospec/scripts/lint.py` 仅报告 main 已有的三项 frontmatter 缺失：tasks/systemd-directive-paths 的 brief.md、review.md 及 journal/shared/2026-10-22-systemd-directive-paths.md；本次未修改这些文件。
- 从三个真实 CDP 脚本提取模板，以六类恶意字符串逐一构建并执行，18 项保持原数据且不执行注入；从 App.tsx 提取两处实际 hash 路由 guard，10 项恶意路径均拒绝。
- 从实际截图脚本提取函数，离线替代 CDP 返回值：重复 online 状态生成不同文件，目录 0700、文件 0600。没有执行真实桌面操作。

# 复核与尚未验收

逐条核对真实数据流；HTML 注释删除只产生可见性布尔值、JSON 字面量只承载数据、QA 配置的认证请求及私有测试断言各有独立依据，不通过改写合法流程隐瞒告警。可复用规则回写 engineering 的安全告警与文件操作复核一节。

本机不能证明 Windows 真机行为；不支持 O_NOFOLLOW 的平台仍验证文件类型及 dev/ino，已在 Windows CI 增加 security-remediation、hourly-log 与 channel-tool-environment 三组回归。没有执行需要真实账号、模型、IM 或桌面写入的 live 探针。最终合并 main 的重扫、逐条 disposition 审核及 Dependabot fixed 状态是 Issue 关闭条件，当前不宣称面板已清零。

首次新增 Windows Node 26 安全门禁中，security-remediation 六项适用用例和 hourly-log 全部通过，FIFO/Unix 权限两项按平台跳过；原 channel-tool-environment 的无条件 POSIX 0600 断言失败（Windows stat 返回 0666）。已将权限位断言限定为 POSIX，所有平台保留普通文件及 dotenv 内容、顺序、幂等和隔离断言；修复后重跑 CI，不移除 Windows 门禁。

# 分支托管扫描与 PR

修复提交 `62491940f031412dcfd38efd8157756f42fd5f2c` 的 [CodeQL run 39892494476](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39892494476) 成功，analysis `2010235423`；CodeQL 2.27.3、javascript-queries 2.4.8（与最新 main 同一固定构建）、security-extended 103 条规则。实际结果为 28 条，比 main 少 11 条，未新增告警；所有本次修复项均不再命中，逐条结果已写回 disposition。剩余 28 条分别有误报或预期安全流程依据，尚未 dismissal，等待 PR 评审确认。

[英文 PR #115](https://github.com/Mininglamp-OSS/octo-runtime/pull/115) 已创建。实现与测试提交 `9f537b0f93748fc1394f0ea048567c871b4c0684` 的[最终扫描](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39893266678)成功，analysis `2010264327`，同工具/查询包、103 条规则、28 个原有结果且无新增；[六平台 CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39893259209)全部通过。

# 后续处置与合并授权

#15/#16 先分别登记测试误报。用户后续认可已说明的流程并明确授权合并 main；按 disposition 中各自的数据流和证据，逐个核验其余 26 条告警的规则/状态后分别标记 false positive，每条独立英文理由可在 GitHub 告警页追溯。原始 SARIF 仍保留 28 个结果，处置状态与扫描发现数量分别统计。未修改查询集、配置目录排除或隐藏合法数据流。

GitHub main 分支保护要求至少 1 位 reviewer 批准、strict CI Gate，且 enforce_admins 为 true；仓库 autoMergeAllowed 为 false。PR 当前无批准，现有 reviewer 请求为 Jerry-Xin、yujiawei、mochashanyao；当前账号也是 PR 作者，不能自批。用户的合并授权已取得，但 GitHub 的独立审批门禁仍需满足，不修改分支保护或伪造审批。最终合并及 main 重扫结果仍待实际完成，未关闭 Issue #81。

# PR P2/P3 复现与修复

Jerry-Xin 对 `6655058` 的 [review 5623626814](https://github.com/Mininglamp-OSS/octo-runtime/pull/115#pullrequestreview-5623626814) 提出两项真实问题，状态为 CHANGES_REQUESTED，均应在合并前修复：

- P2：`writeFile(mode:0644)` 会被宿主 umask 收紧。隔离命令以 077 启动原安全测试，确认为 7 通过、1 失败，WeCom 正确返回凭据缺失而非权限错误。现对本测试独占的虚构文件显式 chmod 0644，不改测试进程的全局 umask，也不放宽生产权限 guard。
- P3：去掉 `/api` 后，CLI 只删除 href 的一条尾斜杠，实际 dotenv 把 `/tenant///api/` 写成 `/tenant/`，与 Gateway 及旧行为的 `/tenant` 不一致。新增实际 dotenv 与 Gateway 的 8 组对照用例，原实现首例失败。改为第二次线性扫描完整 href 后缀，保留内部重复分隔符及非最终 api 路径；CLI 继续不导入业务 Extra。

修复后，security-remediation、channel-tool-environment、hourly-log 共 21 项在 022 和 077 两种独立命令环境下各自全部通过；build/typecheck、lint、lint:names、修改文件 Prettier、docs:check 通过。全量 `pnpm test:suites`：Node 1711 项、1671 通过、40 跳过、0 失败，UI 35 项全部通过。后续托管检查、复审与 main 验收继续在 PR 跟踪；CHANGES_REQUESTED 需要 reviewer 复审，不能由作者代为清除。

# Windows 发行验收失败跟进

`eee611a` 的 CodeQL analysis 2010450091 成功，103 条规则、28 个原始结果、分支 open 为 0。Jerry-Xin 已复审该提交并 Approve。[CI 39897739552](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39897739552) 首次在 Windows Node 24 身份查询中被现有 30 秒期限终止；该查询及启动测试与基线一致，具体系统超时原因未确定。只重跑失败任务后，此检查通过，但最终离线发行验收报 `EBUSY rmdir orc-*`，其余五组矩阵通过。

检查发行脚本确认两个缺陷：`finally rm` 会覆盖原始验收错误；Windows `child.kill(SIGTERM)` 强杀 CLI leader 后，finally 因 leader 已退出跳过 taskkill，可能遗留 worker。另有命令 execFile timeout 只终止 leader 的同类所有权问题。发行验收改为 spawn 创建明确所属的进程组/树，超时先回收树，Windows 前台 CLI 在 leader 存活时 taskkill /T /F；保留原始错误与清理错误，并为各实际验收阶段输出名称。删除目录仅做有界句柄释放重试，不吞掉失败。

用户随后明确要求 Windows 直接采用 40 秒：生产身份查询总期限从 30 秒改为 40 秒，仍查询真实系统 UTC ticks，不缓存或退回 PID。外层 Windows 运行验收为身份查询 40 秒、后续 RPC 就绪 15 秒及关闭预留共 60 秒；编译期限不变。mock 回归同时断言传给系统命令的 40 秒期限，并继续验证身份查询失败禁止 worker 登记。

新增真实后代进程持有 cwd 的超时/停止回归，确认后代退出后目录可删；原始错误、stdout/stderr、退出码及 EBUSY 聚合各有断言。相关 30 项本地通过，离线发行安装与公共 SDK/CLI 验收通过；Windows Node 24/26 显式执行新增回归及完整发行验收，实际结果继续在 PR 记录。本机 macOS 的结果不代替 Windows 证据。

加入发行清理回归后的完整本地 suite 为 Node 1676 通过、40 跳过、0 失败，UI 35 通过。40 秒变更后 build/typecheck、lint、格式与 diff 检查通过；身份登记、启动回滚及发行相关 38 项为 37 通过、1 个 Windows 实机用例在本机跳过。进程树回归最终再跑 5 项全部通过。Windows 真实行为须以本次提交的 CI 为准。

# 发行封装 P2/P3 失败路径修复

[review 5623908244](https://github.com/Mininglamp-OSS/octo-runtime/pull/115#pullrequestreview-5623908244) 对 `bb4b3fd` 指出两项新问题，均成立：树回收失败、fallback kill 未生效时，主流程一直等 close，无法到达聚合错误；spawn 的 ENOENT 被数字 close 状态覆盖。原有 umask 与 URL 修复仍有效，但该提交的绿色 CI 不覆盖这两项新失败路径。

先加入回归，旧实现两项失败：缺失命令实际 code 为 -2；回收失败与 fallback 拒绝时两秒观察窗仍 pending。现为终止后单独保留最多一秒 close 确认窗口；未确认退出返回原始超时与系统回收错误的 AggregateError，显式携带 cleanup.complete=false、closed=false 和真实 PID，unref 未回收进程不等于终止成功。fallback 返回 false 或直接抛错分别覆盖，测试仍以原始 kill 最终回收本测试独占的真实子进程。本地 Windows 分支故障注入不代替原生 Windows 证据。

保留原始 errno code，数字状态另存 exitCode；命令非零退出仍保留原有数字 code 兼容。相关发行/诊断测试 33 项通过，最终故障回归 3 项通过；lint、格式和 diff 检查通过。完整本地尝试中 UI 35 项通过，Node 未改动的 ACP 用例在五秒触发超时；同期系统 load average 达 89，离线 npm install 达六十秒期限。本次完整 Node 验证已中断并保留日志，不宣称本地全量或离线验收成功；新提交的托管全矩阵与离线验收结果在 PR 跟踪。
