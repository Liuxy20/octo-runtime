# DSH 改用未修改的官方 SDK

## 目标与授权

2026-10-26 用户要求：提交 DSH 上游反馈；在新 worktree 移除两个下游依赖补丁；保留 DSH 接入，接受官方 SDK 当前的稳定性及资源回收限制。后续明确授权提交 Git commit、推送并创建 PR；不要求撤回 DSH、升级 SDK、发布或合并。

基线：`origin/main@8af836068780ebb76581225254ad7bef18cc8170`。

## 责任与范围

- 产品目标：让 octo-runtime 直接使用官方 SDK，不承担 DSH 内部实现的长期补丁维护。
- 决定权：用户接受 DSH 实验性接入；SDK 内部的读取预算、诊断保留和进程树清理由上游提供。
- 显式输入：既有 DSH 版本、调用参数、取消信号和会话 ID 保持其调用语义。
- 合同内动作：删除 patchedDependencies 与补丁文件、去掉专属扩展参数和发行补丁复制；调整文档和回归验证到官方能力范围。
- 越界动作：不得另写 SDK、读取私有 child 字段或增加代理来恢复已移除的保证；不得为消除失败伪造执行成功。
- 其他接入产品：不修改共享 Core、Kernel、其他 Adapter 的预算和资源清理规则。

## 验收

1. 上游反馈包含项目用途、两个补丁的目标、可复现边界及固定源码链接；官方关闭 Issues 时使用其指定的 Discussions。
2. 源码安装和发行打包使用未修改的 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3` 与 Protocol；依赖锁中无 patch hash。
3. DSH 保留文本、工具、续聊、取消及 canonical 映射；相关测试仍运行。
4. 文档明确官方 SDK 不保证解析前输入/诊断/lineage 的内存上界与完整后代回收；Runtime 只保留自身投影及队列预算。
5. 类型、lint、DSH 测试和发行验收通过；真实 DSH 验证与 fixture 分别记录。

## 交付状态

上游官方仓库关闭 Issues，依照 README/CONTRIBUTING 的指定入口提交 [Discussion #11031](https://github.com/deepseek-ai/deepseek-harness/discussions/11031)，后续追加两个完整折叠 diff、参数接线方式与固定测试链接。通过 API 读回，两个 diff 与 `8af8360` 中原补丁逐字一致。

`codex/dsh-upstream-sdk` 已移除两个补丁文件、pnpm 应用声明、扩展参数和发行补丁复制。保留官方 0.2.1-rc.3、原生调用和取消、Runtime 自身投影及队列限制。README、双语 Provider 文档和 Adapter 规则同步说明实验性边界。旧任务的补丁与验收记录为历史，不代表当前保证。

验证结果见 [本轮 journal](../../journal/shared/2026-10-26-dsh-upstream-sdk.md)。按用户后续授权通过 `codex/dsh-upstream-sdk` 交付 PR，最终远端状态以 GitHub 为准；合并与发布未获授权。
