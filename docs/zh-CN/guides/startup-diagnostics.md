# 启动诊断

[English](../../en/guides/startup-diagnostics.md) | [文档目录](../README.md)

启动诊断描述组件构造或初始化的失败；即使没有 Run、Session、Task 或 IPC 端点，失败调用也能直接返回诊断。启动后的业务执行错误仍沿原执行域处理，不创建 synthetic failed Run。

从 `@mininglamp-oss/octo-runtime/host` 或 `/executor-kernel` 导入 `describeStartupError`、`formatStartupDiagnostic`、`STARTUP_CATALOG`、`StartupDiagnostic`。`ServiceInitializationError.diagnostic` 直接提供相同结构；原始 `cause` 与 `cleanup` 仍供宿主本地排查。构造和 `initialize()` 都应在捕获边界内。

```ts
import {
  createKernelService, describeStartupError, formatStartupDiagnostic
} from "@mininglamp-oss/octo-runtime/executor-kernel";

// hostPreparedHome and endpoint are selected/prepared by the host.
// The host composes Adapter objects; no agent Run is needed for startup.
try {
  const options = { home: hostPreparedHome, endpoint, adapters };
  const service = createKernelService(options);
  await service.initialize();
  // Keep service for status/close; close only resources this host owns.
} catch (error) {
  const diagnostic = describeStartupError(error, {
    component: "executor-kernel", phase: "initializing"
  });
  if (diagnostic.rootCode === "HOME_PERMISSION_DENIED" ||
      ["EACCES", "EPERM", "EROFS"].includes(diagnostic.context.systemCode ?? "")) {
    showHostPermissionHelp(diagnostic.context.path, diagnostic.context.operation);
  }
  showStartupFailure(formatStartupDiagnostic(diagnostic));
  // Inspect diagnostic.cleanup before retrying. Never parse error.message.
}
```

## 公共字段与兼容

公共结构包括 `domain: "startup"`、外层公共码 `code`、主根因码 `rootCode`（未知时为 `STARTUP_UNKNOWN`）、`component`、既有 `ServicePhase` 的 `phase`、`summary`、`explanation`、`actions`、`retryable`、`userActionRequired`、`context`、`causes`、可选 `cleanup` 和 `truncated`。不要求 Run 标识。`retryable` 表示等待或重试可能有帮助，不自动授权重试；先检查清理与所有权。

typed context 只包含已观测事实：`path`、`resource`、`operation`、`configKey`、`endpoint`、`executable`、`module`、`systemCode`、`measured`、`limit`、`unit`。已知失败路径同时进入文本和 JSON；权限拒绝不解释为不存在。spawn ENOENT 也可能来自 cwd 不存在，因此需要核对所选 executable 和工作目录，不能凭 errno 断言缺少程序。

保留原错误类、message、公共码、cause、cleanup 和 CLI 退出码选择。CLI JSON 保留 `error.code`、`message`、可选 `cause_code` 与管理器元信息，新增 `error.diagnostic`；深层根因使用 `diagnostic.rootCode` 分支。文本显示同一诊断及恢复动作。逃出常规 CLI handler 的启动错误也采用相同安全投影。不迁移 Run/status schema，不增加生命周期状态机。

`HOME_UNAVAILABLE` 继续为旧消费方保留目录说明。#306 退役 SDK 隐式 Home 选择，不能要求 SDK 用户补 LOCALAPPDATA。SDK 宿主显式提供已经存在的有效绝对 Home；CLI 准备自己选择的根目录，默认 `~/.octo-runtime`，显式 `--home` 优先。已有数据不自动移动。已整合 #306（#310）与 #303（#311）；POSIX Kernel 使用 Home 下直接 socket，没有旧端点迁移或双所有者检测层。

#306 的 RuntimeHomeError.diagnostic 平铺路径属性继续支持读取；标准 JSON 使用 context.path/resource/operation 和 actions。CLI error.startup 与可选 error.cleanup 继续作为兼容投影，新调用方使用 error.diagnostic。Kernel 日志目录非法时，在 Home 路径预算校验前返回 LOG_DIRECTORY_MUST_BE_ABSOLUTE；外层 SERVICE_INITIALIZATION_FAILED 与 CLI 退出码选择保持不变。

## 就绪与安全排障

进程存活、服务 phase、Kernel `execution_ready` 和应用业务连通性是不同事实。应用须分别检查 Kernel 就绪与自身业务连接。Provider probe 通过不证明登录或模型可用；本地诊断不增加云端登录、LLM 或网络前置条件。

