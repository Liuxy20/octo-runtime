// 显式手动运行：pnpm build && node --test test/manual/codex-async-live.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { invocationInput } from "../../packages/octo-runtime-protocol/dist/index.js";
import { kernelFixture } from "../kernel-fixture.js";
import { invokeRequest } from "../runtime-fixture.js";

for (const custom of [false, true]) {
  test(
    `real Codex Default canonical form and ${custom ? "custom" : "selected"} answer`,
    { timeout: 150000 },
    async (t) => {
      const f = await kernelFixture(t, {
        manifest: undefined,
        adapterModules: [
          {
            type: "codex",
            module: resolve("packages/octo-runtime-adapter-codex/dist/index.js"),
            export: "default"
          }
        ]
      });
      const marker = `ASYNC_${randomUUID().replaceAll("-", "")}`;
      const prompt = `This is a local async-input test. Invoke request_user_input_async with exactly one question, title "Test color?", and options ["${marker}", "Green"]. Then run a shell command sleeping for 8 seconds to keep the turn active. After that, report the exact answer you receive, including its full ASYNC marker. Do not edit files or make network requests. Do not ask a synchronous question. Use Default mode.`;
      const request = invokeRequest({
        runId: randomUUID(),
        invocationId: randomUUID(),
        workdir: f.directory,
        prompt,
        modelInput: prompt,
        approvalMode: "full_access"
      });
      const input = invocationInput(request, "canonical", "codex");
      let answer,
        question,
        accepted = false,
        consumed = false,
        terminal;
      for await (const event of f.client.invoke(input)) {
        if (event.type === "interaction.requested" && event.payload.kind === "question") {
          question = event.payload;
          assert.equal(question.delivery, "async");
          assert.equal(question.request.schema, "octo.question-request/v1");
          // 用公开结构构造表单字段；不解析 Markdown。
          const fields = question.request.questions.map((q) => ({
            label: q.title,
            choices: q.options,
            custom: q.allowCustom
          }));
          assert.equal(fields.length, 1);
          assert.ok(fields[0].choices.includes(marker));
          assert.equal(fields[0].custom, true);
          answer = custom ? `${marker}_CUSTOM` : marker;
          await f.client.respondInteraction(input.invocationId, {
            interactionId: question.interactionId,
            outcome: "answered",
            value: {
              schema: "octo.question-response/v1",
              answers: [{ questionId: question.request.questions[0].id, text: answer }]
            }
          });
        }
        if (
          event.type === "interaction.resolved" &&
          event.payload.interactionId === question?.interactionId
        ) {
          accepted =
            event.payload.reasonCode === "provider_accepted" &&
            event.payload.outcome === "answered";
        }
        if (
          event.type === "message.update" &&
          event.payload.role === "assistant" &&
          event.payload.delivery !== "async" &&
          answer &&
          event.payload.text?.includes(answer)
        )
          consumed = true;
        if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
          terminal = event.type;
      }
      assert.ok(question, "native async structured question required");
      assert.ok(accepted, "matching provider acceptance required");
      assert.ok(consumed, "model must repeat delivered answer");
      assert.equal(terminal, "run.completed");
      console.log(
        JSON.stringify({
          custom,
          structuredForm: true,
          providerAccepted: accepted,
          modelConsumed: consumed,
          terminal
        })
      );
    }
  );
}
