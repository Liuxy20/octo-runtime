/** 从共享 English-first catalog 重建双语目录；显式运行 node test/manual/generate-startup-catalog.mjs，不加入默认测试或 CI。 */
import { readFileSync, writeFileSync } from "node:fs";
import { STARTUP_CATALOG } from "../../packages/octo-runtime-executor-kernel/src/startup-catalog.ts";
const meanings = {
  LOG_DIRECTORY_MUST_BE_ABSOLUTE: "logging.directory 必须是绝对路径",
  LOG_STATUS_OUTPUT_INVALID: "logging.statusOutput 回调无效",
  ERR_MODULE_NOT_FOUND: "所选模块或其依赖未找到",
  MODULE_NOT_FOUND: "所选模块或其依赖未找到",
  EXTRA_MODULE_REQUIRED: "缺少 Extra 模块选择",
  EXTRA_CONFIG_OBJECT_REQUIRED: "Extra config 必须是对象",
  EXTRA_CONFIG_JSON_REQUIRED: "Extra config 含非 JSON 值",
  EXTRA_CONFIG_PERMISSIONS_INVALID: "Extra 配置文件未通过文件/访问检查",
  EISDIR: "所需文件实际是目录",
  IM_CONTEXT_LOADING_CONFIG_INVALID: "Extra 的 context_loading 配置无效",
  STARTUP_UNKNOWN: "启动根因未知",
  SERVICE_INITIALIZATION_FAILED: "组件初始化失败",
  KERNEL_START_CLEANUP_INCOMPLETE: "Kernel 启动回滚未完成",
  KERNEL_CLEANUP_INCOMPLETE: "Kernel 资源尚未全部释放",
  HOME_UNAVAILABLE: "Runtime Home 不可用",
  HOME_INVALID: "Home 必须是有效绝对目录",
  HOME_UNSUPPORTED: "不支持此 Home 路径或平台",
  HOME_NOT_FOUND: "所需 Home 资源不存在",
  HOME_NOT_DIRECTORY: "所需目录的资源类型错误",
  HOME_PERMISSION_DENIED: "Home 资源访问被拒绝",
  HOME_PATH_TOO_LONG: "Runtime 资源超过路径限制",
  HOME_LIMIT_UNAVAILABLE: "无法确定文件系统路径限制",
  HOME_UNUSABLE: "无法使用 Home 资源",
  IPC_ENDPOINT_INVALID: "IPC 地址无效",
  IPC_ENDPOINT_UNSUPPORTED: "不支持此 IPC 平台",
  IPC_ENDPOINT_TOO_LONG: "IPC 地址超过传输限制",
  ENDPOINT_IN_USE: "IPC 端点已被拥有",
  EADDRINUSE: "IPC 地址已被占用",
  ENDPOINT_PATH_INVALID: "端点位置存在其他资源类型",
  ENDPOINT_OWNER_INVALID: "端点所有权记录无效",
  ENDPOINT_UNVERIFIABLE: "无法确认端点所有权",
  ENDPOINT_RECOVERY_IN_PROGRESS: "端点恢复正在进行",
  ENOENT: "所需启动资源未找到；spawn 还需核对 cwd",
  ENOTDIR: "所需目录的资源类型错误",
  EACCES: "启动操作访问被拒绝",
  EPERM: "操作系统拒绝启动操作",
  EROFS: "启动操作需要可写文件系统",
  ENAMETOOLONG: "资源名称超过系统限制",
  ECONNREFUSED: "组件尚未接受 IPC 连接",
  SETUP_IN_PROGRESS: "组件生命周期操作正在进行",
  SERVICE_INITIALIZATION_CANCELLED: "组件初始化已取消",
  KERNEL_CONFIGURATION_INVALID: "Kernel 构造输入无效",
  EXTRA_CONFIGURATION_INVALID: "Extra 构造输入无效",
  MANIFEST_INVALID: "CLI 模块清单无效",
  EXTRA_NOT_REGISTERED: "Extra 缺少已保存的 CLI 声明",
  EXTRA_MODULE_LOAD_FAILED: "无法载入所选 Extra 模块",
  EXTRA_INITIALIZER_REQUIRED: "Extra 未返回初始化函数",
  EXTRA_NAME_MISMATCH: "Extra 模块名与声明不一致",
  EXTRA_ALREADY_LOADED: "Extra 已有活跃所有者",
  EXTRA_DISPOSE_FAILED: "前一 Extra 仍有未确认资源",
  LOCAL_STATE_INVALID: "无法读取本地状态",
  WRITE_FAILED: "本地状态写入失败",
  COMPONENT_UNAVAILABLE: "组件未就绪",
  SERVICE_PROCESS_EXITED: "服务进程意外退出",
  SERVICE_NOT_INSTALLED: "组件服务未安装",
  NOT_INSTALLED: "组件服务未安装",
  SERVICE_DISABLED: "组件服务已禁用",
  MANAGER_UNAVAILABLE: "原生服务管理器不可用",
  ORPHAN_CLEANUP_INCOMPLETE: "前一 Kernel 资源清理未完成",
  ORPHAN_RECORD_UNSUPPORTED: "不支持已保存的 Kernel 所有权格式"
};
const example = `\`\`\`ts
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
\`\`\``;
const en = `# Startup diagnostics

[简体中文](../../zh-CN/guides/startup-diagnostics.md) | [Documentation](../README.md)

Startup diagnostics describe a component's failed construction or initialization, before any Run, Session, Task or IPC endpoint needs to exist. They do not create a failed agent Run. After startup, execution failures remain in the execution domain.

Import \`describeStartupError\`, \`formatStartupDiagnostic\`, \`STARTUP_CATALOG\` and the \`StartupDiagnostic\` type from either \`@mininglamp-oss/octo-runtime/host\` or \`/executor-kernel\`. \`ServiceInitializationError.diagnostic\` directly contains the same projection; the original \`cause\` and \`cleanup\` remain available locally. Catch construction as well as \`initialize()\`.

${example}

## Public shape and compatibility

\`domain: "startup"\`, \`code\` (outer public code), \`rootCode\` (known primary cause, otherwise \`STARTUP_UNKNOWN\`), \`component\`, \`phase\` (the existing \`ServicePhase\`), \`summary\`, \`explanation\`, \`actions\`, \`retryable\`, \`userActionRequired\`, \`context\`, \`causes\`, optional \`cleanup\`, and \`truncated\` form the public shape. No Run identifier is required. \`retryable\` indicates that waiting/retrying may help, not permission for an automatic retry; inspect cleanup and ownership first.

Typed context contains only observed facts: \`path\`, \`resource\`, \`operation\`, \`configKey\`, \`endpoint\`, \`executable\`, \`module\`, \`systemCode\`, \`measured\`, \`limit\`, \`unit\`. A known affected path appears in both text and JSON. A system errno alone does not prove which dependency is missing: spawn ENOENT can also mean the selected working directory is missing. Unknown causes require inspection rather than a guessed fix.

Existing error classes, messages, public codes, cause chains, cleanup outcomes and CLI exit-code selection remain compatible. CLI JSON keeps \`error.code\`, \`message\`, optional \`cause_code\` and manager metadata, and adds \`error.diagnostic\`; use \`diagnostic.rootCode\` for deep cause branching. Text prints that same diagnosis and recovery actions. Startup errors escaping the normal CLI handler use the same safe projection. There is no migration of Run/status schemas or lifecycle phases.

\`HOME_UNAVAILABLE\` remains documented for older consumers. The #306 Home contract retires implicit SDK location selection; it is not a requirement to set LOCALAPPDATA. SDK hosts supply an existing valid absolute Home; the CLI owns preparation of its selected Home (default \`~/.octo-runtime\`, explicit \`--home\` takes precedence). Existing data is not moved automatically. This change integrates merged #306 (#310) and #303 (#311). POSIX Kernel uses the direct Home socket endpoint; there is no legacy endpoint migration or dual-owner detection layer.

The existing #306 flat path fields remain readable on RuntimeHomeError.diagnostic; canonical JSON uses context.path/resource/operation and actions. CLI error.startup and optional error.cleanup remain available as compatibility projections of the shared contract. New consumers should use error.diagnostic. Two narrow mappings correct resource ownership: plugin-origin filesystem errors retain their actual errno rather than HOME_*; invalid Kernel logging options now fail with LOG_DIRECTORY_MUST_BE_ABSOLUTE or LOG_STATUS_OUTPUT_INVALID before Home path-budget validation (previously a relative logging directory could appear as HOME_INVALID). The outer SERVICE_INITIALIZATION_FAILED and CLI exit selection are unchanged.

## Readiness and safe diagnosis

Process liveness, service phase, Kernel \`execution_ready\` and an Extra's business connectivity are separate facts. A ready Extra can report Kernel unavailable or business disconnected; diagnostics do not change that behavior. Provider probe results do not establish login/model availability. No cloud account, LLM or network request is introduced for local diagnostic formatting.

Cause traversal is bounded to 16 objects and six nested levels and supports aggregate/cyclic errors. Primary failure precedes cleanup causes; pending resources remain visible. Raw messages/stacks, environment, config, stderr, credentials and arbitrary properties are excluded. Dynamic values use the same deterministic sanitizer for text and JSON (control characters, URL credentials/query/fragment and recognizable credential assignments are removed). For untrusted serialized data use \`restoreStartupDiagnostic\` before rendering; explanations/actions are rebuilt from the catalog, not accepted from the record.

The CLI writes one bounded safe recent-failure record per component under \`<home>/logs/startup-<component>.json\`, alongside the existing controlled lifecycle logs. Background start/restart reads only a matching component and current-attempt timestamp, then rebuilds the whitelist; legacy code-only logs remain supported. A failed diagnostic write cannot replace the original startup error. Home/IPC path validation failures are returned directly and do not create logs or a replacement Home. The record does not perform recovery and contains no raw exception or business configuration.

Nested causes retain their observed component/phase and cleanup facts. A complete outer cleanup does not erase an incomplete inner cleanup.

## Catalog

The English summary and recovery column below mirror the shared \`STARTUP_CATALOG\`. Per-attempt context specializes the explanation/action for a selected executable, directory or configuration key. Missing paths, wrong resource types, access denial and length limits retain distinct codes. A code not in the catalog retains its stable identifier, reports an unknown meaning and requests controlled inspection.

| Code | Meaning | Supported recovery | Retry may help |
| --- | --- | --- | --- |
${Object.entries(STARTUP_CATALOG)
  .map(
    ([code, value]) =>
      `| \`${code}\` | ${value.summary} | ${value.action} | ${value.retryable ? "yes" : "user action"} |`
  )
  .join("\n")}

