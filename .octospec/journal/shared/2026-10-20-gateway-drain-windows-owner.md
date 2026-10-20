---
type: Journal
title: Gateway drain 与 Windows Job 产品接线验收
description: 记录真实IM、跨包回归、包外运行及尚缺的平台证据。
tags: [lifecycle, channel, windows, testing, sdk]
timestamp: 2026-10-20T13:40:00Z
status: in_progress
---

# 实现与源码

## 终态先于订阅的误报修复

`816ad54` 后续 P2：Kernel 在订阅 ACK 确认源已 completed 并释放登记后，Gateway 仍可能等待交互展示。真实 IPC 回归先复现完整消费和 final 已成功、但 close 因 INVOCATION_NOT_TRACKED 失败。现以每次 attempt 的原流正常耗尽与真实终态共同确认，仅协调这一登记缺失竞态；控制错误、丢流、缺终态和业务收尾失败继续拒绝关闭，原3秒/4秒共享预算不变。

本地 macOS arm64/Node24.19.0/pnpm11.19.0：专项71通过；完整UI35/35，Node1355通过/10平台跳过，0失败或取消；typecheck/lint/命名/格式通过。新增两组真实 Kernel 用例覆盖成功与 finish 失败；九组反向/终态用例验证不吞未知或其他错误、放弃观察不算耗尽；既有活动执行取消、兄弟隔离与失败路径全部保留。命令为 `node --test test/gateway-runner-drain.test.js test/gateway-shutdown-drain.test.js test/im-task-retry.test.js test/kernel-invoke.test.js test/kernel-invoke-lifecycle.test.js` 及 `corepack pnpm@11.19.0 test:suites`。真实IM、发行包及其他平台本轮未重跑，不沿用旧成绩替代本次验收；新提交CI与review状态另行确认。

## main@e82a2f0 rebase 与核心注释

按用户要求将 PR72 rebase 到已合入 PR73 的 main。冲突处理保留上游 KernelClient.invoke/独立登记、Windows CI 与任务索引，旧 extra-port 删除。Gateway 的取消调用与新增 fixture 使用 cancelInvocation/accepted；runner 并行等待 Kernel 排空与业务 dispose，两者共用原有4秒预算，换算 epoch 期限时不增加额度，最后再断开 client。检查 range-diff，历史原生提交仅保留 Git 历史，最终产品无 Go broker 接线。

用户追加核心注释约束已写入 AGENTS.md 和 engineering 规则。核心实现和接入使用须解释职责、必要输入/结果、所有权、调用顺序、复杂状态转换与竞态；修改行为时同步维护。补齐 Core/Kernel 的输入准备、模型 Context、watchdog、接纳/ACK、订阅恢复、client 登记、worker RPC/监督/进程、身份清单与共享期限注释；SDK 示例增加清理责任说明，删除 serveWorker/rpc/Core README 的旧架构描述。注释不改变产品策略或公开接口。

本地环境 macOS arm64/Node24.19.0/pnpm11.19.0：build/typecheck、lint、命名、格式、OKF 和 diff 检查通过；UI35/35，Node1344通过、10平台跳过，0失败/取消。Gateway/Kernel专项62/62；取消回执统一后的 disposal14/14。

im-test 真实 Codex 工具开始后，以 --cards 联验 SDK 与 --cards --cli 联验 CLI：stop分别390ms/280ms，返回前同一卡片终态编辑已获ACK、唯一final可回读、兄弟Run与Kernel仍可用、重新创建后再次回复。只记录群指纹d010c2b3cd5a，不包含凭据/正文；ACK不代表客户端渲染。此轮未重跑故障注入；对应历史证据不冒充当前结果。干净提交发行包与远端CI另行确认，Windows真机和异常退出后代回收限制仍保留。

## 后续 P2：跳过交互卡终态编辑

PR72 的新评审指出：终态编辑 API 可因 disabled/profile404 返回 undefined，原先等待后仍删除 pending，导致 finish 假成功。通过真实 GatewayTransport/OctoConnector 和受控 HTTP 复现六组；修复前四个异常组失败、两个健康对照通过。修复要求返回原 messageId 才能移除，未确认记录保留并让 finish 失败。新增回归覆盖全部卡片继续收尾、重复 finish 保持失败、能力恢复后编辑原卡而非替代卡，以及 dispose 失败仍投递唯一 final。定向三文件46项通过；本地macOS arm64/Node24.19.0类型、lint、命名、格式、OKF、全套UI35及Node1307通过/10平台跳过，无失败或取消。最终提交CI在PR72跟踪；这属于受控 HTTP/编排验证，本轮没有重跑真实IM或修改真实 Bot 能力配置。

