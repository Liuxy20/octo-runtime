import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface InvocationManifestEntry {
  invocationId: string;
  runId: string;
  adapterType: string;
  startedAt: string;
}

/** 原生 Kernel 资源所有权记录；严格校验，不接受旧 worker 格式或模块 manifest。 */
interface ManifestFile {
  schemaVersion: 1;
  kernelPid: number;
  updatedAt: string;
  cleanupIncomplete: true;
  nativeOwner: true;
  /** 实际关闭已报告失败/超时；区别于原生运行期间预先登记的保守标记。 */
  cleanupFailed?: true;
  invocations: InvocationManifestEntry[];
}

export interface OrphanReapResult {
  found: boolean;
  /** 原生恢复不终止任何进程；人工确认也不表示自动回收。 */
  reaped: false;
  reason?: "kernel_alive" | "cleanup_incomplete" | "cleanup_acknowledged";
}

/**
 * 持久化原生 Kernel 所有权与在途执行事实，不保存业务历史，不迁移旧执行架构。
 * 这是资源恢复记录，不是模块 manifest。写入串行化并通过 rename 替换；
 * 只有 owner 确认 Core/Adapter 资源回收后才能 close 删除记录。
 */
export class InvocationManifest {
  readonly #path: string;
  readonly #invocations = new Map<string, InvocationManifestEntry>();
  #cleanupFailed = false;
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
    if (reap.reason === "kernel_alive") {
      throw new Error(`cannot replace live invocation manifest (${reap.reason})`);
    }
    const manifest = new InvocationManifest(path);
    await manifest.#persist();
    await removeAcknowledgement(path);
    return { manifest, reap };
  }

  /** 原生服务异常退出无法证明 Adapter 资源已清空；正常 close 才删除所有权证据。 */
  async markNativeOwner(): Promise<void> {
    await this.#persist();
  }

  /** owner 关闭未完成时登记实际失败；宿主继续存活也不能将诊断恢复为 available。 */
  async markCleanupIncomplete(): Promise<void> {
    this.#cleanupFailed = true;
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
      nativeOwner: true,
      cleanupIncomplete: true,
      ...(this.#cleanupFailed ? { cleanupFailed: true as const } : {}),
      invocations: [...this.#invocations.values()].map((entry) => ({ ...entry }))
    };
    // 当前调用仍收到自己的 IO 失败；后续完整快照可重试，不能让一次失败毒化整个串行队列。
    this.#writes = this.#writes
      .catch(() => undefined)
      .then(async () => {
        await writeManifest(this.#path, snapshot);
      });
    return this.#writes;
  }
}

/**
 * 检查原生 owner 的遗留记录，不终止宿主或 Provider 进程。
 * 仅文件不存在或该原文已获人工确认才允许 open；损坏及旧 worker 记录保留并明确拒绝。
 */
export async function reapOrphanedInvocationManifest(path: string): Promise<OrphanReapResult> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await removeAcknowledgement(path);
    return { found: false, reaped: false };
  }
  const parsed = parseManifest(source);
  if (processAlive(parsed.kernelPid)) return { found: true, reaped: false, reason: "kernel_alive" };
  return {
    found: true,
    reaped: false,
    reason: (await cleanupWasAcknowledged(path, source))
      ? "cleanup_acknowledged"
      : "cleanup_incomplete"
  };
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
  state:
    "missing" | "available" | "cleanup_incomplete" | "acknowledged" | "unsupported" | "unreadable";
}> {
  try {
    const source = await readFile(path, "utf8");
    const parsed = parseManifest(source);
    return {
      manifestPath: path,
      // 运行中的保守标记不表示实际失败；关闭已失败时，宿主继续存活也不能隐藏 incomplete。
      state:
        parsed.cleanupFailed || !processAlive(parsed.kernelPid)
          ? (await cleanupWasAcknowledged(path, source))
            ? "acknowledged"
            : "cleanup_incomplete"
          : "available"
    };
  } catch (error) {
    return {
      manifestPath: path,
      state:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : (error as NodeJS.ErrnoException).code === "ORPHAN_RECORD_UNSUPPORTED"
            ? "unsupported"
            : "unreadable"
    };
  }
}

/**
 * 操作者已停止未知后代后显式确认当前失败记录；不终止进程、不声称整树回收已验证。
 * 仅接受有效原生记录，仍存活的原 Kernel 不能放行。备份保留，确认仅匹配原文摘要，
 * 所以并发启动、后续调用或另一份清单不会复用旧确认；下一次 open 才替换失败记录。
 */
export async function acknowledgeOrphanCleanup(
  path: string
): Promise<{ manifestPath: string; archivePath: string }> {
  const source = await readFile(path, "utf8");
  const parsed = parseManifest(source);
  if (processAlive(parsed.kernelPid)) throw new Error("ORPHAN_CLEANUP_OWNER_ALIVE");
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

/** 旧格式、未知字段及损坏内容均不能当作空记录覆盖；读取与人工确认共用同一校验。 */
function parseManifest(source: string): ManifestFile {
  try {
    const value: unknown = JSON.parse(source);
    const fields = new Set([
      "schemaVersion",
      "kernelPid",
      "updatedAt",
      "nativeOwner",
      "cleanupIncomplete",
      "cleanupFailed",
      "invocations"
    ]);
    if (
      !record(value) ||
      Object.keys(value).some((key) => !fields.has(key)) ||
      value.schemaVersion !== 1 ||
      value.nativeOwner !== true ||
      value.cleanupIncomplete !== true ||
      !Number.isSafeInteger(value.kernelPid) ||
      Number(value.kernelPid) < 1 ||
      Number(value.kernelPid) > 2147483647 ||
      !timestamp(value.updatedAt) ||
      (value.cleanupFailed !== undefined && value.cleanupFailed !== true) ||
      !Array.isArray(value.invocations) ||
      !value.invocations.every(
        (entry: unknown) =>
          record(entry) &&
          Object.keys(entry).length === 4 &&
          ["invocationId", "runId", "adapterType"].every(
            (key) => typeof entry[key] === "string" && entry[key] !== ""
          ) &&
          timestamp(entry.startedAt)
      )
    )
      throw new Error("Invalid native ownership record");
    return value as unknown as ManifestFile;
  } catch (cause) {
    throw Object.assign(new Error("ORPHAN_RECORD_UNSUPPORTED", { cause }), {
      code: "ORPHAN_RECORD_UNSUPPORTED"
    });
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}
