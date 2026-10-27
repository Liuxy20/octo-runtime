# Extra 自有命令

[English](../../en/guides/extra-commands.md) | [文档目录](../README.md)

CLI 从选中的模块清单发现 Extra 名称。根帮助不导入 Extra；`<extra> --help` 只导入该 Extra 的独立命令模块，不初始化服务、不连接 Kernel、不认证。SDK 原生装配不需要加载命令模块。当前 catalog 按内置清单、Home manifest、当前 CLI 所属 npm/pnpm 全局环境的顺序选择；显式 `--manifest` 完全替换三个来源。

## 配置三个内置 Extra

`--home` 和 `--manifest` 始终是 Runtime 全局参数，可放在自有命令前后，也可与业务参数一起排列。CLI 先确定 Home 和模块来源，再加载命令；Extra 不定义或解析这些参数。`--json`、`-h`、`--help` 也支持前后位置。同一参数重复传入会报错；`--` 后的内容仅为字面位置参数。配置属于 Home，自有命令拒绝 `--profile`。宿主布尔参数沿用旧的“出现即启用”语义，接受 `--json=true`、`--help=true`，等号后的值不会禁用开关；Extra 自有布尔参数只接受裸开关。既有生命周期命令的参数位置保持兼容。企业微信的正式名称是 `channel-wecom`，不新增 `wecom` 别名。

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "EXAMPLE_BOT_TOKEN"

octo-runtime channel-wecom configure \
  --bot_id assistant \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "EXAMPLE_APP_SECRET"

octo-runtime webui configure \
  --port 13888
```

业务参数与存储配置字段同名，渠道参数保留 snake_case。Gateway 用 `--bf_token`、WeCom 用 `--app_secret` 直接传入原文，保存不改写；省略时保留已有凭据。移除 `--credential-stdin` 和旧业务参数别名。`--adapter_type`、`--provider_agent_id` 等执行字段写入 `bots[].adapter`，其他 Bot 字段写入 `bots[]`。WebUI 只暴露 `--port`；首次配置从宿主 Home 推导 `sessionStorePath` 为 `<home>/extras/webui/sessions.json`，已有路径保留。高级路径设置使用 `config set`，JSON 字段名保持不变。

Bot 命令另支持 `--model`、`--effort`、`--provider_agent_id`。OpenClaw 不接受 `--workdir`；普通 Adapter 不接受 `--provider_agent_id`。切换 Adapter 时若旧字段与新 Adapter 不兼容，使用 `config set` 明确替换业务配置。Gateway 的 API 地址必填；WeCom 可用 `--ws_url` 指定地址，更新时省略保留旧地址，新 Bot 省略使用官方地址。Gateway 省略工作目录时沿原有业务默认；WeCom 本地 Adapter 仍需要绝对工作目录。不探测或安装 Provider，不新增模型、思考强度或审批默认。

Gateway 和 WeCom 的 `configure` 均按 `bot_id` 定位：同 ID 更新原项（包括 api_url/ws_url 变化），新 ID 追加到 `config.bots`。旧 JSON 若存在跨 endpoint 的同 ID 多项，保留首项未提供的字段并合并为一项，其他 Bot 保留。两者均保留省略字段；完整 JSON 替换保持运行时原有身份校验。WebUI 在一个 Home 内只有一份配置，修改端口仍更新同一实例。

保存写入 `<home>/extras/<extra>/config.json`，自动构造 extraset 外壳，保留已有 `enabled` 和 `module`。未配置时可创建，disabled 时可编辑；命令不自动启用或启动服务。输出 `saved: true`、`reload_required: true` 表示写盘成功，需要整 Extra 重启生效，不表示运行中服务已经应用。首次使用按需执行 `<extra> start`；执行 Agent 任务另需启动 executor-kernel。

```sh
octo-runtime channel-gateway config set < gateway-business.json
octo-runtime channel-gateway config get
octo-runtime channel-gateway restart
```

## 进阶：手动拼 JSON

`config set` 输入是业务对象，例如 `{"bots":[]}`，不包含 `config`/`module`/`enabled` 外壳。它替换全部业务配置；完整列表出现重复身份会拒绝，而不是丢弃其中一项。`config get` **返回完整业务配置，包含凭据**；未配置返回 `{}`。正常保存结果、帮助及业务校验错误不返回凭据。旧 `extraset`/`extraget` 继续接受／返回完整外壳，extraset 仍是整份声明替换，不进行 Extra 业务校验。

需要直接管理整份声明时，用 `extraset/extraget`：手写 JSON 必须含 `config` 外壳，可带 `module`/`enabled`。它是整份替换，不执行 configure 的按 bot_id 更新。

```sh
octo-runtime extraset channel-gateway \
  < channel-gateway-declaration.json
