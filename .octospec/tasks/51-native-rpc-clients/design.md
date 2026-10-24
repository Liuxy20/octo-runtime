---
type: Design
title: Issue 51 Schema 生成与原生客户端合同
description: 固定生成链、公共 API、RPC 映射、取消恢复状态和Go/Python 两语言平台集成边界。
tags: [architecture, protocol, schema, ipc, native, invoke]
timestamp: 2026-10-23T00:00:00Z
---

# 基线差距与冻结原则

以下是 `445d2bb` 的源码事实，后续目录和 API 均为本任务设计目标。

| 源码位置 | 已有事实 | 实施动作 |
| --- | --- | --- |
| `packages/octo-runtime-protocol/schema/kernel-ipc.schema.json` | 8 个方法，Request 通过 if/then 描述 params；input、环境、response 仍为宽泛 object；无结果/通知 Schema。 | 精确引用共享定义；增加可生成的方法目录和响应/通知定义，保留根 Request 校验入口。 |
| `packages/octo-runtime-protocol/schema/protocol.schema.json` | 已有 KernelLookupKey/RunRef/Snapshot/Status、HostFrame、NativeInteractionResponse 等。部分 Kernel integer 缺少 JS safe integer 上界。 | 复用而不复制定义；补 InvokeInputWire、KernelInvokeEnvironmentWire、InteractionResponse、HostedAdapterMetadataWire，统一已有边界。 |
| `packages/octo-runtime-protocol/src/invoke-input.ts` | InvokeInput 是可用普通 JSON 满足的 class；inputs/contexts 必填；本地 signal、streamLimits 不进 Kernel wire。 | 保留 class/check 公共入口，字段声明从生成 wire type 派生或以类型等价检查约束，禁止两套字段独立维护。 |
| `packages/octo-runtime-protocol/src/index.ts` | InteractionResponse 是手写 interface，value 可为任意 JSON；校验器定义 outcome 与 ID 长度。 | 生成数据类型，保留运行时语义校验入口；opaque value 支持 null，不能仅生成为 object。 |
| `packages/octo-runtime-executor-kernel/src/client.ts` | 已有 submit、ACK 查询、连续游标恢复、invoke 视图、取消及 ownership。 | 作为行为参照，与 native 共用行为参数和回归场景；不把 WorkerRpc 的 stdio 方法错当公共 RPC。 |
| `packages/octo-runtime-executor-kernel/src/invocation-lifecycle.ts` | 128 个元数据登记，未知占额；同一取消意图；4 路 get、4 路 cancel；首次 drain 共用 deadline。 | 两语言在包内单份实现同等登记/控制；不缓存正文，不实现第二套服务托管。 |
| `packages/octo-runtime-protocol/scripts/gen-types.mjs` | 使用 json-schema-to-typescript，只生成 protocol-types.ts。 | 保留现有生成链，补 IPC wire 生成和漂移检查。 |
| `test/kernel-fixture.js`、`test/kernel-relay.js` | 真实 Kernel/worker + fake Adapter，支持按 RPC 请求/响应 barrier 断线。 | 复用服务与 relay，增加跨语言 driver 协议与计数，覆盖非法原始字节的 relay 专项。 |
| 根 `native/` | 不存在。 | 新建独立工具/包，不加入 pnpm recursive 生产构建。 |

M0 建立 `contract-diff.md`，逐字段比较 Schema、TS checker 和服务实际字节，记录 absent/null、额外属性、范围、错误来源。Schema 补全不得将已支持的可选数据缩窄。`additionalProperties:false` 的控制对象仍严格；允许扩展的 Provider 对象继续开放。对当前不一致项先做最小复现，再修产生错误的责任位置；不得靠 native 放宽校验掩盖问题。

## 权威源与生成输出

```text
packages/octo-runtime-protocol/schema/
  protocol.schema.json                 # 全部共享数据定义
  kernel-ipc.schema.json               # 请求/响应/通知及 x-octo-methods 映射
  kernel-client.behavior.json          # 目标：行为参数、状态/动作与错误分类，无重复模型
  kernel-ipc.md                        # 目标：数据 Schema 无法表达的行为规范
  kernel-ipc-fixtures.json             # 扩充既有权威样例
  kernel-client-scenarios.json         # 目标：TS/Go/Python 三客户端复用场景清单和断言
native/
  README.md
  codegen/{generate.mjs,normalize.mjs,emit-*.mjs}
  go/{go.mod,go.sum,client.go,octo_runtime_generated.go,pipe_windows.go,examples/demo_playboard.go,cmd/interop-driver/}
  python/{pyproject.toml,uv.lock,src/octo_runtime/{__init__.py,client.py,octo_runtime_generated.py},demo_playboard.py}
  tests/{run.mjs,serve-kernel.mjs,driver-protocol.md,codegen.test.mjs,interop.test.mjs}
```

