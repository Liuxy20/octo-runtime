# SDK Channel Gateway 接入

通用 Extra 架构和生命周期见开发者文档：[English](docs/en/guides/extras.md) / [简体中文](docs/zh-CN/guides/extras.md)。本篇保留 IM 配置、会话存储和业务接入细节。

宿主使用 /host 的 createExtraService 在当前进程管理 Channel Gateway，执行通过指定的 Kernel endpoint。模块从 /extras/channel-gateway 导入。完整调用方式及 loadContexts 注入见 [Extra 指南](docs/zh-CN/guides/extras.md)。

Gateway 直接调用注入的 ctx.kernel.invoke，消费返回结果完成 delivery 数据处理。提交、身份关联、ACK 查询和订阅修复由同一个 KernelClient 负责。App 内部模块也可直接 attach 后 invoke，无需加载 Gateway 或任何 Extra；Gateway 的展示、存储和业务重试策略不进入 Kernel。

## 源码 submodule

Electron/Buddy 通过 submodule 接入时，必须使用最新远端 `main`。首次添加用 `git submodule add --branch main git@github.com:Mininglamp-OSS/octo-runtime.git octo-runtime`；已有子仓用 `git submodule set-branch --branch main -- octo-runtime` 后执行 `git submodule update --remote --checkout -- octo-runtime`，前提是子仓没有未提交修改。初始化、升级和宿主记录指针的完整步骤见 [SDK 入门](docs/zh-CN/getting-started/sdk.md)。不以特定功能分支或未合并 PR 作为接入依赖；升级验收后由宿主记录 main 的实际 commit 以供 CI 复现。

## 装配顺序

1. 宿主准备 Provider 和自己的 worker 入口，createKernelService 后 initialize，或 attachKernel 连接已有服务。
2. 从受保护配置源取得 Bot 值，并导入 Gateway 模块。
3. createExtraService({endpoint, module, config: {bots}, dependencies}) 后 await initialize()。
4. extra.status() 的 plugin 为插件 JSON；Bot online 与 kernel_available 分别判断。
5. 配置变更先等待 extra.close() 且 complete=true，再保存并创建新实例；Kernel 保持运行。

连接恢复在Gateway内完成：首次暂态离线与上线后暂态断线均等待5、10、15秒，之后每15秒；Retry-After可延长。宿主无需另写重连或重建服务。合法服务端 DISCONNECT 默认重连（含 reason 12、滚动更新及未知断开码）；明确认证/权限/封禁/协议错误仍失败。握手同样默认重试未知服务端原因；HTTP 超时、冲突、限流、5xx 及未知服务故障默认重试，只有明确认证/配置/协议错误停止。退避不是连接成功时限：还需检测断网、回收旧连接和完成鉴权握手；静默断网按每 25 秒检查、90 秒无包阈值发现，不能保证 20 秒内上线。旧任务结果未知时不重新invoke。

原生Extra可选 `logging: { directory: absolutePath, statusOutput: record => hostLogger(record) }` 是宿主代码选项，不放入Bot JSON。SDK默认不写stdout；sink只收到服务生命周期、Kernel可用性转换和Gateway连接/重试，不含chat、session/run/message标识、模型输出、工具参数及凭据。状态同时镜像到directory下 `extras/<extra>-status-<UTC小时>.log`，最多三份、每份100MiB；日志失败不改变执行结果。CLI自动接入stdout，使用 `octo-runtime channel-gateway logs --follow` 查看状态。业务onStatus仍同步，不负责异步探测或重启。

## 逐轮 Context

