import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface WorkerIdentity {
  pid: number;
  started: string;
  entrypoint: string;
}

export interface InvocationManifestEntry {
  invocationId: string;
  runId: string;
  adapterType: string;
  startedAt: string;
}

/** Kernel 内部恢复记录；可选字段兼容扩展，读取时容忍未知字段，不是公共业务协议。 */
interface ManifestFile {
  schemaVersion: 1;
  kernelPid: number;
  updatedAt: string;
  worker?: WorkerIdentity;
  cleanupIncomplete?: true;
  invocations: InvocationManifestEntry[];
}

export interface OrphanReapResult {
  found: boolean;
  reaped: boolean;
  pid?: number;
  reason?:
    | "kernel_alive"
    | "host_missing"
    | "identity_mismatch"
    | "unsupported_identity"
    | "cleanup_incomplete"
    | "cleanup_acknowledged";
}

/**
 * 持久化 Kernel/worker 身份与在途执行事实，用于下次启动时识别遗留资源，不保存业务历史。
 * 写入串行化并通过 rename 替换；只有 owner 确认 worker 回收后才能 close 删除清单。
 */
export class InvocationManifest {
  readonly #path: string;
  readonly #invocations = new Map<string, InvocationManifestEntry>();
  #worker?: WorkerIdentity;
  #writes = Promise.resolve();

  private constructor(path: string) {
    this.#path = path;
  }

  static async open(
    path: string
  ): Promise<{ manifest: InvocationManifest; reap: OrphanReapResult }> {
    const reap = await reapOrphanedInvocationManifest(path);
    if (reap.reason === "cleanup_incomplete") {
      throw Object.assign(
        new Error(
          `Orphan cleanup is unconfirmed: ${path}. After stopping all orphan tools, use acknowledgeOrphanCleanup(path), then retry startup.`
        ),
        { code: "ORPHAN_CLEANUP_INCOMPLETE" }
      );
    }
    if (reap.reason === "kernel_alive" || reap.reason === "unsupported_identity") {
      throw new Error(`cannot replace live or unverifiable invocation manifest (${reap.reason})`);
    }
    const manifest = new InvocationManifest(path);
    await manifest.#persist();
    await removeAcknowledgement(path);
    return { manifest, reap };
  }

  async setWorker(pid: number | undefined, entrypoint: string): Promise<void> {
    if (pid === undefined) {
      this.#worker = undefined;
    } else {
      try {
        const started = await queryProcessStartIdentity(pid);
        if (!started) throw new Error("system process start identity unavailable");
        this.#worker = { pid, started, entrypoint };
      } catch (cause) {
        throw new Error(`cannot identify worker process ${pid}`, { cause });
      }
    }
    await this.#persist();
  }

  async begin(entry: Omit<InvocationManifestEntry, "startedAt">): Promise<void> {
    this.#invocations.set(entry.invocationId, { ...entry, startedAt: new Date().toISOString() });
    await this.#persist();
  }

