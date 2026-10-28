import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { assertJsonValue } from "../packages/octo-runtime-protocol/dist/context.js";
import { failureMessage } from "../packages/octo-runtime-protocol/dist/index.js";
import { invokeRequest } from "./runtime-fixture.js";
import { frames, kernelFixture, kernelInput } from "./kernel-fixture.js";
import {
  answer,
  codeBuddyFixture,
  endTurn,
  scenarios,
  subscriptionResult
} from "./fixtures/codebuddy-fixture.js";

async function collect(source) {
  const values = [];
  for await (const value of source) values.push(value);
  return values;
}

const terminals = (events) =>
  events.filter((e) => /^run\.(completed|failed|cancelled)$/.test(e.type));
const sessionEvent = (events) =>
  events.find((e) => e.type === "session.update").payload.providerSession;
const selection = [
  { namespace: "octo.execution", name: "adapter", payload: { type: "codebuddy" } }
];
const acpFailureMessage = (meta) => `${failureMessage("OH-PRV-4010")}\n${JSON.stringify(meta)}`;

for (const fields of [{ agentConfig: {} }, { agentConfig: { model: "requested-model" } }]) {
  for (const resume of [false, true]) {
    test(`CodeBuddy JSON-safe unknown model receipt (${JSON.stringify(fields)}, resume=${resume})`, async () => {
      const f = codeBuddyFixture();
      const req = invokeRequest({
        ...fields,
        ...(resume ? { providerSession: { sessionId: "resumed" } } : {})
      });
      const events = await collect(f.adapter.invoke(req));
      for (const event of events) assertJsonValue(event.payload);
      assert.deepEqual(sessionEvent(events), {
        sessionId: resume ? "resumed" : "fixture-session",
        resumable: true
      });
      assert.equal(f.state.promptCalls, 1);
      assert.equal(f.state.closes, 1);
      assert.equal(f.state.calls[0].method, resume ? "session/load" : "session/new");
      assert.equal(f.state.calls[0].params.model, resume ? undefined : fields.agentConfig?.model);
    });
  }
}

for (const model of [
  { model: "confirmed-model" },
  { models: { currentModelId: "confirmed-model" } },
  { configOptions: [{ id: "model", currentValue: "confirmed-model" }] },
  { configOptions: [{ id: "selected-model", category: "model", currentValue: "confirmed-model" }] }
]) {
  for (const resume of [false, true]) {
    test(`CodeBuddy reports confirmed model (${JSON.stringify(model)}, resume=${resume})`, async () => {
      const f = codeBuddyFixture({ sessionResult: { sessionId: "fixture-session", ...model } });
      const events = await collect(
        f.adapter.invoke(
          invokeRequest({
            agentConfig: { model: "unapplied-request" },
            ...(resume ? { providerSession: { sessionId: "resumed", model: "stale-model" } } : {})
          })
        )
      );
      assert.equal(sessionEvent(events).model, "confirmed-model");
      assert.equal(f.state.calls.length, 1);
    });
  }
}

for (const [name, updates] of Object.entries(scenarios)) {
  test(`CodeBuddy Core validates ${name} and preserves its terminal`, async () => {
    const f = codeBuddyFixture({ updates });
    const executor = new AgentExecutor();
    executor.register(f.adapter);
    try {
      const values = await collect(
        executor.invokeFrames({
          inputs: [{ type: "text", text: "who are you" }],
          contexts: { schema: "octo.context-envelope/v3", items: selection },
          protocol_mode: "canonical"
        })
      );
      const events = values.filter((v) => v.kind === "canonical").map((v) => v.event);
      const expected =
        name === "success" ? "completed" : name === "cancelled" ? "cancelled" : "failed";
      assert.equal(values.at(-1).control.state, expected, JSON.stringify(values));
      assert.deepEqual(
        terminals(events).map((e) => e.type),
        [`run.${expected}`]
      );
      assert.equal(
        values.some((v) => v.kind === "control" && v.control.type === "error"),
        false
      );
      if (["subscription", "partial"].includes(name)) {
        const payload = terminals(events)[0].payload;
        assert.equal(payload.message, acpFailureMessage(subscriptionResult._meta));
        assert.equal(payload.code, "ACP_MODEL_REQUEST_FAILED");
        assert.equal(payload.providerError, undefined);
        assert.equal(payload.failure.code, "OH-PRV-4010");
        assert.equal(payload.failure.retryable, false);
        assert.equal(payload.failure.cause.httpStatus, undefined);
      }
      if (["empty", "reasoning", "toolOnly", "whitespace"].includes(name))
        assert.equal(terminals(events)[0].payload.code, "ACP_NO_FINAL_OUTPUT");
    } finally {
      assert.equal((await executor.shutdown()).cleanup, "complete");
    }
    assert.equal(f.state.closes, 1);
  });
}

