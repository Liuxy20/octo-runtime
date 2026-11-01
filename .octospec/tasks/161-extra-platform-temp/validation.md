---
type: Validation
title: CLI Extra 平台临时目录本地验证
description: 记录当前源码的 macOS 业务断言、正常及失败清理、工程检查和 YAML metadata 审计边界。
tags: [testing, extra]
---

# 验证结论

最新结果以本节同步复验为准；下文首次实施记录保留历史版本与证据，不沿用为新代码的通过结论。

## 同步 main 后复验

### PR 交付基线 28c3ffa2

用户「更新代码 提交PR」认可当前已报告的验证范围并授权提交、推送及创建 PR。专用分支再次快进 2 个提交至 `28c3ffa2ef685e14ac58d57c2788c9d07b92471c`，目标测试上游未变，保留相同最小修复。

- `corepack pnpm typecheck`（含完整当前源码构建）、构建完成后顺序执行的 `corepack pnpm lint`、`corepack pnpm lint:names` 及目标测试 Prettier 检查均退出 0。
- 原目标测试 1 通过、0 失败、0 跳过；清理探针正常场景退出 0（`extra-home-rMnkn3`），指定断言失败场景按预期退出 1（`extra-home-Lpe7dX`），两场景父目录为空，探针工作区删除。
- 知识检查器通过 581 个单元、20 条规则、3569 个本地链接；全部 581 个知识文件有 mapping frontmatter，严格四字段检查仍为同一批 15 个历史缺项。本任务全部知识文件四字段齐全。
- 测试文件与 CLI main 构建产物 SHA-256 与下方记录一致，构建基于该基线加本地变更；随后提交包含相同代码内容。最终提交 SHA、推送及 PR 引用由 Loop 结果评论记录，避免在提交内自引用其 SHA。
- 相对该基线 `.github`、依赖、锁文件、默认测试入口均无变更，未扩大 CI。Standards 与 Spec 在该基线重新审查，各 0 项发现。
- Windows 原生和全量测试未执行，限制将明确写入 PR，不宣称跨平台全部验收通过。授权不包含自动合并。

### 最新版本 42102c60

用户再次要求「最新代码，开始实施」后，复用现有实现并快进一个主线提交至 `42102c60103a9b18166c499b0c74a23e0d2295c6`。仍处于等待验证审查，本次只同步和复验，不倒退状态、不新增实现范围。

- 当前源码 `corepack pnpm typecheck`（含重新构建）退出 0；全部构建结束后 `corepack pnpm lint` 退出 0。一次 lint 的进程结果因会话中断无法回读，重新执行后取得明确退出 0，以该次为准。
- 原目标测试 1 通过、0 失败、0 跳过；清理探针正常场景退出 0（`extra-home-iOc64O`），指定断言失败场景预期退出 1（`extra-home-mwS31e`），两场景父目录均为空，探针工作区删除。
- 知识检查器通过 572 个单元、20 条规则及 3546 个本地链接；严格四字段审计仍为原表中 15 个历史缺项，572 个知识文档均有 mapping frontmatter。
- 测试及构建产物的 SHA-256 均与下方记录一致；相对本次 origin/main 的 CI、依赖和锁文件无差异，修复 diff 不变。无新增提交、推送或 PR。
- Windows 原生及全量测试未执行，保留原有限制。本次同步不将初次基线的双轴审查表述为新版重新审查。

### 上次版本 88fe84ef

用户要求「更新最新main代码看一下」后，fetch 并将专用分支从 `c35b261b` 快进 5 个提交到 `88fe84efeabfd6e542153402a4e8e91190f7c9f5`。未新增提交或推送。目标测试的上游版本未变化，本地 `tmpdir` 修复完整保留；工程日志仅暂时移出本任务条目，快进后恢复，保留双方所有条目。

- `corepack pnpm typecheck`：退出 0，包含当前源码重新构建及根类型检查。待构建完全结束后执行 `corepack pnpm lint`：退出 0。
- `node --test --test-reporter=tap test/cli-extra-directory.test.js`：退出 0，1 通过、0 失败、0 跳过。
- 重跑同一仓库外清理探针：正常子进程退出 0，观察到 `extra-home-4htB5s`；指定断言失败子进程按预期退出 1，观察到 `extra-home-iahTzE`；两个父目录均为 `[]`，探针工作区回收。
- 仓库知识检查器：退出 0，568 个知识单元、20 条规则、3539 个本地链接。
- 严格四字段审计：568 个知识 Markdown 均有可解析的 mapping frontmatter，但仍有下表相同的 15 个历史文档缺 `description` 或 `tags`，退出 1。新增上游文件未引入其他字段缺项；该数量包含本任务 4 份本地知识文档。
- `git diff --check`：退出 0；相对当前 `origin/main` 的 `.github`、`package.json`、`pnpm-lock.yaml` diff 为空，未扩大 CI。
- 目标测试 SHA-256 仍为 `8e13130486b8dc36ccbbaf8b27596dba945112669c25e3ecfb10ba120d503a13`，当前构建 `apps/cli/dist/main.js` SHA-256 仍为 `057131a0d50cea16a8fc250dad302b0d34fa4f54a985a38579cd2be808ed64c6`。
- Windows 原生及完整测试套件本轮未执行，限制保持。原双轴代码审查绑定初次基线；目标修复 diff 未变化，本轮未重复启动双轴审查。

