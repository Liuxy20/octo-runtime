import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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

interface ManifestFile {
  schemaVersion: 1;
  kernelPid: number;
  updatedAt: string;
  worker?: WorkerIdentity;
  invocations: InvocationManifestEntry[];
}

export interface OrphanReapResult {
  found: boolean;
  reaped: boolean;
  pid?: number;
  reason?: "kernel_alive" | "host_missing" | "identity_mismatch" | "unsupported_identity";
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
    if (reap.reason === "kernel_alive" || reap.reason === "unsupported_identity") {
      throw new Error(`cannot replace live or unverifiable invocation manifest (${reap.reason})`);
    }
    const manifest = new InvocationManifest(path);
    await manifest.#persist();
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
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, {
          encoding: "utf8",
          mode: 0o600
        });
        await rename(temporary, this.#path);
      } finally {
        await rm(temporary, { force: true });
      }
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
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as ManifestFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: false, reaped: false };
    await rm(path, { force: true });
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
    await rm(path, { force: true });
    return { found: true, reaped: false, reason: "host_missing" };
  }
  const currentIdentity = await processStartIdentity(host.pid);
  if (!currentIdentity) {
    return { found: true, reaped: false, pid: host.pid, reason: "unsupported_identity" };
  }
  if (currentIdentity !== host.started) {
    await rm(path, { force: true });
    return { found: true, reaped: false, pid: host.pid, reason: "identity_mismatch" };
  }
  await terminateProcessGroup(host.pid);
  await rm(path, { force: true });
  return { found: true, reaped: true, pid: host.pid };
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
        // 冷启动 PowerShell/.NET 也占用查询期限；10 秒已在独立 Windows CI 中反复超时。
        // 身份登记独立于后续 RPC 就绪与关闭预算，失败仍禁止使用未知 PID。
        { encoding: "utf8", timeout: 30_000, windowsHide: true },
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

async function terminateProcessGroup(pid: number): Promise<void> {
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForExit(pid, 1_000)) return;
  signalProcessGroup(pid, "SIGKILL");
  await waitForExit(pid, 1_000);
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
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