cause 遍历最多 16 个对象、六层，支持聚合与循环；主失败优先，清理错误和 pending 资源继续保留。禁止投影原始异常正文/stack、全量环境、配置、stderr、凭据或任意属性。动态值经同一确定性安全格式化进入文本和 JSON，去除控制字符、URL 认证/query/fragment 及可识别敏感赋值。对不可信序列化结构先调用 `restoreStartupDiagnostic`，文案/建议从共享 catalog 重建，不信任记录里的解释。

CLI 在 `<home>/logs/startup-<component>.json` 保存每组件一份有界安全最近失败，与既有生命周期日志并存。后台 start/restart 只回读当前尝试时间内匹配组件的记录，再重建白名单；兼容旧版仅含码的日志。诊断写盘失败不能覆盖原始启动错误。Home/IPC 路径验证失败直接返回，不创建日志或替代 Home。记录不执行恢复，不包含原始异常或业务配置。

嵌套 cause 保留已观测的组件/阶段与清理事实；外层 cleanup complete 不能抹去内层 incomplete。

## 诊断目录

以下表格的 English-first 恢复说明直接来自共享 `STARTUP_CATALOG`，中文含义与其对齐。实际尝试按 executable、目录或 configKey 填入确定性动态信息。缺失、错误类型、权限、长度限制各自保留不同码；未知码保留标识，明确含义未知并要求下一步受控排查。

