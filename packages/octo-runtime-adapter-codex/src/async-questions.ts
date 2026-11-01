import { createHash } from "node:crypto";
import {
  assertAsyncQuestions,
  assertQuestionRequest,
  questionAnswerText,
  protocolError,
  type AsyncUserInputQuestion,
  type CanonicalEvent,
  type InteractionResponse,
  type QuestionRequest
} from "@mininglamp-oss/octo-runtime-protocol";

type JsonRecord = Record<string, unknown>;
const failure = (code: string): Error & { code: string } =>
  Object.assign(new Error(code), { code });
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 保留原生异步快照；不从正文推断问题，也不授权回答历史消息。 */
export function asyncQuestionMetadata(item: JsonRecord): {
  delivery?: "async";
  questions?: AsyncUserInputQuestion[];
} {
  if (item.delivery !== "async") return {};
  if (item.questions === null || item.questions === undefined) return { delivery: "async" };
  if (!Array.isArray(item.questions)) throw failure("INVALID_ASYNC_QUESTIONS");
  const questions = item.questions.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw failure("INVALID_ASYNC_QUESTIONS");
    const q = value as JsonRecord;
    return { title: q.title, options: q.options };
  });
  assertAsyncQuestions(questions);
  return { delivery: "async", questions };
}

interface Batch {
  request: QuestionRequest;
  threadId: string;
  turnId: string;
  expiresAt: number;
  timer?: NodeJS.Timeout;
  submitting: boolean;
  reject?: (error: Error) => void;
}

/**
 * invocation 独享有界状态；transport 在读取成功 RPC 帧时同步调用 accept，
 * 避免同一缓冲区的后续 turn/completed 覆盖已经观察到的接纳事实。
 */
export class CodexAsyncQuestions {
  readonly #pending = new Map<string, Batch>();
  readonly #seen = new Map<string, string>();
  constructor(
    readonly invocationId: string,
    readonly emit: (event: CanonicalEvent) => void,
    readonly send: (
      params: JsonRecord,
      accept: (value: unknown) => void,
      rejected: (error: Error) => void
    ) => Promise<unknown>,
    readonly now = Date.now,
    readonly lifetimeMs = Infinity
  ) {}

  get size(): number {
    return this.#pending.size;
  }

