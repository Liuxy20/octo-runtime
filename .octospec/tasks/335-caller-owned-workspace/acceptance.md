---
type: Task
title: Issue 335 验收条件
description: 路径所有权、稳定错误码、恢复和不创建目录的验收矩阵。
tags: [workspace, validation, error]
---

| 项 | 条件 | 本地证据 |
| --- | --- | --- |
| W1 | path-only 类型/Schema/runtime 一致；fixed/random/none/mode 空值全部拒绝；无分配器导出 | 生成漂移、Schema及包外类型手动专项 |
| W2 | 调用方已建普通目录/临时目录原样使用，env/context/config 冲突拒绝 | 实际 Core 捕获 fake Adapter 输入 |
| W3 | 缺少/相对/不存在/文件/不可访问目录分别返回具体 WORKDIR_*；Provider 尚未启动 | canonical/native 与 IPC 手动专项；权限按平台条件记录 |
| W4 | 续接、fresh recovery 同一目录；删除后不创建、不换目录 | 连续调用/文件系统断言 |
| W5 | preset 和 workspace:false 无本地覆盖；OpenClaw 不强制本机路径 | 元数据与 Adapter 回归 |
| W6 | 旧随机目录/其他用户文件原样保留，Home/log/IPC/Provider 状态正常 | 删除代码审查、临时状态与现有生命周期回归 |
| W7 | CLI/SDK 文档要求预创建并显式传路径，Gateway 审计指出旧 mode 输出 | 双语 docs 检查、审计记录 |
| W8 | Runtime/client 双包、lint/typecheck/full suites/OKF 通过，无 CI 扩围 | 最终 validation.md 与 workflow/checks 审计 |

手动专项不接入默认测试入口。原生 Provider/IM 未实际执行时必须写未验证；不能把 fake Provider 计为真实执行证据。
