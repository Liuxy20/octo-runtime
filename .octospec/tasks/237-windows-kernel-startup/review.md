---
type: Review
title: "Issue 237：取消回滚原因链与恢复合同自审"
description: "检查最小 Service 错误装配修复、原生生命周期、手动测试与交付范围。"
tags: [windows, lifecycle, review, testing]
timestamp: 2026-11-02T10:58:00Z
---

# 结论

本地实现与验证满足本任务 Windows11/Node24/26 的当前合同。当前历史 replacement 故障未复现，旧根因未知；新增回滚诊断缺口已通过故障注入确认并最小修复。首次交付未执行远端写入；本轮按用户后续“提PR”授权提交和创建 PR，合并及关闭另行安排。

## 承重路径

1. 初始化仍由 startKernelServer 注册宿主 Adapter、持有原生 Core、owner 和 endpoint；普通执行仍通过 KernelClient/RPC，未恢复执行 worker。
2. `starting` 保留实际启动/回滚失败；取消可先结算 Promise.race。catch 先等原有 close，再决定是否合并已经记录的独立 AggregateError。没有新等待、预算、重试、进程退出或所有权释放。
3. 普通取消保留原 cause 身份；原先直接返回的 AggregateError 不重复包装。只有“另一个失败先结算 + 已确认启动聚合失败”增加错误嵌套。调用方应沿 Error.cause/AggregateError.errors 检查；不能再假定实际回滚失败仍只有单个取消 Error。
4. close 的 complete/errors/pendingResources、状态、首次结果缓存不变。已过期但仍 pending 的实际操作不推定完成，迟到清理不改写已返回的 incomplete。

## 规则与范围

已核对 context.yaml 中实际注入的10条规则。无公共接口、schema、包导出、依赖/锁文件、CLI策略、执行正文日志、默认测试入口或 CI diff。运行期错误只在独占测试诊断中输出，不进入产品日志；没有凭据输入。新手动测试使用真实原生服务与 RPC，fake Adapter，不借真实模型可用性作门禁。

任务、验证、review、journal 与生命周期规则保持中文及完整元数据。规则回流仅记录已确认的取消与回滚错误竞态；不提升“旧 EPERM 根因”或“Windows文件锁消失”等推断。

## 验证依据与限制

前后对照、逐场景断言、命令与完整边界见 [validation](validation.md)。修复后两版原组合各三轮5/5、增强组合各三轮13/13、扩展回归各52/52；构建/类型、静态与知识检查结果由交付清单绑定。未增加测试超时或 skip；新增专项自身12秒上限覆盖原有5秒截止，使用事件屏障控制时序。

无现行恢复失败的未处理发现。bind 尚未结束时，持久记录的 inspect available 不能解释为服务 ready/cleanup complete；已在验证边界记录，不据此绕过 owner。未执行完整默认测试、Windows10、macOS/Linux、真实 Provider/IM、Electron 或发行安装；共享平台回归应在合入/关闭前按实际结果补齐，#14 保持开放。

附加文档工具测试为9 pass / 2 fail，两项失败发生在创建 symlink 的 Windows EPERM 环境前提；当前文档实际链接审计及OKF检查通过。未修改该工具或放宽普通用户权限，不将其写成产品回归全绿。
