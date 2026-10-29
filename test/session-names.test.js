import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { InvokeInput, assertInvokeRequest } from "@mininglamp-oss/octo-runtime-protocol";
import { buildClaudeCommand } from "@mininglamp-oss/octo-runtime-adapter-claude-code";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import { invokeRequest } from "./runtime-fixture.js";

test("sessionName validators and wire schemas agree on bounded caller-owned display names", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../packages/octo-runtime-protocol/schema/protocol.schema.json", import.meta.url)
    )
  );
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema);
  const input = {
    inputs: [{ type: "text", text: "hello" }],
    contexts: { schema: "octo.context-envelope/v3", items: [] }
  };
  const cases = JSON.parse(
    readFileSync(
      new URL(
        "../packages/octo-runtime-protocol/schema/session-name-fixtures.json",
        import.meta.url
      )
    )
  );
  for (const { name, sessionName, valid } of cases) {
    for (const [definition, value, check] of [
      [
        "InvokeInputWire",
        { ...input, ...(sessionName === undefined ? {} : { sessionName }) },
        InvokeInput.check
      ],
      [
        "InvokeRequestWire",
        invokeRequest({ ...(sessionName === undefined ? {} : { sessionName }) }),
        assertInvokeRequest
      ]
    ]) {
      const validate = ajv.getSchema(`${schema.$id}#/definitions/${definition}`);
      assert.equal(
        validate(JSON.parse(JSON.stringify(value))),
        valid,
        `${name}: ${JSON.stringify(validate.errors)}`
      );
      if (valid) assert.doesNotThrow(() => check(value));
      else assert.throws(() => check(value), /sessionName/);
    }
  }
});

test("Claude uses --name only on fresh sessions and preserves opaque --resume", async () => {
  for (const providerSession of [undefined, { sessionId: "opaque-native-uuid", resumable: true }]) {
    const spec = await buildClaudeCommand(
      invokeRequest({
        sessionName: "octo-dm-caller-name",
        ...(providerSession ? { providerSession } : {})
      })
    );
    try {
      assert.equal(spec.args.includes("--name"), !providerSession);
      assert.equal(spec.args.includes("--resume"), !!providerSession);
      if (providerSession)
        assert.equal(spec.args[spec.args.indexOf("--resume") + 1], providerSession.sessionId);
      else assert.equal(spec.args[spec.args.indexOf("--name") + 1], "octo-dm-caller-name");
      assert.ok(!spec.input.includes("octo-dm-caller-name"));
    } finally {
      await spec.cleanup();
    }
  }
});

test("ACP preserves load/new IDs independently of names and reports an unsupported fresh title", async () => {
  const calls = [];
  let counter = 0;
  const adapter = createAcpAdapter(
    { type: "name-acp", provider: "name-acp", command: "fixture" },
    {
      acpClientFactory: () => ({
        initialize: async () => ({}),
        reserveRequestId: () => ++counter,
        async request(method, params) {
          calls.push({ method, params });
          return method === "session/new" ? { sessionId: "opaque-acp-id" } : {};
        },
        async *prompt() {
          yield { sessionUpdate: "agent_message_chunk", content: { text: "done" } };
          yield { type: "prompt_result", stopReason: "end_turn" };
        },
        cancel() {},
        close: async () => {}
      })
    }
  );
  for (const resumed of [false, true]) {
    const events = [];
    for await (const event of adapter.invoke(
      invokeRequest({
        sessionName: resumed ? "changed-title" : "readable-title",
        ...(resumed ? { providerSession: { sessionId: "opaque-acp-id" } } : {})
      })
    ))
      events.push(event);
    assert.equal(events.at(-1).type, "run.completed");
    assert.equal(
      events.find((event) => event.type === "session.update").payload.providerSession.sessionId,
      "opaque-acp-id"
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === "run.notice" &&
          event.payload.params.category === "session_name_unsupported"
      ),
      !resumed
    );
  }
  assert.deepEqual(
    calls.map((call) => call.method),
    ["session/new", "session/load"]
  );
  assert.equal(calls[1].params.sessionId, "opaque-acp-id");
  assert.ok(!JSON.stringify(calls).includes("title"));
});
