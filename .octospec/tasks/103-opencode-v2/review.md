---
type: Task
title: Issue 103 OpenCode 2 双轴审查
description: 固定 main 基线的 Standards 与 Spec 独立审查结论和验收边界。
tags: [adapter, testing, protocol]
timestamp: 2026-10-23T05:00:00Z
---

# 审查范围

基线为 `445d2bb24f6ffc27bb4414c835e6a0b365f9f25b`，实现提交为 `81f316e88c324e374b613dc6a12437da130fa5ff`；差异使用 `git diff 445d2bb24f6ffc27bb4414c835e6a0b365f9f25b...81f316e`。两个独立审查分别对照仓库规则与 Issue #103 / 最终任务简报。其后补齐验收记录，并对 PR Secret Scan 的固定无效凭据样例误报完成修复和独立收尾复核。

## Standards

未发现需要修复的问题。ACP 仅在关闭成功后归一普通执行错误，结构化错误和清理错误保留；CLI 以真实退出码判定成功，不由 step_finish 提前成功。环境、cwd、配置和临时资源归属符合仓库合同。提交保留配置的作者、英文消息和 Codex trailer。Fowler smell 检查无可操作发现。

## Spec

未发现需要修复的问题。V1 在 probe 和直接 invoke 均明确拒绝；两传输共用实际路径门禁。CLI 的 standalone、stdin、model/effort、V2 MCP 和退出检查符合合同；ACP 保留原生 deny，未应用的 effort 明确提示。16 个真实执行及独立 worker 的测试 IM 往返覆盖本次主要需求，共享 SDK/ACP 改动直接服务兼容与清理问题。

## 验证与剩余边界

实际检查结果和首轮高并发计时失败的复核过程见 [validation](validation.md)。最终 Node 全量 1674 通过、40 跳过，UI 35 通过，相关回归 84 通过，工程检查通过。OctoSpec lint 仍有 3 个已确认基线缺少 frontmatter 的错误，与本次变更无关。

真实集成仅覆盖 macOS arm64 / OpenCode 2.1.3 / deepseek/deepseek-flash；Windows/Linux、其他 2.x 和其他模型未实测。ACP effort setter 未实现；CLI 缺少显式 model 时不猜测模型引用。审查未将这些已公开的范围边界认定为本次阻断问题。

Standards：0 个发现；Spec：0 个发现；两个轴均无待修复问题。

## PR 收尾复核

