/** Optional metadata logging; bounded queues isolate filesystem writes in a dedicated worker. */
import { isAbsolute } from "node:path";
import { Worker } from "node:worker_threads";
import { extraStatusRecord, kernelStatusRecord, type ExtraStatusRecord } from "./service-status.js";

export type RuntimeLogLevel = "info" | "warn" | "error";
export type RuntimeLog = (
  level: RuntimeLogLevel,
  event: string,
  data?: Readonly<Record<string, unknown>>
) => void;
export interface RuntimeLoggingOptions {
  directory: string;
  /** In-process status sink; SDK defaults to silence. Never placed in JSON config or workerData. */
  statusOutput?: (record: ExtraStatusRecord) => void;
}
export const noopRuntimeLog: RuntimeLog = () => {};

const strings = new Set([
  "run_id",
  "invocation_id",
  "session_id",
  "adapter_type",
  "model",
  "status",
  "code",
  "reason_code",
  "native_code",
  "primary_code",
  "cleanup_code",
  "signal",
  "endpoint_id",
  "state",
  "protocol_mode"
]);
const numbers = new Set([
  "duration_ms",
  "request_id",
  "pid",
  "exit_code",
  "native_code",
  "input_count",
  "text_input_count",
  "image_input_count",
  "context_count",
  "attempt",
  "frame_count",
  "conversion_count",
  "working_tasks",
  "queued_tasks"
]);

export function assertRuntimeLogging(options?: RuntimeLoggingOptions): void {
  if (
    options !== undefined &&
    (!options || typeof options.directory !== "string" || !isAbsolute(options.directory))
  )
    throw new TypeError("LOG_DIRECTORY_MUST_BE_ABSOLUTE");
  if (options?.statusOutput !== undefined && typeof options.statusOutput !== "function")
    throw new TypeError("LOG_STATUS_OUTPUT_INVALID");
}

/** F31：.octospec/tasks/gateway-august-feature-assessment/assessment.md */
export class RuntimeLogging {
  #worker?: Worker;
  #pending = 0;
  #statusPending = 0;
  readonly #statusOutput?: RuntimeLoggingOptions["statusOutput"];
  #closed = false;
  #closing?: Promise<void>;
  #done?: () => void;
  constructor(options?: RuntimeLoggingOptions) {
    assertRuntimeLogging(options);
    if (!options) return;
    this.#statusOutput = options.statusOutput;
    try {
      this.#worker = new Worker(new URL("./runtime-log-worker.js", import.meta.url), {
        workerData: { directory: options.directory }
      });
    } catch {
      return;
    }
    this.#worker.on("message", (message: string | { written: boolean }) => {
      if (typeof message === "object") {
        if (message.written) this.#statusPending = Math.max(0, this.#statusPending - 1);
        else this.#pending = Math.max(0, this.#pending - 1);
      }
      if (message === "closed") this.#done?.();
    });
    this.#worker.on("error", () => {
      this.#worker = undefined;
      this.#done?.();
    });
    this.#worker.on("exit", () => {
      this.#worker = undefined;
      this.#done?.();
    });
    this.#worker.unref();
  }
  readonly kernel: RuntimeLog = (level, event, data) =>
    this.#write("kernel", undefined, level, event, data);
  extra(name: string): RuntimeLog {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new TypeError("EXTRA_NAME_INVALID");
    return (level, event, data) => this.#write("extra", name, level, event, data);
  }
  #write(
    source: "kernel" | "extra",
    extra: string | undefined,
    level: RuntimeLogLevel,
    event: string,
    data?: Readonly<Record<string, unknown>>
  ): void {
    if (this.#closed) return;
    if (source === "kernel" && this.#worker && this.#statusPending < 128) {
      try {
        const status = kernelStatusRecord(level, event, data);
        if (status) {
          this.#worker.postMessage({ status: true, line: `${JSON.stringify(status)}\n` });
          this.#statusPending++;
        }
      } catch {
        /* 状态镜像失败不影响执行或普通日志。 */
      }
    }
    if (extra) {
      try {
        const status = extraStatusRecord(extra, level, event, data);
        if (status) {
          // Sink and mirror fail independently; neither failure may affect service recovery.
          try {
            const result: unknown = this.#statusOutput?.(status);
            // TypeScript permits async functions in void sinks; observe rejection without waiting.
            if (result && typeof (result as PromiseLike<unknown>).then === "function")
              void Promise.resolve(result).catch(() => undefined);
          } catch {
            /* A host sink failure must not suppress the independent file mirror. */
          }
          if (this.#worker && this.#statusPending < 128) {
            this.#worker.postMessage({ extra, status: true, line: `${JSON.stringify(status)}\n` });
            this.#statusPending++;
          }
        }
      } catch {
        /* Untrusted diagnostic getters must not escape into service execution. */
      }
    }
    if (!this.#worker || this.#pending >= 128) return;
    try {
      if (!["info", "warn", "error"].includes(level) || !/^[a-z][a-z0-9_.-]{0,63}$/.test(event))
        return;
      const safe: Record<string, string | number> = {};
      // Ignore unknown fields entirely instead of serializing or truncating arbitrary bodies.
      for (const key of strings) {
        const value = data?.[key];
        if (
          typeof value === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,127}$/.test(value) &&
          !/^(?:bf_|sk-|Bearer)/i.test(value)
        )
          safe[key] = value;
      }
      for (const key of numbers) {
        const value = data?.[key];
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          (value >= 0 || (key === "native_code" && Number.isSafeInteger(value)))
        )
          safe[key] = value;
      }
      // 任务诊断只进入普通日志；逐字段校验，保持组件状态输出的独立隐私边界。
      const diagnosticId = data?.diagnostic_id;
      if (typeof diagnosticId === "string" && /^diag_[0-9a-f]{32}$/.test(diagnosticId))
        safe.diagnostic_id = diagnosticId;
      const stage = data?.stage;
      if (
        typeof stage === "string" &&
        ["channel_session_read", "channel_presentation_initialize", "channel_admission"].includes(
          stage
        )
      )
        safe.stage = stage;
      const component = data?.failure_component;
      if (component === "octo-runtime" || component === "octo-agent-worker")
        safe.failure_component = component;
      const occurredAt = data?.occurred_at;
      if (
        typeof occurredAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt) &&
        Number.isFinite(Date.parse(occurredAt)) &&
        new Date(occurredAt).toISOString() === occurredAt
      )
        safe.occurred_at = occurredAt;
      const record = {
        time: new Date().toISOString(),
        level,
        source,
        event,
        ...(extra ? { extra_type: extra } : {}),
        data: safe
      };
      this.#worker.postMessage({ extra, line: `${JSON.stringify(record)}\n` });
      this.#pending++;
    } catch {
      /* Diagnostics cannot interrupt execution, including getter errors or an exited worker. */
    }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    if (!this.#worker) return Promise.resolve();
    const worker = this.#worker;
    this.#closing = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve();
      }, 1000);
      this.#done = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        worker.postMessage("close");
      } catch {
        this.#done();
      }
    });
    return this.#closing;
  }
}