以下为首次实施记录。

本地实现及适用检查通过，等待验证审查。Windows 原生验收未执行，不能宣称全部跨平台验收完成。最新主线已补齐此前 7 个文件的 YAML frontmatter；严格检查新规范的必填字段时，仍有 15 个未修改历史文件缺项，详见下表。本任务知识文件的必填字段完整。

## 代码与环境

- 日期：2026-11-01。
- 基线：`c35b261b31573bc2f08a16eeced12f18705b2560`，在原专用 worktree 中从初始基线快进 6 个主线提交。
- 分支：`fix/161-extra-platform-temp`；主机：`lvsijiaMacBook-Pro.local`。
- 平台：macOS / `Darwin 25.6.0 arm64`；Node `v24.22.2`。
- 本机裸 `pnpm` 为 `12.4.1`，本次使用 `corepack pnpm`，解析为仓库要求的 `11.19.0`。
- 工作区：目标测试已修改，规格与验证记录未提交；没有提交、推送或创建 PR。保留配置的 Git 作者设置。
- 测试文件 SHA-256：`8e13130486b8dc36ccbbaf8b27596dba945112669c25e3ecfb10ba120d503a13`。
- 当次构建 `apps/cli/dist/main.js` SHA-256：`057131a0d50cea16a8fc250dad302b0d34fa4f54a985a38579cd2be808ed64c6`。

## 实现与验收对应

| 编号 | 结果 | 依据 |
| --- | --- | --- |
| A1 | 通过 | 仅新增 `node:os` 的 `tmpdir` 导入，并将 `mkdtemp` 前缀改为 `join(tmpdir(), "extra-home-")`。 |
| A2 | 通过 | 当前源码构建后，目标测试 1 通过、0 失败、0 跳过；两个 Home 的既有 CLI 读写断言保持执行。 |
| A3 | 通过 | 原测试在子进程独占 TMPDIR 中成功，观察到 `extra-home-2laniW` 创建/删除事件，退出码 0，父目录剩余条目 `[]`。 |
| A4 | 通过 | 仓库外副本在原配置断言后注入 `ORT59_EXPECTED_ASSERTION_FAILURE`，观察到 `extra-home-w9fH1C` 创建/删除事件，预期退出码 1，父目录剩余条目 `[]`。 |
| A5 | 未执行 | 当前没有已确认可用的 Windows 原生环境；未创建或删除机器级 tmp 目录，不用 macOS 结果代替此项。 |
| A6 | 通过 | 已记录源码、dirty、版本与命令；相对固定基线的 `.github`、`package.json` 和 `pnpm-lock.yaml` diff 为空，未修改任何 CI 入口或必需检查。 |

## 命令与结果