The catalog does not prescribe a new public code for every failure or turn business connectivity errors into component startup errors. In particular, removed execution workers are not restored.
`;
const zh = `# 启动诊断

[English](../../en/guides/startup-diagnostics.md) | [文档目录](../README.md)

启动诊断描述组件构造或初始化的失败；即使没有 Run、Session、Task 或 IPC 端点，失败调用也能直接返回诊断。启动后的业务执行错误仍沿原执行域处理，不创建 synthetic failed Run。

从 \`@mininglamp-oss/octo-runtime/host\` 或 \`/executor-kernel\` 导入 \`describeStartupError\`、\`formatStartupDiagnostic\`、\`STARTUP_CATALOG\`、\`StartupDiagnostic\`。\`ServiceInitializationError.diagnostic\` 直接提供相同结构；原始 \`cause\` 与 \`cleanup\` 仍供宿主本地排查。构造和 \`initialize()\` 都应在捕获边界内。

${example}

## 公共字段与兼容

公共结构包括 \`domain: "startup"\`、外层公共码 \`code\`、主根因码 \`rootCode\`（未知时为 \`STARTUP_UNKNOWN\`）、\`component\`、既有 \`ServicePhase\` 的 \`phase\`、\`summary\`、\`explanation\`、\`actions\`、\`retryable\`、\`userActionRequired\`、\`context\`、\`causes\`、可选 \`cleanup\` 和 \`truncated\`。不要求 Run 标识。\`retryable\` 表示等待或重试可能有帮助，不自动授权重试；先检查清理与所有权。

typed context 只包含已观测事实：\`path\`、\`resource\`、\`operation\`、\`configKey\`、\`endpoint\`、\`executable\`、\`module\`、\`systemCode\`、\`measured\`、\`limit\`、\`unit\`。已知失败路径同时进入文本和 JSON；权限拒绝不解释为不存在。spawn ENOENT 也可能来自 cwd 不存在，因此需要核对所选 executable 和工作目录，不能凭 errno 断言缺少程序。

保留原错误类、message、公共码、cause、cleanup 和 CLI 退出码选择。CLI JSON 保留 \`error.code\`、\`message\`、可选 \`cause_code\` 与管理器元信息，新增 \`error.diagnostic\`；深层根因使用 \`diagnostic.rootCode\` 分支。文本显示同一诊断及恢复动作。逃出常规 CLI handler 的启动错误也采用相同安全投影。不迁移 Run/status schema，不增加生命周期状态机。

\`HOME_UNAVAILABLE\` 继续为旧消费方保留目录说明。#306 退役 SDK 隐式 Home 选择，不能要求 SDK 用户补 LOCALAPPDATA。SDK 宿主显式提供已经存在的有效绝对 Home；CLI 准备自己选择的根目录，默认 \`~/.octo-runtime\`，显式 \`--home\` 优先。已有数据不自动移动。已整合 #306（#310）与 #303（#311）；POSIX Kernel 使用 Home 下直接 socket，没有旧端点迁移或双所有者检测层。

#306 的 RuntimeHomeError.diagnostic 平铺路径属性继续支持读取；标准 JSON 使用 context.path/resource/operation 和 actions。CLI error.startup 与可选 error.cleanup 继续从共享结构生成，新调用方使用 error.diagnostic。两项窄映射纠正资源归属：插件自身的文件错误保留实际 errno，不再误归 HOME_*；Kernel 日志选项先做纯配置校验，返回 LOG_DIRECTORY_MUST_BE_ABSOLUTE 或 LOG_STATUS_OUTPUT_INVALID（此前相对日志目录可能呈现 HOME_INVALID）。外层 SERVICE_INITIALIZATION_FAILED 与 CLI 退出码选择保持不变。

## 就绪与安全排障

进程存活、服务 phase、Kernel \`execution_ready\`、Extra 自身业务连通性分别描述。Extra 可以 ready，同时报告 Kernel 不可用或业务未连通；诊断不改变这种行为。Provider probe 通过不证明登录或模型可用。本地诊断不增加云端登录、LLM 或网络前置条件。

cause 遍历最多 16 个对象、六层，支持聚合与循环；主失败优先，清理错误和 pending 资源继续保留。禁止投影原始异常正文/stack、全量环境、配置、stderr、凭据或任意属性。动态值经同一确定性安全格式化进入文本和 JSON，去除控制字符、URL 认证/query/fragment 及可识别敏感赋值。对不可信序列化结构先调用 \`restoreStartupDiagnostic\`，文案/建议从共享 catalog 重建，不信任记录里的解释。

CLI 在 \`<home>/logs/startup-<component>.json\` 保存每组件一份有界安全最近失败，与既有生命周期日志并存。后台 start/restart 只回读当前尝试时间内匹配组件的记录，再重建白名单；兼容旧版仅含码的日志。诊断写盘失败不能覆盖原始启动错误。Home/IPC 路径验证失败直接返回，不创建日志或替代 Home。记录不执行恢复，不包含原始异常或业务配置。

嵌套 cause 保留已观测的组件/阶段与清理事实；外层 cleanup complete 不能抹去内层 incomplete。

## 诊断目录

以下表格的 English-first 恢复说明直接来自共享 \`STARTUP_CATALOG\`，中文含义与其对齐。实际尝试按 executable、目录或 configKey 填入确定性动态信息。缺失、错误类型、权限、长度限制各自保留不同码；未知码保留标识，明确含义未知并要求下一步受控排查。

| Code | 含义 | 支持的恢复动作（共享 English-first 文案） | 重试判断 |
| --- | --- | --- | --- |
${Object.entries(STARTUP_CATALOG)
  .map(([code, value]) => {
    if (!meanings[code]) throw new Error(`Missing translation: ${code}`);
    return `| \`${code}\` | ${meanings[code]} | ${value.action} | ${value.retryable ? "等待/重试可能有用" : "先由用户处理"} |`;
  })
  .join("\n")}

目录不为每个失败强制发明新公共码，也不把业务连通性错误改成组件启动错误。已删除的执行 worker 不恢复。
`;
for (const [language, text] of [
  ["en", en],
  ["zh-CN", zh]
]) {
  writeFileSync(
    new URL(`../../docs/${language}/guides/startup-diagnostics.md`, import.meta.url),
    text
      .replaceAll("`executable`、`systemCode`", "`executable`、`module`、`systemCode`")
      .replaceAll("`executable`, `systemCode`", "`executable`, `module`, `systemCode`")
  );
  const sdk = new URL(`../../docs/${language}/getting-started/sdk.md`, import.meta.url);
  const content = readFileSync(sdk, "utf8");
  if (!content.includes("../guides/startup-diagnostics.md"))
    writeFileSync(
      sdk,
      content +
        (language === "en"
          ? "\n## Startup failures\n\nSee the [startup diagnostic contract and catalog](../guides/startup-diagnostics.md) for stable code branching, safe resource context, cleanup and CLI JSON compatibility.\n"
          : "\n## 启动失败\n\n稳定码分支、安全资源 context、清理事实及 CLI JSON 兼容方式见[启动诊断合同与目录](../guides/startup-diagnostics.md)。\n")
    );
}
