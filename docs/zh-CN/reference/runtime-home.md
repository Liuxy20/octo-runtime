# Runtime Home：宿主所有权与迁移

[English](../../en/reference/runtime-home.md) | [SDK 接入](../getting-started/sdk.md)

`createKernelService({ home, endpoint, adapters })` 和 `createExtraService({ home, endpoint, module, config, dependencies })` 都要求宿主显式提供已存在、可访问的绝对目录。构造不做 IO；`initialize()` 在日志、名称/端点所有权、身份或监听启动前校验 Home。SDK 不根据 appId、平台、环境或 cwd 选择目录，不展开 `~`，不创建 Home 根，也不回退到父目录或其他根。验证后可以创建 Runtime 自己的子目录和文件。

宿主按产品设计选择目录、创建根、授予权限，再传给 SDK。Electron 可以选择自己的 `userData`、Application Support、AppData 或用户选定目录；这些是产品决定。下面是宿主代码，`getPath` 与 `mkdir` 均不在 SDK 内：

```ts
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createKernelService, componentEndpoint } from "@mininglamp-oss/octo-runtime/host";

await app.whenReady();
const home = join(app.getPath("userData"), "runtime"); // 产品选择
await mkdir(home, { recursive: true }); // 宿主准备
const kernel = createKernelService({ home, endpoint: componentEndpoint(home), adapters: [] });
await kernel.initialize();
// 应用退出时先关闭自己的 Extra，再 await kernel.close() 并检查 complete。
```

`componentEndpoint`、`normalizedHome`、`homeHash` 和 `componentServiceId` 是纯计算工具：先检查原始输入语法；endpoint 派生还检查文件系统/传输预算，但不证明实际目录存在。服务仍独立验证必填 `home`，不能用预先算好的 endpoint 绕过。`hostHomePaths` 额外访问文件系统验证目录；`ensureHostHome` 只为已经存在的根创建内部资源；账号/profile 路径对象携带 `home`，`ensureAccount`/`ensureLocalRuntime` 写入前也重验根，缓存路径不能补建消失的 Home。`resolveHostHome(appId)` 已删除。

`attachKernel({ endpoint })` 是只拥有连接的低层 API，不启动服务、不推断或创建 Home。`acquireEndpoint(endpoint)` 只管理端点租约，父目录须已准备；两者都拒绝无效/超长 IPC 地址。内部 `startKernelServer` 同样校验地址且不创建 endpoint 父目录，不是替代公开 Home 服务边界的入口。显式低层 Core 不使用 Home，也不提供 Home 服务托管。

## 路径与传输预算

支持 Linux、macOS 绝对 POSIX 路径和 Windows 本地盘绝对路径；拒绝文件系统根。Windows 拒绝 UNC、device/扩展前缀、盘相对/root-relative、ADS、保留设备名与尾部空格/点，避免 IO 与端点 hash 指向不同资源。合法空格与中文保留，不按 JS 字符个数计量。