`extra.im` 是 channel-gateway/channel-wecom 的保留命名空间，由对应 Extra 构造并决定注入时机；宿主静态 Context 和动态 `loadContexts` 中的全部 `extra.im` 项均不生效，本轮没有渠道同名项也不透传。宿主业务材料使用其他命名空间。渠道规则内容如需外部更新，由渠道内部按业务合同读取，不通过宿主 Context 覆盖。全局 `octo.control/instructions` 保留既有特殊合并，冻结重试复用渠道快照。详见 [Channel 规则](.octospec/rules/channel-integration.md#extraim-命名空间归属)。

`message-trigger.conversation.id` 是原始频道 ID，type 仅为 `dm`、`group`、`group_topic`，分别表示私聊、群和群子区。子区保留完整频道 ID，父群/子区短 ID 与名称分别保留在 conversation.group/topic 中。

dependencies.loadContexts(botConfig,{signal}) 返回当前 ContextItem 数组或 Promise。函数在宿主同进程直接调用，读取的数据变化无需重载连接。超时或取消后真实 Promise 未结束仍占额度；返回值最多 32 项 / 64 KiB。静态 context 与动态项的合并、业务指引和准入规则继续按 [Gateway 合同](packages/octo-runtime-extra-channel-gateway/README.md)。

Gateway 的稳定 mention、产物交付和历史阅读说明，在会话首轮及第 N、2N…轮注入普通 Context，Bot 字段 `stable_context_refresh_interval_turns` 默认 30，必须为正安全整数。reset/new 重新计数；工具步骤、自动重试、同代次卡片重试及准备失败不增加用户任务轮数。刷新轮的渠道默认英文 mention 指令与宿主有效 `octo.control/instructions.payload.entries` 保序拼接，宿主在前、默认在后，内容也占 Context 预算。每轮独立提供简短 `extra.im/message-trigger`，描述真实发送者、频道和实际 mention；稳定说明不混入 actor。宿主静态/动态项仍按原规则整项替换，不做通用去重。用户明确要求的 Bot 交接支持原生 mention；自消息和真实 mention 准入合同保持，详见上述 Gateway 合同。

身份补全使用 Bot 的只读 API，失败不阻断 AgentRun，不重试或切换查询接口。UID/Bot ID 对应的名称与类型在各 Bot 的内存中按 API/Space 隔离缓存，固定十分钟过期，最多 2,000 项，失败与缺失结果不缓存；成员权限和发送 mention 的授权不使用此缓存。

自动历史以 `messages: [{uid, username, sentAt, content}]` 从旧到新呈现。纯文本也用 `content: {type: "text", text: "..."}`；回复保留引用与回复正文，转发保留嵌套消息，富文本保留块顺序，媒体引用标记 `read: false`，不下载媒体正文。完整 JSON 数组上限为 20 条和 8,000 个 Unicode 码点，截短或省略明确标注，身份字段不截短。模型不再收到独立自动 `history-gap`；历史不完整、读取失败或被省略时，仅在 `history` 中补充一句英文 `note`，失败时 `messages` 可为空。游标与真实交接证据不进入模型快照，说明不代表正文已交接。

不要把函数、源码或模块实例放进 config。替换函数引用按整体停止/加载处理。调用方处理 signal 的正常取消，dispose 的真实失败仍须报告。

## 自定义会话存储

Gateway 支持可选的 `dependencies.createSessionStore`。源码宿主按上节更新到包含此能力的最新 main，不需要依赖 #65 或特定功能分支；不提供工厂时保持默认内存行为。

`ImSessionStore` 是 Gateway 会话状态的读写接口，保存逻辑 session 与 Provider session 的绑定、reset 代次、历史/规则准备状态、消息处理记录和 reset 去重记录。保存绑定后，应用重启或 Extra 重载时可以尝试续接原会话。Provider 原生对话由 Provider 管理，持久绑定不恢复未完成 Run，也不保证 Provider 会话一定能恢复。

默认不提供工厂时使用 `MemoryImSessionStore`；当前 CLI 传入空 dependencies，沿用此默认。需要持久化的 Electron 主进程可以复用宿主 SQLite，实现并注入 `ImSessionStore`。接口中的 occurrence 包含文本及可选请求快照，宿主需要明确这些数据的保留、容量和保护策略。

整个 `octo-runtime` 不依赖 SQLite，不提供 SQLite 适配实现、驱动、表结构或迁移。下面的 SQLite 代码属于宿主接入示意；底层也可以是其他满足接口合同的宿主存储。真实数据库测试由宿主工程执行。

### 主进程装配示例

以下是**宿主实现示意**，展示主发行包公共入口；源码 workspace 使用 [SDK 入门](docs/zh-CN/getting-started/sdk.md)。`host-storage.js` 是宿主自己编写的数据库适配代码，不是 Runtime 导出的实现：`openHostDatabase` 打开宿主数据库，`createSqliteImSessionStore(database, botConfig)` 同步返回实现 `ImSessionStore` 的独立句柄。endpoint、config 与数据库适配需由宿主提供；这段节选不是可独立执行的完整项目。

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type {
  GatewayDependencies,
  ImSessionStore
} from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import { openHostDatabase, createSqliteImSessionStore } from "./host-storage.js";

// endpoint 和 config 由宿主的 Kernel 装配及受保护配置源提供。
declare const endpoint: string;
declare const config: JsonObject;
const database = openHostDatabase();
const dependencies: GatewayDependencies = {
  createSessionStore(botConfig): ImSessionStore {
    // 按可信 Bot、账号、组织及助理配置分区；不从入站消息决定存储归属。
    // 每次返回独立句柄；句柄 close 只释放当前 Bot 的使用权。
    return createSqliteImSessionStore(database, botConfig);
  }
};
const extra = createExtraService({
  endpoint,
  module: gateway,
  config,
  dependencies
});
try {
  await extra.initialize();
  const status = await extra.status();
  // Bot 配置或工厂错误记录于 plugin.errors；initialize 成功不等于各 Bot 在线。
  if (Array.isArray(status.plugin.errors) && status.plugin.errors.length)
    throw new Error("GATEWAY_BOT_INITIALIZATION_FAILED");
} catch (error) {
  const cleanup = await extra.close();
  if (!cleanup.complete) throw new Error("GATEWAY_STARTUP_CLEANUP_INCOMPLETE", { cause: error });
  throw error;
}

// 宿主退出、切账号或配置重载时先调用；不能先关数据库。
async function stopGateway() {
  const cleanup = await extra.close();
  if (!cleanup.complete) throw new Error("EXTRA_CLEANUP_INCOMPLETE");
  // 此时该 Extra 的存储使用已结束。其他数据库使用者也结束后，
  // 再由宿主统一关闭 database；Gateway 不关闭共享数据库或 Kernel。
}
```

加载对象是 `module: gateway`。宿主的 SQLite store 通过 dependencies 进入这个插件，装配链为：

```text
Electron 主进程 createExtraService({ module: gateway, config, dependencies })
  -> Gateway extra(ctx, config)(dependencies)
  -> Manager 按有效且启用的 Bot 调用 createSessionStore(botConfig)
  -> 将返回句柄注入对应 ImRuntime
  -> Gateway 的 binding/reset/occurrence/gap/rules 读写进入宿主实现
```

store 无需另行注册成 Extra，不放进 JSON config，也不传给 Kernel/worker。可同时提供 loadContexts，从同一个宿主数据库读取本轮材料；两个入口彼此独立，工厂返回的对象由 Gateway 持有。

### 宿主实现与类型边界

宿主实现同步 `read/save/reset/occurrence/remember`，并按需要实现 `patchGap/invalidateRules/patchRules`。工厂接收已校验且保留宿主 scope 扩展字段的独立 Bot 配置快照；每个有效且启用的 Bot 调用一次，无效或禁用 Bot 不分配。常规读写和工厂保持同步，句柄 `close` 允许 `void | Promise<void>`。同步查询仍占用主进程时间，不会自动变成异步 IO。

`GatewayDependencies`、`ImSessionStore` 及实现该接口需要的业务类型统一从 `/extras/channel-gateway` 导入。通用 `/extra` 只提供共享插件合同；Gateway 的存储依赖不进入 `ExtraContext`，不改变其他 Extra 的依赖形状，也不增加通用加载器的业务分支。未来业务 Extra 在自己的入口定义专属 dependencies，沿用同一个泛型服务装配。

工厂返回的句柄由 Gateway 负责释放，整个数据库由宿主负责。Gateway 先停准入，在共享截止内完成原调用的绑定保存及业务收尾，再撤销访问并释放句柄；失败或超时返回 incomplete，阻止同名替换。宿主应等待完整关闭后再切换存储 scope；共享数据库还有其他使用者时继续保持连接。工厂或存储失败必须可观察，显式配置工厂时不能静默回退 Memory。

| 方法                    | 宿主实现的合同                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read(key)`             | 返回独立 binding 快照；未命中为 undefined。key 是 Gateway 的不透明聊天身份，宿主另按可信 Bot/账号/组织/助理等 scope 分区。                                          |
| `save(key, binding)`    | 同步保存完整 binding，不能保留可被调用者继续修改的原对象引用；失败抛错。存储不会自行推断新的 Provider 或会话身份。                                                  |
| `reset(key, controlId)` | 同步、原子地去重控制 ID 并递增 generation，清除旧绑定；重复控制返回当前 binding，不再次增加代次。宿主负责控制记录的保留策略。                                       |
| `occurrence/remember`   | 按 key 与消息 ID 读写独立的处理/重试快照，未命中为 undefined。可能包含文本和 Context；宿主负责容量及期限，不承诺恰好一次消息处理。                                  |
| `patchGap`              | 原子读取当前 binding，仅在 sessionId/generation 匹配时执行 update，成功后将 gap revision 按先前版本加一；未命中或拒绝更新返回 false。不能用旧快照覆盖新的 binding。 |
| `invalidateRules`       | 仅使匹配的现有有效 binding 的规则游标失效并推进其 revision，不创建 binding，不改变聊天代次或历史位置。                                                              |
| `patchRules`            | 原子校验 sessionId/generation 后更新规则游标；未命中、身份过期或 update 返回 undefined 时返回 false。                                                               |
| `close`                 | 可选，Gateway 对工厂句柄调用一次，允许 Promise；只结束这个句柄，不关闭共享数据库。原始句柄仍由宿主持有时，宿主负责其自身访问权限。                                  |

可选方法不存在时必须真正省略，不提供空函数伪装支持：缺少 gap patch 时采用既有 unknown/有界补历史策略，缺少规则游标方法时保守携带规则。工厂不得返回 Promise；错误的 async 工厂会被拒绝并安排迟到句柄回收。普通方法不接受异步返回值，宿主须提供满足同步合同的适配。

数据库事务由宿主实现：reset 的去重与代次更新、patch 的身份校验与写入应各自原子完成。多窗口/多进程共享数据库时，还须由宿主协调写入；单个 JS 句柄的同步调用不自动获得跨进程隔离。切账号先完整关闭旧 Extra，再使用新可信 scope；不要从入站消息正文选择 scope。

### 可运行的无数据库样例

[gateway-store.mts](test-support/public-extra/gateway-store.mts) 提供完整的宿主内存后端、全部接口方法、工厂装配和关闭断言；[host.mts](test-support/public-extra/host.mts) 与 [worker.mts](test-support/public-extra/worker.mts) 提供真实 Kernel 启动入口。该样例无 SQLite 依赖、不使用 IM 凭据，证明公共类型和加载/所有权；内存后端不证明文件落盘或 Provider 真实续聊，生产宿主仍需实现容量与保留策略。

在本仓根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm pack:release
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
```

验证器在临时消费目录只安装测试 tgz，以 `strict`、`skipLibCheck=false` 编译完整样例并运行，结束后清理临时资源。源码 `0.0.0` 是测试打包版本，不执行 npm 发布。真实 Gateway 的消息读取、reset、重载、scope 和尾写行为见 [宿主存储回归](test/gateway-host-session-store.test.js)；SQLite 重开和 Electron 驱动兼容性由宿主工程实际测试。

数据范围和使用收益的完整说明见 [ImSessionStore 用途与 Electron SQLite 接入](.octospec/tasks/channel-host-session-store/session-store-explained.md)，实施与包外类型验收见 [任务简报](.octospec/tasks/channel-host-session-store/brief.md)。

## 执行中停止

调用 extra.close() 后，Gateway 立即停止准入、排队任务、准备和重试；已接纳调用请求取消，但原事件订阅与投递连接保持到收尾结束。Gateway 在最多 3 秒内消费终态、保存当前代次的绑定并尝试唯一最终回复，再释放连接；插件与原生 Extra 服务共用最多 4 秒的清理预算，不逐层重新计时。

取消 ACK、Provider 终态、IM 投递成功和进程退出是不同事实。结果未知、投递失败或截止未完成时，close() 返回 complete=false，重复停止保留同一失败结果；宿主不得据此创建同名替代实例。停止 Gateway 不停止共享 Kernel，也不取消其他 Extra 或 attached 客户端的 Run。

可复现的真实 IM 检查见 [验收脚本](scripts/verify-gateway-drain-live.mjs)：通过环境变量 OCTO_CHANNEL_QA_ACCOUNTS 指定受保护账号文件；默认验证 SDK，--cli 验证 CLI，--fail-delivery 在实际 WebSocket 文本发送边界注入失败。脚本仅使用 im-test 及指定账号共同加入的 Channel_QA_ 测试群，报告不含凭据。

## 配置和业务责任

Gateway 默认通过本轮 `extra.im/artifact-delivery` 建立文件交付约定：Agent 成功 final 中的本地 Markdown 链接/图片由固定 workflow 上传到 IM，再替换目标并计算 mention 后发送同一条 final。普通文件链接额外发送原生文件卡（type=8，带文件名、类型、字节数和下载地址）；final Markdown 中的链接文字及附件地址同时保留，二者不是二选一。图片使用 Markdown 图片语法内嵌展示，仅图片引用不另发文件卡；同图另有下载链接时共用一次上传并发送一张文件卡。

HTML、Markdown 与其他文件采用相同附件合同，不根据企业服务部署状态转成在线文档，不创建文档权限或公开分享。群聊交付沿用 IM 文件访问体验，避免文档 ACL、后加入成员及转发场景引入额外访问障碍。用户明确要求在线协作、发布、上传或网盘保存时，仍由 Agent 普通 ToolCall 完成；已有远程 URL 不重复上传或补发卡片。

Bot 的 `artifact_delivery.mode: "tools"` 可关闭固定交付；省略为 `channel`。默认对成功 final 引用的本机路径尝试实际读取，不以 Agent 来源或工作区拒绝，无需新增配置；宿主可用绝对 `allowed_roots`（空数组拒绝全部）、`allowed_mime_types` 及更小的文件/总量/数量/超时预算收紧。文件不存在或无法读取按实际失败报告，不主动下载远端文件；超限、显式目录限制越界、符号链接逃逸或部分上传失败在同条回复明确标注，不重跑模型。发送重试复用上传结果；stop/reset 撤销在途交付和旧代次 final，shutdown 沿既有共享期限。完整字段及限制见下方 Schema。

上传准备按 final 缓存，每张文件卡拥有独立稳定编号和确认回执，沿既有 WS ACK/取消路径发送；最终文本重试不会重新上传或补发卡片。卡片未确认时在同条 final 明确提示，已上传的下载链接仍保留，不把卡片失败当作模型生成失败。原生文件卡不受进度/互动卡片的 `cards` 开关控制。

完整字段见 [Gateway JSON Schema](packages/octo-runtime-extra-channel-gateway/config-schema.json)，业务行为见 [Gateway README](packages/octo-runtime-extra-channel-gateway/README.md)。宿主负责令牌取得、存储、更新与授权流程；Extra 消费实际配置值，不扫描 CLI Home 或其他凭据文件。Electron/Tauri 使用 SDK，不调用 Runtime CLI。

真实 IM 验收只使用 im-test.deepminer.com.cn，具体宿主和 Provider 的结果另记，不能由本地 fixture 推断。
