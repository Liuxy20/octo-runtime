// 显式本地运行：node --experimental-transform-types --test test/manual/codex-async-webui.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { RawRunPresentation } from "../../packages/octo-runtime-extra-webui/web/src/shared/raw-presentation.ts";

function fixture() {
  const presentation = new RawRunPresentation("run");
  let seq = 0;
  return {
    presentation,
    receive(type, payload = {}) {
      seq++;
      return presentation.receive({
        jsonrpc: "2.0",
        method: "agent_run.event",
        params: {
          run_id: "run",
          stream_id: "stream",
          seq,
          event: { run_id: "run", seq, type, payload }
        }
      });
    }
  };
}

for (const kind of [undefined, "question", "approval", "elicitation"])
  test(`WebUI ignores async controls while preserving text and existing ${kind ?? "execution"}`, () => {
    const { presentation, receive } = fixture();
    receive("run.started");
    if (kind)
      receive("interaction.requested", {
        interactionId: "sync",
        kind,
        request: { question: "Existing input" },
        expiresAt: new Date(Date.now() + 60000).toISOString()
      });
    for (const expiresAt of [undefined, new Date(Date.now() + 60000).toISOString()])
      assert.equal(
        receive("interaction.requested", {
          interactionId: "async",
          kind: "question",
          delivery: "async",
          ...(expiresAt ? { expiresAt } : {}),
          request: {
            schema: "octo.question-request/v1",
            messageId: "native",
            questions: [
              { id: "q:0", title: "Optional question?", options: null, allowCustom: true }
            ]
          }
        }),
        undefined
      );
    assert.equal(
      receive("interaction.resolved", {
        interactionId: "async",
        status: "invalidated",
        reasonCode: "run_terminal"
      }),
      undefined
    );
    const controls = presentation.snapshot().payload.interactions;
    assert.equal(controls.length, kind ? 1 : 0);
    if (kind) {
      assert.equal(controls[0].status, "pending");
      assert.equal(controls[0].actionable, true);
      assert.equal(controls[0].kind, kind);
      assert.equal(
        receive("interaction.resolved", {
          interactionId: "sync",
          status: "resolved",
          outcome: "answered"
        }).type,
        "interaction.upsert"
      );
    }
    const text = receive("message.update", {
      messageId: "native",
      channel: "final",
      delivery: "async",
      text: "Optional question?"
    });
    assert.equal(text.type, "text.commit");
    assert.equal(text.payload.text, "Optional question?");
    receive("run.completed");
    assert.equal(presentation.snapshot().payload.run.status, "completed");
    assert.equal(presentation.after, kind ? 8 : 6, "ignored controls still advance the cursor");
  });

test("WebUI ignored async identities remain bounded per Run", () => {
  const { receive } = fixture();
  for (let index = 0; index < 128; index++)
    receive("interaction.requested", { interactionId: String(index), delivery: "async" });
  assert.throws(
    () =>
      receive("interaction.requested", {
        interactionId: "overflow",
        delivery: "async"
      }),
    /PRODUCT_PRESENTATION_CAPACITY_EXHAUSTED/
  );
});
