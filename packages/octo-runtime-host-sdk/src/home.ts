import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  normalizeRuntimeHome,
  validateRuntimeHome,
  assertRuntimePath,
  prepareHomeDirectory
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import { HostRuntimeError } from "./errors.js";
import { componentEndpoint } from "./endpoint.js";

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MACHINE_PATTERN = /^machine_[0-9a-f-]{36}$/;

export interface MachineIdentity {
  schema_version: 1;
  machine_id: string;
}

export interface HostHomePaths {
  home: string;
  machineFile: string;
  run: string;
  socket: string;
  pidFile: string;
}

export interface HostAccountPaths {
  home: string;
  accountKey: string;
  root: string;
  configFile: string;
  logs: string;
}

export interface HostProfilePaths {
  home: string;
  name: string;
  root: string;
  configFile: string;
  identityFile: string;
  credentialFile: string;
}

/** 宿主先准备根；返回经过实际存在/权限与当前 endpoint 预算校验的 Home 路径，不创建身份。 */
export function hostHomePaths(homeInput: string): HostHomePaths {
  const home = normalizeRuntimeHome(homeInput);
  const run = join(home, "run");
  const socket = componentEndpoint(home, "executor-kernel");
  validateRuntimeHome(home, [
    { path: join(home, "octo-runtime-executor-kernel.pid"), resource: "kernel-pid" },
    {
      path: join(home, `.machine.json.${"0".repeat(10)}.${"0".repeat(36)}.tmp`),
      resource: "machine-identity"
    }
  ]);
  return {
    home,
    machineFile: join(home, "machine.json"),
    run,
    socket,
    pidFile: join(home, "octo-runtime-executor-kernel.pid")
  };
}

export function accountKeyFor(subjectType: string, subjectId: string): string {
  if (subjectType !== "user" || !subjectId.trim()) {
    throw new HostRuntimeError(
      "SUBJECT_INVALID",
      "home",
      false,
      "a stable user subject is required"
    );
  }
  return base32Hash(`${subjectType}\0${subjectId.trim()}`, 20);
}

export function profileNameFor(appId: string, tenantId: string): string {
  if (!tenantId.trim())
    throw new HostRuntimeError("TENANT_INVALID", "home", false, "tenant id is required");
  const name = `${appSlug(appId)}-${base32Hash(tenantId.trim(), 20)}`;
  if (!PROFILE_PATTERN.test(name)) {
    throw new HostRuntimeError(
      "PROFILE_INVALID",
      "home",
      false,
      `generated profile is invalid: ${name}`
    );
  }
  return name;
}

export function accountPaths(paths: HostHomePaths, accountKey: string): HostAccountPaths {
  const root = join(paths.home, "accounts", accountKey);
  return {
    home: paths.home,
    accountKey,
    root,
    configFile: join(root, "config.json"),
    logs: join(root, "logs")
  };
}

export function profilePaths(account: HostAccountPaths, name: string): HostProfilePaths {
  if (!PROFILE_PATTERN.test(name))
    throw new HostRuntimeError("PROFILE_INVALID", "home", false, `invalid profile: ${name}`);
  const root = join(account.root, name);
  assertRuntimePath(
    join(root, "credentials", `.runtime-token.json.${"0".repeat(10)}.${"0".repeat(36)}.tmp`),
    "profile-credential"
  );
  return {
    home: account.home,
    name,
    root,
    configFile: join(root, "config.json"),
    identityFile: join(root, "identity", "runtime.json"),
    credentialFile: join(root, "credentials", "runtime-token.json")
  };
}

/** 仅在宿主已存在的 Home 中创建 Runtime 子目录/身份；根不可用时失败，不自动修复根。 */
export function ensureHostHome(paths: HostHomePaths): MachineIdentity {
  validateRuntimeHome(paths.home, [
    { path: paths.machineFile, resource: "machine-identity" },
    { path: paths.run, resource: "runtime-state" }
  ]);
  for (const directory of [paths.run, join(paths.home, "accounts")])
    prepareHomeDirectory(paths.home, directory);
  if (process.platform !== "win32") prepareHomeDirectory(paths.home, dirname(paths.socket));
  if (existsSync(paths.machineFile)) {
    const machine = readJson<MachineIdentity>(paths.machineFile);
    if (machine.schema_version !== 1 || !MACHINE_PATTERN.test(machine.machine_id)) {
      throw new HostRuntimeError(
        "MACHINE_INVALID",
        "home",
        false,
        `invalid machine identity: ${paths.machineFile}`
      );
    }
    return machine;
  }
  const machine: MachineIdentity = { schema_version: 1, machine_id: `machine_${randomUUID()}` };
  writeJsonAtomic(paths.machineFile, machine);
  return machine;
}

export function ensureAccount(account: HostAccountPaths, profiles: readonly string[]): void {
  validateRuntimeHome(account.home, [
    { path: account.configFile, resource: "account-configuration" }
  ]);
  if (profiles.length === 0)
    throw new HostRuntimeError(
      "TENANTS_EMPTY",
      "home",
      false,
      "at least one authorized tenant is required"
    );
  for (const profile of profiles) {
    const paths = profilePaths(account, profile);
    prepareHomeDirectory(account.home, dirname(paths.identityFile));
    prepareHomeDirectory(account.home, dirname(paths.credentialFile));
  }
  const existing = existsSync(account.configFile)
    ? readJson<Record<string, unknown>>(account.configFile)
    : {};
  const currentDefault =
    typeof existing.default_profile === "string" ? existing.default_profile : undefined;
  const defaultProfile =
    currentDefault && profiles.includes(currentDefault) ? currentDefault : [...profiles].sort()[0];
  writeJsonAtomic(account.configFile, {
    ...existing,
    schema_version: 1,
    default_profile: defaultProfile,
    channel: "stable"
  });
}

export function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new HostRuntimeError("LOCAL_STATE_INVALID", "home", false, `cannot read ${path}`, {
      cause: error
    });
  }
}

export function readJsonOptional<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return readJson<T>(path);
}

export function writeJsonAtomic(path: string, value: unknown, secret = false): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  assertRuntimePath(temporary, "runtime-state");
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(temporary, "wx", secret ? 0o600 : 0o644);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (secret && process.platform !== "win32") chmodSync(temporary, 0o600);
  renameWithRetry(temporary, path);
  if (secret && process.platform !== "win32") chmodSync(path, 0o600);
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
}

function appSlug(appId: string): string {
  const normalized = appId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  // 保持原有 slug/身份映射，只以线性扫描移除首尾连字符。
  let start = 0,
    end = normalized.length;
  while (start < end && normalized[start] === "-") start++;
  while (end > start && normalized[end - 1] === "-") end--;
  const slug = normalized.slice(start, end).slice(0, 48);
  if (!slug || !/^[a-z0-9]/.test(slug)) {
    throw new HostRuntimeError(
      "APP_ID_INVALID",
      "home",
      false,
      "appId must contain an ASCII letter or digit"
    );
  }
  return slug;
}

function base32Hash(value: string, length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = createHash("sha256").update(value).digest();
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && encoded.length < length) {
      encoded += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (encoded.length === length) break;
  }
  return encoded;
}

function renameWithRetry(source: string, target: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isNodeError(error, "EPERM") && !isNodeError(error, "EBUSY")) break;
      const until = Date.now() + 25 * (attempt + 1);
      while (Date.now() < until) {
        // Bounded synchronous retry keeps initialization atomic without a second async API.
      }
    }
  }
  rmSync(source, { force: true });
  throw new HostRuntimeError("WRITE_FAILED", "home", true, `cannot atomically replace ${target}`, {
    cause: lastError
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}