`native/tests` 通过路径直接读取 Protocol 的 fixtures/scenarios，不复制一份权威数据。语言包测试从运行器收到相同样例或读取仓库相对路径；正式安装包不装载 Schema/fixture。生成时会将必要检查编译进代码。

`x-octo-methods` 每项包含 wire name、语言公共名称、params/result `$ref`、unary/stream 分类、通知映射、sideEffect 和 recovery 分类；`kernel-client.behavior.json` 引用这些 method key，定义下表预算与状态迁移。生成器必须校验每个公开方法恰好有一个映射；缺失、重复、未知引用或未实现的 Schema 关键字在写出任何产物前失败。

生成步骤固定为：标准 JSON 解析 → 解析 `$ref` 和可达闭包 → 规范化 IR → 类型/validator/method emitter → manifest/hash。高层客户端由各语言维护唯一源码。IR 覆盖可达定义实际使用的 object/required/additionalProperties/propertyNames/minProperties/maxProperties、数组 items/contains/uniqueItems/数量限制、enum/const、nullable、oneOf/anyOf/allOf/not/if/then/else、数值、pattern/format/字符串长度和判别字段。Request 外壳通过方法映射拆成独立请求定义，其他对象的条件约束继续生成校验，不能忽略。

现有 Schema 还含 `x-octo-*` 的 Unicode、深度、字节、UTF-16 长度、URL、唯一 key/ref/header 和 selection 不变量。M0 为每个可达关键字记录源校验器和生成 helper 映射；形状及声明的本地不变量编译为模板 helper 调用，授权/有效 pending/执行配置一致性继续由原服务边界验证。仅供 TS 类型提示的 `tsType` 和 default 是注解，不在 native 注入默认值。未知 assertion 失败，未知普通描述性注解可保留。M1 用完整可达闭包及其反例验证，不能只演示简单 struct；fixture 必须注明 codec 拒绝还是服务语义拒绝，不能把二者混作一个检查。

| 内容 | 生成部分 | 允许手写的部分 |
| --- | --- | --- |
| wire model/unknown extensions | 属性、union、presence、原始 JSON 载荷、序列化与校验 | 通用原始 JSON/UTF-8 适配工具；不重复字段表 |
| RPC | 8 方法参数/结果、通知解码、错误类/码、sideEffect 分类 | connect/read/write/close、时钟、随机 ID、异步取消原语 |
| 高层 Invoke | 共享行为参数与 RPC 接口 | lazy admission、ACK 查询、续流、模式投影、取消、交互、元数据登记与 drain；各语言只维护一份 |
| 协议边界 | 上限常量、已知值校验和错误映射、控制状态判定 | 分块 reader/writer 的平台机制 |

2026-10-24 用户确认保留完整 SDK 并去重：删除客户端模板及其复制产物，客户端/生命周期在语言包内单份维护。修改状态或错误分类必须同时运行共享场景。手写 transport 中不得出现 `agent_run.*` 方法选择、InvokeInput 字段清单、恢复分支或权限逻辑。Go/Python 校验使用去重规则 IR，公开类型保持完整。Native 不接入 GitHub CI，所有校验按需本地执行。

生成命令为 `node native/codegen/generate.mjs`，使用 Node、gofmt 在临时目录生成，全部成功后写回；检查命令 `node native/codegen/generate.mjs --check` 只使用 Node，核对 manifest v2 的 Schema/生成器摘要、完整产物清单和逐文件 SHA-256，发现修改/缺失/遗留产物即失败。检查不重新格式化；生成器测试另行证明完整生成两次字节一致。输出使用 UTF-8 LF、固定排序和内容摘要，不写绝对路径、时间戳或随机值。TS build 仍只需 Node/pnpm。

## 精确 RPC 目录

以下名称为目标 Schema definition 名；已有同义数据定义直接复用。

