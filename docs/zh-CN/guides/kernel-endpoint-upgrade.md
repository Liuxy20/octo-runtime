# Kernel 端点升级

[English](../../en/guides/kernel-endpoint-upgrade.md)

常驻 POSIX Kernel 地址准确为 `<home>/executor-kernel.sock`。通过
`componentEndpoint(home)` 派生，并将同一个结果用于创建 Kernel、attach 客户端和
独立托管的 Extra。Extra 可选控制端点只提供自身状态，继续使用
`<home>/sockets/octo-runtime-<extra>.sock`，不是第二个 Kernel 地址。

Windows 保持既有 `\\.\pipe\octo-runtime-kernel-<home-hash>`。传输根据同一规范化
Home 派生管道，不创建 Unix socket 文件，也不另选状态目录。所有平台服务 ID 均不变。

Home 选择和准备归宿主。按 [Home 归属合同](https://github.com/Mininglamp-OSS/octo-runtime/issues/306)，
SDK 显式接收已准备的绝对 Home，只有 CLI 默认 `~/.octo-runtime`；已有自定义或旧平台
目录继续通过 `--home` 指定。端点升级不要求迁移数据或创建新 Home，原配置、凭据、
machine/profile 身份与 Provider 数据保留。

## 停止、升级、重启

1. 替换旧版本前，停止连接旧 Kernel 的所有 Extra，再停止 Kernel 并确认完整清理。
   CLI 部署使用旧版 `<extra> stop --home <home>` 和
   `executor-kernel stop --home <home>`；SDK 宿主等待各服务 `close()` 的清理结果。
2. 旧版本异常退出时，先停止其遗留工具，再用旧版 `doctor` 与显式
   `executor-kernel recover --acknowledge-orphan-cleanup --home <home>` 确认；随后用
   旧版启动并正常停止，完成其所有权清理后再升级。SDK 宿主以旧清单的准确路径调用
   `inspectOrphanCleanup` / `acknowledgeOrphanCleanup`。默认 endpoint-only SDK 清单
   位于 `<old-endpoint>.runs`，CLI 清单位于 `<home>/run/kernel-invocations.json`。
   未知或损坏记录由资源所有者调查，新版不删除或重新解释。
3. 同步升级 Kernel 与全部客户端/Extra，替换宿主或原生客户端中硬编码的旧地址，
   使用当前派生结果。先重启 Kernel，再启动 Extra。服务 ID、Home 和定义未因本次
   布局改变，无需仅为端点布局重装系统服务。
4. 查询新 Kernel status 和各 Extra 的 `kernel_available`；attach 客户端须重新连接
   新地址。不保留别名监听、自动回退、请求转发或旧执行重放。

## 旧端点保护

旧地址为 `<home>/sockets/octo-runtime-executor-kernel.sock`。新版在 POSIX 上用旧版
识别的 PID/nonce 协议持有旧地址的 `.owner` 租约，直到新服务完整关闭。这是兼容锁，
**不是第二个监听 socket**，因此没有 Extra 控制 socket 时也可能保留 `sockets` 目录。

旧 socket、旧/未知 owner 或旧端点旁的 `.runs` 记录均触发
`KERNEL_ENDPOINT_UPGRADE_REQUIRED`，附带真实路径和失败操作。已停止但尚未确认的文件
同样阻止启动；新版保留现场，提示先完成旧版停止/恢复流程。不因连接失败便 unlink
旧 socket，不终止 PID、不扫描其他 Home、不重置用户状态。

只有本实现留下、与规范端点匹配且原 owner 已确认不存在的过渡租约，可在回收锁内
重新取得。PID 身份或权限不确定仍拒绝。新版异常退出的规范执行清单继续沿既有显式
recover 流程处理；兼容锁不代表执行资源清理已获确认。清理不完整时保留两个租约，
阻止替换，等待所有权问题解决。
Kernel 还会核对关闭 server 后本次 socket 是否仍在；close 回调成功不能代替路径
回收确认，也不再补一次可能误删替换文件的路径删除。

规范地址上的遗留 socket 也必须有本实现的匹配 Kernel owner，且原 PID 已确认不存在，
才允许回收。没有 owner 的 socket 或未知记录保留。socket/owner 文件名同时列为 CLI
保留 profile 名；已有冲突明确失败，不自动改名或删除。

## 地址预算

直接文件名比旧 Kernel 路径少 21 个 UTF-8 字节。POSIX IPC 预算按**完整编码地址**
计算（Node pathname socket：macOS 103 字节、Linux 107 字节），与 owner/recovery/
state 文件的文件系统预算分别处理。Extra 控制端点预算独立，Kernel 可用的 Home 不
保证任意 Extra 控制地址都可用。Windows 管道预算与文件路径分别处理，不统一套用
260 字符。显式 Home/address 超限时明确失败，不改用 `/tmp`、父目录或另一个 Home。

依据见 [Node IPC 文档](https://github.com/nodejs/node/blob/v24.22.2/doc/api/net.md#ipc-support)。
本次实测平台、证据和待整合项记录在仓库 Issue 303 任务中；平台参数计算不等于真实
Unix bind 验证。
