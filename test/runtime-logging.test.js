import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLogging } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { ExtraPlugins } from "../packages/octo-runtime-host-sdk/dist/index.js";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest } from "./runtime-fixture.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "octo-metadata-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function records(directory, subdirectory = "") {
  const root = join(directory, subdirectory);
  const names = await readdir(root);
  return (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".log"))
        .map((name) => readFile(join(root, name), "utf8"))
    )
  )
    .join("")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
test("F31 disabled logging creates no files, rejects implicit directories, and never serializes bodies", async (t) => {
  const directory = await fixture(t),
    disabled = new RuntimeLogging();
  disabled.extra("fixture")("info", "fixture.started", { text: "private" });
  await disabled.close();
  assert.deepEqual(await readdir(directory), []);
  assert.throws(() => new RuntimeLogging({ directory: "relative" }), /ABSOLUTE/);
  const logging = new RuntimeLogging({ directory });
  const extras = new ExtraPlugins(
    [
      {
        name: "fixture",
        config: {},
        load: async () => ({
          name: "fixture",
          default: (ctx) => async () => {
            assert.equal(typeof ctx.log, "function");
            ctx.log("info", "fixture.started", {
              extra_type: "forged",
              status: "running",
              token: "bf_secret",
              error: Error("secret"),
              input: "SECRET_INPUT",
              context: { text: "SECRET_CONTEXT" },
              model: "bf_secret"
            });
          }
        })
      }
    ],
    {},
    (name) => logging.extra(name)
  );
  await extras.loadConfigured();
  await extras.close();
  await logging.close();
  const rows = await records(directory, "extras");
  assert.equal(rows[0].extra_type, "fixture");
  assert.equal(rows[0].source, "extra");
  assert.deepEqual(rows[0].data, { status: "running" });
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|bf_secret|forged/);
});
test("F31 kernel lifecycle counts only this input/context and keeps execution independent of logging", async (t) => {
  const directory = await fixture(t),
    logging = new RuntimeLogging({ directory });
  const host = new AgentExecutor({ log: logging.kernel });
  host.register({
    metadata: {
      type: "fixture",
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "fixture.canonical", modes: ["canonical"], nativeMethods: [] }
    },
    async *invoke() {
      yield { protocolVersion: 2, type: "run.completed", payload: { text: "SECRET_REPLY" } };
    }
  });
  const input = {
    inputs: [{ type: "text", text: "SECRET_INPUT" }],
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [
        { namespace: "octo.execution", name: "adapter", payload: { type: "fixture" } },
        { namespace: "extra.im", name: "rules", payload: { text: "SECRET_CONTEXT" } }
      ]
    },
    approvalMode: "full_access",
    sessionId: "session-log",
    invocationId: "invocation-log",
    runId: "run-log",
    protocol_mode: "canonical"
  };
  const events = [];
  for await (const event of host.invoke(input)) events.push(event);
  assert.equal(events.at(-1).type, "run.completed");
  await assert.rejects(async () => {
    for await (const _ of host.invoke({ ...input, invocationId: "bad", inputs: [] })) void _;
  });
  await host.shutdown();
  await logging.close();
  const rows = await records(directory);
  assert.equal(rows.find((row) => row.event === "invoke.received").data.input_count, 1);
  assert.equal(rows.find((row) => row.event === "invoke.received").data.context_count, 1);
  assert.equal(rows.find((row) => row.event === "invoke.finished").data.status, "completed");
  assert.ok(rows.some((row) => row.event === "invoke.rejected"));
  assert.ok(rows.some((row) => row.event === "invoke.started"));
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|payload|instructions/);
  const failing = new AgentExecutor({
    log: () => {
      throw Error("disk unavailable");
    }
  });
  await assert.rejects(
    async () => {
      for await (const _ of failing.invoke({ ...input, inputs: [] })) void _;
    },
    (error) => !String(error).includes("disk unavailable")
  );
});
test("F31 log queue is bounded and filesystem failure does not reach callers", async (t) => {
  const directory = await fixture(t),
    logging = new RuntimeLogging({ directory });
  for (let i = 0; i < 10000; i++) logging.kernel("info", "fixture.burst", { attempt: i });
  await logging.close();
  assert.ok((await records(directory)).length <= 128);
  const blocked = join(directory, "blocked");
  await writeFile(blocked, "file");
  const failed = new RuntimeLogging({ directory: blocked });
  failed.kernel("error", "fixture.failure", { code: "DISK_FAILED" });
  await failed.close();
});

test("shared runtime diagnostics retain safe process facts and reject provider bodies", async (t) => {
  const directory = await fixture(t);
  const logging = new RuntimeLogging({ directory });
  logging.kernel("error", "fixture.native", {
    reason_code: "PROVIDER_MESSAGE_TOO_LARGE",
    native_code: -32000,
    primary_code: "EPIPE",
    cleanup_code: "EPERM",
    signal: "SIGTERM",
    request_id: 7,
    pid: 123,
    exit_code: 23,
    message: "SECRET_PROVIDER_BODY",
    stderr: "SECRET_PROVIDER_STDERR"
  });
  logging.kernel("error", "fixture.invalid", {
    native_code: -0.5,
    pid: -1,
    exit_code: Infinity,
    reason_code: "Bearer-secret"
  });
  await logging.close();
  const rows = await records(directory);
  assert.deepEqual(rows[0].data, {
    reason_code: "PROVIDER_MESSAGE_TOO_LARGE",
    native_code: -32000,
    primary_code: "EPIPE",
    cleanup_code: "EPERM",
    signal: "SIGTERM",
    request_id: 7,
    pid: 123,
    exit_code: 23
  });
  assert.deepEqual(rows[1].data, {});
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|Bearer/);
});

test("Core provides the shared adapter log sink and records the canonical failure reason", async () => {
  const logs = [];
  const core = new AgentExecutor({ log: (...entry) => logs.push(entry) });
  core.register({
    metadata: {
      type: "fixture",
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "fixture.canonical", modes: ["canonical"], nativeMethods: [] }
    },
    async *invoke(_request, context) {
      context.log("error", "fixture.native", { native_code: -32000 });
      yield {
        protocolVersion: 2,
        type: "run.failed",
        payload: { code: "PROVIDER_MESSAGE_TOO_LARGE", message: "fixture capacity" }
      };
    }
  });
  try {
    const events = await Array.fromAsync(
      core.invoke(
        invocationInput(invokeRequest({ approvalMode: "full_access" }), "canonical", "fixture")
      )
    );
    const failure = events.at(-1).payload.failure;
    assert.equal(events.at(-1).type, "run.failed");
    assert.equal(failure.reasonCode, "PROVIDER_MESSAGE_TOO_LARGE");
    assert.equal(logs.find((entry) => entry[1] === "fixture.native")[2].native_code, -32000);
    assert.equal(
      logs.find((entry) => entry[1] === "invoke.failed")[2].reason_code,
      failure.reasonCode
    );
  } finally {
    await core.shutdown();
  }
});
