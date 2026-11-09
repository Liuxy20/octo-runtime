---
type: Task
title: Runtime npm 发行版本纠正
description: npm 继续 1.1.12 发行，协议版本不决定 npm 主版本。
tags: [release, documentation]
---

# 用户决定

用户明确要求版本纠正另开 worktree、Runtime 也开新分支。npm 沿 1.1.11 → 1.1.12 递增；不考虑旧接口兼容，不增加兼容层。agentEnv、平铺 invoke、interrupt 和 IPC v2 保持。该决定取代此前将破坏性接口等同于 npm 2.0.0 的推断。

## 范围与验收

纠正当前版本合同、安装提示与依赖工具中的 2.x 假设；历史实测记录保留日期并由新决定覆盖。Runtime/client 源码保持 0.0.0，由发行 tag 注入相同版本，确认现有发布器允许 1.1.12。不发布、不合并、不修改用户原分支。Gateway 锁仅能使用真实归档/注册表数据，不伪造新版本 integrity；1.1.12 尚未发布时明确记录验证限制。

规划可执行性 96/100，版本边界明确、工作树独立；验收需检查双语一致、CLI 提示和发行版本解析，实际结果另记。