for (const errorMessage of [
  undefined,
  "{broken",
  "null",
  "[]",
  "42",
  { message: "Request rejected", data: { statusCode: 403 } }
]) {
  test(`CodeBuddy provider failure survives malformed metadata (${JSON.stringify(errorMessage)})`, async () => {
    const result = {
      ...subscriptionResult,
      _meta: {
        "codebuddy.ai/outcome": "FAILED_MODEL_REQUEST",
        ...(errorMessage === undefined ? {} : { "codebuddy.ai/errorMessage": errorMessage })
      }
    };
    const f = codeBuddyFixture({ updates: [answer, result] });
    const events = await collect(f.adapter.invoke(invokeRequest()));
    assert.deepEqual(
      terminals(events).map((e) => e.type),
      ["run.failed"]
    );
    assert.equal(events.at(-1).payload.message, acpFailureMessage(result._meta));
    for (const event of events) assertJsonValue(event.payload);
    assert.equal(f.state.closes, 1);
  });
}

test("CodeBuddy preserves the original metadata without parsing, redaction or field selection", async () => {
  const secret = randomUUID();
  const f = codeBuddyFixture({
    updates: [
      {
        ...subscriptionResult,
        _meta: {
          "codebuddy.ai/outcome": "FAILED_MODEL_REQUEST",
          "codebuddy.ai/errorMessage": JSON.stringify({
            code: -32003,
            message: `Quota exceeded; token=${secret}`,
            headers: { authorization: secret },
            data: {
              statusCode: 429,
              code: 14015,
              category: "quota",
              request: { body: secret },
              details: secret
            }
          }),
          privateMetadata: secret
        }
      }
    ]
  });
  const events = await collect(f.adapter.invoke(invokeRequest()));
  const expected = {
    "codebuddy.ai/outcome": "FAILED_MODEL_REQUEST",
    "codebuddy.ai/errorMessage": JSON.stringify({
      code: -32003,
      message: `Quota exceeded; token=${secret}`,
      headers: { authorization: secret },
      data: {
        statusCode: 429,
        code: 14015,
        category: "quota",
        request: { body: secret },
        details: secret
      }
    }),
    privateMetadata: secret
  };
  assert.equal(events.at(-1).payload.message, acpFailureMessage(expected));
  assert.equal(events.at(-1).payload.providerError, undefined);
});

for (const stopReason of [42, {}, null]) {
  test(`CodeBuddy malformed stopReason still emits an ACP failure (${JSON.stringify(stopReason)})`, async () => {
    const update = { ...subscriptionResult, stopReason };
    const f = codeBuddyFixture({ updates: [answer, update] });
    const executor = new AgentExecutor();
    executor.register(f.adapter);
    try {
      const values = await collect(
        executor.invokeFrames({
          inputs: [{ type: "text", text: "hello" }],
          contexts: { schema: "octo.context-envelope/v3", items: selection },
          protocol_mode: "canonical"
        })
      );
      const events = values.filter((v) => v.kind === "canonical").map((v) => v.event);
      assert.equal(values.at(-1).control.state, "failed");
      assert.equal(
        values.some((v) => v.kind === "control" && v.control.type === "error"),
        false
      );
      assert.deepEqual(
        terminals(events).map((e) => e.type),
        ["run.failed"]
      );
      assert.equal(terminals(events)[0].payload.message, acpFailureMessage(update._meta));
      assert.equal(terminals(events)[0].payload.failure.code, "OH-PRV-4010");
    } finally {
      assert.equal((await executor.shutdown()).cleanup, "complete");
    }
    assert.equal(f.state.closes, 1);
  });
}

test("CodeBuddy Core keeps raw metadata strings and unknown fields byte-for-byte", async () => {
  const value = randomUUID();
  for (const meta of [
    undefined,
    null,
    [value, { token: value }],
    value,
    {
      "codebuddy.ai/errorMessage": ` {"token":"${value}","unknown":true} \n`,
      token: value,
      opaque: { arbitrary: [value, null, true], authorization: `Bearer ${value}` }
    }
  ]) {
    const executor = new AgentExecutor();
    executor.register(
      codeBuddyFixture({ updates: [{ type: "prompt_result", stopReason: "refusal", _meta: meta }] })
        .adapter
    );
    try {
      const events = await collect(
        executor.invoke({
          inputs: [{ type: "text", text: "hello" }],
          contexts: { schema: "octo.context-envelope/v3", items: selection },
          protocol_mode: "canonical"
        })
      );
      assert.equal(events.at(-1).type, "run.failed");
      assert.equal(events.at(-1).payload.message, acpFailureMessage(meta));
      assert.equal(events.at(-1).payload.failure.code, "OH-PRV-4010");
    } finally {
      assert.equal((await executor.shutdown()).cleanup, "complete");
    }
  }
});

