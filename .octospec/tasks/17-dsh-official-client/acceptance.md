---
type: Task
title: 官方 DSH Client 验收与审查
description: 区分自动化、真实 Desktop、测试 IM、浏览器阻塞与官方 SDK 资源限制。
tags: [dsh, adapter, testing, review]
timestamp: 2026-10-25T00:00:00Z
---

# 基线与范围

基线 `982a2fe7b976071f76b9626af4cb65c9d2e50d08`，分支 `fix/17-dsh-official-client`，下列运行结果取自提交前 dirty 工作树。macOS arm64，Node 24.19.0，pnpm 11.19.0。官方 Client/Protocol 与本机 Desktop 的 DSH 均为 0.2.1-rc.3，wire 为 0.0.1。本记录不能证明原生 Windows 或其他 DSH 版本。

使用 verified-review 串行阅读每个源码、配置、测试及知识文件，覆盖 24 个文件；生成的 pnpm-lock.yaml 只核对直接依赖和精确版本，不逐行审查传递依赖。删除的 client.ts 作为替换上下文。检查公开接口、资源所有权、取消/超时首错、通知队列、脱敏、会话恢复、Desktop execve、发行入口、许可证和失败测试。

# 自动化

| 命令 | 结果与范围 |
| --- | --- |
| `pnpm build` | 全仓构建与公共声明通过 |
| `pnpm exec tsc -p tsconfig.json --noEmit` | 通过 |
| `pnpm lint` / `pnpm lint:names` | 通过 |
| `pnpm test:suites` | Node 1772 项：1731 通过、41 跳过、0 失败；UI 35 项通过 |
| `pnpm docs:check` | 文档样例与配对检查通过 |
| `pnpm format:check` / `git diff --check` | 通过 |
| `node scripts/pack-release.mjs` | 官方 Client/Protocol 的 JS 进入发行包，完整 Provider 不进入；许可证修复后重跑通过 |
| `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz` | 空 npm cache 离线安装、实际发行 Adapter fixture、公共类型/样例、SDK/CLI 生命周期与卸载保留 Home 通过；许可证修复后重跑通过 |

41 个 Node 跳过中包含一项新增的官方 SDK 孤儿进程组限制；不得将它计为通过。原始非法行测试按官方握手超时失败，通知大小测试检查解析后的对象，均不再证明旧自实现的解析前原始行限制。

# 真实执行

`node scripts/verify-dsh-live.mjs` 经实际 KernelClient 与官方 HarnessClient 调用 Desktop：新建成功、同一 session 恢复原始标记、真实工具写文件成功、缺失 session 明确失败且不创建替代会话、Provider 失败、取消并保持兄弟任务完成、后续恢复成功。Kernel close 报 complete=true，errors 与 pendingResources 均为空。

空缓存安装 tgz 后，从包外 `/tmp/octo-dsh-official-consumer/probe.mjs` 导入已安装主包公开的 `/executor-kernel` 与 `/adapters/dsh`，由独立 worker 再调用真实 Desktop。新建与原 session 续聊恢复标记均通过，关闭无 pendingResources。探针最初因缺少 initialize 和把 undefined 放入输入而被合同拒绝；修正探针后才执行到 Provider，不将前两次失败算作产品执行成功。

`OCTO_CHANNEL_QA_ACCOUNTS=<指定本地文件> node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm` 在真实 im-test、既有专用 QA 群通过：真实 @ 接纳、无 @ 拒绝、同一群 session 续聊、真实工具、同一张卡片完成更新、关闭时终态与 final 已确认、Provider 错误卡片、兄弟任务/Kernel 保留、重启回复。stop drain 实测 120 毫秒，仅代表该次样本。

以上 IM 验证由测试客户端发送并读取服务端结果，不是浏览器可视化验收。既有四个可用 Bot 的两两 DM 只读检查均返回 not_friend；遵照用户要求不建立好友关系。DM 保持 BLOCKED，待指定已有关系账号。

# 浏览器

使用 Playwright 启动本机可见 Chrome，真实打开 `https://im-test.deepminer.com.cn/`，点击“Octo 登录”，跳转 `https://accounts-test.imocto.cn/login`，显示手机号/邮箱和密码表单。已检查实际 DOM 与登录页截图，没有伪造登录态、注入消息或 mock 后端。

用户给定文件是七个 Bot 条目，其中四个提供可用 Bot Token，没有人类网页登录凭据。浏览器停在登录页，消息、卡片、续聊的浏览器操作保持 BLOCKED，不能用上面的 API 验证代替。已向用户请求可网页登录的测试账号文件路径或在可见 Chrome 中登录，凭据不进入本记录。

# 审查结论

首轮托管 CI 在安装阶段因五个未声明策略的 Provider 传递依赖 hook 失败；逐项核对 scripts 后，将精确版本的 dsh-subprocess-local、Google genai、koffi、node-pty、protobufjs 设为 allowBuilds=false。Runtime 不运行 npm 安装的 Provider，实际 Client/Protocol JS 不引用这些 helper；不放开任意安装脚本。修复后本地正常 prepare 构建通过。

首轮 Dependency Review 发现新增依赖的 undici 8.11.2、zod 4.4.3、MCP client 2.2.0、fflate 0.8.2 含公开漏洞。按 GHSA-xjj6-f33q-929c、GHSA-mrhx-c7xc-m3w5、GHSA-6prh-2h8m-c8cw、GHSA-px8p-9vwx-vf98 的修复版本，分别精确 override 为 8.12.2、4.6.6、2.3.0、0.8.3。没有修改官方 Client 源码或版本。重新构建、冻结 lock 安装、格式检查和全量测试通过；Node 仍为 1731 通过、41 跳过，UI 35 通过。新的托管 CI/Dependency Review 待核对，不能将首轮失败写成通过。

发行脚本最初仅写 MIT 名称，遗漏上游完整版权与授权文本；read-confirmed，已在本轮修复：从两个实际 npm 包复制完整 LICENSE，并由发行验收断言授权与版权文字。修复后离线验证通过。

仍保留两项已证实的官方 SDK 限制，不以“无问题”覆盖：

- `src/index.ts` 的 `client?.close()` 使用官方 dispose，只确认直接子进程退出；上游先检查 child.exitCode，再对子进程 kill，没有进程组所有权。父进程退出后仍在工作的孤儿工具无法保证回收。证据级别 read-confirmed，原进程组 fixture 明确跳过；正常真实工具取消通过不证明该异常分支。需上游公开进程树清理能力后再补资格验证，不能读取其私有 child 或重写 Client。
- 通知过滤回调中的 `Buffer.byteLength(JSON.stringify(notification))` 位于官方 JSON 解析之后。上游 reader 未设解析前行字节上限，超大/无换行原始输入不能沿本地 StreamLimitPolicy 提前拦截。证据级别 read-confirmed；解析后大小与有界 canonical 队列测试通过只证明下游边界。需要上游提供公开 reader 预算配置。

官方 Client 替换与可用路径已验证；完整端到端验收尚未完成。浏览器、既有好友 DM、原生 Windows 及上述上游限制不得标记通过。PR 保持草稿，未合并 main；独立 reviewer 与 CI Gate 也须满足。
