---
type: Report
title: Issue 81 逐条安全告警处置
description: 原 35 条、最新 main 新增 7 条告警与依赖漏洞的信任边界及验证记录。
tags: [security, testing]
timestamp: 2026-10-23T00:00:00Z
---

# 分析依据

- 原分析：`6fee2e1828587c26c97d185a60590d956ee10192`，analysis `1978622244`，CodeQL `2.27.2`，`javascript-queries 2.4.7+a7057b836bf29767461026718b14d20790b9085f`，35 条。
- 最新 main：`445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`，analysis `2010142591`，CodeQL `2.27.3`，`javascript-queries 2.4.8+a1575b98a8cc19bcfa7bb6cb41be688cb3dae65c`，39 条。
- 两次均为 `security-extended`、103 条规则。最新[托管扫描](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39889943281)成功；这只证明本次整改前 main 的现状。
- 原 #2/#11/#13 托管状态变为 fixed，但其中相同逻辑分别迁移为 #36/#40/#42；必须整改迁移后的实现。
- 下表“修复”表示本工作树已实施；分支托管结果及逐条 dismissal 状态在末节登记，合并 main 状态需另行核对。
- 表内包名省略 `packages/octo-runtime-` 前缀，app/script/test 路径相对仓库根目录。原 35 条及新增 7 条完整保留，未削弱查询、排除目录或隐藏数据流。

# 原告警

