---
type: Review
title: "Issue 240：交付前自审"
description: "核对真实 EOF、同步测试拦截、失败/清理断言和范围边界。"
tags: [testing, adapter, windows, review]
timestamp: 2026-11-03T02:07:00Z
---

# 结论

本地 diff 可审查，未发现需要扩展至生产实现的缺陷。最终验证范围见[validation](validation.md)。macOS/Linux未执行是保留的验收缺口，不宣称跨平台实测通过。

## 合同检查

- 父端是实际 Node 子进程创建的 OS 管道，没有合成 end、成功/失败替身或先 kill 再观察。child.stdout 对应fd3而非物理fd1已在说明中明确；输出句柄由同一Provider持有，无中间代理退出混淆。
- EOF监听在生产客户端安装监听之前登记，先独立kill(pid,0)探测；同一真实ChildProcess的exit/close和destroyed句柄构成后续证据。原错误正则与零终态仍执行，5000ms未改。
- spawn替换仅同步构造期间可见，finally恢复属性并同步Node ESM绑定。手动回归覆盖构造抛错恢复；原文件并行Grok/标准ACP隔离用例继续通过。无生产注入API、协议、配置或依赖修改。
- 同一after disposer先等待所属客户端close与实际child.close，再删测试目录；通过轮在断言主体已确认退出/句柄关闭。专项独立观察后的测试disposer清理不伪称Adapter自动动作。
- 完整原文件Node24/26各三轮28/28，显式手动各3/3，受影响13文件各69/69；基线外层65秒强收尾不计通过。未改变workflow、package scripts、required checks或默认专项入口。

## COMPREHENSION

1. 改变的是测试的ACP输出所有权，确保进程存活时可主动关闭真实管道；生产EOF处理与cleanup不变。
2. 风险集中于同步spawn替换与额外fd的跨平台表现。替换不跨await，finally恢复；Windows两版实际验证，POSIX待独立运行。
3. 原断言之外，父端EOF/PID/exit/close/句柄顺序直接核对目标前提；不靠测试变绿反推EOF发生。证据包含失败基线和全部最终轮日志。