test("CodeBuddy successful responses may carry metadata without becoming failures", async () => {
  const meta = { "codebuddy.ai/outcome": "SUCCESS", trace: { native: true } };
  const events = await collect(
    codeBuddyFixture({ updates: [answer, { ...endTurn, _meta: meta }] }).adapter.invoke(
      invokeRequest()
    )
  );
  assert.deepEqual(
    terminals(events).map((e) => e.type),
    ["run.completed"]
  );
});

for (const updates of [
  [{ type: "prompt_result", stopReason: "refusal" }],
  [
    {
      type: "prompt_result",
      stopReason: "end_turn",
      _meta: { "codebuddy.ai/outcome": "FAILED_MODEL_REQUEST" }
    }
  ],
  [
    {
      type: "prompt_result",
      stopReason: "end_turn",
      _meta: {
        "codebuddy.ai/errorMessage": JSON.stringify({ message: "Provider rejected request" })
      }
    }
  ]
]) {
  test(`CodeBuddy failure signals cannot complete (${JSON.stringify(updates)})`, async () => {
    const events = await collect(codeBuddyFixture({ updates }).adapter.invoke(invokeRequest()));
    assert.deepEqual(
      terminals(events).map((e) => e.type),
      ["run.failed"]
    );
    assert.notEqual(events.at(-1).payload.code, "ACP_NO_FINAL_OUTPUT");
  });
}

test("CodeBuddy result-body text fills missing final output without duplicating streamed text", async () => {
  for (const content of [
    "result answer",
    { text: "result answer" },
    [{ type: "text", text: "result answer" }]
  ]) {
    for (const streamed of [false, true]) {
      const updates = [...(streamed ? [answer] : []), { ...endTurn, content }];
      const events = await collect(codeBuddyFixture({ updates }).adapter.invoke(invokeRequest()));
      assert.equal(events.at(-1).type, "run.completed");
      assert.deepEqual(
        events.filter((e) => e.type === "message.delta").map((e) => e.payload.text),
        [streamed ? "Hello" : "result answer"]
      );
    }
  }
});

test("CodeBuddy failure closes running tool and model step without a success terminal", async () => {
  const events = await collect(
    codeBuddyFixture({
      updates: [
        { sessionUpdate: "agent_thought_chunk", content: { text: "Thinking" } },
        { sessionUpdate: "tool_call", toolCallId: "tool", name: "read", input: {} },
        subscriptionResult
      ]
    }).adapter.invoke(invokeRequest())
  );
  assert.deepEqual(
    terminals(events).map((e) => e.type),
    ["run.failed"]
  );
  assert.ok(events.some((e) => e.type === "tool_call.update" && e.payload.status === "failed"));
  assert.ok(events.some((e) => e.type === "model_step.finished" && e.payload.status === "failed"));
});

