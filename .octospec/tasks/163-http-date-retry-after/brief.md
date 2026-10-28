---
type: Task
title: Issue 163 REST 投递遵守日期格式 Retry-After
description: 统一 Gateway HTTP 限流提示解析，避免日期格式退回一秒后提前重试。
tags: [channel, delivery, testing]
---

# 目标

处理 [Issue #163](https://github.com/Mininglamp-OSS/octo-runtime/issues/163)。服务器用 HTTP-date 指定最早重试时刻时，REST 客户端按剩余时间等待；超过既有预算时返回限流错误。

## 关键合同与归属

- 业务目标是遵守服务端的限流提示。解析属于 Gateway HTTP 传输层，不改变模型执行、宿主策略或其他 Extra。
- 显式输入为响应的 Retry-After、现有 JSON retry_after、当前本机时间和调用方 signal。HTTP-date 按目标时间减本机当前时间计算，不引入分布式时钟校正。
- PR #226 的 Jerry-Xin review 补充：IMF-fixdate、RFC850 和 asctime 三种 HTTP-date 均按 UTC 解释；asctime 没有时区后缀，也不能受客户端本地时区影响。最终按格式提取 UTC 分量构造，不再依赖 Date.parse。
- yujiawei 后续 review 补充：RFC850 的两位年份按 HTTP 的未来 50 年窗口展开为四位年份，超过窗口的同尾数日期回到最近的过去世纪；比较完整 UTC 时间戳，恰好 50 年不回退，不能使用 JavaScript 固定的 1950/2050 分界。
- REST 与鉴权/注册使用同一内部解析函数。秒数形式保留 REST 已支持的小数，非法值返回无提示；过去日期解析为零。有限秒数转毫秒溢出时保留 Infinity，REST 按超预算停止；连接错误沿用既有的非有限值归零行为。
- 2026-10-29 同类排查：数字只接受 ASCII 十进制整数及普通小数兼容（含 .5、1.），不接受正负号、进制前缀或指数；仅去除 HTTP 外层 SP/HTAB。日期只接受三种 HTTP-date 格式，并校验月份、有效日历、星期、1900 年起的年份及时间分量；闰秒映射到下一秒，避免提前等待。无效值回到调用方既有兜底，不猜测 ISO、本地日期或缺失时区。
- REST 对零等待继续沿用现有防连续重试策略：尝试正数 body 提示，否则等待默认 1000 ms。鉴权/注册仍可返回零，由建联层的既有退避决定等待。
- 正数 header 优先于 body；不缩短服务端要求的正数等待。保留每次 REST 调用最多两次重试、提示大于 10000 ms 不重试、累计退避大于 15000 ms 不重试及只向上增加的抖动。
- 15 秒仅为累计退避等待预算，不是端到端请求期限。上层 dispatcher 独立保留最多三次投递尝试和大于 3000 ms 等待时停止的合同；不把 REST 次数描述为整个投递流程的次数。
- signal 中断等待后不得再发送请求。解析不持有资源；原请求拥有计时器、取消监听及 HTTP 资源，资源所有权不变。
- 新增专项只由 node --test test/manual/gateway-retry-after.test.mjs 显式运行，不进入默认测试 glob、workflow、job、矩阵、触发条件或 Gate。

## 实现范围

新增内部 transport/retry-after.ts；REST errors 与 connection-error 复用解析。新增手动专项，覆盖确定时钟解析与真实 loopback HTTP 的发送/错误/退避路径。沿 octospec 记录规则、验证、review 与结论。

## 范围外

不调整重试额度，不重跑 AgentRun，不改公共 SDK/协议、进程拓扑、持久化、凭据或已部署设备。2026-10-28 用户后续授权 review 通过后提交并创建 PR；合并及部署不在本次授权内。

## 验收

1. 固定时钟覆盖未来/当前/过去 HTTP-date、数字秒/小数秒、空/无效/负数/溢出提示，检查 header/body/default 优先级及连接层的零值行为。
2. 真实 loopback HTTP 经 sendMessage 发出请求；未来日期的第二次请求不早于目标时间，数字提示继续生效，重试保留 client_msg_no。
3. 超过 10 秒的日期等待只请求一次；连续 429 仍受两次重试和 15 秒累计退避限制；退避取消和 retryOn429=false 不再发请求。
4. 先在基线运行日期回归确认失败，再在修复后通过。运行相关既有回归、lint、typecheck/build、格式、命名及 OctoSpec lint。
5. 使用 verified-review 阅读全部改动并运行真实 HTTP 场景，处理确认的问题。记录源码基线、平台、命令、实际结果与未测边界。
6. 核对相对 origin/main 的 workflow、package scripts 与实际默认检查列表，确认 CI 范围未扩大。
7. 显式手动专项在独立子进程固定 Asia/Shanghai 与 America/Los_Angeles，验证三种 HTTP-date、asctime 空格补齐的单数字日期及过去日期；真实 asctime HTTP 重试不得早于 UTC 目标时间。用户授权修复 review 后提交、push 并更新本地 main。
8. RFC850 覆盖 2026 时钟下的 2050、未来恰好 50 年及超过一秒、1999/2000 和 2090/2120 的世纪边界；真实 HTTP 的 2050 提示按超预算仅请求一次，上述检查也在两个非 UTC 子进程执行。
9. 非十进制、符号、指数、控制/Unicode 空白与非法日期表同时检查解析和调用方兜底；覆盖 UTC 闰秒、世纪闰年及 400 年日历周期的三格式往返和月末溢出。真实 HTTP 的非法 0x10 头仍按默认等待后成功重试，不能误判超预算。