| wire method | params | result | 结果含义及副作用 |
| --- | --- | --- | --- |
| `status` | 空 object | KernelStatus | ipc_version=1、实例、pid、worker、execution_ready；只读 |
| `adapter.list` | 空 object | HostedAdapterMetadataWire[] | 按 Core describe 与 AdapterMetadata 实际字段补 Schema；可用不等于本轮成功 |
| `agent_run.invoke` | input:InvokeInputWire；executionEnvOverrides?:ContextEnvsPayload；kernel_instance_id?:string | KernelInvokeResult: `{kernel_instance_id,receipt:HostRunReceipt}` | 写出一次；高层在发送前固定 instance；本地 ref 将二者组合 |
| `agent_run.get` | key:KernelLookupKey；kernel_instance_id?:string | KernelRunSnapshot | 查询原五元组，可要求原 instance |
| `agent_run.subscribe` | ref:KernelRunRef；after_seq:SafeNonnegativeInteger | KernelRunSnapshot ACK | ACK 后只有 event/stream_error 通知；观察连接 |
| `agent_run.cancel` | ref；reason?:string | `{accepted:boolean}` | 控制副作用，ACK 不是终态 |
| `agent_run.respond` | ref；response:InteractionResponse | 空 object | interactionId/outcome/value；权限及 pending 在服务端校验 |
| `agent_run.native.respond` | ref；response:NativeInteractionResponse | 空 object | requestId 为字符串或有符号安全整数，opaque payload；不重建 Provider 响应 |

响应定义 `jsonrpc:"2.0"`、原 request id、result/error 二选一；error 为 `{code:number,message:string,data:{code:string,...}}`。标准解析错误的 id 可为 null，普通客户端必须匹配原字符串 id，错 id 不接受。保留未知业务错误字符串和附加 JSON data，不能因 enum 未列出新服务错误而变成成功或解码崩溃。已知目录补齐实际 Kernel/client/协议错误，包括 RUN_OUTCOME_UNKNOWN、容量、关闭和不支持选项。

`agent_run.event.params` 包含 `kernel_instance_id/run_id/stream_id/seq/event:HostFrame`；外层 instance/run/stream/seq 与 ref、内层 frame 必须一致。`agent_run.stream_error.params` 包含 code/instance，不作为执行终态。其 Schema 和方法通知映射也生成。允许 Schema 明确开放的附加字段；未知通知方法或关键判别值不能被静默跳过。

## 数据与字节语义

| 项目 | 固定规则 |
| --- | --- |
| 身份 | LookupKey 为 run_id/invocation_id/agent_session_id/session_generation/protocol_mode；RunRef 再含 kernel_instance_id/stream_id/protocol。不能以 invocationId 单字段取消未知 Run。 |
| 数值 | 已知 seq/generation/整数 requestId 限 JS 安全整数，最大 9007199254740991；禁止 NaN/Infinity。opaque Provider JSON 不强转 float64，也不擅自限制为协议身份整数。native codec 保留收到的数值 token/精度；既有 TS 服务 JSON.parse 会对超出 IEEE-754 精度的数值舍入，不承诺改变服务端数字表示。codec 保真测试与穿过 TS 后的实际 wire 测试分别断言，不要求 TS 还原已舍入数值。 |
| presence | 非 nullable optional 缺失时省略，显式 null 拒绝。nullable optional 使用 absent/null/value 三态。false、0、空 string/list/object 仅按该字段合同检查，不能由 omitempty/default 抹去。 |
| Go | 可选标量不用零值表达缺失；生成 presence wrapper/自定义 MarshalJSON。opaque 用 json.RawMessage，保留数字 token。 |
| Python | dataclass/TypedDict 与 UNSET sentinel；生成 codec 严格区分 bool 与 int；opaque JSON 用 Decimal/int 保留数值，生成 token writer 处理 Decimal，禁止 float 路径丢精度。 |
| 字符 | UTF-8 严格解码，跨 chunk 多字节字符合法，拒绝无效 UTF-8/孤立 surrogate。不得借 Go/Python 默认 replacement 静默修复。保留有效 Unicode，不做正规化。 |
| 长度 | Schema 字符长度按 Unicode scalar 计；RPC id 的 128 上限是 UTF-8 字节，增加显式字节约束元数据/生成校验；不把 maxLength 当字节。 |
| JSON object | 使用标准 parser；重复 JSON 属性沿基线 JSON.parse 的末值语义，不混同重复调用 ID。schema additionalProperties 的开放/严格边界分别生成。 |
| NDJSON | 每连接一条 UTF-8 JSON-RPC 请求，LF 结束；无 batch/多路复用。JSON 字符串内的换行转义。EOF 残行不当作完整结果；CRLF 接收按尾部 JSON 空白处理，发送统一 LF。 |
| 请求上限 | 完整已序列化请求含 LF ≤ 32 MiB；最终带 instance 的请求必须重新检查，不能只检查 input 估算。过限在 write 前拒绝。 |
| 接收上限 | 依据现有 HOST_RPC_MAX_LINE_BYTES：40 MiB + 64 KiB，不含 LF 的待解析行；它是 HostFrame 硬最大值两倍预算加包装，不是单帧有效预算。 |
| 背压 | 64 KiB 分块累计，一次解析一行；消费前不无限预读。每订阅最多保留当前一条解析事件及有界未解析字节，不采用无界 channel/list。正文不进入 registry。 |

