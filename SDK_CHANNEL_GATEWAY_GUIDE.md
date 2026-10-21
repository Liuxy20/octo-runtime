# SDK Channel Gateway 接入

通用 Extra 架构和生命周期见开发者文档：[English](docs/en/guides/extras.md) / [简体中文](docs/zh-CN/guides/extras.md)。本篇保留 IM 配置、会话存储和业务接入细节。

宿主使用 /host 的 createExtraService 在当前进程管理 Channel Gateway，执行通过指定的 Kernel endpoint。模块从 /extras/channel-gateway 导入。完整调用方式及 loadContexts 注入见 [原生 SDK 指南第 3 节](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#3-原生-extra)。

Gateway 直接调用注入的 ctx.kernel.invoke，消费返回结果完成 delivery 数据处理。提交、身份关联、ACK 查询和订阅修复由同一个 KernelClient 负责。App 内部模块也可直接 attach 后 invoke，无需加载 Gateway 或任何 Extra；Gateway 的展示、存储和业务重试策略不进入 Kernel。

## 源码 submodule

Electron/Buddy 通过 submodule 接入时，必须使用最新远端 `main`。首次添加用 `git submodule add --branch main git@github.com:Mininglamp-OSS/octo-runtime.git octo-runtime`；已有子仓用 `git submodule set-branch --branch main -- octo-runtime` 后执行 `git submodule update --remote --checkout -- octo-runtime`，前提是子仓没有未提交修改。初始化、升级和宿主记录指针的完整步骤见 [原生 SDK 指南第 0 节](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#0-源码接入使用最新-main)。不以特定功能分支或未合并 PR 作为接入依赖；升级验收后由宿主记录 main 的实际 commit 以供 CI 复现。

## 装配顺序

1. 宿主准备 Provider 和自己的 worker 入口，createKernelService 后 initialize，或 attachKernel 连接已有服务。
2. 从受保护配置源取得 Bot 值，并导入 Gateway 模块。
3. createExtraService({endpoint, module, config: {bots}, dependencies}) 后 await initialize()。
4. extra.status() 的 plugin 为插件 JSON；Bot online 与 kernel_available 分别判断。
5. 配置变更先等待 extra.close() 且 complete=true，再保存并创建新实例；Kernel 保持运行。

## 逐轮 Context

dependencies.loadContexts(botConfig,{signal}) 返回当前 ContextItem 数组或 Promise。函数在宿主同进程直接调用，读取的数据变化无需重载连接。超时或取消后真实 Promise 未结束仍占额度；返回值最多 32 项 / 64 KiB。静态 context 与动态项的合并、业务指引和准入规则继续按 [Gateway 合同](packages/octo-runtime-extra-channel-gateway/README.md)。

不要把函数、源码或模块实例放进 config。替换函数引用按整体停止/加载处理。调用方处理 signal 的正常取消，dispose 的真实失败仍须报告。

## 自定义会话存储

Gateway 支持可选的 `dependencies.createSessionStore`。源码宿主按上节更新到包含此能力的最新 main，不需要依赖 #65 或特定功能分支；不提供工厂时保持默认内存行为。

`ImSessionStore` 是 Gateway 会话状态的读写接口，保存逻辑 session 与 Provider session 的绑定、reset 代次、历史/规则准备状态、消息处理记录和 reset 去重记录。保存绑定后，应用重启或 Extra 重载时可以尝试续接原会话。Provider 原生对话由 Provider 管理，持久绑定不恢复未完成 Run，也不保证 Provider 会话一定能恢复。

默认不提供工厂时使用 `MemoryImSessionStore`；当前 CLI 传入空 dependencies，沿用此默认。需要持久化的 Electron 主进程可以复用宿主 SQLite，实现并注入 `ImSessionStore`。接口中的 occurrence 包含文本及可选请求快照，宿主需要明确这些数据的保留、容量和保护策略。

整个 `octo-runtime` 不依赖 SQLite，不提供 SQLite 适配实现、驱动、表结构或迁移。下面的 SQLite 代码属于宿主接入示意；底层也可以是其他满足接口合同的宿主存储。真实数据库测试由宿主工程执行。

### 主进程装配示例

以下是**宿主实现示意**，展示主发行包公共入口；源码 workspace 使用 [第 0 节说明的对应包](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#0-源码接入使用最新-main)。`host-storage.js` 是宿主自己编写的数据库适配代码，不是 Runtime 导出的实现：`openHostDatabase` 打开宿主数据库，`createSqliteImSessionStore(database, botConfig)` 同步返回实现 `ImSessionStore` 的独立句柄。endpoint、config 与数据库适配需由宿主提供；这段节选不是可独立执行的完整项目。

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
  if (!cleanup.complete)
    throw new Error("GATEWAY_STARTUP_CLEANUP_INCOMPLETE", { cause: error });
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

| 方法 | 宿主实现的合同 |
| --- | --- |
| `read(key)` | 返回独立 binding 快照；未命中为 undefined。key 是 Gateway 的不透明聊天身份，宿主另按可信 Bot/账号/组织/助理等 scope 分区。 |
| `save(key, binding)` | 同步保存完整 binding，不能保留可被调用者继续修改的原对象引用；失败抛错。存储不会自行推断新的 Provider 或会话身份。 |
| `reset(key, controlId)` | 同步、原子地去重控制 ID 并递增 generation，清除旧绑定；重复控制返回当前 binding，不再次增加代次。宿主负责控制记录的保留策略。 |
| `occurrence/remember` | 按 key 与消息 ID 读写独立的处理/重试快照，未命中为 undefined。可能包含文本和 Context；宿主负责容量及期限，不承诺恰好一次消息处理。 |
| `patchGap` | 原子读取当前 binding，仅在 sessionId/generation 匹配时执行 update，成功后将 gap revision 按先前版本加一；未命中或拒绝更新返回 false。不能用旧快照覆盖新的 binding。 |
| `invalidateRules` | 仅使匹配的现有有效 binding 的规则游标失效并推进其 revision，不创建 binding，不改变聊天代次或历史位置。 |
| `patchRules` | 原子校验 sessionId/generation 后更新规则游标；未命中、身份过期或 update 返回 undefined 时返回 false。 |
| `close` | 可选，Gateway 对工厂句柄调用一次，允许 Promise；只结束这个句柄，不关闭共享数据库。原始句柄仍由宿主持有时，宿主负责其自身访问权限。 |

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

完整字段见 [Gateway JSON Schema](packages/octo-runtime-extra-channel-gateway/config-schema.json)，业务行为见 [Gateway README](packages/octo-runtime-extra-channel-gateway/README.md)。宿主负责令牌取得、存储、更新与授权流程；Extra 消费实际配置值，不扫描 CLI Home 或其他凭据文件。Electron/Tauri 使用 SDK，不调用 Runtime CLI。

真实 IM 验收只使用 im-test.deepminer.com.cn，具体宿主和 Provider 的结果另记，不能由本地 fixture 推断。
