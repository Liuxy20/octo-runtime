import { createHash } from "node:crypto";
import type { CanonicalEvent } from "@mininglamp-oss/octo-runtime-protocol";
import { DshError, nativeCode, record } from "./errors.js";
import type { DshNotification } from "./client.js";

function required(value: unknown): asserts value {
  if (!value) throw new DshError("DSH_TRAJECTORY_INVALID");
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 191;
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
function event(type: CanonicalEvent["type"], payload: Record<string, unknown>): CanonicalEvent {
  return { protocolVersion: 2, type, payload } as CanonicalEvent;
}

/** 只保留当前工作和序号摘要；不存轨迹历史，不把 child 文本合并进 root final。 */
export class DshTrajectory {
  readonly #sessions = new Map<string, { parent?: string; seq: number; digest: string }>();
  readonly #steps = new Map<string, string>();
  readonly #turns = new Map<string, number>();
  readonly #tools = new Map<string, { id: string; sessionId: string; time: number }>();
  readonly #messages = new Map<string, { id: string; text: string }>();
  readonly #receipts = new Set<string>();
  #lastReason?: string;
  #lastNativeCode?: string | number;
  #lastAnswer = false;
  #objects = 0;

  constructor(
    readonly sessionId: string,
    private readonly maxTextBytes: number
  ) {
    this.#sessions.set(sessionId, { seq: -1, digest: "" });
  }

  #id(sessionId: string, kind: string, value: unknown): string {
    return `dsh:${hash(sessionId)}:${kind}:${String(value)}`;
  }
  #bound(): void {
    if (++this.#objects > 4096)
      throw new DshError("DSH_TRAJECTORY_INVALID", { phase: "object_limit" });
  }
  #lineage(sessionId: string): Record<string, unknown> {
    const parentSessionId = this.#sessions.get(sessionId)?.parent;
    return { providerSessionId: sessionId, ...(parentSessionId ? { parentSessionId } : {}) };
  }

  accept(notification: DshNotification): CanonicalEvent[] {
    const { method, params } = notification;
    if (method === "subagent.started") {
      if (!this.#sessions.has(String(params.parentSessionId))) return [];
      required(identifier(params.childSessionId) && identifier(params.parentSessionId));
      const child = this.#sessions.get(params.childSessionId);
      if (child) {
        required(child.parent === params.parentSessionId);
        return [];
      }
      required(this.#sessions.size < 128 && params.childSessionId !== this.sessionId);
      this.#sessions.set(params.childSessionId, {
        parent: params.parentSessionId,
        seq: -1,
        digest: ""
      });
      return [
        event("activity.started", {
          activityId: this.#id(params.childSessionId, "agent", 0),
          kind: "working",
          subject: { type: "run" },
          source: "provider",
          info: {
            params: {
              providerSessionId: params.childSessionId,
              parentSessionId: params.parentSessionId
            }
          }
        })
      ];
    }
    if (method === "subagent.finished") {
      const child =
        typeof params.childSessionId === "string"
          ? this.#sessions.get(params.childSessionId)
          : undefined;
      if (!child) return [];
      required(
        child.parent === params.parentSessionId && ["ok", "error"].includes(String(params.status))
      );
      return [
        event("activity.finished", {
          activityId: this.#id(String(params.childSessionId), "agent", 0),
          status: params.status === "ok" ? "completed" : "failed"
        })
      ];
    }
    if (method !== "session.event") return [];
    required(identifier(params.sessionId));
    const sessionId = params.sessionId;
    const state = this.#sessions.get(sessionId);
    if (!state) return [];
    const source = params.event;
    required(
      record(source) &&
        identifier(source.type) &&
        integer(source.seq) &&
        integer(source.time) &&
        record(source.data)
    );
    const digest = hash(JSON.stringify(source));
    if (source.seq < state.seq) return [];
    if (source.seq === state.seq) {
      required(digest === state.digest);
      return [];
    }
    state.seq = source.seq;
    state.digest = digest;
    const data = source.data;
    const lineage = this.#lineage(sessionId);
    const output: CanonicalEvent[] = [];
    const stepId = this.#id(sessionId, "step", `${String(data.turn)}:${String(data.step)}`);
    switch (source.type) {
      case "agent/inbox/spliced":
        if (sessionId === this.sessionId) {
          required(Array.isArray(data.inserted));
          for (const item of data.inserted) {
            required(record(item) && identifier(item.id));
            required(this.#receipts.size < 128);
            this.#receipts.add(item.id);
          }
        }
        break;
      case "turn/start":
        required(integer(data.turn) && !this.#turns.has(sessionId));
        this.#turns.set(sessionId, data.turn);
        if (sessionId === this.sessionId) {
          this.#lastReason = undefined;
          this.#lastAnswer = false;
        }
        output.push(
          event("activity.started", {
            activityId: this.#id(sessionId, "turn", data.turn),
            kind: "working",
            subject: { type: "run" },
            source: "provider",
            info: { params: lineage },
            startedAtMs: source.time
          })
        );
        break;
      case "step/start":
        required(
          integer(data.turn) &&
            integer(data.step) &&
            this.#turns.get(sessionId) === data.turn &&
            !this.#steps.has(sessionId)
        );
        this.#bound();
        this.#steps.set(sessionId, stepId);
        output.push(event("model_step.started", { stepId, startedAtMs: source.time, ...lineage }));
        break;
      case "step/end":
        required(this.#steps.get(sessionId) === stepId);
        this.#steps.delete(sessionId);
        output.push(
          event("model_step.finished", {
            stepId,
            status: "completed",
            endedAtMs: source.time,
            ...lineage
          })
        );
        break;
      case "assistant/chunk": {
        required(this.#steps.get(sessionId) === stepId && record(data.chunk));
        const chunk = data.chunk;
        if (chunk.type !== "text-delta") break;
        required(typeof chunk.text === "string");
        const message = this.#messages.get(sessionId) ?? {
          id: this.#id(sessionId, "message", source.seq),
          text: ""
        };
        if (!this.#messages.has(sessionId))
          output.push(
            this.#messageEvent("message.create", message.id, sessionId, stepId, {
              role: "assistant",
              status: "streaming"
            })
          );
        message.text += chunk.text;
        required(Buffer.byteLength(message.text) <= this.maxTextBytes);
        this.#messages.set(sessionId, message);
        output.push(
          this.#messageEvent("message.delta", message.id, sessionId, stepId, { text: chunk.text })
        );
        break;
      }
      case "assistant/message": {
        required(
          this.#steps.get(sessionId) === stepId &&
            record(data.message) &&
            Array.isArray(data.message.content)
        );
        const blocks: Record<string, unknown>[] = data.message.content as Record<string, unknown>[];
        required(blocks.every((block) => record(block) && typeof block.type === "string"));
        const text = blocks
          .filter((block) => block.type === "text")
          .map((block) => {
            required(typeof block.text === "string");
            return block.text;
          })
          .join("");
        required(Buffer.byteLength(text) <= this.maxTextBytes);
        const reasoning = blocks
          .filter((block) => block.type === "reasoning")
          .map((block) => {
            required(typeof block.text === "string");
            return block.text;
          })
          .join("");
        if (reasoning) {
          required(Buffer.byteLength(reasoning) <= this.maxTextBytes);
          const analysis = {
            id: this.#id(sessionId, "analysis", source.seq),
            role: "assistant",
            channel: "analysis",
            exposure: "private_reasoning",
            provenance: { provider: "dsh", nativeEvent: "assistant/message" },
            stepId,
            ...lineage
          };
          output.push(
            event("message.create", { ...analysis, status: "streaming" }),
            event("message.delta", { ...analysis, text: reasoning }),
            event("message.update", { ...analysis, status: "completed" })
          );
        }
        const existing = this.#messages.get(sessionId);
        const messageId = existing?.id ?? this.#id(sessionId, "message", source.seq);
        if (!existing)
          output.push(
            this.#messageEvent("message.create", messageId, sessionId, stepId, {
              role: "assistant",
              status: "streaming"
            })
          );
        // durable stream 只在 commit 到达；只发增量或快照一次，并验证二者一致。
        let sent = existing?.text ?? "";
        if (!existing && data.stream !== undefined) {
          required(Array.isArray(data.stream));
          for (const part of data.stream) {
            required(record(part) && typeof part.type === "string");
            if (part.type !== "text-chunks") continue;
            required(
              Array.isArray(part.texts) && part.texts.every((item) => typeof item === "string")
            );
            for (const delta of part.texts) {
              sent += delta;
              required(Buffer.byteLength(sent) <= this.maxTextBytes);
              if (delta)
                output.push(
                  this.#messageEvent("message.delta", messageId, sessionId, stepId, { text: delta })
                );
            }
          }
        }
        required(text.startsWith(sent));
        if (text.length > sent.length)
          output.push(
            this.#messageEvent("message.delta", messageId, sessionId, stepId, {
              text: text.slice(sent.length)
            })
          );
        output.push(
          this.#messageEvent("message.update", messageId, sessionId, stepId, {
            role: "assistant",
            status: data.interrupted === true ? "stopped" : "completed"
          })
        );
        this.#messages.delete(sessionId);
        this.#bound();
        if (sessionId === this.sessionId)
          this.#lastAnswer = text.trim().length > 0 && data.interrupted !== true;
        if (record(data.usage)) {
          // 用量只复制已给出的数值，保留原生字段名；不填充未知 token。
          const usage = Object.fromEntries(
            Object.entries(data.usage).filter(([, value]) => integer(value))
          );
          if (Object.keys(usage).length)
            output.push(event("usage.update", { ...usage, stepId, ...lineage }));
        }
        break;
      }
      case "tool/call": {
        // 原生 arguments 是 JSON 文本；只在这一个结构边界解析。
        let args: unknown = data.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            throw new DshError("DSH_TRAJECTORY_INVALID");
          }
        }
        required(
          this.#steps.get(sessionId) === stepId &&
            identifier(data.callId) &&
            identifier(data.name) &&
            record(args)
        );
        const key = `${sessionId}\0${data.callId}`;
        required(!this.#tools.has(key));
        this.#bound();
        const id = this.#id(sessionId, "tool", hash(data.callId));
        this.#tools.set(key, { id, sessionId, time: source.time });
        output.push(
          event("tool_call.create", {
            id,
            name: data.name,
            args,
            status: "running",
            stepId,
            ...lineage
          })
        );
        break;
      }
      case "tool/result": {
        required(record(data.message) && identifier(data.message.toolCallId));
        const key = `${sessionId}\0${data.message.toolCallId}`;
        const tool = this.#tools.get(key);
        required(
          tool && this.#steps.get(sessionId) === stepId && Array.isArray(data.message.content)
        );
        required(data.message.isError === undefined || typeof data.message.isError === "boolean");
        this.#tools.delete(key);
        output.push(
          event("tool_call.update", {
            id: tool.id,
            status: data.message.isError ? "failed" : "completed",
            output: data.message.content,
            stepId,
            ...lineage,
            ...(source.time >= tool.time ? { durationMs: source.time - tool.time } : {})
          })
        );
        break;
      }
      case "turn/end": {
        required(
          integer(data.turn) &&
            this.#turns.get(sessionId) === data.turn &&
            record(data.reason) &&
            ["completed", "error", "aborted", "max-tokens"].includes(String(data.reason.kind))
        );
        this.#turns.delete(sessionId);
        if (sessionId === this.sessionId) {
          this.#lastReason = String(data.reason.kind);
          const code = record(data.reason.error) ? nativeCode(data.reason.error.code) : undefined;
          this.#lastNativeCode = code;
        }
        output.push(
          event("activity.finished", {
            activityId: this.#id(sessionId, "turn", data.turn),
            status:
              data.reason.kind === "completed"
                ? "completed"
                : data.reason.kind === "aborted"
                  ? "cancelled"
                  : "failed",
            endedAtMs: source.time
          })
        );
        break;
      }
    }
    return output;
  }

  #messageEvent(
    type: CanonicalEvent["type"],
    id: string,
    sessionId: string,
    stepId: string,
    data: Record<string, unknown>
  ): CanonicalEvent {
    return event(type, {
      id,
      channel: sessionId === this.sessionId ? "final" : "commentary",
      stepId,
      ...this.#lineage(sessionId),
      ...data
    });
  }

  /** wait 只证明 idle；receipt、durable terminal 和已提交回答分别验证。 */
  finish(receiptId: string): CanonicalEvent {
    if (
      !this.#receipts.has(receiptId) ||
      !this.#lastReason ||
      this.#turns.size ||
      this.#steps.size ||
      this.#tools.size ||
      this.#messages.size
    )
      throw new DshError("DSH_TRAJECTORY_INVALID");
    if (this.#lastReason === "aborted")
      return event("run.cancelled", { reason: "provider_aborted" });
    if (this.#lastReason !== "completed")
      throw new DshError("DSH_EXECUTION_FAILED", {
        ...(this.#lastNativeCode === undefined ? {} : { nativeCode: this.#lastNativeCode })
      });
    if (!this.#lastAnswer) throw new DshError("DSH_NO_FINAL_OUTPUT");
    return event("run.completed", {});
  }
}
