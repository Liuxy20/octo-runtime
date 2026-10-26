---
type: Guide
title: Extra 配置与调用
description: 当前 CLI 路径、SDK 声明及本地 WebUI。
tags: ["extra"]
timestamp: 2026-10-15T00:00:00Z
implementation_baseline: df63c8f
---

# Extra 配置与仓库外开发

当前配置、函数式插件合同和生命周期以 [Extra 规则](../rules/extras.md) 为准。Host SDK 的原生服务和动态函数示例见 [Extra 指南](../../docs/zh-CN/guides/extras.md)，CLI 文件操作见 [CLI README](../../apps/cli/README.md#extra-配置)。

第三方使用主发行包 /extra 与 /protocol 导入通用类型和工具，通过 /host.createExtraService 装配模块、配置与泛型依赖，再 initialize/status/close。Gateway 模块和业务类型从 /extras/channel-gateway 导入。JSON Schema 由 /extras/<name>/config-schema.json 公开；SDK 只接受已解析配置值，存储来源由宿主选择。严格包外 TS 编译与运行见 [public-extra](../../test-support/public-extra/plugin.mts) 和 [发行验证](../../scripts/verify-release.mjs)。

Gateway 的可选 createSessionStore 也属于它自己的 dependencies，同步返回 ImSessionStore；通用 ExtraContext/加载器不认识会话方法或数据库。宿主 store、默认内存、句柄所有权与完整加载示例见 [SDK 指南](../../SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)和[可运行宿主样例](../../test-support/public-extra/gateway-store.mts)。独立 Extra 可以定义完全不同的依赖类型，沿用同一泛型服务；不需要修改 Runtime 的共享入口。

```bash
octo-runtime extraset channel-gateway < gateway.json
octo-runtime channel-gateway restart
```

extraset 保存完整声明，重启只影响对应组件。首次使用先 install；start/restart 不隐式安装。旧 daemon 接口和服务命令不再提供。
