import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  opendirSync,
  openSync,
  statSync,
  unlinkSync
} from "node:fs";
import { posix, win32 } from "node:path";

export interface StartupPathDiagnostic {
  domain: "startup";
  code: string;
  path?: string;
  resource: string;
  operation: string;
  action: string;
  systemCode?: string;
  endpoint?: string;
  measured?: number;
  limit?: number;
  unit?: "utf8-bytes" | "utf16-units";
}

/** 启动域的受控路径失败；只公开必要路径/errno，不复制原始配置或异常正文。 */
export class RuntimeHomeError extends Error {
  readonly code: string;
  readonly diagnostic: Readonly<StartupPathDiagnostic>;
  constructor(diagnostic: Omit<StartupPathDiagnostic, "domain">, cause?: unknown) {
    super(diagnostic.code, { cause });
    this.name = "RuntimeHomeError";
    this.code = diagnostic.code;
    // 明确投影字段，避免 JS 调用方附带的配置等额外属性进入公开启动诊断。
    this.diagnostic = Object.freeze({
      domain: "startup",
      code: diagnostic.code,
      resource: diagnostic.resource,
      operation: diagnostic.operation,
      action: diagnostic.action,
      ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
      ...(diagnostic.systemCode !== undefined ? { systemCode: diagnostic.systemCode } : {}),
      ...(diagnostic.endpoint !== undefined ? { endpoint: diagnostic.endpoint } : {}),
      ...(diagnostic.measured !== undefined ? { measured: diagnostic.measured } : {}),
      ...(diagnostic.limit !== undefined ? { limit: diagnostic.limit } : {}),
      ...(diagnostic.unit !== undefined ? { unit: diagnostic.unit } : {})
    });
  }
}

const action =
  "The host must select and prepare an existing, accessible absolute Runtime Home, then retry with that directory. No replacement Home is selected.";
const lengthAction =
  "The host must choose a directory/address within the reported filesystem and IPC limits, prepare it, and retry. Existing data is not moved automatically.";

