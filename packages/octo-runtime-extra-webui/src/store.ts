import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { RuntimeLog } from "@mininglamp-oss/octo-runtime-host-sdk";

// 本机 Windows 的瞬态 EPERM 在约 1.6 秒后恢复；只重试替换，不重放业务变更。
// 最多 8 次替换、3170 ms 退避；文件系统调用和调度本身的耗时不计入退避预算。
const replacementDelays = [20, 50, 100, 200, 400, 800, 1600];
async function replace(temporary: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      // 返回结束重试的实际错误及其原生字段，不能让最初的 EPERM 掩盖后续错误。
      if (
        process.platform !== "win32" ||
        (error as NodeJS.ErrnoException).code !== "EPERM" ||
        attempt === replacementDelays.length
      )
        throw error;
      await delay(replacementDelays[attempt]);
    }
  }
}
export interface Session {
  id: string;
  title: string;
  projectPath: string;
  updatedAt: number;
  revision: number;
  adapter: string;
  model: string;
  effort: string;
  providerSession?: Record<string, unknown>;
  messages: unknown[];
}
export function validMessages(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.every((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return false;
      const row = message as Record<string, unknown>;
      return (
        typeof row.id === "string" &&
        typeof row.role === "string" &&
        ["user", "assistant", "system"].includes(row.role) &&
        typeof row.content === "string" &&
        typeof row.createdAt === "number" &&
        Number.isFinite(row.createdAt)
      );
    })
  );
}
export function validBinding(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).sessionId === "string" &&
    !!(value as Record<string, unknown>).sessionId
  );
}
export class SessionStore {
  records: Session[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly path: string,
    private readonly log?: RuntimeLog
  ) {}

  private cleanupError(event: string, error: unknown): void {
    // 清理可能因未释放句柄等原因失败；仅报告错误码，诊断失败不能覆盖保存错误。
    try {
      this.log?.("warn", event, { code: (error as NodeJS.ErrnoException)?.code });
    } catch {
      // 日志回调不能改变存储操作的结果。
    }
  }
  async open() {
    try {
      const text = await readFile(this.path, "utf8");
      if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error("WEBUI_STORE_TOO_LARGE");
      const data = JSON.parse(text) as { version: number; sessions: Session[] };
      if (
        data.version !== 1 ||
        !Array.isArray(data.sessions) ||
        data.sessions.length > 100 ||
        data.sessions.some(
          (s) =>
            typeof s.id !== "string" ||
            !/^[a-f0-9-]{36}$/.test(s.id) ||
            typeof s.projectPath !== "string" ||
            typeof s.title !== "string" ||
            !["adapter", "model", "effort"].every(
              (key) => typeof s[key as keyof Session] === "string"
            ) ||
            !Number.isFinite(s.updatedAt) ||
            !validMessages(s.messages) ||
            (s.providerSession !== undefined && !validBinding(s.providerSession)) ||
            !Number.isSafeInteger(s.revision) ||
            s.revision < 0
        )
      )
        throw new Error("WEBUI_STORE_INVALID");
      if (new Set(data.sessions.map((session) => session.id)).size !== data.sessions.length)
        throw new Error("WEBUI_STORE_INVALID");
      this.records = data.sessions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  change<T>(operation: (records: Session[]) => T): Promise<T> {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        const next = structuredClone(this.records);
        const result = operation(next);
        const text = JSON.stringify({ version: 1, sessions: next });
        if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error("WEBUI_STORE_TOO_LARGE");
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        // 独占创建成功才取得所有权；open 失败不能删除可能属于其他写入者的文件。
        const handle = await open(temporary, "wx", 0o600);
        try {
          try {
            await handle.writeFile(text);
          } catch (error) {
            await handle
              .close()
              .catch((closeError: unknown) =>
                this.cleanupError("webui.store.close_failed", closeError)
              );
            throw error;
          }
          // 关闭失败同样是保存失败，不能尝试替换或提交内存。
          await handle.close();
          await replace(temporary, this.path);
        } catch (error) {
          await unlink(temporary).catch((cleanupError: unknown) =>
            this.cleanupError("webui.store.temporary_cleanup_failed", cleanupError)
          );
          throw error;
        }
        // rename 成功就是提交点；此后没有可能将成功翻转成失败的日志或清理动作。
        this.records = next;
        return result;
      });
    this.queue = task;
    return task;
  }
}