图片继续由既有 ModelInputPart 约束 base64、byteSize、sha256；生成校验负责形状，原执行边界继续校验一致性。Context 的已识别合同仍由 Kernel/Core 校验，客户端不能通过忽略权限项改写请求。除本地身份补齐外，默认值和执行准备留在 Core；不在 native 渲染模型 Context。

## 高层状态机与预算

| 阶段/触发 | 必须动作 | 禁止或失败结果 |
| --- | --- | --- |
| 构造 Invocation 未消费 | 不建立连接、不登记、不 invoke | 不能产生 Provider 执行 |
| 首次消费 | 检查关闭/取消/容量；复制 input，补齐缺少的 run/invocation/session ID；登记原 key；status 取得 instance | 不写回调用方，不改变模式/Context/Provider session |
| status 后、invoke 首次 write 前 | 再检查取消和停止接纳；序列化最终 envelope 并检查大小 | 已取消则 invoke 写出 0 次 |
| invoke write 已尝试 | 即便部分 write/断开也保守视为可能已提交，保存 key+instance | 不因超时/取消重新 invoke |
| ACK 丢失 | 按原 key/instance 最多 3 次 get，100/250/500 ms，修复总预算 10 秒，每次受剩余预算约束 | 找不到返回 ACCEPTANCE_UNKNOWN；instance/identity 差异立即报原错 |
| ACK 合法 | 校验回执全身份，生成完整 ref，处理此前取消意图，然后订阅原流 | 错回执不接入另一 Run |
| 订阅 | ACK 校验完整 ref；通知校验内外身份和 `seq=last+1`，只前移连续 cursor | gap/重复/乱序立即报错，不跳帧补洞 |
| 断流 | 原 ref/cursor 续接；最多 3 次额外连接，100/250/500 ms，自第一次中断起 10 秒，累计次数不因收到一帧重置 | 只对允许的传输暂态修复；窗口/实例/身份错误立即停止 |
| native lost | 先交付真实 lost 控制帧，再以 RUN_OUTCOME_UNKNOWN 结束 | 不释放 unknown 登记，不宣称完成 |
| canonical 控制错误 | 与 TS 相同，必要时 get 核对 lost；确认为 lost 才替换为 RUN_OUTCOME_UNKNOWN；核对失败保留原错误 | 不制造 Provider run.failed 或成功事件 |
| 正常终态 | completed/failed/cancelled 释放登记；模式投影按 TS canonicalEvents 处理 | native payload 的 result/completed 不算 Host 终态 |
| 无终态 EOF/stream_error | 先按允许的传输类修复，否则报告真实错误/未确认 | 不将耗尽解释成 completed |

connect/unary/订阅 ACK 默认 5 秒，invoke ACK 30 秒，写出等待 5 秒；订阅 ACK 后不加“5 秒无模型事件就失败”的 idle timeout。受控 drain 中每次 I/O、sleep 和 pending admission 等待都服从首次绝对总期限；本地时长使用 monotonic clock，API 接收墙钟 deadline 时转换一次。

信号或客户端选项 deadline 在 write 前取消则不提交；write 后记录取消意图，接纳恢复后对同一 ref 最多发一次 cancel，同时保留原尾流。deadline 表示发起取消的时刻，不承诺 Provider 已在该时刻结束。普通调用者需要有界停止等待时可关闭观察并保留 unknown；不得伪造已取消。更具体的接纳未知、控制未知、身份/传输错误优先于本地取消 reason；仅正常耗尽后报告本地取消原因。