  async end(invocationId: string): Promise<void> {
    if (!this.#invocations.delete(invocationId)) return;
    await this.#persist();
  }

  async close(): Promise<void> {
    await this.#writes;
    await rm(this.#path, { force: true });
    await removeAcknowledgement(this.#path);
  }

  #persist(): Promise<void> {
    const snapshot: ManifestFile = {
      schemaVersion: 1,
      kernelPid: process.pid,
      updatedAt: new Date().toISOString(),
      ...(this.#worker ? { worker: { ...this.#worker } } : {}),
      invocations: [...this.#invocations.values()].map((entry) => ({ ...entry }))
    };
    this.#writes = this.#writes.then(async () => {
      await writeManifest(this.#path, snapshot);
    });
    return this.#writes;
  }
}

/**
 * 仅在原 Kernel 已退出且 worker 的 PID/启动身份仍匹配时尝试回收，防止 PID 复用误杀。
 * 无法验证身份时保留清单并报告 unsupported_identity；worker 已消失不证明 Windows 后代已清空。
 */
export async function reapOrphanedInvocationManifest(path: string): Promise<OrphanReapResult> {
  let parsed: ManifestFile;
  let source: string;
  try {
    source = await readFile(path, "utf8");
    parsed = JSON.parse(source) as ManifestFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await removeAcknowledgement(path);
      return { found: false, reaped: false };
    }
    await rm(path, { force: true });
    await removeAcknowledgement(path);
    return { found: true, reaped: false, reason: "host_missing" };
  }
  if (
    Number.isSafeInteger(parsed.kernelPid) &&
    parsed.kernelPid > 0 &&
    processAlive(parsed.kernelPid)
  ) {
    return { found: true, reaped: false, reason: "kernel_alive" };
  }
  const host = parsed.worker;
  if (!host || !Number.isSafeInteger(host.pid) || host.pid < 1 || !processAlive(host.pid)) {
    if (parsed.cleanupIncomplete && process.platform === "win32") {
      return {
        found: true,
        reaped: false,
        pid: host?.pid,
        reason: (await cleanupWasAcknowledged(path, source))
          ? "cleanup_acknowledged"
          : "cleanup_incomplete"
      };
    }
    await rm(path, { force: true });
    await removeAcknowledgement(path);
    return { found: true, reaped: false, reason: "host_missing" };
  }
  const currentIdentity = await processStartIdentity(host.pid);
  if (!currentIdentity) {
    return { found: true, reaped: false, pid: host.pid, reason: "unsupported_identity" };
  }
  if (currentIdentity !== host.started) {
    if (parsed.cleanupIncomplete && process.platform === "win32") {
      return {
        found: true,
        reaped: false,
        pid: host.pid,
        reason: (await cleanupWasAcknowledged(path, source))
          ? "cleanup_acknowledged"
          : "cleanup_incomplete"
      };
    }
    await rm(path, { force: true });
    await removeAcknowledgement(path);
    return { found: true, reaped: false, pid: host.pid, reason: "identity_mismatch" };
  }
  // 必须在 leader 仍可识别时回收 Windows 树；失败保留证据，禁止覆盖清单并启动替代 worker。
  if (!(await terminateProcessGroup(host.pid)) && process.platform === "win32") {
    // 失败事实必须跨重启保留；leader 后来消失或 PID 复用不能抹去未确认的后代归属。
    await writeManifest(path, { ...parsed, cleanupIncomplete: true });
    return { found: true, reaped: false, pid: host.pid, reason: "cleanup_incomplete" };
  }
  await rm(path, { force: true });
  await removeAcknowledgement(path);
  return { found: true, reaped: true, pid: host.pid };
}

async function removeAcknowledgement(path: string): Promise<void> {
  try {
    await rm(`${path}.acknowledgement`, { force: true });
  } catch {
    // 旧确认已因清单删除或替换而失效；辅助文件清理失败不能阻止启动，原始归档始终保留。
  }
}

/** 只读恢复诊断，不回收进程、不改写清单；用于 doctor 及 SDK 运维界面。 */
export async function inspectOrphanCleanup(path: string): Promise<{
  manifestPath: string;
  state: "missing" | "available" | "cleanup_incomplete" | "acknowledged" | "unreadable";
  workerPid?: number;
}> {
  try {
    const source = await readFile(path, "utf8");
    const parsed = JSON.parse(source) as ManifestFile;
    return {
      manifestPath: path,
      state: parsed.cleanupIncomplete
        ? (await cleanupWasAcknowledged(path, source))
          ? "acknowledged"
          : "cleanup_incomplete"
        : "available",
      workerPid: parsed.worker?.pid
    };
  } catch (error) {
    return {
      manifestPath: path,
      state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable"
    };
  }
}

/**
 * 操作者已停止未知后代后显式确认当前失败记录；不终止进程、不声称整树回收已验证。
 * 仍存活的原 Kernel/worker 或无法核验的 PID 不能放行。备份保留，确认仅匹配原文摘要，
 * 所以并发启动、后续调用或另一份清单不会复用旧确认；下一次 open 才替换失败记录。
 */
export async function acknowledgeOrphanCleanup(
  path: string
): Promise<{ manifestPath: string; archivePath: string }> {
  const source = await readFile(path, "utf8");
  const parsed = JSON.parse(source) as ManifestFile;
  if (
    parsed.schemaVersion !== 1 ||
    !Number.isSafeInteger(parsed.kernelPid) ||
    parsed.kernelPid < 1 ||
    parsed.cleanupIncomplete !== true ||
    !parsed.worker ||
    !Number.isSafeInteger(parsed.worker.pid) ||
    parsed.worker.pid < 1
  ) {
    throw new Error("ORPHAN_CLEANUP_NOT_PENDING");
  }
  if (processAlive(parsed.kernelPid)) throw new Error("ORPHAN_CLEANUP_OWNER_ALIVE");
  if (processAlive(parsed.worker.pid)) {
    const identity = await processStartIdentity(parsed.worker.pid);
    if (!identity || identity === parsed.worker.started)
      throw new Error("ORPHAN_CLEANUP_OWNER_ALIVE");
  }
  const archivePath = `${path}.acknowledged.${randomUUID()}.json`;
  await writeFile(archivePath, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const temporary = `${path}.${randomUUID()}.ack.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ digest: manifestDigest(source), archivePath }), {
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, `${path}.acknowledgement`);
  } finally {
    await rm(temporary, { force: true });
  }
  return { manifestPath: path, archivePath };
}

function manifestDigest(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function cleanupWasAcknowledged(path: string, source: string): Promise<boolean> {
  try {
    const ack = JSON.parse(await readFile(`${path}.acknowledgement`, "utf8")) as {
      digest?: string;
      archivePath?: string;
    };
    if (
      ack.digest !== manifestDigest(source) ||
      typeof ack.archivePath !== "string" ||
      !ack.archivePath.startsWith(path) ||
      !/^\.acknowledged\.[0-9a-f-]{36}\.json$/.test(ack.archivePath.slice(path.length))
    )
      return false;
    return manifestDigest(await readFile(ack.archivePath, "utf8")) === ack.digest;
  } catch {
    return false;
  }
}

async function writeManifest(path: string, snapshot: ManifestFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 查询系统启动时间以区分 PID 复用；失败时不返回可用于回收的身份，绝不以 PID 本身兜底。 */
export async function processStartIdentity(pid: number): Promise<string | undefined> {
  try {
    return await queryProcessStartIdentity(pid);
  } catch {
    return undefined;
  }
}

// 登记失败保留系统查询原因；公开探测与孤儿回收仍以 undefined 表示身份未知。
async function queryProcessStartIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      return fields[19] ? `linux:${fields[19]}` : undefined;
    } catch {
      return undefined;
    }
  }
  if (process.platform === "darwin" || process.platform === "freebsd") {
    return new Promise((resolve) => {
      execFile(
        "/bin/ps",
        ["-o", "lstart=", "-p", String(pid)],
        { timeout: 2_000 },
        (error, stdout) => {
          const value = stdout.trim();
          resolve(error || !value ? undefined : `ps:${value}`);
        }
      );
    });
  }
  if (process.platform === "win32") {
    return new Promise((resolve, reject) => {
      execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          // 直接调用系统进程对象，避免 Get-Process 的命令发现/模块自动加载占用身份查询预算。
          // 保持 UTC ticks 身份格式，不缓存可能已经复用的 PID。
          `$PSModuleAutoLoadingPreference='None'; $target=[System.Diagnostics.Process]::GetProcessById(${pid}); try { [Console]::Out.Write($target.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)) } finally { $target.Dispose() }`
        ],
        // PowerShell 冷启动与查询共用 40 秒；Windows CI 曾在 30 秒期限被系统命令超时终止。
        // 身份登记独立于后续 RPC 就绪与关闭预算，失败仍禁止使用未知 PID。
        { encoding: "utf8", timeout: 40_000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("Windows process identity query failed", { cause: error })
            );
            return;
          }
          const value = stdout.trim();
          resolve(!/^\d+$/.test(value) ? undefined : `windows:${value}`);
        }
      );
    });
  }
  return undefined;
}

async function terminateProcessGroup(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    const terminated = await new Promise<boolean>((resolve) => {
      execFile(
        "taskkill.exe",
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, timeout: 5_000 },
        (error) => resolve(!error)
      );
    });
    // taskkill 失败即使 leader 随后消失，也不能证明后代已回收。
    return terminated && (await waitForExit(pid, 1_000));
  }
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForExit(pid, 1_000)) return true;
  signalProcessGroup(pid, "SIGKILL");
  return waitForExit(pid, 1_000);
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processAlive(pid);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
