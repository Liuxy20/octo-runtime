---
type: Task
title: DSH 公开进度与终局语义
description: 按当前原生生命周期修正步骤分类及唯一 root final，验证独立 Gateway 消费。
tags: [adapter, canonical, stream, testing]
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/298
---

# 目标与范围

基线 main `157fabb7d680df1ee72d9d9e5ed40cfc6c22b336`；独立 clone、分支 `fix/298-dsh-semantics`。#329 已合并；DSH 原生映射归 Runtime adapter，投影、卡片与投递归独立 Gateway。只修改前者，后者使用独立 checkout 验证消费，不恢复 Extra/WebUI/worker。

业务目标是工具步骤有可信分类、公开进度不进入最终正文、最终 root 回答只发布一次。决定权来自 #298；输入是 DSH 原生事件，不改变宿主的模型、权限、会话或产品策略。所有 canonical 消费方共同受益，不新增 Gateway 私有 parser。

# 承重合同

- `step/end` 无 finishReason；依据已观察的 tool/call 派生 tool-calls，依据完整 root 终局派生 stop，不伪造上游字段。
- 暂存未确认用途的 root 公开文字；工具/后续步骤或 turn 证明其为 commentary，receipt + durable terminal + idle 后才发布最后合格回答为 final。保持 chunk 边界和 commit 前缀核对，不重分类已发布正文。
- 保持工具身份、原生顺序、步骤时间、子会话 lineage、私有 reasoning、失败/取消；缓存有字节和条数上限。子会话绝不成为 root final。
- 原生 SDK 不打补丁，Core/协议不增加 DSH 特例；不改变 native 准入或资源回收承诺。
- child 活动按原生 started/finished 运行边界逐次配对：重复结束不重复投影；结束后无新 started 的帧不重启工作。新的 started 可合法重新挂载同一 durable child，须分配新的 canonical 活动身份；不增加“必须有新 turn 才允许恢复”的推断条件，不永久屏蔽 child。

# 验收

1. 修改前在 adapter → Core → 独立 Gateway projector/reasoningPhases 记录反例。
2. 手动专项覆盖多步骤多工具、公开进度→工具→最终、纯 final、legacy chunk/commit、durable stream、失败、取消、子会话、多 turn、顺序异常及容量边界。
3. 校验 final 在终局确认前为空且只一次；卡片标题、工具身份/状态/归属/时间与 canonical 一致。保存实际消费者生成的卡片 payload。
4. Windows 原生 Node 24/26 专项、相关既有测试及当前仓库检查。真实 DSH/IM 无凭据则明确未验，不把 fixture 当 live。
5. 不增加 CI/workflow/job/matrix/trigger/gate；按用户追加授权提交、推送并向 main 创建 PR，以 Refs #298 关联；不合并、关闭 Issue 或发布。
