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

import {
  RuntimeHomeError,
  normalizeRuntimeHome,
  assertRuntimePath,
  platformLimits,
  type PathLimits
} from "@mininglamp-oss/octo-runtime-client/internal";
export {
  RuntimeHomeError,
  normalizeRuntimeHome,
  assertRuntimePath,
  assertIpcEndpoint,
  type StartupPathDiagnostic
} from "@mininglamp-oss/octo-runtime-client/internal";

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
        operation
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