octo-runtime extraget channel-gateway

octo-runtime extraset channel-wecom \
  < channel-wecom-declaration.json
octo-runtime extraget channel-wecom

octo-runtime extraset webui \
  < webui-declaration.json
octo-runtime extraget webui
```

交互/读取 stdin 不持有写锁。保存时在与 extraset 相同的 Home 写锁内比较整份声明修订；冲突返回 `EXTRA_CONFIG_CONFLICT`，需重新读取并决定重试。取消发生在原子写入开始前不保存；原子写入开始后以实际结果为准。Ctrl+C/外部 signal 取消命令，已完成的保存不回滚。POSIX 文件保持 0600，损坏、链接、权限不符不会当作首次配置覆盖。

参数名以小写字母开头，可含小写字母、数字、下划线及连字符，最长 64 字符，大小写敏感；命令名仍遵守原有小写字母/数字/连字符规则。

## 为第三方 Extra 提供命令

包的服务入口与命令入口分开。包通过 exports 暴露 `./commands`；主 Runtime 包公开合同位于 `@mininglamp-oss/octo-runtime/extra`。命令模块只声明元数据与函数，不在 import 时访问网络、读取凭据或初始化服务。

```ts
import type { ExtraCommandExtension } from "@mininglamp-oss/octo-runtime/extra";

// CLI 拥有 signal 和持久化；Extra 负责业务校验，交互必须配合取消。
const extension: ExtraCommandExtension = {
  apiVersion: 1,
  commands: [{
    name: "configure",
    description: "Save the business endpoint",
    options: [{ name: "endpoint", type: "string", required: true, description: "Service URL" }],
    async run(ctx, input) {
      const snapshot = await ctx.readConfig();
      const endpoint = String(input.options.endpoint);
      // 这里按业务合同校验 endpoint；若需认证，在写锁外完成并传 ctx.signal。
      const saved = await ctx.saveConfig({ ...snapshot.config, endpoint }, snapshot.revision);
      return { value: { ...saved } };
    }
  }]
};
export default extension;
```

与 CLI 安装在同一全局环境的 `octo-runtime-extra-<name>` 或 `@scope/octo-runtime-extra-<name>` 自动发现；`/commands` 与服务使用同一选中安装，移除或替换后拒绝继续加载。详见[模块载入](../concepts/module-loading.md)。其他包名或本地安装使用以下 Home manifest：

```json
{"version":1,"adapters":[],"extras":[{"name":"loop-daemon","module":"your-extra-package"}]}
```

包需以该 manifest 为来源可解析，例如安装到 Home 的 `node_modules`。服务使用所选 `module`，命令使用该 module 的 `/commands` 子路径；不扫描全局同名包。文件模块可显式声明 `"commands":"./commands.mjs"`，同样相对原始 manifest 解析。commands 字段属于该选中条目，重复被忽略的清单条目不会被导入。导出不存在时保留生命周期；声明的扩展损坏或 API 不兼容时仅该扩展失败，根帮助、其他 Extra 和普通离线生命周期继续可用。

命令可嵌套 `commands`，叶子提供异步 `run`，两者二选一；嵌套最多 8 层（顶层深度为 0），总命令最多 128。选项类型为 string/boolean，string 支持 `--name value` 或 `--name=value`；以 `-` 开头的值用等号形式。`arguments` 按声明顺序消费位置参数，`--` 后只解释为位置参数，不识别宿主选项或帮助。重复选项、未知选项、超量位置参数拒绝。组节点不声明选项或位置参数。

宿主选项名与 install/uninstall/start/stop/restart/status/run/logs 保留；顶层 Runtime 名称不可作为 Extra namespace。参数必填检查在帮助时跳过，帮助不调用 handler。返回 `value` 为可输出 JSON，可选 `message` 为普通终端的安全文本（`--json` 时只输出 value），`exitCode` 为 0..255（默认 0），没有返回值时不额外输出。`ctx.output` 可输出进度，JSON 模式下应避免污染结果；`ctx.prompt` 仅用于交互终端的非秘密输入，凭据输入方式由 Extra 决定，内置渠道直接接受字符串参数；有界 1 MiB 的 `ctx.readStdin` 继续用于 JSON 配置和其他扩展流程。插件负责所有主动输出的脱敏，通用宿主不能判断业务对象哪些字段是秘密。

`ExtraCommandError` 只用于固定安全错误码与提示，禁止拼入用户输入、凭据或后端错误；其他 handler 异常被折叠为 `EXTRA_COMMAND_FAILED`。命令与 CLI 同进程运行，不是 JS 沙箱；handler 必须观察 signal、等待自己发起的操作并关闭自己创建的资源。通用框架不强杀或回滚第三方已完成的远端副作用。