/** 先检查原始输入，再规范化；这是纯路径计算，不代表目录已存在或启动已验证。 */
export function normalizeRuntimeHome(
  input: string,
  platform: NodeJS.Platform = process.platform,
  resource = "home"
): string {
  const fail = (code: string): never => {
    throw new RuntimeHomeError({
      code,
      ...(typeof input === "string" ? { path: input } : {}),
      resource,
      operation: "validate-input",
      action
    });
  };
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(input)
  )
    fail("HOME_INVALID");
  if (!["win32", "darwin", "linux"].includes(platform)) fail("HOME_UNSUPPORTED");
  const api = platform === "win32" ? win32 : posix;
  if (!api.isAbsolute(input)) fail("HOME_INVALID");
  if (platform === "win32") {
    // 仅支持本地盘绝对路径。拒绝 UNC/device/root-relative/ADS 和 Win32 别名，避免 hash 与 IO 指向不同资源。
    const local = input.replaceAll("/", "\\");
    if (
      !/^[a-z]:\\/i.test(local) ||
      /[<>"|?*]/.test(local) ||
      [...local].some((character) => character.codePointAt(0)! < 32) ||
      local.slice(2).includes(":")
    )
      fail("HOME_UNSUPPORTED");
    for (const part of local.slice(3).split("\\")) {
      if (part === "." || part === "..") continue;
      if (/[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
        fail("HOME_UNSUPPORTED");
    }
  }
  const home = api.resolve(input);
  if (home === api.parse(home).root) fail("HOME_UNSUPPORTED");
  return home;
}

interface PathLimits {
  path: number;
  name: number;
}
// Unix 的纯计算上限来自对应 OS 的 PATH_MAX/NAME_MAX；真实启动再查询所选文件系统。
// Windows Node/libuv 使用扩展 UTF-16 路径：32767 包括 NUL 和自动追加的 \\?\ 前缀，不使用 MAX_PATH=260。
function platformLimits(platform: NodeJS.Platform): PathLimits {
  if (platform === "win32") return { path: 32767 - 1 - 4, name: 255 };
  if (platform === "linux") return { path: 4096 - 1, name: 255 };
  if (platform === "darwin") return { path: 1024 - 1, name: 255 };
  throw new RuntimeHomeError({
    code: "HOME_UNSUPPORTED",
    resource: "home",
    operation: "path-budget",
    action
  });
}

/** 检查实际附加文件名的预算；Windows 按 UTF-16 code unit，POSIX 按 UTF-8 字节。 */
export function assertRuntimePath(
  path: string,
  resource: string,
  platform: NodeJS.Platform = process.platform,
  limits = platformLimits(platform)
): void {
  const unit = platform === "win32" ? "utf16-units" : "utf8-bytes";
  const measure = (value: string) =>
    Buffer.byteLength(value, platform === "win32" ? "utf16le" : "utf8") /
    (platform === "win32" ? 2 : 1);
  const fail = (measured: number, limit: number, operation: string) => {
    throw new RuntimeHomeError({
      code: "HOME_PATH_TOO_LONG",
      path,
      resource,
      operation,
      action: lengthAction,
      measured,
      limit,
      unit
    });
  };
  if (measure(path) > limits.path) fail(measure(path), limits.path, "path-budget");
  const api = platform === "win32" ? win32 : posix;
  for (const part of path.slice(api.parse(path).root.length).split(api.sep)) {
    if (measure(part) > limits.name) fail(measure(part), limits.name, "filename-budget");
  }
}

/** endpoint-only API 只拥有传输，不推断或创建 Home；同样在连接/监听前拒绝无效或超长地址。 */
export function assertIpcEndpoint(
  endpoint: string,
  platform: NodeJS.Platform = process.platform
): void {
  const fail = (code: string, extra: Partial<StartupPathDiagnostic> = {}): never => {
    throw new RuntimeHomeError({
      code,
      ...(typeof endpoint === "string" ? { path: endpoint, endpoint } : {}),
      resource: "ipc-endpoint",
      operation: "ipc-address",
      action: lengthAction,
      ...extra
    });
  };
  if (
    typeof endpoint !== "string" ||
    !endpoint ||
    endpoint.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(endpoint)
  )
    fail("IPC_ENDPOINT_INVALID");
  if (platform === "win32") {
    if (!/^\\\\[.?]\\pipe\\[^\\]+$/i.test(endpoint)) fail("IPC_ENDPOINT_INVALID");
    const measured = Buffer.byteLength(endpoint, "utf16le") / 2;
    // CreateNamedPipeW: 完整 pipe 名最多 256 WCHAR；namespace 不是文件路径，不套用 Unix sun_path。
    if (measured > 256)
      fail("IPC_ENDPOINT_TOO_LONG", { measured, limit: 256, unit: "utf16-units" });
  } else {
    if (!posix.isAbsolute(endpoint)) fail("IPC_ENDPOINT_INVALID");
    // Node net + libuv 的 pathname socket 必须留出结尾 NUL：Linux 108、Darwin 104 字节 sun_path。
    const limit = platform === "linux" ? 107 : platform === "darwin" ? 103 : undefined;
    if (limit === undefined) fail("IPC_ENDPOINT_UNSUPPORTED");
    const measured = Buffer.byteLength(endpoint, "utf8");
    if (measured > limit!) fail("IPC_ENDPOINT_TOO_LONG", { measured, limit, unit: "utf8-bytes" });
    assertRuntimePath(endpoint, "ipc-endpoint", platform);
    assertRuntimePath(`${endpoint}.owner.recovery`, "endpoint-ownership", platform);
  }
}

export interface RuntimePath {
  path: string;
  resource: string;
  /** 可选日志只校验名称预算，IO 可用性由既有 best-effort 日志层处理。 */
  optional?: boolean;
}

/**
 * 宿主先准备根目录；SDK 在资源启动前只验证，不 mkdir 根或选择替代目录。
 * access 后用独占短探针确认真实读写权限（Windows access 不能完整判断 ACL），不改变身份/配置。
 * 这是同账号信任边界内的启动检查，不承诺对同账号并发替换目录提供文件系统沙箱。
 */
export function validateRuntimeHome(input: string, paths: readonly RuntimePath[] = []): string {
  const home = normalizeRuntimeHome(input);
  let operation = "stat";
  let affected = home;
  let resource = "home";
  try {
    assertRuntimePath(home, "home");
    if (!statSync(home).isDirectory())
      throw new RuntimeHomeError({
        code: "HOME_NOT_DIRECTORY",
        path: home,
        resource: "home",
        operation,
        action
      });
    operation = "filesystem-limits";
    const cache = new Map<string, PathLimits>();
    const filesystemLimits = (path: string): PathLimits => {
      if (process.platform === "win32") return platformLimits(process.platform);
      // 日志/状态可由高级宿主选择在另一文件系统；不能把 Home 所在卷的预算套给它。
      let directory = path;
      for (;;) {
        try {
          if (statSync(directory).isDirectory()) break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // 子路径缺失/被普通文件阻断时仍可查询最近目录；其他 IO 失败由调用方按资源必要性处理。
          if (!["ENOENT", "ENOTDIR"].includes(code ?? "")) throw error;
        }
        const parent = posix.dirname(directory);
        if (parent === directory) throw new Error("PATH_LIMIT_UNAVAILABLE");
        directory = parent;
      }
      const cached = cache.get(directory);
      if (cached) return cached;
      const query = (name: string) => {
        operation = "getconf";
        const value = Number(
          // 使用 OS 工具的固定位置；宿主可能为 Provider 注入受限 PATH，不能据此选择查询程序。
          execFileSync("/usr/bin/getconf", [name, directory], {
            encoding: "utf8",
            timeout: 1000,
            stdio: ["ignore", "pipe", "ignore"]
          }).trim()
        );
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("PATH_LIMIT_UNAVAILABLE");
        return value;
      };
      const limits = { path: query("PATH_MAX") - 1, name: query("NAME_MAX") };
      cache.set(directory, limits);
      return limits;
    };
    const limits = filesystemLimits(home);
    for (const entry of [{ path: home, resource: "home", optional: false }, ...paths]) {
      affected = entry.path;
      resource = entry.resource;
      normalizeRuntimeHome(entry.path, process.platform, entry.resource);
      assertRuntimePath(entry.path, entry.resource);
      operation = "filesystem-limits";
      let observed: PathLimits | undefined;
      try {
        observed = filesystemLimits(entry.path);
      } catch (error) {
        // 可选日志的 stat/getconf 失败（循环链接、坏盘等）仍归日志层 best-effort 隔离，不能枚举少数 errno。
        // 前面的输入/静态长度检查不在此隔离范围；Home 和状态等必需资源仍传播原始 IO 失败。
        if (!entry.optional) throw error;
      }
      if (observed) assertRuntimePath(entry.path, entry.resource, process.platform, observed);
    }
    affected = home;
    resource = "home";
    operation = "access";
    accessSync(home, constants.R_OK | constants.W_OK | constants.X_OK);
    operation = "read-directory";
    opendirSync(home).closeSync();
    operation = "write-probe";
    const probe = (process.platform === "win32" ? win32 : posix).join(
      home,
      `.octo-home-${randomUUID()}`
    );
    assertRuntimePath(probe, "home-probe", process.platform, limits);
    affected = probe;
    const fd = openSync(probe, "wx", 0o600);
    try {
      closeSync(fd);
    } finally {
      unlinkSync(probe);
    }
    return home;
  } catch (error) {
    if (error instanceof RuntimeHomeError) throw error;
    throw runtimePathFailure(error, affected, resource, operation);
  }
}

/** 只创建已验证 Home 内的子目录，逐级 mkdir；根消失时失败，绝不递归补建根。 */
export function prepareHomeDirectory(home: string, directory: string): void {
  const api = process.platform === "win32" ? win32 : posix;
  const child = api.relative(home, directory);
  if (!child || child.startsWith(`..${api.sep}`) || child === ".." || api.isAbsolute(child)) return;
  let current = home;
  for (const part of child.split(api.sep)) {
    current = api.join(current, part);
    try {
      mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && statSync(current).isDirectory())
        continue;
      throw runtimePathFailure(error, current, "runtime-directory", "mkdir");
    }
  }
}

/** 将实际系统 IO 失败投影为启动诊断，保留必要 errno 但不公开系统错误正文。 */
export function runtimePathFailure(
  error: unknown,
  path: string,
  resource: string,
  operation: string
): RuntimeHomeError {
  const raw =
    error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
  const systemCode = typeof raw === "string" && /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : undefined;
  const code =
    operation === "getconf"
      ? "HOME_LIMIT_UNAVAILABLE"
      : systemCode === "ENOENT"
        ? "HOME_NOT_FOUND"
        : systemCode === "ENOTDIR"
          ? "HOME_NOT_DIRECTORY"
          : ["EACCES", "EPERM", "EROFS"].includes(systemCode ?? "")
            ? "HOME_PERMISSION_DENIED"
            : systemCode === "ENAMETOOLONG"
              ? "HOME_PATH_TOO_LONG"
              : operation === "filesystem-limits"
                ? "HOME_LIMIT_UNAVAILABLE"
                : "HOME_UNUSABLE";
  return new RuntimeHomeError(
    {
      code,
      path,
      resource,
      operation,
      action:
        code === "HOME_PATH_TOO_LONG"
          ? lengthAction
          : code === "HOME_LIMIT_UNAVAILABLE"
            ? "Make the operating system /usr/bin/getconf utility available to query PATH_MAX/NAME_MAX, then retry with the same prepared directory."
            : action,
      ...(systemCode ? { systemCode } : {})
    },
    error
  );
}

/** 所有启动资源先列出完整最终文件名，覆盖原子写、恢复归档与轮转锁的额外后缀。 */
export function kernelStartupPaths(
  endpoint: string,
  stateDirectory?: string,
  logDirectory?: string
): RuntimePath[] {
  const paths: RuntimePath[] = [];
  if (process.platform !== "win32")
    paths.push({ path: `${endpoint}.owner.recovery`, resource: "endpoint-ownership" });
  const statePath = stateDirectory
    ? (process.platform === "win32" ? win32 : posix).join(stateDirectory, "kernel-invocations.json")
    : process.platform !== "win32"
      ? `${endpoint}.runs`
      : undefined;
  if (statePath)
    paths.push({
      path: `${statePath}.acknowledged.${"0".repeat(36)}.json`,
      resource: "kernel-state"
    });
  if (logDirectory)
    paths.push({
      path: (process.platform === "win32" ? win32 : posix).join(
        logDirectory,
        "kernel-status-20000101T00.log.lock"
      ),
      resource: "kernel-log",
      optional: true
    });
  return paths;
}