  register(item: JsonRecord, threadId: string, turnId: string, otherPending: number): void {
    const { questions } = asyncQuestionMetadata(item);
    if (!questions?.length) return;
    if (typeof item.id !== "string" || !item.id) throw failure("INVALID_ASYNC_QUESTION_ID");
    const id = `codex:async:${digest([this.invocationId, threadId, turnId, item.id])}`;
    const hash = digest(questions);
    const previous = this.#seen.get(id);
    if (previous !== undefined) {
      if (previous !== hash) throw failure("ASYNC_QUESTION_CONFLICT");
      return;
    }
    if (this.#seen.size >= 1024 || this.size + otherPending >= 16)
      throw failure("INTERACTION_PENDING_LIMIT_EXCEEDED");
    const request = {
      schema: "octo.question-request/v1",
      messageId: item.id,
      questions: questions.map((q, index) => ({ ...q, id: `q:${index}`, allowCustom: true }))
    };
    assertQuestionRequest(request);
    const expiresAt = this.now() + this.lifetimeMs;
    const timer = Number.isFinite(expiresAt)
      ? setTimeout(() => this.#finish(id, "expired", "question_timeout"), this.lifetimeMs)
      : undefined;
    timer?.unref?.();
    this.#seen.set(id, hash);
    // 直接 Core 消费端持有公开事件对象；独立保存原题，避免 UI 修改展示数据后改写投递关联。
    this.#pending.set(id, {
      request: structuredClone(request),
      threadId,
      turnId,
      expiresAt,
      timer,
      submitting: false
    });
    this.emit({
      protocolVersion: 2,
      type: "interaction.requested",
      payload: {
        interactionId: id,
        executionInstanceId: this.invocationId,
        kind: "question",
        delivery: "async",
        ...(Number.isFinite(expiresAt) ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        request: request as unknown as JsonRecord
      }
    });
  }

  /** 提交只允许一个在途请求；取消仅关闭表单，不向 Provider 伪造答案。 */
  respond(response: InteractionResponse): Promise<void> {
    const id = response.interactionId;
    const batch = this.#pending.get(id);
    if (!batch || batch.submitting) return Promise.reject(protocolError("INTERACTION_NOT_ACTIVE"));
    if (batch.expiresAt <= this.now()) {
      this.#finish(id, "expired", "question_timeout");
      return Promise.reject(protocolError("INTERACTION_NOT_ACTIVE"));
    }
    if (response.outcome === "cancelled" && response.value === undefined) {
      this.#finish(id, "resolved", "user_cancelled", "cancelled");
      return Promise.resolve();
    }
    try {
      if (response.outcome !== "answered") throw failure("INVALID_QUESTION_RESPONSE");
      const text = questionAnswerText(batch.request, response.value);
      batch.submitting = true;
      clearTimeout(batch.timer);
      const hex = digest(id);
      const clientId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const params = {
        threadId: batch.threadId,
        expectedTurnId: batch.turnId,
        clientUserMessageId: clientId,
        input: [
          {
            type: "text",
            text,
            text_elements: []
          }
        ]
      };
      return new Promise<void>((resolve, reject) => {
        batch.reject = reject;
        const failed = (error: Error & { deliveryNotAttempted?: boolean }) => {
          if (!this.#pending.has(id)) return;
          const explicit = error.name === "CodexAppServerRpcError";
          if (error.deliveryNotAttempted === true) {
            batch.submitting = false;
            batch.reject = undefined;
            batch.timer = Number.isFinite(batch.expiresAt)
              ? setTimeout(
                  () => this.#finish(id, "expired", "question_timeout"),
                  Math.max(0, batch.expiresAt - this.now())
                )
              : undefined;
            batch.timer?.unref?.();
            reject(error);
            return;
          }
          this.#finish(
            id,
            "invalidated",
            explicit ? "provider_rejected" : "submission_outcome_unknown"
          );
          const result = failure(explicit ? "ASYNC_ANSWER_REJECTED" : "OPERATION_OUTCOME_UNKNOWN");
          // RPC 错误码可跨 worker 诊断；不把 Provider 的任意正文复制到公共错误。
          const nativeCode = (error as Error & { code?: unknown }).code;
          reject(
            Object.assign(result, {
              cause: error,
              ...(explicit && typeof nativeCode === "number" ? { providerRpcCode: nativeCode } : {})
            })
          );
        };
        try {
          void this.send(
            params,
            (value) => {
              if (
                !this.#pending.has(id) ||
                !value ||
                typeof value !== "object" ||
                (value as JsonRecord).turnId !== batch.turnId
              )
                throw failure("OPERATION_OUTCOME_UNKNOWN");
              this.#finish(id, "resolved", "provider_accepted", "answered");
              resolve();
            },
            failed
          ).catch(failed);
        } catch (error) {
          failed(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** 正常完成仅释放未答旁路；宿主可续跑。已发出未确认的答案仍为未知，不得重投。 */
  invalidate(reason: string): void {
    for (const [id, batch] of this.#pending) {
      if (reason === "run_completed" && !batch.submitting) {
        clearTimeout(batch.timer);
        this.#pending.delete(id);
        continue;
      }
      const reject = batch.reject;
      this.#finish(id, "invalidated", batch.submitting ? "submission_outcome_unknown" : reason);
      reject?.(failure("OPERATION_OUTCOME_UNKNOWN"));
    }
    this.#seen.clear();
  }

  #finish(
    id: string,
    status: "resolved" | "expired" | "invalidated",
    reasonCode: string,
    outcome?: "answered" | "cancelled"
  ): void {
    const batch = this.#pending.get(id);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.#pending.delete(id);
    this.emit({
      protocolVersion: 2,
      type: "interaction.resolved",
      payload: {
        interactionId: id,
        executionInstanceId: this.invocationId,
        status,
        reasonCode,
        ...(outcome ? { outcome } : {})
      }
    });
  }
}