下表中的 pnpm 命令实际均通过 `corepack pnpm` 调用。

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile --ignore-scripts` | 退出 0，锁文件不变。 |
| `corepack pnpm build` | 退出 0，workspace 与 CLI 当前源码构建完成。 |
| `corepack pnpm typecheck` | 退出 0，包含重新构建及根类型检查。 |
| `node --test --test-reporter=tap test/cli-extra-directory.test.js` | 退出 0，1 通过、0 失败、0 跳过。 |
| 仓库外 `cleanup.mjs` 子进程探针 | 探针退出 0；正常子进程退出 0，注入失败子进程按预期退出 1，均无残留。 |
| `corepack pnpm lint` | 最终在构建及 typecheck 全部结束后顺序执行，退出 0。 |
| `corepack pnpm lint:names` | 退出 0，findings 为空。 |
| `corepack pnpm exec prettier --check test/cli-extra-directory.test.js` | 退出 0。 |
| `git diff --check` | 退出 0。 |
| `uv run --no-project --with pyyaml python .octospec/scripts/lint.py` | 退出 0，最终 549 个知识单元、20 条规则、3468 个本地链接。 |

首次 lint 与首次构建并行，类型声明尚未生成，报 296 个类型解析相关错误；第二次 lint 与 typecheck 的 clean/rebuild 重叠，报 1152 个同类错误。最终等待构建停止后单独运行 lint 通过，未通过修改源码或规则消除这些过程错误。后续顺序应为 build/typecheck 完成后再 lint，避免共享 dist 竞争。

构建存在既有 WebUI 体积和依赖 `use client` 指令提示，退出码为 0。本次未修改 UI 或构建配置。

### 清理探针方法

脚本位于本机独占验证目录 `ort59-verify.09qGnbb0Zy/cleanup.mjs`，未纳入默认测试或 CI。执行命令为 `node <独占验证目录>/cleanup.mjs <worktree路径>`。

- 使用 `mkdtemp(join(tmpdir(), "ort59-cleanup-"))` 创建探针工作区，两个场景各有已存在的临时父目录；只给子进程设置 `TMPDIR`。
- 正常场景直接运行仓库原测试，用目录观察器记录 `extra-home-*` 事件，检查 Node 测试统计、进程退出码和父目录空列表。
- 失败场景在仓库外复制目标测试，仅重定位 CLI import 到当前构建产物，并在原配置断言后增加一次故意失败；夹具创建、原业务断言和 after 清理不变。
- 断言子进程确因指定断言失败且非超时；两个场景都在子进程完成后检查无残留。探针的 finally 删除整个所属工作区。

## 最新代码的 YAML metadata 审计

更新主线后执行仓库检查器，通过 546 个知识单元、20 条规则及 3462 个本地链接（该次包含本任务初稿，尚未新增本验证/评审/journal）。此前报缺 frontmatter 的 137、246、267 共 7 个文件均已在主线补齐。

另以 PyYAML 解析 `.octospec/{rules,guides,tasks,journal,learnings}/` 的全部知识 Markdown，沿用检查器对 `index.md`、`log.md`、`*.template.md` 的豁免，逐项验证 `type`、`title`、`description` 为非空字符串，`tags` 为列表。结果：全部有可解析的 mapping frontmatter，但 15 个历史文件仍不满足新规范的必填字段。仓库现有检查器只要求非空 `type`，因此其通过并不表示新规范的四个字段全部完整。

| 历史文件（相对 `.octospec/`） | 缺失或无效字段 |
| --- | --- |
| `tasks/17-dsh-official-reviewed/acceptance.md` | `description`, `tags` |
| `tasks/194-extra-commands/brief.md` | `description` |
| `tasks/194-extra-commands/review.md` | `description` |
| `tasks/194-extra-commands/validation.md` | `description` |
| `tasks/210-kernel-recovery/assessment.md` | `description`, `tags` |
| `tasks/210-kernel-recovery/brief.md` | `description`, `tags` |
| `tasks/210-kernel-recovery/design.md` | `description`, `tags` |
| `tasks/210-kernel-recovery/review.md` | `description`, `tags` |
| `tasks/210-kernel-recovery/validation.md` | `description`, `tags` |
| `tasks/234-context-lifecycle/assessment.md` | `description` |
| `tasks/234-context-lifecycle/design.md` | `description` |
| `journal/shared/2026-10-16-hourly-log-delivery.md` | `description` |
| `journal/shared/2026-10-16-invoke-size-delivery.md` | `description` |
| `journal/shared/2026-10-27-194-extra-commands.md` | `description` |
| `journal/shared/2026-10-27-210-kernel-recovery-investigation.md` | `description`, `tags` |

上述为用户要求核对最新代码时发现的历史缺项，未扩展本次夹具修复去修改；严格全库四字段检查返回 1，不能将其报告为通过。本次新增或修改的知识 Markdown 单独检查全部四字段，并解析 `context.yaml`。

收尾时发现共享 `origin/main` 又前进 4 个提交，引用为 `4a0f53b50723422d90f051944ae19eb28f60712a`。使用 `git ls-tree` 和 `git show` 对该引用做只读审计：561 个知识 Markdown 均有可解析的 mapping frontmatter，仍是上表相同的 15 个历史必填字段缺项。较实施基线的这 4 个提交未修改目标测试。未将此更新引用冒充已验证实现基线，功能验证仍绑定 `c35b261b` 加本地测试修改。

## 审查与限制

- [两轴评审](review.md)及新增验证记录的终审均未发现本变更问题；规范轴与规格轴分别报告。
- 未运行完整 `pnpm test`；本次无跨包合同变化，按已确认规格运行定向验证。
- Windows、Linux 原生结果未取得；macOS 属于已验证 POSIX 环境。
- 此记录不代表用户已认可验证结果，也不授予提交、推送、PR 或合并权限。
