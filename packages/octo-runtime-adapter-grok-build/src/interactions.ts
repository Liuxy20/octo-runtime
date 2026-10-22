import {
  AcpApprovalBridge,
  sanitizePublicValue,
  type CanonicalEvent,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { InteractionResponse } from "@mininglamp-oss/octo-runtime-protocol";
import { randomUUID } from "node:crypto";

type JsonRecord = Record<string, unknown>;
interface Question {
  params: JsonRecord;
  answer: (response: InteractionResponse) => JsonRecord;
  resolve: (result: JsonRecord) => void;
  reject: (error: Error) => void;
  written: Promise<void>;
  confirm: () => void;
  fail: (error: Error) => void;
  timer: NodeJS.Timeout;
  expiresAt: number;
  responding: boolean;
}

/** 标准权限沿用 SDK；原生追问和计划确认只存在于当前 Grok Build 调用。 */
export class GrokBuildInteractionBridge extends AcpApprovalBridge {
  readonly #questions = new Map<string, Question>();
  readonly #events: CanonicalEvent[] = [];
  #wake?: () => void;
  #error?: Error;
  #closed = false;

  constructor(request: InvokeRequest) {
    super(request);
  }

  requestQuestion(
    params: JsonRecord,
    request: JsonRecord,
    answer: Question["answer"]
  ): Promise<JsonRecord> {
    if (this.#closed || this.request.signal?.aborted || this.#questions.size >= 16)
      return Promise.reject(new Error("APPROVAL_WAIT_UNAVAILABLE"));
    const interactionId = `interaction_${randomUUID()}`;
    const expiresAt = Date.now() + this.timeoutMs;
    let confirm!: () => void;
    let fail!: (error: Error) => void;
    const written = new Promise<void>((resolve, reject) => {
      confirm = resolve;
      fail = reject;
    });
    void written.catch(() => undefined);
    const result = new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#error = new Error("APPROVAL_EXPIRED");
        this.#questions.delete(interactionId);
        reject(this.#error);
        fail(this.#error);
        this.#resolved(interactionId, "expired", "approval_timeout");
      }, this.timeoutMs);
      timer.unref();
      this.#questions.set(interactionId, {
        params,
        answer,
        resolve,
        reject,
        written,
        confirm,
        fail,
        timer,
        expiresAt,
        responding: false
      });
    });
    this.#emit({
      protocolVersion: 2,
      type: "interaction.requested",
      payload: {
        interactionId,
        kind: "question",
        executionInstanceId: this.request.invocationId,
        expiresAt: new Date(expiresAt).toISOString(),
        request: sanitizePublicValue(request) as JsonRecord
      }
    });
    return result;
  }

  override async respond(response: InteractionResponse): Promise<void> {
    const pending = this.#questions.get(response.interactionId);
    if (!pending) return super.respond(response);
    if (pending.responding || pending.expiresAt <= Date.now() || this.request.signal?.aborted)
      throw new Error("INTERACTION_NOT_ACTIVE");
    const result = pending.answer(response);
    pending.responding = true;
    pending.resolve(result);
    await pending.written;
    if (!this.#questions.has(response.interactionId) || this.#closed)
      throw new Error("INTERACTION_NOT_ACTIVE");
    clearTimeout(pending.timer);
    this.#questions.delete(response.interactionId);
    this.#emit({
      protocolVersion: 2,
      type: "interaction.resolved",
      payload: {
        interactionId: response.interactionId,
        executionInstanceId: this.request.invocationId,
        status: "resolved",
        outcome: response.outcome
      }
    });
  }

  override responseWritten(params: JsonRecord): void {
    super.responseWritten(params);
    for (const pending of this.#questions.values())
      if (pending.params === params) pending.confirm();
  }

  override responseFailed(params: JsonRecord, error: Error): void {
    for (const pending of this.#questions.values())
      if (pending.params === params) pending.fail(error);
    this.#error = error;
    super.responseFailed(params, error);
    this.#wake?.();
  }

  override async *stream(source: AsyncIterable<CanonicalEvent>): AsyncGenerator<CanonicalEvent> {
    const iterator = super.stream(source);
    let next = iterator.next();
    void next.catch(() => undefined);
    try {
      while (true) {
        while (this.#events.length) yield this.#events.shift()!;
        if (this.#error) throw this.#error;
        const wake = new Promise<null>((resolve) => {
          this.#wake = () => resolve(null);
        });
        const result = await Promise.race([next, wake]);
        this.#wake = undefined;
        if (result === null) continue;
        while (this.#events.length) yield this.#events.shift()!;
        if (result.done) return;
        yield result.value;
        next = iterator.next();
        void next.catch(() => undefined);
      }
    } catch (error) {
      this.close("execution_lost");
      while (this.#events.length) yield this.#events.shift()!;
      throw error;
    } finally {
      this.close("execution_lost");
      await iterator.return(undefined);
    }
  }

  override close(reason: string): void {
    super.close(reason);
    if (this.#closed) return;
    this.#closed = true;
    for (const [interactionId, pending] of this.#questions) {
      clearTimeout(pending.timer);
      const error = new Error("INTERACTION_NOT_ACTIVE");
      pending.reject(error);
      pending.fail(error);
      this.#resolved(interactionId, "invalidated", reason);
    }
    this.#questions.clear();
  }

  #resolved(interactionId: string, status: "expired" | "invalidated", reasonCode: string): void {
    this.#emit({
      protocolVersion: 2,
      type: "interaction.resolved",
      payload: { interactionId, executionInstanceId: this.request.invocationId, status, reasonCode }
    });
  }

  #emit(event: CanonicalEvent): void {
    this.#events.push(event);
    this.#wake?.();
  }
}
