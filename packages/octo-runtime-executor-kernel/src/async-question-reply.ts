import { randomUUID } from "node:crypto";
import {
  assertCanonicalEvent,
  assertHostFrame,
  assertHostFrameIdentity,
  assertHostRunReceipt,
  assertInvokeInput,
  assertJsonValue,
  assertQuestionRequest,
  assertQuestionResponse,
  questionAnswerText,
  type AsyncQuestionReplySnapshot,
  type CanonicalEvent,
  type HostFrame,
  type InvokeEnvironment,
  type InvokeInput
} from "@mininglamp-oss/octo-runtime-protocol";
import { KernelError, type KernelClient } from "./types.js";

export type AsyncQuestionReplyResult =
  | { route: "steer"; acceptance: "provider_accepted" }
  | { route: "new_run"; input: InvokeInput; events: AsyncGenerator<CanonicalEvent> };

/**
 * 宿主持有的一份旁路问题控制者，不拥有 Kernel 或数据库。
 * 活动时 steer，确认正常完成后复用 invoke；宿主须串行管理同会话、
 * 保存提交状态并消费新 Run 尾流。新流返回不代表 Provider 接纳。
 */
export class AsyncQuestionReply {
  #snapshot: AsyncQuestionReplySnapshot;
  constructor(
    readonly client: KernelClient,
    snapshot: AsyncQuestionReplySnapshot,
    readonly continuation: () => InvokeInput,
    readonly environment?: InvokeEnvironment
  ) {
    assertJsonValue(snapshot);
    if (
      snapshot.schema !== "octo.async-question-reply/v1" ||
      !["pending", "submitting", "answered", "cancelled", "invalidated", "unknown"].includes(
        snapshot.phase
      ) ||
      typeof snapshot.completed !== "boolean" ||
      snapshot.ref.protocol_mode !== "canonical" ||
      snapshot.ref.protocol !== "codex.app-server" ||
      snapshot.question.delivery !== "async" ||
      snapshot.question.kind !== "question" ||
      snapshot.question.executionInstanceId !== snapshot.ref.invocation_id ||
      !snapshot.providerSession.sessionId ||
      snapshot.providerSession.resumable === false
    )
      throw new KernelError("INVALID_ASYNC_QUESTION_SNAPSHOT");
    const { kernel_instance_id, ...receipt } = snapshot.ref;
    if (!kernel_instance_id) throw new KernelError("INVALID_ASYNC_QUESTION_SNAPSHOT");
    assertHostRunReceipt(receipt);
    assertCanonicalEvent({
      protocolVersion: 2,
      type: "interaction.requested",
      payload: snapshot.question
    });
    assertQuestionRequest(snapshot.question.request);
    this.#snapshot = structuredClone(snapshot);
  }

  /** 独立 JSON 副本供宿主保存；恢复 submitting/unknown 不会再次投递。 */
  snapshot(): AsyncQuestionReplySnapshot {
    return structuredClone(this.#snapshot);
  }

  /** 只接受原源流事实；消息 final 或查不到 Run 不能证明正常完成。 */
  observe(frame: HostFrame): void {
    assertHostFrame(frame);
    const { kernel_instance_id: _instance, ...receipt } = this.#snapshot.ref;
    void _instance;
    assertHostFrameIdentity(frame, receipt);
    if (frame.kind === "control" && frame.control.type === "state") {
      if (frame.control.state === "completed") this.#snapshot.completed = true;
      else if (["failed", "cancelled", "lost"].includes(frame.control.state))
        this.#snapshot.phase = "invalidated";
    }
    if (
      frame.kind === "canonical" &&
      frame.event.type === "interaction.resolved" &&
      frame.event.payload.interactionId === this.#snapshot.question.interactionId
    ) {
      const payload = frame.event.payload;
      this.#snapshot.phase =
        payload.reasonCode === "provider_accepted"
          ? "answered"
          : payload.reasonCode === "submission_outcome_unknown"
            ? "unknown"
            : "invalidated";
    }
  }

  /** 关闭旁路，不中断模型；原活动交互同步关闭，未知响应不重试。 */
  async cancel(): Promise<void> {
    this.#assertPending();
    this.#snapshot.phase = "cancelled";
    if (!this.#snapshot.completed) {
      try {
        await this.client.respond(this.#snapshot.ref, {
          interactionId: this.#snapshot.question.interactionId,
          outcome: "cancelled"
        });
      } catch (error) {
        if (!(error instanceof KernelError) || error.code !== "INTERACTION_NOT_ACTIVE") throw error;
      }
    }
  }

