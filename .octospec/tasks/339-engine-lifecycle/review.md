---
type: Review
title: Issue 339：双轴审查与同类问题子审查
description: 独立记录 Standards、Spec 和生命周期同类问题的发现、修复及复核，不将两个轴合并排名。
tags: [review, lifecycle, ownership, autofix]
---

# 审查基线

使用 code-review 技能，固定 main `d5aeae707fcda0b138b360136f164c085c9a5e87`，审查命令为 `git diff <baseline>` 加本任务新增文件；提交前无新增 commit，故不能用空的三点提交 diff 代替工作区审查。规范来源为 AGENTS.md 与 context.yaml 所列规则，需求来源为 #339、用户后续说明及 brief/design/plan。三个子审查独立执行，之后针对 autofix 复核。

## Standards

初审2项P2：动态CLI资源只在内部Adapter合法时才登记，违反部分初始化失败完整回滚；初始化失败的清理结果只留下概括错误，丢失pending/failed资源事实。无额外确定的代码异味结论。

修复：先登记明确资源envelope再验证执行合同；用ServiceInitializationError保留主cause，cliCleanupResult保留unresolved/failed ID与分类错误。新增回归同时检查公开diagnostic.cleanup投影。独立复核确认两项修复，未发现新增Standards问题。

## Spec

初审2项P2：无效Adapter漏回滚（与Standards轴重叠，保留各自发现）；多个依赖资源并行/正序关闭，不满足设计逆构造序回滚。

修复：先登记再验证；逆构造序等待disposer，共用绝对deadline，每个disposer只启动一次，到期仍尝试其他资源。transport/session依赖回归通过。独立复核确认两项修复，未发现新增Spec问题。

## 同类问题子 review

沿factory、初始化失败、owner.close、共享fixture与finally向外检查，不扩大其他Adapter的执行模型。

1. 重复确认无效envelope漏回滚；已修复。
2. 手动审批Kernel fixture未消费独立owner且模块单例跨测试共享；改为每测试宿主工厂，显式status/finalizer与独立owner回收。
3. 多处验证脚本在Kernel/scope清理断言失败后跳过owner，测试helper首个owner失败后跳过其余owner。改为先尝试独立清理，再断言结果；涉及313 live/package/doctor、elicitation、dual-protocol及共享helper。
4. JS工厂close返回坏shape可使聚合抛TypeError，wrapper.closed永久未决。每个结果校验boolean和字符串数组，非法结果记本资源failed/incomplete，继续清理；5秒上限回归验证初始化失败和closed均返回。

同类最终复核确认上述发现均修复。ACP/OpenClaw/DSH逐调用模型未发现应随本次迁移的常驻所有权缺陷，保留原模型。额外复核审批fixture迁移未掩盖生产缺陷：writer上限来自基线；测试证明分批累计512，不宣称一次突发512成功。审查是有范围的静态检查与回归，不宣称没有所有潜在缺陷。

## 验证与结论

修复前4项定向测试均失败，修复后通过；最终默认1548通过/61跳过，专项136通过，真实direct/IPC恢复与双Core共享通过。具体命令、平台限制、发行包消费和首次失败见[验证](validation.md)。

Standards：2项已修复，未解决0项；Spec：2项已修复，未解决0项；同类问题按以上4类完成修复及复核。两个轴未合并排名，重叠项不当成两个独立缺陷统计。