| Code | 含义 | 支持的恢复动作（共享 English-first 文案） | 重试判断 |
| --- | --- | --- | --- |
| `STARTUP_UNKNOWN` | 启动根因未知 | Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known. | 先由用户处理 |
| `LOG_DIRECTORY_MUST_BE_ABSOLUTE` | logging.directory 必须是绝对路径 | Pass an absolute directory in logging.directory, then retry startup through the host. | 先由用户处理 |
| `SERVICE_INITIALIZATION_FAILED` | 组件初始化失败 | Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known. | 先由用户处理 |
| `KERNEL_START_CLEANUP_INCOMPLETE` | Kernel 启动回滚未完成 | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | 先由用户处理 |
| `KERNEL_CLEANUP_INCOMPLETE` | Kernel 资源尚未全部释放 | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | 先由用户处理 |
| `HOME_UNAVAILABLE` | Runtime Home 不可用 | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | 先由用户处理 |
| `HOME_INVALID` | Home 必须是有效绝对目录 | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | 先由用户处理 |
| `HOME_UNSUPPORTED` | 不支持此 Home 路径或平台 | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | 先由用户处理 |
| `HOME_NOT_FOUND` | 所需 Home 资源不存在 | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | 先由用户处理 |
| `HOME_NOT_DIRECTORY` | 所需目录的资源类型错误 | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | 先由用户处理 |
| `HOME_PERMISSION_DENIED` | Home 资源访问被拒绝 | Check permissions for the reported resource and operation under the host account, then retry. Do not reset identities or replace Home to bypass the error. | 先由用户处理 |
| `HOME_PATH_TOO_LONG` | Runtime 资源超过路径限制 | The host must select and prepare a shorter supported path within the reported limit, then retry. Existing data is not moved automatically. | 先由用户处理 |
| `HOME_LIMIT_UNAVAILABLE` | 无法确定文件系统路径限制 | Make the operating system getconf utility available to query PATH_MAX/NAME_MAX, then retry with the same prepared Home. | 先由用户处理 |
| `HOME_UNUSABLE` | 无法使用 Home 资源 | Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known. | 先由用户处理 |
| `IPC_ENDPOINT_INVALID` | IPC 地址无效 | Pass a valid local IPC endpoint through the host's endpoint option, then retry. | 先由用户处理 |
| `IPC_ENDPOINT_UNSUPPORTED` | 不支持此 IPC 平台 | Use a supported platform and local IPC transport. | 先由用户处理 |
| `IPC_ENDPOINT_TOO_LONG` | IPC 地址超过传输限制 | Select a shorter Home or endpoint within the reported transport limit, then retry. Existing data is not moved automatically. | 先由用户处理 |
| `ENDPOINT_IN_USE` | IPC 端点已被拥有 | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | 先由用户处理 |
| `EADDRINUSE` | IPC 地址已被占用 | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | 先由用户处理 |
| `ENDPOINT_PATH_INVALID` | 端点位置存在其他资源类型 | Inspect the reported endpoint and correct the host's endpoint selection. Do not delete an unrelated file. | 先由用户处理 |
| `ENDPOINT_OWNER_INVALID` | 端点所有权记录无效 | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | 先由用户处理 |
| `ENDPOINT_UNVERIFIABLE` | 无法确认端点所有权 | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | 先由用户处理 |
| `ENDPOINT_RECOVERY_IN_PROGRESS` | 端点恢复正在进行 | Wait for the owning recovery operation to finish, inspect status, then retry. | 等待/重试可能有用 |
| `ENOENT` | 所需启动资源未找到；spawn 还需核对 cwd | Correct the reported resource selection or prepare the required dependency, then retry. | 先由用户处理 |
| `ENOTDIR` | 所需目录的资源类型错误 | Correct the reported directory path to an existing directory, then retry. | 先由用户处理 |
| `EISDIR` | 所需文件实际是目录 | Correct the selected file path to the intended regular file, then retry. | 先由用户处理 |
| `EACCES` | 启动操作访问被拒绝 | Check the host account's permissions for the reported resource and operation, then retry. | 先由用户处理 |
| `EPERM` | 操作系统拒绝启动操作 | Check the host account's permissions and the reported resource, then retry. | 先由用户处理 |
| `EROFS` | 启动操作需要可写文件系统 | Use an accessible writable resource for the reported operation, then retry. | 先由用户处理 |
| `ENAMETOOLONG` | 资源名称超过系统限制 | Select a shorter supported path or endpoint, then retry. | 先由用户处理 |
| `ECONNREFUSED` | 组件尚未接受 IPC 连接 | Inspect the target component's lifecycle and logs, start it through its host, then retry. | 等待/重试可能有用 |
| `SETUP_IN_PROGRESS` | 组件生命周期操作正在进行 | Wait for that operation to finish, then retry. | 等待/重试可能有用 |
| `SERVICE_INITIALIZATION_CANCELLED` | 组件初始化已取消 | Check the host cancellation request and cleanup outcome before starting again. | 等待/重试可能有用 |
| `KERNEL_CONFIGURATION_INVALID` | Kernel 构造输入无效 | Pass endpoint and an adapters array to createKernelService. Compose Adapter objects in the host; retired worker/manifest/env options are unsupported. | 先由用户处理 |
| `ERR_MODULE_NOT_FOUND` | 所选模块或其依赖未找到 | Check the selected module and its installed dependency graph in the host; correct the declaration or install the required package, then retry. | 先由用户处理 |
| `MODULE_NOT_FOUND` | 所选模块或其依赖未找到 | Check the selected module and its installed dependency graph in the host; correct the declaration or install the required package, then retry. | 先由用户处理 |
| `MANIFEST_INVALID` | CLI 模块清单无效 | Check the selected manifest.json: version must be 1 and adapters must be valid arrays without duplicate keys. | 先由用户处理 |
| `LOCAL_STATE_INVALID` | 无法读取本地状态 | Inspect the reported file and system cause. Preserve existing identities and configuration; correct the file or access through the host. | 先由用户处理 |
| `WRITE_FAILED` | 本地状态写入失败 | Inspect the reported path, operation and system cause; correct access before retrying the host operation. | 先由用户处理 |
| `COMPONENT_UNAVAILABLE` | 组件未就绪 | Inspect component status and controlled lifecycle logs. Process liveness alone does not establish Kernel execution readiness or application connectivity. | 等待/重试可能有用 |
| `SERVICE_PROCESS_EXITED` | 服务进程意外退出 | Inspect this startup attempt's controlled diagnostic and lifecycle logs before restarting. | 先由用户处理 |
| `SERVICE_NOT_INSTALLED` | 组件服务未安装 | Run this component's install command, then start it. | 先由用户处理 |
| `NOT_INSTALLED` | 组件服务未安装 | Run this component's install command, then start it. | 先由用户处理 |
| `SERVICE_DISABLED` | 组件服务已禁用 | Run this component's install --autostart=true command, then start it. | 先由用户处理 |
| `MANAGER_UNAVAILABLE` | 原生服务管理器不可用 | Run doctor and inspect the current user's native service manager. | 先由用户处理 |
| `ORPHAN_CLEANUP_INCOMPLETE` | 前一 Kernel 资源清理未完成 | CLI users: run doctor with the same --home. After confirming all owned orphan tools have stopped, run octo-runtime recover --acknowledge-orphan-cleanup with that Home, then start again. SDK hosts must use the corresponding inspect/acknowledge API; do not remove ownership records. | 先由用户处理 |
| `ORPHAN_RECORD_UNSUPPORTED` | 不支持已保存的 Kernel 所有权格式 | Preserve the ownership evidence. Stop and clean up using the version and host that created it before upgrading; do not acknowledge or delete an unknown record. | 先由用户处理 |

目录不为每个失败强制发明新公共码，也不把业务连通性错误改成组件启动错误。已删除的执行 worker 不恢复。
