---
type: Validation
title: Issue 309：双包发行与独立客户端验证
description: 记录最终本地归档、包外 npm/pnpm、基线互操作、发布恢复、现有回归和未验环境。
tags: [testing, packaging, release, protocol, lifecycle]
---

# 验证记录

首轮实现记录保留如下；PR #316 同步最新 main 的冲突解决与重验见末节。前述归档大小和完整性仅属于首轮产物。

2026-11-05，按[确认设计](design.md)完成本地实现。worktree `octo-runtime-issue-309-runtime-client`，分支 `codex/issue-309-runtime-client`；基线和 HEAD 均为 `de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，工作树 dirty，尚无本次提交。测试包版本 `0.0.309` 仅用于本地，不表示已发布。构建元数据为相同 commit、`dirty: true`、`buildTime: 2026-11-05T02:28:58.985Z`。

环境：macOS 26.6.2 / Darwin arm64，Node 24.22.2、pnpm 11.19.0、npm 12.2.1。所有安装和模拟发布均在独占临时目录，不安装系统服务、不执行真实 npm/GitHub 写入，不改变用户 Runtime Home。

## 最终发行物

两包来自一次 workspace 构建，通过 `node scripts/pack-release.mjs --version 0.0.309` 产出；最后仅重新构建 client 以同步入口注释后再打包。归档位于仓库 `dist/release/`（忽略的本地产物）。解包字节统计为 tar 内全部文件内容之和，不包含文件系统占用开销。

| 包 | 归档 | 压缩字节 | 解包字节 | 文件数 | 内置依赖包数 |
| --- | --- | --- | --- | --- | --- |
| runtime | `mininglamp-oss-octo-runtime-0.0.309.tgz` | 1601522 | 6670792 | 1234 | 68 |
| client | `mininglamp-oss-octo-runtime-client-0.0.309.tgz` | 121415 | 962166 | 81 | 1 |

runtime 完整 SHA-512：`sha512-P2YsFEQVpbP5eGvxmOY+x19swq39B3Px//h8PwAYtdyIu1aGVSBjpAUlgeiBPouoLasy9IHq/mDkf7blHhpxBw==`。

client 完整 SHA-512：`sha512-fdMZosDHeT/G/1XDR7NuJZs8lUHghcYi+5SgYPLp2/iQRP0M5+ULA1B5Dccxv5lxBjGlx3JHaA15o/2H+3sf6g==`。

client 唯一运行依赖为内置 `@mininglamp-oss/octo-runtime-protocol@0.0.309`；没有 CLI、Kernel server、Core、Host、Adapter、Extra，全部传递 JS/d.ts 无这些依赖。runtime 将同版本 client 和 protocol 物化到自身 node_modules，内部只解析一个客户端/协议实例。全部 client exports 目标存在；四份 schema 与唯一源码原件字节一致；两包构建元数据完全一致；发行 manifest 无 workspace/link/file。安装产物无工作区软链。

这些数字只反映当前本地归档大小，不声称启动、吞吐、内存或真实产品性能提升。

## 实际命令