| 告警 | 当前责任位置 | 根因与处置 | 验证依据 |
| --- | --- | --- | --- |
| [1](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/1) | adapter-sdk/src/public-display.ts `redactCredentialText` | 真缺陷：多个无 END 的 PEM BEGIN 导致重复扫描。单向查找头尾；缺失 END 也脱敏到末尾。 | security-remediation：完整/重复/截断 PEM、长输入子进程限时；adapter-failures |
| [2](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/2) | 已删除 daemon home；迁移为 host-sdk/src/home.ts | 旧位置托管 fixed；相同首尾连字符正则仍存在，按 #36 修复，不恢复旧包。 | 最新托管扫描 + #36 回归 |
| [3](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/3) | extra-channel-gateway/src/transport/api/client.ts 及同类 URL 调用 | 真缺陷：未锚定的尾斜杠正则对长失败后缀退化。共用线性扫描，保持内部路径、末尾 `/api` 及 Bot 身份语义。CLI 独立使用等价线性处理，不反向依赖 Extra。 | security-remediation 长 URL；channel-tool-environment；IM 协议、规则及图片回归 |
| [4](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/4) | extra-channel-gateway/src/presentation/run-projector.ts `hasVisibleReply` | 误报：Markdown AST 的 HTML 字符串仅用于非空布尔判断，不生成或写入 HTML。删除注释后的字符串不返回、不进入 DOM；不把它当 HTML sanitizer。 | im-diagnostic-completion：隐藏注释不算回复、真正 HTML/代码/图片可见；审阅返回类型与唯一消费点 |
| [5](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/5) | scripts/verify-channel-connection-renderer-live.mjs `screen` | 误报：`JSON.stringify(id)` 作为独立 JS 字符串字面量插入 CDP 源码；引号和反斜杠由 JSON 序列化处理，不是仅替换某个危险字符。DOM 选择器的输入可能导致选择器失败，但不能突破 JS 字面量执行代码。 | 仅本机 CDP；来源为本脚本创建渠道返回的 ID；下文序列化负向验证 |
| [6](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/6) | scripts/verify-channel-features-live.mjs `createTestGroup` | 误报：固定键的群名、成员 UID 对象经 `JSON.stringify` 成为 JS 对象字面量，所有可变字符串均为值；CDP 执行前再次确认测试服务。不是 HTML `<script>` 嵌入，不存在关闭 script 标签的上下文。 | 仅读取显式 QA 账号；API 地址断言与身份核验；序列化负向验证 |
| [7](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/7) | scripts/verify-im-context-live.mjs `--human-callback` | 误报：卡片 ID/频道/回答作为固定形状对象的 JSON 值传给本机 CDP；JSON 编码保持数据字面量。仅显式真人回调模式调用，执行前验证测试服务。 | 序列化负向验证；未执行真实卡片操作，不冒充真人联调 |
| [8](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/8) | extra-webui/src/index.ts `Set-Cookie` | 按 WebUI 仅本地调试、非生产的合同判定为预期流程：服务随机生成 256-bit 本次启动会话令牌，以 HttpOnly、SameSite=Strict、无持久期限 cookie 交给本地浏览器；不是宿主长期凭据落盘。仅监听 127.0.0.1，核验 Host、跨站请求、写请求 Origin 和 token。本地 TCP 本身不提供 OS 账号隔离，不能将 IPC 的同账号合同外推为此处的账号鉴权。 | webui-extra 浏览器边界回归；architecture Extra 状态表明确仅本地调试、非生产，包 README 记录固定 loopback；远程或多账号隔离部署须重新设计 |
| [9](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/9) | extra-webui/web/src/lib/api.ts ← App.tsx hash 路由 | 误报：两个 hash 来源均先经过完整锚定 `^#/sessions/([a-f0-9-]+)$`，仅将捕获 ID 放进固定同源 `/api/sessions/` 路径。不能包含斜杠、点、查询、编码、外域或其他动作；网络目标不受 hash 控制。 | 源码双入口核验；下文 hash 路由负向验证；webui-extra 鉴权和 revision 回归 |
| [10](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/10) | scripts/verify-channel-connection-renderer-live.mjs 截图 | 真缺陷：共享 `/tmp` 固定截图目录。改为每次 `mkdtemp` 私有目录、0600、wx 文件及随机文件名，重复 online 状态不覆盖。截图保留用于人工验收。 | 本地无 CDP 的目录/文件创建验证；未执行真实桌面故障注入 |
| [11](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/11) | 已删除 apps/daemon；迁移为 apps/cli/src/openclaw.ts | 旧位置托管 fixed，相同 dotenv 检查读取迁移为 #40，已同步整改。 | 最新托管扫描 + #40 回归 |
| [12](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/12) | adapter-sdk/src/hourly-log.ts `write` | 真缺陷：路径上的 exists/lstat 不能保护随后的 open。移除前置检查，O_NOFOLLOW/O_NONBLOCK 打开后 fstat 校验 regular/nlink，保留独占小时锁、容量和清理合同。 | hourly-log：链接不写入、并发总容量；security-remediation：FIFO 不阻塞 |
| [13](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/13) | 已删除 daemon extra-config；迁移为 host-sdk/src/extra-config.ts | 旧位置托管 fixed，相同配置权限检查读取迁移为 #42，已同步整改。 | 最新托管扫描 + #42 回归 |
| [14](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/14) | extra-channel-wecom/scripts/probe-wecom.mjs | 真缺陷：stat(path) 后按路径重读。改为 open/fstat/readFile(fd)/finally close，拒绝链接及非普通文件，不输出正文或 Secret。 | security-remediation：公开权限文件拒绝、错误码输出、不泄漏样本值 |
| [15](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/15) | test/channel-tool-environment.test.js | 误报：stat 是写后 POSIX 0600 测试断言，不是决定是否读取的授权 guard；目标位于该测试独占 mkdtemp 内，无竞争写者。保留权限断言。 | channel-tool-environment 原回归；逐行核对 test setup/cleanup/断言 |
| [16](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/16) | test/channel-tool-environment.test.js | 同类独立误报：后续 read 用于断言配置另一 OpenClaw home 不会改动第一个 dotenv；前面 stat 仍是测试断言，所有操作顺序等待且没有并发写者。 | channel-tool-environment 原回归；独占测试目录 |
| [17](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/17) | test/context-mcp.test.js | 误报：stat(file) 的 0600 断言校验测试刚创建的 Claude MCP 临时文件，随后 read 验证 payload，finally cleanup；没有基于检查的生产权限决策或并发写者。 | context-mcp：权限、payload 与 cleanup 后 ENOENT |
| [18](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/18) | test/fixtures/restart-hanging-adapter-host.js | 真缺陷：exists/read/write 计数跨进程可丢更新。按序号独占 wx 创建认领尝试次数；无共享 RMW，非 EEXIST 错误传播，遍历有界。 | security-remediation：8 并发进程序号唯一、缺失父目录失败；保留第二次启动挂起合同 |
| [19](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/19) | adapter-openclaw/src/gateway.ts ← local-gateway.ts | 误报：宿主显式配置的 gateway_url/凭据用于该 Gateway 的原生认证连接。只接受 ws/wss；明文 ws 限回环；禁止 URL 用户信息/查询/hash；credential_ref 为固定目录/格式。没有读取任意文件并上报第三方。 | openclaw-runtime-connection：独立 profile、凭据引用、远程 ws 拒绝、连接刷新 |
| [20](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/20) | extra-channel-gateway/src/transport/api/client.ts URL | 误报：source 为明确指定 QA 账号文件中的 API Server 字段，sink 是该测试服务器 URL 的固定 API 路径；测试脚本对地址和 verify-bot 身份断言，消息不能改变服务器配置。 | im-protocol；QA 脚本地址/身份 guard；无任意文件上传 |
| [21](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/21) | extra-channel-gateway/src/transport/api/client.ts headers/body | 误报：source 为同一 QA 账号配置，Bearer 送到该账号指定且核验的 API；body 为调用者明确指定的业务 JSON，不是账号文件原文。配置来源受宿主控制。 | im-protocol 请求鉴权/body 断言；channel-tool-environment 不把凭据放进模型输入 |
| [22](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/22) | extra-channel-gateway/src/transport/api/cards.ts `getCardProfile` URL | 误报：固定 `/v1/bot/card/profile` 目标为核验的 QA API；source 只是账号文件的 API 字段，不上传文件内容。 | im-protocol 卡片能力协商、失败关闭 |
| [23](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/23) | 同上 Authorization | 误报：Bot token 按合同发送给该 Bot 的 API 服务以读取有效卡片能力；不回显 token、不转发原账号文件。 | im-protocol 鉴权与卡片协商 |
| [24](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/24) | extra-channel-gateway/src/transport/api/conversations.ts `fetchBotGroups` URL | 误报：同一受核验 QA API 的固定 `/v1/bot/groups` 读取请求。 | im-protocol；QA 脚本账号/服务核验 |
| [25](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/25) | 同上 Authorization | 误报：仅使用所选 Bot token 获取该 Bot 可见群列表，ACL 由 IM Server 校验。 | im-protocol 鉴权断言；不传原文件内容 |
| [26](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/26) | extra-channel-gateway/src/transport/api/rules.ts `getGroupMd` URL | 误报：API 来自受核验宿主配置，groupNo 用 encodeURIComponent 限定为路径参数，不能改变 origin。 | im-group-rules、im-protocol |
| [27](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/27) | 同上 Authorization | 误报：按当前 Bot 身份读取其有权访问的 GROUP.md；文件 source 是调用方选择的 QA 凭据来源。 | im-group-rules：权限/失败不伪装成空规则 |
| [28](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/28) | extra-channel-gateway/src/transport/api/rules.ts `getThreadMd` URL | 误报：固定 API origin；群及话题 ID 均 encodeURIComponent，不将远端正文当 URL。 | im-group-rules 话题规则回归 |
| [29](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/29) | 同上 Authorization | 误报：当前 Bot 对指定话题规则的正常鉴权读取；权限拒绝继续传播。 | im-group-rules、im-protocol |
| [30](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/30) | extra-channel-gateway/src/transport/connection-error.ts `connectionFetch` | 误报：包装 verify-bot/register 的既定认证请求；source 为显式 QA 文件。上层测试地址核验，认证两调用 redirect:error；失败只产生受控错误码，不能借错误回显 token。 | im-connection-state-machine；QA source guard 与 auth.ts/wukong.ts |
| [31](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/31) | scripts/verify-channel-connection-renderer-live.mjs 代理 fetch | 误报：只允许两个精确 req.url；API 地址先严格相等断言；转发 body 有 64 KiB 上限、redirect:error、15s deadline。仅本机代理到测试服务。 | 源码 allowlist/地址/容量/重定向核对；未执行真实故障注入 |
| [32](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/32) | 同脚本 `command` CDP | 预期安全流程：本机 CDP 经 Work App 的既有保存渠道接口写入本脚本所选 QA Bot 配置以测试连接状态；不是将账号文件原文发送到远端。使用前核验测试 App、空闲 Bot，finally 删除本次渠道。 | 本机固定 CDP、测试环境 guard 与本次创建 ID 跟踪；未执行真实桌面写入 |
| [33](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/33) | scripts/verify-channel-features-live.mjs CDP 建群 | 预期安全流程：本机 CDP 只收到本次测试群名和成员 UID；token 没有进入该表达式。群创建是显式 live 探针的目的，服务先核验为测试环境。 | #6 字面量核验；QA 地址和身份 guard；未发送真实消息/创建群 |
| [34](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/34) | scripts/resolve-release-build-time.mjs | 误报：网络内容仅写入新 mkdtemp 下固定 `release.tgz`；metadata name/version、npm HTTPS origin 和 sha512 integrity 均核验。tar `-xOf` 仅读固定成员到 stdout，不按 archive 路径解包至文件系统，不能控制输出路径或覆盖宿主文件。 | release-build-time：身份、origin、integrity、commit/dirty/time 校验和 finally rm |
| [35](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/35) | scripts/verify-codex-forwarding-live.mjs `--check-endpoint` | 误报：只持久化严格断言过的 HTTP status、固定 endpoint 和本地 randomUUID marker，未读响应正文。目标由本地探针父进程选在其 mkdtemp 内；wx/0600 拒绝覆盖。响应不能控制路径。 | 源码数据流核对；未执行真实模型/线上请求 |

