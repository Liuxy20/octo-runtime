---
type: Guide
title: Extra 配置与调用
description: 当前 CLI 路径、SDK 声明及本地 WebUI。
tags: ["extra"]
timestamp: 2026-10-15T00:00:00Z
implementation_baseline: df63c8f
---

# Extra 配置与仓库外开发

当前配置、函数式插件合同和生命周期以 [Extra 规则](../rules/extras.md) 为准。Host SDK 的独立进程和动态函数示例见 [原生接入指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#3-独立-extra)，CLI 文件操作见 [CLI README](../../apps/cli/README.md#extra-配置)。

第三方使用主发行包 /extra 与 /protocol 导入类型和工具，通过 /host.startExtra 装配自己的模块。JSON Schema 由 /extras/<name>/config-schema.json 公开；SDK 只接受已解析配置值，存储来源由宿主选择。严格外部 TS 编译与实际运行 fixture 见 [public-extra](../../test-support/public-extra/plugin.mts) 和 [发行验证](../../scripts/verify-release.mjs)。

```bash
octo-runtime extraset channel-gateway < gateway.json
octo-runtime channel-gateway restart
```

extraset 保存完整声明，重启只影响对应组件。首次使用先 install；start/restart 不隐式安装。旧 daemon 接口和服务命令不再提供。