下表最终命令退出码均为 0；初轮失败及修复另记，不混入最终通过数。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | lockfile 冻结安装通过；lock 仅增加三个 importer 的 client 关系，没有第三方版本升级 |
| `pnpm typecheck` | 完整 build 和根类型检查通过；随后 client 注释同步后单独 build 通过 |
| `pnpm lint`、`pnpm lint:names`、`pnpm format:check` | 全库通过，命名 0 findings |
| `pnpm test:suites` | WebUI 35/35；Node 2400 项中 2334 通过、66 按原有条件跳过、0 失败 |
| `pnpm docs:check` | 35 对双语页、71 Markdown、20 JSON 示例、14 Mermaid、12 Context 示例；4 项运行验证通过 |
| `node scripts/check-developer-docs.mjs --scope current` | 163 文档、2117 链接、112 fragment，0 errors；127 外链按既有规则跳过 |
| `pnpm native:check` | 3 组生成输入及文件 hash 一致；未改 schema 或生成文件 |
| `uv run --no-project --with pyyaml python .octospec/scripts/lint.py`、`git diff --check` | 657 个 OKF 单元、20 条规则、3990 个本地文件链接及空白检查通过；临时 PyYAML 环境未修改仓库依赖 |
| `node scripts/pack-release.mjs --version 0.0.309` | 同次产出上述两个同版本 tgz |
| `node --test test/manual/runtime-client-309.test.mjs` | 最终 tgz 的 6 项全通过 |
| `node --test test/manual/runtime-client-release-309.test.mjs` | 19 项全通过；包括实际 workflow run 脚本的本地命令夹具 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.309.tgz --expected-commit de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` | 单 runtime tgz 空缓存全局离线安装、公开类型、内置 Extra/WebUI、原生 Kernel、独立 Extra、Host store、状态 sink、恢复探针、CLI 和卸载保留 Home 全通过 |
| `pnpm run test:global-extras dist/release/mininglamp-oss-octo-runtime-0.0.309.tgz` | npm/pnpm v11 实际全局安装、独立分组、命令/配置/ESM initializer、混合来源、后续安装/移除均通过 |

手动 client 验证在 npm/pnpm 各自仓外工程、空缓存/空 store、禁用 NODE_PATH 下执行：先仅安装 client，一个 tgz 即可离线安装；随后加 full，一个 runtime tgz 即可安装。两种情况下执行 strict=true、skipLibCheck=false 的外部 TypeScript；同时安装后检查跨发行物双向结构类型、schema/validator 行为一致，以及发行物内部的 attachKernel/KernelError/validator 身份。跨发行物 KernelError 确认不是同一个类，符合用户确认的发行模型。

基线兼容专项通过 `git archive de3ff37a86ee3cb8f6ab66148ceca817f6ae5240` 提取原 protocol、Adapter SDK、Core 和 Kernel，按原 tsconfig 逐包编译。仅编译工具、Node 类型及第三方 import-meta-resolve 借用现有工具链，服务端未使用当前实现。独立 client 从最终 tgz 空缓存安装后连接该基线服务，status/list/invoke、真实事件及关闭后服务仍可用均通过。基线服务完整 close 后才删除所属临时目录。

## 验收映射

| ID | 本地结果与证据 |
| --- | --- |
| A01-A04 | 通过：最终归档闭包、exports、schema、构建来源、npm/pnpm 外部安装、严格类型和身份边界 |
| A05-A06 | 通过本地 fake Provider：包外原生服务、service.client、standalone attach 关闭隔离；既有 public SDK/Host lifecycle/Extra direct 与 IPC 回归通过 |
| A07-A08 | 通过：唯一实现迁移；既有 canonical/native、问答/审批、取消/abort、尾流、未知 ACK/控制、原游标和实例恢复回归均通过 |
| A09 | 通过：未知/缺失 IPC 版本仅发 status，不发 invoke；拆包前固定基线 Kernel 互操作通过 |
| A10-A11 | 通过可控夹具：两包均缺、任一存在、两包存在只补缺包；两个预检中任一冲突/鉴权失败则无上传；上传 ACK 丢失后先确认已发字节；构建时间能由任一包恢复，双来源时间冲突失败；原有延迟可读和有界超时测试通过 |
| A12-A13 | 通过可控夹具：Release 只补缺失附件，已有附件必须 cmp 相等；完整双 npm/双附件各自核对 integrity；三 latest 中断恢复、不回退及 dry-run 零写入；历史单包不会被当作新双包完整记录 |
| A14 | macOS npm/pnpm 离线和全局真实安装通过；Windows 真机 **not run**，现有平台模拟测试不作真机证明 |
| A15 | 本地现有完整检查通过；生成来源未变；CI 结构及默认 scripts 比对通过，远端实际 checks **not run**（未提交/推送） |
| A16 | 归档体积/依赖/来源已记录；平台和真实集成边界如下 |

## CI 范围

以 YAML 结构对比固定基线与当前所有修改的 workflow：触发器、顶层权限、job 集合、job 所有非 steps 字段（包含矩阵、needs、if、并发）、step 数量、每步 actions uses 均未变。ci.yml 的 check/Windows/Gate 仍分别为 15/23/1 步；npm-publish 的 validate/verify/publish 为 5/0/6 步；release-publish 的 npm/Release/latest 为 0/2/3 步。

仅修改现有构建归档/上传材料、双包预检与发布、部分附件恢复和 latest 对象；根 package.json scripts 完全相同。原有测试只调整 private/单包路径旧断言与 UTF-8 合成 status 的合法字段，没有增加测试个数。新增 6+19 专项均在 `test/manual/`，不被 `test/*.test.js` 或 CI 默认 selector 选择。无新增 workflow/job/matrix/trigger/required status/needs，也无新增专项 CI 步骤。尚未推送，不把本地比对记为远端 CI 已通过。

## 失败处置与边界

- 初始草稿缺 PathLimits 导出导致编译失败，已修复；全构建/类型和端点旧用例通过。
- 曾把 lint 与带 clean 的 build 同时运行，临时缺失 dist 导致大量类型解析错误；改在完整构建后执行，全 lint 通过，没有放宽规则。
- 新 status 校验暴露两个 UTF-8 接收夹具返回不合法 status，已补足原协议字段，保留大字符拆包/字节上限/后续连接恢复断言；全套通过。
- 旧发行测试硬编码所有 workspace private 及单归档路径，已按双包合同调整原断言。双语新示例注释同步后通过现有 docs 检查。
- global Extra 旧验收脚本只取 npm pack JSON[0]，在 npm 12 包名索引输出下失败；复用仓库既有 parseNpmPackResult，原场景通过，没有增加场景或 CI。
- 手动夹具的身份重复、模块路径、workflow run 区块截取及基线 after 清理顺序问题已修正；最终手动 25 项均通过。Review 发现的三项规范问题均修复，见[审查记录](review.md)。

Node 26、Linux/Windows 原生安装及 named pipe 真机、Electron 打包、真实 Provider turn、官方 npm 新包权限/provenance 和真实 npm/GitHub Release 均 **not run**。本次移动既有客户端实现，真实 Provider/Electron 不由 Node fake Provider 结果推定；没有通过真实 publish 试探权限。原生 Go/Python 运行测试未重跑，本轮仅明确执行 native 生成校验。所有手动临时服务均完整关闭后清理，未改变用户 Home。

以上为提交前取得的本地证据。两轴审查完成后，用户追加授权英文 commit/push 并向 main 创建 PR；提交前重新 fetch 确认 origin/main 仍为相同基线，并复核知识检查和 workflow 范围。合并、打 tag 和正式发行须另按授权执行。

## PR #316 同步 main 与冲突重验

2026-11-05，按用户追加授权将 `origin/main@11dbab88` 合入 `codex/issue-309-runtime-client`，合并前 HEAD 为 `0fe46d97640fea01416b4e6c4fdfe8e38079eb17`。`runtime-home.ts` 文本冲突来自 #314 统一启动诊断与本分支纯路径抽取。将纯启动诊断和 catalog 迁入 client，Kernel 显式兼容转发，生命周期仅复用数据类型；服务启动、文件系统及日志 IO 保持完整 Runtime 所有。包外消费者手动夹具增加安全诊断、旧别名、catalog 和发行物内部错误身份断言，不增加默认测试或专项 CI。

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check` 全部通过。
- `pnpm test:suites`：WebUI 35 项通过；Node 2334 通过、66 项原有条件跳过、0 失败。
- `env TMPDIR=/tmp node --test test/manual/startup-diagnostics.test.js test/manual/startup-diagnostics-review.test.mjs`：30 通过、1 项 Windows ACL 真机测试跳过。首次使用 macOS 默认长临时目录时，一例 CLI 缺模块场景先触发 IPC 路径过长校验；仅缩短本次手动运行的 TMPDIR 后通过，未修改产品校验或上游测试。
- `node scripts/pack-release.mjs --version 0.0.309` 重新生成双包；`node --test test/manual/runtime-client-309.test.mjs test/manual/runtime-client-release-309.test.mjs`：25 项全部通过，包含新增诊断断言、独立安装及原基线 Kernel 互操作。
- `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.309.tgz --expected-commit 0fe46d97640fea01416b4e6c4fdfe8e38079eb17`：完整包离线安装、公开类型、原生 Kernel、独立 Extra、Host store、恢复、CLI 及卸载保留 Home 全部通过。构建发生在合并提交前，因此元数据使用该旧 HEAD 且 dirty；未将该归档作为正式发行物。
- 相对最新 `origin/main` 解析比较全部 13 个 workflow：文件集合、触发器、job、矩阵、needs、权限、step 数和 actions 均相同；根默认 scripts 相同。workflow diff 仍仅为原 PR 的三个双包发行适配文件，本次同步未修改 workflow。推送前 PR 实际 checks 仍为既有 CI 六个平台组合及 Gate、依赖/历史/标签/标题/密钥/workflow 检查，另有既有 `code-review` 状态；本次不增加检查。

本节结果为本机 macOS/Node 24 证据；新合并提交的远端 CI 需由推送触发，未以旧 HEAD 的远端通过状态代替。Linux/Windows/Node 26 和正式发布边界仍按前节列明。

## 远端 review 后续：dry-run 候选语义修复

2026-11-05，在干净 HEAD `954e2c1605f0073c329610c58e37f031f1ba7f7d` 复现 yujiawei 的 review：空发布状态与候选 `9.9.9` 原返回三项提升 actions，但没有任何写入；正常执行拒绝空完整集合。用户随后授权改代码并英文回复修复内容与定级意见。

修复后不修改 readState 的完整集合；候选只参与模拟目标选择。未验证目标输出 `targetVerified: false`、`candidate.verified: false`、空 `actions`、三项 `conditionalActions` 及明确的非发布就绪警告，写入仍为零。已验证目标正常返回 actions；候选较旧时分别报告候选与实际目标验证事实。正式函数调用与 CLI 一样拒绝候选，鉴权/读取/integrity 失败和 latest 下界拒绝保持。

- `node --test test/release-latest.test.js test/release-build-time.test.js test/release-manifest.test.js test/manual/runtime-client-release-309.test.mjs`：52/52 通过，含既有 28 项和显式手动 24 项。新增 5 项均在手动文件；既有默认 dry-run 测试只同步返回值断言，未增加默认测试数。
- 手动专项覆盖未发布空状态且输入对象不被污染、已验证/较旧候选、函数正式执行拒绝候选、client latest 下界、验证失败透传；生产 command client 分别覆盖双包完整、缺 client npm 版本、缺 runtime 附件和缺 client 附件，验证 dry-run 零写入及正式提升行为。
- `pnpm typecheck`：完整构建和根类型检查通过。本次不改 SDK、wire、打包或依赖，未重跑全量业务套件与发行安装，不将之前结果标为本轮重验。
- 原复现以 `node --input-type=module` 显式调用重跑：返回未验证状态、空 actions、conditionalActions 和警告；写入数组为空。未执行真实 npm publish、latest 更新或 GitHub Release 写入。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、开发文档检查和 OctoSpec 检查全部通过：166 文档/2133 链接无错误，661 个 OKF 单元/20 条规则/4011 个本地文件链接。相对最新 main 重新结构比对 13 个 workflow 及根 scripts，范围相同；本次相对 HEAD 的 workflow/package.json diff 为空。

新增专项保持显式手动运行；本次 workflow、默认 scripts 和测试 selector 均未修改。英文 review 回复说明该模拟假设在 main `11dbab88` 已存在、正式发布不传候选且始终验证远端产物，建议 P2 定级；接受并修复输出歧义，不自行撤销 reviewer 的 changes-requested。

## 再次同步 main：#317

2026-11-05，按用户追加授权将 `origin/main@b5396834`（#317：Codex 常驻服务及 Core scope）合入原 PR 分支，合并前 HEAD 为 `0110782dc9277ca5c695154e93b8497de9a12b25`。四处文本冲突分别为知识目录、日志、Kernel 客户端转发和 UTF-8 测试；知识内容均保留，Kernel 仍仅转发，新的 `assertKernelStatus` 接入 client 唯一实现。保留既有 IPC 版本错误优先级与 `INVALID_RESPONSE`，新服务快照按共享校验器白名单/数量限制处理；UTF-8 场景使用合法 kernel_instance_id 字段承载文本。此前 dry-run 修复完整保留。

- `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check`、`pnpm native:check` 均通过。native Schema/生成文件来自 main，未手改生成产物。
- `pnpm test:suites`：WebUI 35 项通过，Node 2334 通过、66 项原有条件跳过、0 失败。
- `node scripts/pack-release.mjs --version 0.0.309` 重新产出双包；`node --test test/manual/runtime-client-309.test.mjs test/manual/runtime-client-release-309.test.mjs`：35 项全部通过。新增 5 项仅在手动 client 文件，覆盖旧 status、合法快照、禁止字段、非法 owner PID 和快照超限；非法响应仅发 status、不发 invoke。原基线 Kernel 互操作、npm/pnpm 单 client/双包离线安装、严格类型与 dry-run/恢复验证继续通过。
- `node --test test/manual/codex-service-lifecycle-313.test.mjs`：30 项全部通过，包含服务快照、scope 清理、恢复和成功/清理分离的离线夹具。
- `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.309.tgz --expected-commit 0110782dc9277ca5c695154e93b8497de9a12b25`：完整包离线安装、公开类型、原生 Kernel、独立 Extra、Host store、恢复、CLI 及卸载保留 Home 全通过。归档构建于合并提交前，元数据仍为上述旧 HEAD/dirty，仅作为本地验证产物。
- OctoSpec、开发文档和最终格式检查通过：670 个 OKF 单元/20 条规则/4066 个本地链接，166 文档/2143 链接无错误。提交前再次 fetch 确认 main 仍为 `b5396834`；相对该目标解析比对 13 个 workflow，触发器、权限、job、矩阵、needs、步骤数和 actions 以及根 scripts 均未扩围。本次合并相对上一 HEAD 不修改 workflow/package.json；PR workflow diff 仍仅为原双包适配的三个文件。推送前实际检查列表仍是既有六个平台组合、Gate 和治理检查，旧 HEAD 全通过不作新合并提交通过的证据。

本轮保持既有 workflow、默认 scripts 和测试 selector；新增专项仅手动运行。未重新调用真实 Provider、修改用户 Home 或执行正式发布，Windows/Linux/Node 26 等结果仍由新提交远端 CI 及独立实测提供，不借用 main 或前一提交的通过状态。