单 client 最多 32 个实际连接、128 个高层调用登记，pending/unknown/lost 都占登记额度。暂停迭代器不缓存无限帧。cancel watcher 最多每调用一个，取消控制最多 4 路，get 最多 4 路；额度在真实 I/O 结束后释放。服务端现有 64 连接/16 订阅不变。`invocations.stopAdmission/drain` 仅高级 owner 使用，首次 deadline 固定、不加重放订阅，complete 只在所有执行可确认终态时为 true；未确认返回 unresolved。

## 语言 API 与平台边界

Go/Python 两语言都提供 `status/list/submit/get/subscribe/cancel/respond/respondNative/close` 对应操作、`invoke`、按 invocationId 的控制、snapshot/stopAdmission/drain。命名按语言习惯，wire 字段和错误码保持原文。高级 subscribe 返回 HostFrame；高层 native 输出 HostFrame、canonical 输出 CanonicalEvent，动态模式使用语言判别联合，不要求调用者手动 submit/subscribe。

| 语言 | 高层 API 目标 | 观察与取消 | 传输和依赖 |
| --- | --- | --- | --- |
| Go | `client.Invoke(ctx, input, options) *Invocation`；`Next() bool / Event() InvokeEvent / Err() error / Close() error` | ctx 取消控制 Run，Close 只关观察；InvokeEvent 暴露模式对应 typed view；实例可从 client registry 查 ref | client.go 内部选择 Unix net.Dialer / Windows pipe；pipe_windows.go 仅绑定 Windows API，对外一个 SDK 包 |
| Python | `client.invoke(input, *, cancel=None, deadline=None) -> Invocation`；async iterator，`async with`/`aclose()` | 显式 CancelToken/deadline 控制 Run；Task.cancel/CancelledError/aclose 关闭观察；单独有界控制任务维护已写请求结果 | Unix asyncio socket；Windows pywin32 overlapped I/O + 有界 event 轮询，默认/Selector loop 均不依赖 asyncio 私有 pipe API |

Python Windows 使用 CreateFile(FILE_FLAG_OVERLAPPED)、ReadFile/WriteFile、event、GetOverlappedResult；取消 I/O 用 CancelIoEx，并确认 completion 后释放 OVERLAPPED/buffer/handle。在事件循环内有界轮询 completion，每连接同一方向一个在途 I/O，连接额度上限 32；不新增线程 executor。不能用 `asyncio.to_thread` 取消了 Future 就声称阻塞 I/O 已回收。所有平台 write 必须处理 partial write。

工具链目标：Go 模块 `go 1.25`，Python >=3.11；按需本地测试最低版本和当前版本，不接入 native CI。依赖在 M0 按最低版本/平台 wheel 核对并记录精确锁定版本；若当前依赖不兼容最低版本，优先锁定兼容版本，不能悄悄提高最低要求。本机 Python 3.9.6 不满足目标，实施测试用 uv 管理 Python 3.11+。各语言独立 lock，不修改 TS 生产依赖来安装这些工具链。

平台机制依据（2026-10-23 已查阅）：[go-winio 源码](https://github.com/microsoft/go-winio/blob/main/pipe.go)、[pywin32 win32file 源码](https://github.com/mhammond/pywin32/blob/main/win32/src/win32file.i)、[Windows CancelIoEx](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-cancelioex)。这些资料支持选型，不是本项目 Windows 已通过的证据。

## 包与兼容策略

Go module 目标 `github.com/Mininglamp-OSS/octo-runtime/native/go`，Python distribution `octo-runtime-client` / import `octo_runtime`。首版源码版本 `0.0.0`，首次发布候选 `0.1.0`，发布另行授权；名称是否可占用不阻塞本地交付。Go 子目录 tag 使用 `native/go/vX.Y.Z`，Python 独立版本，不能套用 npm pack/install hook。

服务兼容以 `ipc_version=1`、现有 Run 7/Context v3 和经联调的最早服务 commit 为下界，记录 schema hash/client behavior revision。没有对应 release tag 时报告 commit 范围，不能杜撰最低发行版本。未知 IPC major 在 invoke write 前拒绝；新增合法可选字段按开放边界保留。首次只承诺通过验收的服务范围，不宣称兼容所有历史 ipc_version=1 实现。SDK 小版本允许向后兼容增量，破坏性客户端 API 或 wire 变化必须独立记录。