  /** 整批一次。steer 等待 Provider ACK；new_run 必须消费返回流，沿原 invoke 管理执行。 */
  async respond(value: unknown): Promise<AsyncQuestionReplyResult> {
    this.#assertPending();
    const original = this.#snapshot;
    assertQuestionRequest(original.question.request);
    const answer = structuredClone(value);
    assertQuestionResponse(answer);
    const text = questionAnswerText(original.question.request, answer);
    const next = structuredClone(this.continuation());
    assertInvokeInput(next);
    // 现有会话由宿主显式提供，旧题不能跨 reset 或 Provider binding 改投。
    if (
      next.sessionId !== original.ref.agent_session_id ||
      (next.sessionGeneration ?? 0) !== original.ref.session_generation ||
      next.providerSession?.sessionId !== original.providerSession.sessionId ||
      next.providerSession?.resumable === false ||
      next.providerEpoch !== original.providerEpoch
    )
      throw new KernelError("ASYNC_QUESTION_SESSION_STALE");
    original.phase = "submitting";
    let attempted = false;
    try {
      if (!original.completed) {
        const current = await this.client.get(original.ref, original.ref.kernel_instance_id);
        if (current.terminal) this.observe(current.terminal);
        if (this.snapshot().phase === "invalidated")
          throw new KernelError("INTERACTION_NOT_ACTIVE");
      }
      if (!original.completed) {
        attempted = true;
        try {
          this.#assertNotExpired();
          await this.client.respond(original.ref, {
            interactionId: original.question.interactionId,
            outcome: "answered",
            value: answer
          });
          original.phase = "answered";
          return { route: "steer", acceptance: "provider_accepted" };
        } catch (error) {
          if (
            !(error instanceof KernelError) ||
            !["INTERACTION_NOT_ACTIVE", "ASYNC_ANSWER_REJECTED"].includes(error.code)
          )
            throw error;
          // 仅明确未接纳才可在正常终态之后续跑；ACK 丢失和写后失联绝不进入此分支。
          attempted = false;
          const current = await this.client.get(original.ref, original.ref.kernel_instance_id);
          if (current.terminal) this.observe(current.terminal);
          if (!original.completed) {
            original.phase = "invalidated";
            throw error;
          }
        }
      }
      const input: InvokeInput & { protocol_mode: "canonical" } = {
        ...next,
        runId: randomUUID(),
        invocationId: randomUUID(),
        protocol_mode: "canonical",
        continuityMode: "continue",
        inputs: [{ type: "text", text }],
        prompt: text,
        modelInput: text,
        providerSession: { ...original.providerSession, requireResume: true },
        freshFallbackModelInput: text,
        freshFallbackModelInputParts: [{ type: "text", text }]
      };
      const client = this.client,
        environment = this.environment;
      const beforeInvoke = () => {
        this.#assertNotExpired();
        const currentInput = this.continuation();
        if (
          currentInput.sessionId !== input.sessionId ||
          (currentInput.sessionGeneration ?? 0) !== original.ref.session_generation ||
          currentInput.providerSession?.sessionId !== original.providerSession.sessionId ||
          currentInput.providerEpoch !== original.providerEpoch
        )
          throw new KernelError("ASYNC_QUESTION_SESSION_STALE");
      };
      const events = (async function* () {
        try {
          beforeInvoke();
          for await (const event of client.invoke(input, environment)) {
            if (
              event.type === "session.update" &&
              event.payload.providerSession?.sessionId === original.providerSession.sessionId &&
              event.payload.providerSession.resumeOutcome === "resumed"
            )
              original.phase = "answered";
            yield event;
          }
        } finally {
          if (original.phase === "submitting") original.phase = "unknown";
        }
      })();
      return { route: "new_run", input: structuredClone(input), events };
    } catch (error) {
      if (original.phase === "submitting") original.phase = attempted ? "unknown" : "pending";
      throw error;
    }
  }

  #assertPending(): void {
    const snapshot = this.#snapshot;
    if (snapshot.phase !== "pending") throw new KernelError("INTERACTION_NOT_ACTIVE");
    this.#assertNotExpired();
  }

  #assertNotExpired(): void {
    const expiresAt = this.#snapshot.question.expiresAt;
    if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now())
      throw new KernelError("INTERACTION_NOT_ACTIVE");
  }
}
