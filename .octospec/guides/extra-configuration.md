---
type: Guide
title: Extra 配置与调用
description: 当前 CLI 路径、SDK 声明及本地 WebUI。
tags: ["extra"]
timestamp: 2026-10-27T00:00:00Z
implementation_baseline: a7c33b6
---

# Extra 配置与仓库外开发

CLI 简化配置使用 [Extra 自有命令](../../docs/zh-CN/guides/extra-commands.md)；configure 按业务 ID 更新，Extra 下的 extraset/extraget 读写完整声明；旧顶层写法隐藏兼容。

当前配置、函数式插件合同和生命周期以 [Extra 规则](../rules/extras.md) 为准。Host SDK 的原生服务和动态函数示例见 [Extra 指南](../../docs/zh-CN/guides/extras.md)，CLI 文件操作见 [CLI README](../../apps/cli/README.md)。

第三方使用主发行包 /extra 与 /protocol 导入通用类型和工具，通过 /host.createExtraService 装配模块、配置与泛型依赖，再 initialize/status/close。Gateway 模块和业务类型从 /extras/channel-gateway 导入。JSON Schema 由 /extras/<name>/config-schema.json 公开；SDK 只接受已解析配置值，存储来源由宿主选择。严格包外 TS 编译与运行见 [public-extra](../../test-support/public-extra/plugin.mts) 和 [发行验证](../../scripts/verify-release.mjs)。

Gateway 的可选 createSessionStore 也属于它自己的 dependencies，同步返回 ImSessionStore；通用 ExtraContext/加载器不认识会话方法或数据库。宿主 store、默认内存、句柄所有权与完整加载示例见 [SDK 指南](../../SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)和[可运行宿主样例](../../test-support/public-extra/gateway-store.mts)。独立 Extra 可以定义完全不同的依赖类型，沿用同一泛型服务；不需要修改 Runtime 的共享入口。

```bash
octo-runtime channel-gateway extraset < gateway.json
octo-runtime channel-gateway start
```

`extraset` 保存完整声明，不启动或重启组件。上述示例适用于已保存且启用的 Gateway 声明；`start` 在服务未安装时自动安装本组件并开启自启，已安装时保留服务设置。修改配置后，对已安装且启用的服务执行 `octo-runtime channel-gateway restart`。`restart` 不自动安装，未安装时返回退出码 3。

`install` 首次和重复执行均默认开启自启；只有显式 `--autostart=false` 才禁用，再次普通 `install` 会恢复自启。服务禁用后，`start` 和 `restart` 返回 `SERVICE_DISABLED`；先执行 `octo-runtime channel-gateway install --autostart=true`，再启动。只需前台调试时使用 `octo-runtime channel-gateway run`，无需注册系统服务。

WebUI 使用 `webui extraset` 保存声明，再执行 `octo-runtime webui start`；WeCom 使用 `channel-wecom extraset` 保存声明，再执行 `octo-runtime channel-wecom start`。各组件的 `run/start/restart` 都使用自己的名称，不能用 `channel-gateway` 代替。所有命令选择同一个 Home；自定义 Home 时每次使用相同的 `--home`。启停只影响所选组件，不会启动或停止 Kernel 或其他 Extra。

精确的安装、自启和禁用行为见[CLI 生命周期合同](../rules/runtime-lifecycle.md#cli)。SDK 宿主继续使用上文的 `createExtraService`，不要求注册 CLI 系统服务。旧 daemon 接口和服务命令不再提供。