# 最新 main 新增

| 告警 | 位置 | 根因与处置 | 验证依据 |
| --- | --- | --- | --- |
| [36](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/36) | host-sdk/src/home.ts `appSlug` | #2 的迁移路径；线性索引去首尾 `-` 后才按既有规则截到 48，保持原身份映射，不靠缩短输入隐藏退化。 | security-remediation：20 万后缀及正常 appId/profile 一致 |
| [37](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/37) | test/release-latest.test.js `!calls.some(...includes(...))` | 误报：includes 位于负向测试断言，用于证明从未调用禁止 registry；生产 URL allowlist 并不使用该子串匹配。该判断不会授予任何网络访问。 | release-latest、release-registry；核对生产 registry 校验 |
| [38](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/38) | apps/cli/src/logs.ts ← scripts/verify-stateless-live.mjs 固定临时 Home | sink 是 O_RDONLY 的日志读取，并未创建临时文件；但探针不应隐式选择共享固定 Home，移除该默认值，要求显式绝对 OCTO_STATELESS_LIVE_HOME。 | CLI logs 原回归；本地未执行 live 探针；最终重扫核对 provenance 是否消除 |
| [39](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/39) | apps/cli/src/output.ts ← 同脚本 | sink 为 `open(...,"r")` 读取启动诊断，并非临时文件创建；同 #38 消除测试默认共享 Home，不更改生产读取的合法用户 Home。 | CLI lifecycle 原回归；最终重扫核对 |
| [40](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/40) | apps/cli/src/openclaw.ts `syncCliOpenClawToolEnvironment` | #11 的迁移路径；open 后 stat/读取/收紧权限均使用同一 handle，finally close；不重新按路径 chmod。保留原子替换以及仅更新两项 dotenv 的合同。 | channel-tool-environment；security-remediation：符号链接目标不变 |
| [41](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/41) | executor-kernel/src/endpoint.ts `acquireEndpoint` | 误报：CodeQL 将前一次 wx 创建尝试当 read 的授权检查；实际仅在 EEXIST 分支读旧 owner，且先独占 recovery 租约，确认原 pid 已 ESRCH 才移除；再次 wx 决定赢家，release 核对 nonce。同账号租约协议允许读已有 owner，不能删掉这条恢复路径。 | extra-startup/host-sdk 生命周期及端点独占回归；逐分支核对 recovery/nonce/OS 账号信任边界 |
| [42](https://github.com/Mininglamp-OSS/octo-runtime/security/code-scanning/42) | host-sdk/src/extra-config.ts `readStoredExtra` | #13 的迁移路径；open/fstat/有界 handle.read/finally close。权限检查与内容为同一文件，实际读取最多 1 MiB+1，拒绝增长超限/链接/FIFO；不支持 NOFOLLOW 时再核对路径类型及文件身份。 | security-remediation：缺失、权限、目录、链接、超限、FIFO、打开后路径替换；cli-extra-directory |

# Dependabot

| 告警 | 原版本 | 修复 | 当前证据 |
| --- | --- | --- | --- |
| [1](https://github.com/Mininglamp-OSS/octo-runtime/security/dependabot/1) / GHSA-xp26-3454-mjgp | @vitest/mocker 4.1.11 | Vitest 及配套 mocker 升级至 4.1.12 | 官方修复线；pnpm audit 0；最终默认分支面板待核对 |
| [2](https://github.com/Mininglamp-OSS/octo-runtime/security/dependabot/2) / GHSA-qxg6-89mg-rqv8 | @vitest/mocker 4.1.11 | 同上，无跨主版本或单独强制覆盖 | UI 回归；最终默认分支面板待核对 |

上游依据：[Vitest 4.1.12](https://github.com/vitest-dev/vitest/releases/tag/v4.1.12)。`file-access-to-http` 是文件数据流启发式，不能单凭命中认定越权上传，见 [CodeQL 规则说明](https://codeql.github.com/codeql-query-help/javascript/js-file-access-to-http/)。代码字面量的上下文分析参考 [CodeQL code sanitization](https://codeql.github.com/codeql-query-help/javascript/js-bad-code-sanitization/)。

# 最终验证状态

修复提交 `62491940f031412dcfd38efd8157756f42fd5f2c` 的[托管扫描](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39892494476)成功，analysis `2010235423`；CodeQL 2.27.3、javascript-queries `2.4.8+a1575b98a8cc19bcfa7bb6cb41be688cb3dae65c`、security-extended 103 条规则均与最新 main 基线一致。结果从 39 降至 28，未新增告警。下列结果针对修复分支，不代表默认 main 的全局状态：

| 告警编号（逐条详见上表） | 分支实际托管结果 |
| --- | --- |
| #1、#3、#10、#12、#14、#18、#36、#38、#39、#40、#42 | 本次修复后不再命中，共 11 条 |
| #2、#11、#13 | 原路径已删除，latest main 与本分支均不再命中；迁移缺陷分别按 #36/#40/#42 验证 |
| #4、#5、#6、#7、#8、#9、#15、#16、#17、#19、#20、#21、#22、#23、#24、#25、#26、#27、#28、#29、#30、#31、#32、#33、#34、#35、#37、#41 | SARIF 仍命中，共 28 条；按各自信任边界和证据分别标记 false positive，均附独立英文理由与本记录引用；并非新增目录排除或查询抑制 |

实现与测试提交 `9f537b0f93748fc1394f0ea048567c871b4c0684` 的[最终分支扫描](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39893266678)成功，analysis `2010264327`；工具/查询包版本和 103 条规则保持一致，SARIF 28 项且无新增项。对应[六平台 CI](https://github.com/Mininglamp-OSS/octo-runtime/actions/runs/39893259209)全部通过，包括 Windows Node 24/26 的文件安全回归与发行验证。

# 逐条处置与合并门禁

#15/#16 已分别登记测试误报；用户后续明确认可真实问题修复、其余按证据逐条确认的流程，并授权合并 main。随后逐项核对剩余 26 个告警的规则 ID、当前 open 状态和本表依据，分别登记 false positive，每条独立填写英文理由，没有隐藏数据流或设置全局抑制。#8 限定仅 loopback 的本地调试、非生产场景，不宣称 TCP 提供账号隔离；#41 依赖独占恢复租约、PID ESRCH 和 nonce 校验；若未来扩大信任边界，必须重审。

工作树验证写入 [journal](../../journal/shared/2026-10-23-81-security-remediation.md)。[PR #115](https://github.com/Mininglamp-OSS/octo-runtime/pull/115) 已具备源代码修复和逐条处置证据，合并授权已取得。GitHub main 分支保护要求 `CI Gate`、最新基线及至少 1 位 reviewer 批准，管理员同样受保护；当前尚无批准，仓库未启用 auto-merge。不得自批或绕过保护合并。补充本记录后再核对最终提交检查；只有实际合并 main 并重扫、确认 Dependabot fixed 后，才能关闭 Issue #81。

# PR review 后续发现

[Review 5623626814](https://github.com/Mininglamp-OSS/octo-runtime/pull/115#pullrequestreview-5623626814) 的 P2/P3 均为需修复的回归，不归入上述 CodeQL 误报：P2 显式 chmod 测试独占的公开权限文件，确保 077 umask 下仍测试权限拒绝；P3 在移除末尾 /api 后线性裁去全部尾斜杠，恢复 CLI 与 Gateway 一致的 dotenv URL。两项均先复现失败再验证修复，具体测试证据见 journal；等待 reviewer 复审及最新提交门禁，不以旧提交的通过结果代替验收。