test("CodeBuddy Kernel public submit/subscribe and invoke preserve default and failed outcomes", async (t) => {
  const { client } = await kernelFixture(t, {
    workerEntrypoint: resolve("test/fixtures/codebuddy-worker.mjs")
  });
  for (const [scenario, expected] of [
    ["success", "completed"],
    ["subscription", "failed"],
    ["partial", "failed"],
    ["empty", "failed"],
    ["reasoning", "failed"],
    ["rawMeta", "failed"],
    ["malformedStopReason", "failed"],
    ["cancelled", "cancelled"]
  ]) {
    const makeInput = () => ({
      ...kernelInput(`fixture:${scenario}`),
      inputs: [{ type: "text", text: `fixture:${scenario}` }],
      modelInput: `fixture:${scenario}`,
      contexts: { schema: "octo.context-envelope/v3", items: selection }
    });
    const { ref } = await client.submit(makeInput());
    const source = await frames(client, ref);
    assert.equal(source.at(-1).control.state, expected, JSON.stringify(source));
    const events = source.filter((v) => v.kind === "canonical").map((v) => v.event);
    assert.deepEqual(
      terminals(events).map((e) => e.type),
      [`run.${expected}`]
    );
    assert.equal((await client.get(ref)).terminal.control.state, expected);
    const canonical = await collect(client.invoke(makeInput()));
    assert.deepEqual(
      terminals(canonical).map((e) => e.type),
      [`run.${expected}`]
    );
    if (["subscription", "partial"].includes(scenario)) {
      for (const result of [terminals(events)[0], terminals(canonical)[0]]) {
        assert.equal(result.payload.message, acpFailureMessage(subscriptionResult._meta));
        assert.equal(result.payload.code, "ACP_MODEL_REQUEST_FAILED");
        assert.equal(result.payload.providerError, undefined);
        assert.equal(result.payload.failure.code, "OH-PRV-4010");
        assert.equal(result.payload.failure.retryable, false);
      }
    }
    if (scenario === "rawMeta") {
      for (const result of [terminals(events)[0], terminals(canonical)[0]]) {
        const prefix = `${failureMessage("OH-PRV-4010")}\n`;
        assert.ok(result.payload.message.startsWith(prefix));
        const meta = JSON.parse(result.payload.message.slice(prefix.length));
        assert.match(meta.token, /^[0-9a-f-]{36}$/);
        assert.equal(meta.arbitrary.request.headers.authorization, `Bearer ${meta.token}`);
        assert.equal(meta["codebuddy.ai/errorMessage"], ` {"password":"${meta.token}"} \n`);
        assert.equal(result.payload.message, acpFailureMessage(meta));
      }
    }
    if (scenario === "malformedStopReason") {
      assert.equal(terminals(canonical)[0].payload.code, "ACP_MODEL_REQUEST_FAILED");
      assert.equal(terminals(canonical)[0].payload.failure.code, "OH-PRV-4010");
    }
  }
});

test("CodeBuddy public default/empty/explicit model requests reach the prompt", async () => {
  for (const config of [{}, { agentConfig: {} }, { agentConfig: { model: "explicit-model" } }]) {
    const f = codeBuddyFixture();
    const executor = new AgentExecutor();
    executor.register(f.adapter);
    try {
      const events = await collect(
        executor.invoke({
          inputs: [{ type: "text", text: "hello" }],
          contexts: { schema: "octo.context-envelope/v3", items: selection },
          protocol_mode: "canonical",
          ...config
        })
      );
      assert.equal(events.at(-1).type, "run.completed");
      assert.equal(f.state.promptCalls, 1);
    } finally {
      assert.equal((await executor.shutdown()).cleanup, "complete");
    }
  }
});

test("CodeBuddy 429 and quota metadata use the same explicit ACP failure code", async () => {
  for (const quota of [false, true]) {
    const f = codeBuddyFixture({
      updates: [
        {
          type: "prompt_result",
          stopReason: "refusal",
          _meta: {
            "codebuddy.ai/errorMessage": JSON.stringify({
              message: "Request rejected",
              data: { statusCode: 429, category: quota ? "quota" : "rate_limit" }
            })
          }
        }
      ]
    });
    const executor = new AgentExecutor();
    executor.register(f.adapter);
    try {
      const events = await collect(
        executor.invoke({
          inputs: [{ type: "text", text: "hello" }],
          contexts: { schema: "octo.context-envelope/v3", items: selection },
          protocol_mode: "canonical"
        })
      );
      assert.equal(events.at(-1).type, "run.failed");
      assert.equal(events.at(-1).payload.code, "ACP_MODEL_REQUEST_FAILED");
      assert.equal(events.at(-1).payload.failure.code, "OH-PRV-4010");
      assert.equal(events.at(-1).payload.failure.retryable, false);
    } finally {
      assert.equal((await executor.shutdown()).cleanup, "complete");
    }
  }
});

test("CodeBuddy cancellation keeps its terminal unless a provider failure was declared", async () => {
  for (const failed of [false, true]) {
    const controller = new AbortController();
    const updates = failed
      ? [{ ...subscriptionResult, stopReason: "cancelled", text: "not a successful answer" }]
      : scenarios.cancelled;
    const f = codeBuddyFixture({ updates });
    controller.abort("stop");
    const events = await collect(f.adapter.invoke(invokeRequest({ signal: controller.signal })));
    assert.deepEqual(
      terminals(events).map((e) => e.type),
      [failed ? "run.failed" : "run.cancelled"]
    );
    assert.equal(
      events.some((e) => e.type === "message.delta"),
      false
    );
  }
});

test("CodeBuddy usage without optional model remains JSON-safe", async () => {
  const events = await collect(
    codeBuddyFixture({
      updates: [{ type: "usage", usage: { inputTokens: 3 } }, answer, endTurn]
    }).adapter.invoke(invokeRequest())
  );
  for (const event of events) assertJsonValue(event.payload);
});
