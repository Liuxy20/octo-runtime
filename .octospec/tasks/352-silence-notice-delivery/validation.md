---
type: Validation
title: PR352 静默通知交付验证
description: 记录竞态复现、真实计时、全量回归、发布包和删除残留检查。
tags: [validation, silence, race, release]
---

# 基线与范围

2026-11-11，ab9762dc791853c59c18349a6141888606c7ac64 上的修复工作树；Darwin arm64、Node 24.22.2。只改通知交付竞态和对应手动测试、文档。Runtime 持有时间事实，业务仍自行消费；没有新增协议字段或 Gateway 状态。

# 已执行检查

- `pnpm typecheck`：构建、生成与类型检查通过。
- `pnpm test:suites`：1464 项，1403 通过、61 跳过、0 失败。
- `node --test test/manual/model-output-silence.test.mjs`：18 通过、1 真实计时项跳过；随后 `OCTO_SILENCE_LIVE=1 node --test test/manual/model-output-silence.test.mjs`：19 项全部通过，包含真实 Kernel/client 的两段 60 秒计时、重放和输出重置。这是本地真实计时及 loopback 验证，不是真实模型验收。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`pnpm docs:check`：全部通过，文档运行测试 4 项通过。
- `node scripts/pack-release.mjs`：重建 Runtime/client 两份本地 0.0.0 包；`node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` 全部通过；`OCTO_CLIENT_TEST_VERSION=0.0.0 node --test test/manual/runtime-client-309.test.mjs`：11 项全部通过。
- 独立 `/tmp/silence-delivery-race.mjs`：基线输出 0 条通知并失败，修复输出 1 条通知后正常交付文本；前后日志 `/tmp/silence-delivery-race-{before,after}.log`。独立 `/tmp/silence-delivery-slot.test.mjs`：2 项通过。
- 临时删除 lint `/tmp/octo-envelope-lint.bBwNmu/check.mjs`：源码 252、构建 306、打包 419、文档代码块 95、Schema 4，0 发现，5 类残留种子检出。日志为同目录 `review352-*.log`。

最终 `uv run --with pyyaml python .octospec/scripts/lint.py` 通过：765 个 OKF 单元、20 条规则、3547 个本地链接。临时文档 lint 检查 9 个变更 Markdown、4 个 JSON 示例、2 个通知示例，元数据检查 6 个知识 Markdown；共 7 个负向种子检出，0 发现。`git diff --check` 通过。临时脚本仅用于本地专项，系统可能清理它们；永久回归保存在 test/manual。相对 origin/main 的 `.github/`、package.json、pnpm-lock.yaml 无 diff；没有新 workflow、job、矩阵、触发器、必需状态或默认专项测试入口。未执行真实 Provider、Gateway 或 Windows/Electron 验收；未合并或正式发布。

提交前核对远端旧 head ab9762dc 的实际检查：Ubuntu/macOS Node 24/26 构建测试打包、Windows Node 24/26 发布包检查，以及既有 dependency-review、history、label、pr-title-lint、secret-scan 和 CI Gate 均成功。该结果只属于旧 head；修复提交将由既有检查重新运行，未增加检查项。

# Windows CI 失败跟进

[4bb30c53 的 CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/42860129644) 中，Ubuntu/macOS Node 24/26 全部成功；Windows Node 24/26 均在既有文件权限检查失败，CI Gate 随之失败。合计 4 次 ACL 读取均在约 10 秒被 execFile 终止，killed=true、signal=SIGTERM、stdout/stderr 为空。之后同 helper 的模块路径用例成功；证据确认子进程预算耗尽，但不能区分 PowerShell 启动和模块加载各自耗时。

测试 ACL 查询与负向 Set-Acl 的有限预算调整为 30 秒；嵌套 Node 外层为 45 秒。专项子 Agent 独立核对全部调用方、错误传播和外层期限，无未关闭发现。权限正负断言、模块隔离与非零失败保持，未添加重试或平台跳过。

本地执行与失败步骤相同的 4 个测试文件：18 通过、1 个 Windows 专用用例按既有条件跳过、0 失败；Prettier 检查通过。真实 Windows 由推送后的既有 CI 验证，本地结果不能替代。相对 origin/main 的 workflow、package.json 和 lockfile 无 diff。