远端 review 在 ad4e357 提出唯一 P2：固定无效 apiKey 样例造成 Secret Scan 失败。首次修复简化固定值，为真实原始历史指纹添加单条例外，同步命名检查的规范化 SHA256；错误认证语义保留，16 个真实场景再次通过。独立 Standards 审查还发现需同步该哈希，已修正并通过命名检查与 7 项回归，最后复核无剩余问题。完整历史及 PR canary 证明原行和邻行的新模式仍被拦截，具体证据及既有历史告警边界见 [validation](validation.md#pr-secret-scan-误报核验)。

用户随后明确凭据值及固定测试占位值禁止入库；首次扫描修复不代表满足这项设计约束。已补充架构规则，并将错误认证值和 MCP Authorization 值均改为运行期在内存随机生成，撤回保留固定值的做法。最终验证及托管重新审查状态分别见验收记录和 PR 最新结果。

## 最新 main 同步

按用户要求 rebase 到 `cc49c8b`；`git range-diff` 及逐文件比较确认原 OpenCode 实现、测试和真实验收脚本未改变，目录冲突保留 #81 和 #103 两方条目。原审查结论仍对应上述原始提交，不能当作对 main 新增整改的独立审查。精确历史扫描指纹随实现提交 SHA 更新，更新后检查见 [validation](validation.md#rebase-到最新-main)。

## yujiawei 最新审查逐项处理

2026-10-24 以被审查 head `9ca69ac24064627a4ec77783c5f27a8b8647a55b` 为固定点复核工作区差异，未新增既有历史归因。

1. PATH：审查中的绝对路径示例不成立，POSIX resolve 保留绝对项；真实子进程回归证明绝对／相对／空项顺序与最终执行一致。相对项属于宿主显式环境输入，workdir 并非操作系统安全隔离，不拒绝合同已有的相对项。补查修正实际 Windows 自定义根相对／盘符相对命令绑定 cwd 的缺口，新增三平台原生二进制探测，Windows CI 显式运行。
2. 裸 Error：成立。缺少最终输出改为 canonical run.failed，不吞掉 Provider 进程或清理异常。Core 回归同时验证唯一失败终态、cleanup complete 及指令临时文件删除。
3. 空字符串：成立。使用 string 类型检查，并同步支持 normalizer 已接受的 part 包装文本与 step-start 重置，避免真值非字符串和旧 step 文本误报成功。
4. rg：首轮按 main 已有依赖且 CONTRIBUTING.md 明确要求真实 ripgrep 处理，macOS/Linux CI 显式安装。审查环境中的 shell function 不能替代 spawn 可执行文件。用户后续要求进一步处理测试可移植性，已补下文的非 Git fixture 回退，不再以先决条件作为全部处置。

同时纠正 Jerry-Xin 的非阻断证据说明：MCP fixture 记录 header，验收脚本事后断言相等；该证据验证传递，没有验证服务端拒绝错误认证。

### Standards

独立规范审查无需要修复的问题。符合本机路径规则、唯一终态和资源所有权合同；测试不依赖 Windows shebang，未新增凭据常量，无值得要求重构的 Fowler smell。工具强制的格式和类型问题由实际工程检查覆盖。

### Spec

独立需求审查无需要修复的问题。路径门禁与执行一致，缺输出返回失败，文本及 step 状态与 normalizer 对齐，未扩大产品策略。Windows 原生测试已接入 CI，但本机 23 项通过不代表 Windows 已验证。

Standards：0 个发现；Spec：0 个发现。实际测试结果及 OS 边界见 [validation](validation.md#yujiawei-最新审查修复)。

## 最新 P2 与测试可移植性

Jerry-Xin 在 `1467724` 提出的 P2 成立：将 process.execPath 硬链接或复制到临时目录，不能保证动态链接 Node 的相对原生库仍可加载。改为 POSIX fixture 通过原绝对路径 shebang 调用安装位置的 Node；Windows 保留原生 exe 查找、PATHEXT、盘符及目录选择回归。没有修改版本门禁来接纳失败 fixture，也未跳过 POSIX 路径场景。

按用户补充的 rg 意见，缺少真实 rg 时仅为非 Git 目录提供 Node 遍历回退，保留固定目录排除、secret.md 排除、二进制内容跳过和不跟随内部链接；报告不再声称应用 Git ignore。真实路径任一祖先有 .git 的目录仍明确 RIPGREP_REQUIRED，其余 rg 错误继续失败。8 项命名测试主动清空 PATH 和 Path，避免碰巧依赖开发者或 CI 的安装；Windows 增加同一套测试。

两个独立审查再次分别核对 Standards／Spec。Standards 无需修复问题；Spec 发现 Git 祖先判断的符号链接绕过，改为 realpathSync(root) 后向上查找，并补真实子目录及外部链接（Windows junction）回归；最终复核无剩余可操作问题。

yujiawei 在 `1467724` 已 Approved，附带两个非阻断 P2：README 现已说明 PATH／UNC 行为和未实测共享边界；工具终态原有 completed/error 显式白名单不变，新增回归保证 pending、running、未知或缺失状态均不被误认为工具终态。没有把所有未知状态猜成失败。

## a5f5cac 审查与再次同步 main

2026-10-24 yujiawei 对 a5f5cac 的新审查有两项真实遗漏：Windows 普通环境对象的 Path／Pathext 别名没有参与探测；ACP 的 constructor 判断把 TypeError／SyntaxError／RangeError 等普通内建异常误判为结构化错误。修复为 Windows 探测副本统一 PATH／PATHEXT 别名，重复别名按 Node 子进程字典序取首项；ACP 仅对含字符串或数字 code 的异常保留对象，其余普通异常在 close 成功后包装，close 异常仍原样上抛。

其余意见逐项核对：excluded 实际仅含字面 basename，没有审查所称的 glob；probeCommand 已提取版本 token，新增 opencode v2.1.3 banner 回归通过，预发布拒绝是明确合同；PATH／UNC 的原生规则与未实测边界已公开。没有按错误前提添加 glob 抽象或放宽版本策略。

用户同时要求更新 main，已 rebase 到 c01c0c9144b74028b3f08ab59d9e27ed7ed8a9ff；8 个提交 range-diff 均为等号，新增主线依赖和 setup-go 更新保留。精确历史扫描例外及命名摘要随原始提交新 SHA 同步。以重放后的 ef9c312 为固定点，两个独立子审查分别复核工作区改动及主线集成：Standards 0 个发现，Spec 0 个发现。Windows 运行结果仍须以新 head 的托管测试确认；上一 head 的通过不替代本轮证据。