| 资源 | 校验 |
| --- | --- |
| Linux/macOS 文件路径 | UTF-8 字节；启动通过 OS `getconf PATH_MAX/NAME_MAX <home>` 查询，完整路径为 PATH_MAX 减 NUL；纯计算按对应 OS 的 PATH_MAX/NAME_MAX 校验 |
| Windows 文件路径 | Node/libuv 扩展路径按 UTF-16 code unit；总预算 32767 减 NUL 和自动添加的 `\\?\` 前缀，单组件 255；不是统一 MAX_PATH=260。实际 IO 仍可能更早失败并报告系统错误 |
| pathname Unix socket | 当前 Linux 最多 107 UTF-8 字节，macOS 最多 103；为 sun_path 的结尾 NUL 留空间 |
| Windows Named Pipe | 按 CreateNamedPipe 的文档支持合同，完整 pipe 名最多 256 UTF-16 code unit；Home hash 保持既有命名，不把 Home 字节数套入 Unix socket 预算 |
| 附加名称 | 启动前检查端点 owner/recovery、实际 manifest/原子写/确认归档、日志轮转锁；profile/CLI 状态派生检查自身完整路径 |

Unix 固定使用 OS `/usr/bin/getconf`，不受 Provider 专用 PATH 影响；必需资源查询时工具不可用或不能取得确定值则返回 `HOME_LIMIT_UNAVAILABLE`，不猜测文件系统限制。可选日志的 IO（含文件系统预算查询失败）仍由既有 best-effort 日志层处理，不因日志路径不可用而判定可用 Home 失败；日志路径语法和静态长度预算在该隔离边界外仍严格检查。Home 验证使用只读目录检查和独占短文件探针确认实际权限（特别是 Windows ACL）；探针不修改身份、凭据或配置，正常验证后立即删除。启动校验是同账号互信下的观测，不是阻止同账号并发替换目录的 OS 沙箱。

依据：[Node IPC](https://github.com/nodejs/node/blob/v24.19.0/doc/api/net.md#identifying-paths-for-ipc-connections)、[Microsoft 路径](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)、[Named Pipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea)、[Linux limits](https://github.com/torvalds/linux/blob/master/include/uapi/linux/limits.h)、[Darwin limits](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/syslimits.h)。当前 POSIX 布局仍为 `<home>/sockets/octo-runtime-<component>.sock`。后续 #303 修改布局时必须一起调整预算，不能将本次验证当成新布局的证明。

## 失败诊断

`ServiceInitializationError.cause` 保留 `RuntimeHomeError`，`cleanup` 保留既有回滚结果，不产生 AgentRun 终态。`RuntimeHomeError.diagnostic` 包含 `domain: startup`、稳定 `code`、实际 `path`（缺失输入无 path）、资源 `resource`、失败 `operation`、宿主处置建议 `action`。长度失败提供 `measured/limit/unit`，IPC 长度还提供安全的派生 `endpoint`；系统 IO 保留必要 `systemCode` 和 cause。CLI 复用此诊断输出 `startup` 与 `cleanup`，不打印原始环境/配置/异常正文；无效 Home 不通过日志递归创建根。

主要码为 `HOME_INVALID`、`HOME_UNSUPPORTED`、`HOME_NOT_FOUND`、`HOME_NOT_DIRECTORY`、`HOME_PERMISSION_DENIED`、`HOME_PATH_TOO_LONG`、`HOME_LIMIT_UNAVAILABLE`、`HOME_UNUSABLE`、`IPC_ENDPOINT_INVALID`、`IPC_ENDPOINT_UNSUPPORTED`、`IPC_ENDPOINT_TOO_LONG`。宿主应按实际原因准备目录、修正权限或选择满足预算的目录，然后重建/重试服务；SDK 不自动搬迁数据。

## 调用方迁移

1. 删除 `resolveHostHome(appId)` 调用；宿主自己选择并准备绝对根。
2. 所有 Kernel/Extra 服务 options 增加必填 `home`，保留明确的 endpoint。原先仅传 endpoint 的调用必须迁移；不能从 endpoint hash 逆推 Home。
3. `HostAccountPaths` / `HostProfilePaths` 新增必填 `home`，优先使用路径 helper 生成，手工构造时必须同步提供；`hostHomePaths` 不再接收模拟平台参数且要求真实目录存在；平台计算使用 endpoint 工具，不能充当跨平台实机验收。
4. CLI 只选择显式 `--home` 或所有平台统一用户 `~/.octo-runtime`。相对 `--home` 由 CLI 明确转绝对；空值与字面 `~` 拒绝。移除 `OCTO_RUNTIME_HOME`、LOCALAPPDATA、Application Support 和 XDG 隐式分支。
5. 原 Home、profile、身份、配置和凭据不自动移动或删除。Windows 旧 `%LOCALAPPDATA%\OctoRuntime`、旧环境覆盖目录或产品目录若仍要使用，显式传 `--home <原绝对目录>`；保存的旧服务定义继续使用其原明确目录，重新安装时也指定相同目录。

本次 Windows Node 24/26 的实际结果和未验证平台见 [Issue 306 验证记录](../../../.octospec/tasks/306-runtime-home/validation.md)。专项显式运行 `node --test test/manual/runtime-home-306.test.mjs`，不扩大默认 CI。
