---
type: Task
title: Issue 205 宿主管理 DSH npm 入口
description: 明确宿主选择与传入 DSH 入口的责任、范围和验收合同。
tags: [adapter, runtime, installation]
---

# Issue 205：宿主管理 DSH npm 入口

需求依据：[Issue #205](https://github.com/Mininglamp-OSS/octo-runtime/issues/205) 及其 2026-10-28 评论。评论取代原 Desktop/ASAR 验收方向。

## 可执行性与范围

实施可执行性评估为 95/100，达到用户要求的 95 分门槛。这是工程判断，不是成功概率：合同、现有配置传递链路、官方 SDK 接口及本地回归入口均已核对；各平台原生 npm 包与 Electron 实测独立记录，专项验证不加入 GitHub CI。

业务目标：宿主选择 npm 安装的 DSH，并将 JS 入口绝对路径作为 `providerOptions.dshBin` 传入。安装、升级、配置来源及认证归宿主和 DSH；Adapter 校验入口及兼容版本，使用未经修改的官方 Client 完成 stdio SDK 握手、执行及关闭。

## 合同与拓扑

- CLI/SDK 宿主原生创建 Kernel；Kernel 内部 worker 执行唯一 Core 和 Adapter。官方 Client 及版本探针只启动所选 JS 入口，使用当前 `process.execPath`，Electron 子进程固定 `ELECTRON_RUN_AS_NODE=1`。不增加外部 Node 依赖。
- Kernel 既有 `adapterConfigurations.dsh.providerOptions` 同时用于 discovery 与 invocation。CLI 在常驻 Kernel 和 playboard 创建前共用宿主配置解析：显式 `<home>/<profile>/config.json` adapters execution provider_options 优先；未配置 dshBin 时选择 PATH 中首个 dsh，通过 npm 包名及 bin 元数据确定 JS 入口，不执行 shim。Windows npm prefix 和项目 node_modules/.bin 也适用；不识别、缺失或不兼容时不换另一安装。进程内 Core、SDK 应用自行选择并显式传入配置。
- 删除 Adapter 内的 PATH 发现、`command/args`、`desktopPath`、Desktop 桥接。Adapter 未收到配置或格式非法返回 `DSH_CONFIG_INVALID`；文件缺失返回 `DSH_EXECUTABLE_NOT_FOUND`；版本不兼容、启动失败及握手失败保持现有明确错误。
- 不读取或执行 Desktop bundle/ASAR，不修改全局 ASAR 行为，不选择另一个安装，不重置身份、Home、profile、认证或既有会话。不修改官方 SDK。
- Provider 子进程由官方 SDK 关闭；版本探针继续使用现有进程清理。实验性 SDK 的后代清理与输入预算限制不变。

## 验收

1. 配置缺失、相对路径、wrapper、Desktop/ASAR 入口及旧启动字段被拒绝，缺失安装不回退。
2. 版本、初始化失败保持明确；原有执行/续聊/取消/错误回归通过。
3. Kernel `client.list()` 与调用使用同一宿主配置；带空格及非 ASCII 的入口可启动。
4. 真实 npm DSH 及 Electron 的版本探测和 SDK 初始化通过显式手动专项验证，不调用模型、不新增 GitHub CI；fixture 测试和原生验证分别记录。
5. 同步双语文档与宿主配置示例，执行 verified-review 后提交英文 commit/PR，保留 Codex trailer。
6. CLI 无需手工填写 dshBin 即可从 npm 安装自动发现；常驻 Kernel list/invoke 与 playboard 均覆盖，自动补齐保留 dshHome、streamLimits 及其他宿主配置。
7. PATH 只跳过实际不存在的候选；首个已存在候选为损坏链接、不可执行文件或非文件时也不选择下一安装。npm 元数据无效同样终止发现。
