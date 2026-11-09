import { invokeClient } from "../../test-support/invoke-client.js";
// 显式 non-gating：真实 Codex Default，原 Run 结束后由同一表单补答。
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOwnedCodexAdapter as createCodexAdapter } from "../../test-support/scoped-codex-adapter.mjs";
import { AsyncQuestionReply } from "../../dist/public/executor-kernel.js";
import { invocationInput } from "../../packages/octo-runtime-protocol/dist/index.js";
import { kernelFixture } from "../kernel-fixture.js";
import { invokeRequest } from "../runtime-fixture.js";

for (const custom of [false, true])
  test(
    `real Default late ${custom ? "custom" : "selected"} answer starts a new Run`,
    { timeout: 180000 },
    async (t) => {
      const f = await kernelFixture(t, {
        // 真实专项由宿主选择 Provider，Kernel 只接收已构造的对象。
        adapters: [createCodexAdapter()]
      });
      const marker = `LATE_${randomUUID().replaceAll("-", "")}`;
      const prompt = `Local async-input test. Invoke request_user_input_async with exactly one question titled "Test color?" and options ["${marker}", "Green"]. After publishing the question, finish this turn immediately with "Original turn complete". Do not wait for an answer. In a later turn, when supplemental answers arrive, repeat the exact supplied answer including the complete LATE marker. No file edits or network requests. Use Default mode, no synchronous question.`;
      const input = invocationInput(
        invokeRequest({
          runId: randomUUID(),
          invocationId: randomUUID(),
          workdir: f.directory,
          prompt,
          modelInput: prompt,
          approvalMode: "full_access"
        }),
        "canonical",
        "codex"
      );
      let question, ref, providerSession, terminal;
      for await (const event of invokeClient(f.client, input)) {
        if (event.type === "session.update") providerSession = event.payload.providerSession;
        if (event.type === "interaction.requested" && event.payload.delivery === "async") {
          question = event.payload;
          ref = f.client.invocations
            .snapshot()
            .find((r) => r.ref?.invocation_id === input.invocationId)?.ref;
        }
        if (
          event.type === "interaction.resolved" &&
          event.payload.interactionId === question?.interactionId
        )
          assert.fail("unanswered normal completion must not invalidate the form");
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
          terminal = event.type;
      }
      assert.equal(terminal, "run.completed");
      assert.ok(question && ref && providerSession);
      assert.equal(question.request.questions.length, 1);
      assert.ok(question.request.questions[0].options.includes(marker));
      const reply = new AsyncQuestionReply(
        f.client,
        {
          schema: "octo.async-question-reply/v1",
          ref,
          question,
          providerSession,
          completed: false,
          phase: "pending"
        },
        () => ({ ...input, sessionId: ref.agent_session_id, providerSession })
      );
      reply.observe((await f.client.get(ref, ref.kernel_instance_id)).terminal);
      const answer = custom ? `${marker}_CUSTOM` : marker;
      const result = await reply.respond({
        schema: "octo.question-response/v1",
        answers: [{ questionId: "q:0", text: answer }]
      });
      assert.equal(result.route, "new_run");
      assert.notEqual(result.input.runId, ref.run_id);
      let resumed = false,
        consumed = false;
      for await (const event of result.events) {
        if (event.type === "session.update")
          resumed =
            event.payload.providerSession.sessionId === providerSession.sessionId &&
            event.payload.providerSession.resumeOutcome === "resumed";
        if (
          event.type === "message.update" &&
          event.payload.role === "assistant" &&
          event.payload.delivery !== "async" &&
          event.payload.text?.includes(answer)
        )
          consumed = true;
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
          terminal = event.type;
      }
      assert.equal(resumed, true);
      assert.equal(consumed, true);
      assert.equal(terminal, "run.completed");
      assert.equal(reply.snapshot().phase, "answered");
      console.log(
        JSON.stringify({
          custom,
          route: result.route,
          sameProviderSession: resumed,
          modelConsumed: consumed,
          terminal
        })
      );
    }
  );