## Node-only 修订验证

当前工作区：macOS arm64、Node24.19.0、pnpm11.19.0；公共代码和构建/分发无 Go broker。typecheck、lint、命名、格式、OKF通过，UI35/35，Node1300通过/10平台跳过、0失败/取消；双轴复核未发现新增P1/P2，重点四文件53项通过。

真实 IM 继续使用用户指定测试环境和账号，group fingerprint为`d010c2b3cd5a`。命令为`OCTO_CHANNEL_QA_ACCOUNTS=<本机账号文件> node scripts/verify-gateway-drain-live.mjs --cards`，CLI增加`--cli`；故障模式以`--fail-card`替换`--cards`。SDK/CLI正常卡片stop为281ms/294ms，同一消息的终态折叠编辑获得真实REST ACK、唯一final在stop返回时可回读、兄弟与Kernel存活、重建后可再回复。终态卡片拒绝注入为665ms/500ms，两入口均incomplete、重复stop失败保持、仅尝试一次且final可回读。故障为客户端受控注入，不记作服务端自然故障。

服务端消息sync返回创建时渲染内容，不返回编辑后的原始reasoning状态；因此只确认终态编辑ACK，不能声称客户端渲染或终态读回。Windows父先退/Runtime强杀清树仍无强保证，现有complete仅覆盖既有可观测结果。最终干净提交的发行包及CI结果另记。

## 撤回前的历史证据

