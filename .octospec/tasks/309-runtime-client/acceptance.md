---
type: Task
title: Issue 309：验收矩阵
description: 通过独立安装、类型与对象身份、生命周期和部分发布恢复证明双包合同，专项只显式手动执行。
tags: [testing, protocol, lifecycle, packaging, release]
---

# 验收矩阵

本矩阵保留验收合同；逐项实际结果见[验证记录](validation.md)。未执行的平台和真实发布保持 **not run**，不以规划评分或先前失败运行作为验收通过。

| ID | 场景/操作 | 通过条件 |
| --- | --- | --- |
| A01 | 同 revision 构建并调用现有 pack 入口，分别解包两份 tgz | 包名正确、版本一致、commit/dirty/buildTime 一致；所有 exports 文件存在；无 workspace/link/file；schema 与源码原件一致 |
| A02 | 空缓存、仓库外工程，只安装 client tgz，禁用 NODE_PATH 和源码软链 | 不安装 full Runtime；client 根、protocol、JSON schema 可导入；运行依赖只有 client 和私有 protocol |
| A03 | 遍历 client 归档与全部传递 d.ts import，并执行严格外部 tsc | 无 CLI/Kernel server/Core/Host/Adapter/Extra；strict=true、skipLibCheck=false；根/协议泛型和原语可用 |
| A04 | 对同版本双包在独立 npm 与 pnpm 项目安装并导入 | 每个发行物内部 client/协议值身份一致；跨发行物类型双向兼容、schema/校验结果一致，明确不要求跨副本 ===/instanceof/WeakSet 互认 |
| A05 | full SDK 外部工程原生构造 Kernel，初始化后经 service.client/standalone client 查询、执行、关闭 | 服务 endpoint/PID 属于当前宿主；两种客户端连接同一服务；附着 client 关闭不停止 Kernel；显式直接 Core 入口仍可执行 |
| A06 | 同 full Kernel 上运行两个 Extra IPC；另验 #312 direct | 关闭 Extra A 不影响 B、宿主调用或共享 Kernel；direct 不 attach、不产生 Kernel 执行资源；初始化回滚和 incomplete 保留 |
| A07 | native/canonical 执行、事件、list/status、审批/问答、cancel/abort、AsyncQuestionReply | 输入/输出和控制维持原合同；取消 ACK 与真实终态分开；旁路未知响应不变成新 Run；尾流和独立业务收尾被观察 |
| A08 | 丢失 invoke ACK、断流恢复、实例变化、游标缺口、控制响应未知 | 只查原身份、不再次 invoke；订阅沿原 ref/cursor 有界恢复；未知控制不重试；明确报实例/缺口/未知错误 |
| A09 | 未知 ipc_version/畸形 status，及基线 de3ff37a Kernel 的兼容试验 | 非 1 或无效 status 拒绝且不写 invoke；记录基线组合实际可用/失败；其他不支持的 wire 输入按既有错误拒绝，不宣称通用版本协商 |
| A10 | 两个包均缺失、仅 client 已发、仅 runtime 已发、两包已发的可控 registry 状态 | 每种恢复只上传缺失归档；两个包分别预检来源/integrity；两包同源、单包可恢复 buildTime；完整性不一致停止 |
| A11 | 任一 lookup 鉴权/网络错、归档冲突、发布 ACK 未知、延迟可读 | 只有 E404 当缺包；冲突在任何新上传前失败；未知上传先读取确认，无盲重发/unpublish/重打 tag |
| A12 | npm 双包成功但 GitHub 附件部分失败，或三 latest 更新中断、并发旧版恢复 | 仅补缺失附件；完整集合核对两个 npm integrity 和两个附件；三 latest 重读收敛到最高完整版本，不因旧版恢复回退 |
| A13 | 既有 dry-run 发行模式 | 两包均执行现有发布校验但无真实 npm/GitHub 写入；缺包、预检错误与实际失败可区分；未验证候选明确标注 verified=false、空 actions，仅返回带警告的 conditionalActions；已验证目标才返回 actions；正式执行拒绝 candidate；包名参数不能误查成 runtime |
| A14 | 原 offline SDK、npm global Extra、pnpm global Extra 和 Windows verifier | 只提供 runtime 一个物料，原场景通过；client 也可单 tgz 独立离线安装；失败保留所属进程/registry 清理事实；单 client 离线仍只需一个 tgz |
| A15 | 既有跨包回归、双语文档示例、native/codegen 校验与 CI 范围核对 | 原 checks 通过或给出同基线失败证据；Schema 不变；专项未进入默认选择器/CI；workflow 只变更双包材料处理和发布对象 |
| A16 | 依赖和体积记录、平台与真实集成清单 | 两包压缩/解包字节、依赖数、源码 revision 可复查；Node、OS、真实 Provider/Electron 各自有证据或明确 not run |

## 计划执行入口

既有检查：`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm docs:check`、`pnpm test`，及现有 pack/install/Extra 验收脚本。实施时按依赖顺序运行并复用已完成的 build，不为本专项更改默认 selector。

新增手动专项计划集中在 `test/manual/runtime-client-309*.test.mjs` 与必要的包外 fixture，使用显式 Node test 命令。先查看现有内核/生命周期测试，复用可控服务和 fake Provider，不为拆包重写执行引擎。

`pnpm native:check` 显式本地执行，证明既有生成产物无漂移；Go/Python 原生运行测试按实际工具链独立记录，不接入默认 build/prepare/CI。Node fake Provider 不证明真实 Provider turn，也不证明 Electron 打包或 Windows 真机。

## 证据记录要求

每次记录：源码完整 SHA/dirty、Node/pnpm/npm/OS 版本、实际命令和退出码、归档名/版本/integrity/大小、安装目录与依赖清单、执行结果、清理结果，以及未执行理由。临时环境独占且由创建者清理，不读取或改写用户 Home/config，不输出凭据。

本地可控 registry 用于安装及发布状态夹具，不能记为官方 npm 已发布。正式权限与真实发布结果在获得发布授权后单独验收。
