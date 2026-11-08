# 模块装配

[English](../../en/concepts/module-loading.md)

SDK 原生 import Adapter 对象并传给 createKernelService，Kernel 不读取 manifest。CLI 的内置 manifest 与 Home manifest 仅声明 adapters；显式 --manifest 替换默认来源。

业务渠道通过独立仓库的 SDK 接入，Runtime 无插件发现、业务配置 schema 或注册 RPC。