2026-10-20 用户明确撤回公共层原生方案。以下记录属于历史提交，Go broker 与二进制发行已从当前实现撤除；旧 Windows Job 成绩不能用于 Node.js 方案。当前强制边界见[架构约束](../../rules/architecture.md#实现语言与原生依赖边界)，新验证另行记录。Windows 父先退和强杀后代回收不标记完成。

工作分支为`feat/gateway-drain-windows-cleanup`，基于main的`fae6333`。规划PR68已关闭；本记录不表示它曾包含实现。`6b79493909ed80b40e75b35b1747d1939e14408f`包含Gateway drain、全部owned launcher的Windows Job接线、原生关闭竞态修正及真实IM验收脚本。后续提交统一runner外层的单调截止，并修正终态之后卡片/final仍在发送时的连接提前撤销，公开API不变。

Gateway停准入后保留原调用消费及投递，最多3秒drain、4秒共享清理；失败保留归属。已撤回的 Windows 原型将目标挂起后关联 Job，等待后代及 broker/stdio 关闭；对应源码已删除，不再作为现行机制说明。

# 本地与发行包

环境：macOS/arm64，Node24.19.0，pnpm11.19.0，Go固定1.25.14。下列产品检查及发行包基于干净`6b79493`：

```sh
corepack pnpm@11.19.0 typecheck
corepack pnpm@11.19.0 lint
corepack pnpm@11.19.0 lint:names
corepack pnpm@11.19.0 format:check
corepack pnpm@11.19.0 test:suites
node scripts/pack-release.mjs
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz --expected-commit 6b79493909ed80b40e75b35b1747d1939e14408f --require-clean
```

结果：类型、lint、命名、格式通过；UI35/35，Node1289通过、18平台跳过、0失败/取消，共1307项，Node部分31.5秒。跳过不计Windows通过。包外离线安装、skipLibCheck=false公开类型、owned Kernel、独立Extra、CLI Kernel、卸载保留Home全部通过；包内两架构PE/摘要及Go许可通过。

终态后连接修正后的工作区再次完成typecheck、lint、命名、格式和OKF检查；UI35/35、Node1291通过/18平台跳过，共1309项，0失败/取消，Node部分30.6秒。两项新增回归不改变平台跳过口径。提交后在干净`1d6104fdf477cfa30512be9dbcaba3ccc73d1bd2`重建，使用上述pack与verify命令（expected-commit改为此完整SHA）通过离线安装、公开类型、owned Kernel、独立Extra、CLI Kernel及卸载保留Home。

# 真实IM

用户指定`https://im-test.deepminer.com.cn/`及受保护账号文件。脚本以临时CLI Home使用两个明确授权的User Bot，只复用二者均加入的`Channel_QA_`群；记录只保留群指纹`d010c2b3cd5a`。不输出token、账号ID、消息正文或规则正文。

```sh
node scripts/verify-gateway-drain-live.mjs --inspect
node scripts/verify-gateway-drain-live.mjs
node scripts/verify-gateway-drain-live.mjs --cli
node scripts/verify-gateway-drain-live.mjs --fail-delivery
node scripts/verify-gateway-drain-live.mjs --cli --fail-delivery
```

每条命令由调用方设置`OCTO_CHANNEL_QA_ACCOUNTS`指向受保护文件，不把凭据放入命令参数。环境为上述macOS/Node，真实Codex CLI0.154.0。SDK使用独立Extra与Kernel、宿主loadContexts；CLI使用真实前台Gateway与同一指定Kernel。兄弟Run通过独立已接纳调用观察隔离。

| 场景 | 实际结果 |
| --- | --- |
| SDK工具开始后stop | 98ms，complete=true；立即回读唯一final；真实terminal；兄弟Run和Kernel保持可用；重新创建后再次真实回复 |
| CLI工具开始后SIGTERM | 109ms，成功退出；同样有唯一final、真实terminal、兄弟隔离与重新创建回复 |
| SDK实际发送边界注入拒绝 | 621ms，complete=false，重复stop仍失败；真实Provider/连接，final发送尝试1次；兄弟与Kernel可用 |
| CLI实际发送边界注入拒绝 | 481ms，失败退出，重复stop仍失败；发送尝试1次；兄弟与Kernel可用 |

故障注入针对实际WebSocket sendText边界。最初REST拦截没有命中文本路径，该次结果不算故障验收通过；改到实际边界后两入口均通过。该结果不声称服务端实际发生过503。独立runner受控测试另验证cancel ACK→尾binding→唯一final→connector.close的顺序；真实IM回读证明stop时已存在最终消息，不额外虚称抓取了服务端断链的精确时间。

终态后连接修正的工作区重复真实联验：SDK127ms、CLI141ms，两者再次确认真实工具已开始、终态、stop时唯一final、兄弟/Kernel隔离和重新创建后回复；SDK发送故障468ms、CLI549ms，仍报告incomplete且仅尝试1次。

# CI与未验项

`3d56095`的[CI39426380604](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39426380604)全部通过，但仅是原型。`3cd3fde`的[CI39428394531](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39428394531)Windows Job/Provider步骤通过，原生组件步骤暴露cleared先于broker退出而错误报告processExited的竞态，之后超时；Linux两项失败已修正。macOS该轮收到runner shutdown信号，不记为断言通过。`0cb54c7`的中间run因后续修正已主动取消。

`6b79493`的[CI39431785904](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39431785904)：Windows与macOS job通过，包含最终tgz。Windows扩大步骤62项中60通过/2跳过，生命周期101项中94通过/7跳过；原生组件3项通过，100次创建回收后句柄203→203。Linux在IM集成测试收尾挂起，该轮已主动取消以取得日志，不记为全绿。

使用官方`node:24.19.0-bookworm-slim`容器在Linux/arm64复现：终态到达后活动任务表已空，但`session.tail`仍在发送，close误判空闲而撤销连接，导致IM_DELIVERY_UNKNOWN。修正为在线连接统一在drain后撤销；新增卡片结束和final发送两个精确窗口回归。测试fixture改为finally释放其WebSocket/HTTP资源，保留原失败。容器IM与drain回归11/11，本地加独立runner回归12/12通过。该Linux容器证据不代替Windows或CI amd64结果。

最终代码`1d6104f`的[CI39434536989](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39434536989)三平台和CI Gate全部成功。Windows归属步骤64项中62通过/2跳过，生命周期101项中94通过/7跳过；100次创建回收的句柄203→203，兄弟哨兵存活，最终安装包验证通过。Linux与macOS完整测试及离线发行包验证通过，Linux Node1291通过/18跳过，UI35/35。后续提交只回写此证据。

英文实现PR为[#72](https://github.com/Mininglamp-OSS/octo-runtime/pull/72)。仓库保护要求main至少一名reviewer批准、管理员同样适用，且auto-merge未启用。记录时PR仍待review，未合并；不修改仓库保护规则。

尚无原生Windows10/11桌面、arm64机器、实际客户应用构建/重启结果；Codex与Claude在Windows桌面的真实Provider回收仍待验证。拒绝嵌套Job/Win32查询失败的故障注入未执行；100次创建回收与哨兵不能代替所有资源故障分支。Windows Server/amd64结果、交叉编译和平台跳过分别计数。M5整体仍未完成，#14/#30更广验收和无关#55不自动关闭。

95分是原开发计划的可完成性自评，不是实现完成率或真机验收得分。后续验收不能通过降低[原矩阵](../../tasks/gateway-drain-windows-cleanup/acceptance.md)要求补齐分数。
