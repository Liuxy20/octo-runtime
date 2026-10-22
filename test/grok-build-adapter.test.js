import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnGrokBuildAcpClient as spawnAcpClient } from "../packages/octo-runtime-adapter-grok-build/dist/client.js";
import { spawnAcpClient as spawnStandardAcpClient } from "@mininglamp-oss/octo-runtime-acp-client";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";
import {
  createGrokBuildAdapter,
  grokBuildAdapter
} from "@mininglamp-oss/octo-runtime-adapter-grok-build";
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { preparedFrames, invokeRequest } from "./runtime-fixture.js";

const fixturePath = new URL("./fixtures/grok-build-acp-host.mjs", import.meta.url).pathname;
const base = () =>
  invokeRequest({
    approvalMode: "ask",
    controlInstructions: "CONTROL_95",
    modelInput: "hello",
    agentConfig: {}
  });
async function fixture(t, mode = "success", { cleanupFailure = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "octo-grok-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const trace = join(directory, "trace.jsonl");
  const spawns = [];
  const adapter = createGrokBuildAdapter({
    acpClientFactory(options) {
      spawns.push(options);
      const client = spawnAcpClient({
        ...options,
        command: process.execPath,
        args: [fixturePath],
        env: {
          ...options.env,
          OCTO_GROK_FIXTURE: options.env?.OCTO_GROK_FIXTURE ?? mode,
          OCTO_GROK_TRACE: trace
        }
      });
      if (cleanupFailure) {
        const close = client.close.bind(client);
        client.close = async () => {
          await close();
          throw new Error("GROK_TEST_CLEANUP_FAILED");
        };
      }
      return client;
    }
  });
  return {
    adapter,
    directory,
    spawns,
    async trace() {
      return (await readFile(trace, "utf8")).trim().split("\n").map(JSON.parse);
    }
  };
}
async function collect(adapter, request = base()) {
  return Array.fromAsync(adapter.invoke(request));
}
const terminal = (events) =>
  events.filter((event) => ["run.completed", "run.failed", "run.cancelled"].includes(event.type));

test("Grok canonical registration, streaming, native tools, usage, cwd, environment and system rules", async (t) => {
  const f = await fixture(t);
  const request = {
    ...base(),
    workdir: f.directory,
    executionEnvOverrides: {
      env_variables: [
        { key: "OCTO_TEST_VALUE", value: "run-value" },
        { key: "OCTO_TEST_SECRET", value: "secret-canary-95" }
      ]
    }
  };
  const events = await collect(f.adapter, request);
  assert.deepEqual(grokBuildAdapter.metadata.protocolSupport.modes, ["canonical"]);
  assert.deepEqual(
    terminal(events).map((event) => event.type),
    ["run.completed"]
  );
  assert.equal(
    events
      .filter((event) => event.type === "message.delta" && event.payload.channel === "final")
      .map((event) => event.payload.text)
      .join(""),
    "OCTO_GROK_95"
  );
  assert.ok(
    events.some((event) => event.type === "message.delta" && event.payload.channel === "analysis")
  );
  assert.ok(events.some((event) => event.type === "tool_call.create"));
  assert.ok(
    events.some(
      (event) => event.type === "tool_call.update" && event.payload.status === "completed"
    )
  );
  assert.equal(events.find((event) => event.type === "usage.update").payload.inputTokens, 12);
  assert.equal(
    events.find((event) => event.type === "session.update").payload.providerSession.sessionId,
    "grok-session-1"
  );
  const trace = await f.trace();
  assert.deepEqual(
    trace.map((entry) => entry.method),
    ["initialize", "authenticate", "session/new", "session/prompt"]
  );
  assert.equal(trace[1].params.methodId, "cached_token");
  assert.equal(trace[1].params._meta.headless, true);
  assert.equal(trace[2].params._meta.rules, "CONTROL_95");
  assert.equal(trace[2].params._meta.yoloMode, false);
  assert.equal(trace[2].params._meta.autoMode, false);
  assert.equal(trace[2].fixtureCwd, await realpath(f.directory));
  assert.equal(trace[2].fixtureEnv, "run-value");
  assert.equal(trace[3].params.prompt[0].text, "hello");
  assert.equal(JSON.stringify(events).includes("secret-canary-95"), false);
  assert.deepEqual(f.spawns[0].args, ["--no-auto-update", "agent", "--no-leader", "stdio"]);
  assert.equal(JSON.stringify(f.spawns[0].args).includes("secret-canary-95"), false);
  assert.equal(process.env.OCTO_TEST_VALUE, undefined);
});

for (const [mode, methodId] of [
  ["auth_api_key", "xai.api_key"],
  ["auth_api_key_interactive", "xai.api_key"],
  ["auth_api_key_first", "xai.api_key"],
  ["auth_cached_token", "cached_token"]
]) {
  test(`Grok ${mode} authenticates using the harness advertisement without caller-supplied credentials`, async (t) => {
    const f = await fixture(t, mode);
    const events = await collect(f.adapter);
    assert.deepEqual(
      terminal(events).map((event) => event.type),
      ["run.completed"]
    );
    const trace = await f.trace();
    assert.deepEqual(trace.find((entry) => entry.method === "authenticate").params, {
      methodId,
      _meta: { headless: true }
    });
  });
}

test("Grok authentication rejection does not switch methods or create a session", async (t) => {
  const f = await fixture(t, "auth_api_key_error");
  await assert.rejects(() => collect(f.adapter), /GROK_AUTH_FAILED/);
  const trace = await f.trace();
  assert.deepEqual(
    trace.map((entry) => entry.method),
    ["initialize", "authenticate"]
  );
  assert.equal(trace[1].params.methodId, "xai.api_key");
});

for (const [mode, expected] of [
  ["auth_missing", /GROK_AUTH_REQUIRED/],
  ["auth_error", /GROK_AUTH_FAILED/],
  ["bad_protocol", /GROK_VERSION_UNSUPPORTED/],
  ["bad_version", /GROK_VERSION_UNSUPPORTED/],
  ["load_error", /Authentication expired/],
  ["incomplete", /GROK_PROMPT_INCOMPLETE/],
  ["accepted_only", /GROK_PROMPT_INCOMPLETE/],
  ["provider_error", /provider rejected key \[REDACTED\]/],
  ["exit", /ACP process exited|disconnected/],
  ["disconnect", /ACP stdout disconnected/],
  ["disconnect_diagnostic", /CONFIG_INVALID: missing provider credential/]
]) {
  test(`Grok ${mode} cannot report successful completion`, { timeout: 5000 }, async (t) => {
    const f = await fixture(t, mode);
    const request = {
      ...base(),
      ...(mode === "load_error" ? { providerSession: { sessionId: "prior" } } : {}),
      executionEnvOverrides: {
        env_variables: [{ key: "OCTO_TEST_SECRET", value: "secret-canary-95" }]
      }
    };
    const events = [];
    await assert.rejects(async () => {
      for await (const event of f.adapter.invoke(request)) events.push(event);
    }, expected);
    assert.equal(terminal(events).length, 0);
    if (mode === "load_error")
      assert.equal(
        (await f.trace()).some((entry) => entry.method === "session/new"),
        false
      );
  });
}

test("Grok explicit resume preserves rules and missing session applies frozen recovery input to a fresh session", async (t) => {
  const resumed = await fixture(t);
  await collect(resumed.adapter, { ...base(), providerSession: { sessionId: "prior" } });
  const trace = await resumed.trace();
  const load = trace.find((entry) => entry.method === "session/load");
  assert.equal(load.params.sessionId, "prior");
  assert.equal(load.params._meta.rules, undefined);
  assert.equal(load.params._meta["x.ai/restore_code"], false);
  assert.equal(
    trace.some((entry) => entry.method === "session/new"),
    false
  );
  const missing = await fixture(t, "missing_session");
  const events = await collect(missing.adapter, {
    ...base(),
    providerSession: { sessionId: "gone" },
    freshFallbackModelInput: "RECOVERY_95"
  });
  const fallback = events.find((event) => event.type === "session.update").payload.providerSession;
  assert.equal(fallback.resumeOutcome, "fresh_fallback");
  const recovery = await missing.trace();
  assert.equal(
    recovery.find((entry) => entry.method === "session/new").params._meta.rules,
    "CONTROL_95"
  );
  assert.equal(
    recovery.find((entry) => entry.method === "session/prompt").params.prompt[0].text,
    "RECOVERY_95"
  );
});

test("Grok maps explicit plan, model, model-specific effort downgrade and both MCP transports", async (t) => {
  const f = await fixture(t);
  const events = await collect(f.adapter, {
    ...base(),
    agentConfig: { model: "grok-three-level", effort: "xhigh" },
    context: {
      schema: "octo.context-envelope/v3",
      items: [
        { namespace: "octo.execution", name: "actmode", payload: { mode: "plan" } },
        {
          namespace: "octo.execution",
          name: "mcp",
          payload: {
            mcpServers: {
              local: { type: "stdio", command: "node", args: ["tool.mjs"], env: { KEY: "value" } },
              remote: {
                type: "streamable_http",
                url: "https://example.com/mcp",
                headers: { Authorization: "Bearer example" }
              }
            }
          }
        }
      ]
    }
  });
  const trace = await f.trace();
  assert.equal(trace.find((entry) => entry.method === "session/set_mode").params.modeId, "plan");
  assert.equal(
    trace.find((entry) => entry.method === "session/set_config_option").params.value,
    "grok-three-level"
  );
  assert.ok(
    events.some(
      (event) => event.type === "execution.update" && event.payload.actmode.effective === "plan"
    )
  );
  assert.ok(
    events.some((event) => event.payload.params?.warningCode === "REASONING_EFFORT_DOWNGRADED")
  );
  const servers = trace.find((entry) => entry.method === "session/new").params.mcpServers;
  assert.deepEqual(servers[0].env, [{ name: "KEY", value: "value" }]);
  assert.equal(servers[1].type, "http");
});

for (const mode of ["permission", "question", "plan"]) {
  test(
    `Grok ${mode} responds on the original invocation and rejects stale answers`,
    { timeout: 5000 },
    async (t) => {
      const f = await fixture(t, mode);
      const request = {
        ...base(),
        ...(mode === "permission" ? {} : { approvalMode: "full_access" })
      };
      let interactionId;
      const events = [];
      for await (const event of f.adapter.invoke(request)) {
        events.push(event);
        if (event.type === "interaction.requested") {
          interactionId = event.payload.interactionId;
          await f.adapter.respondInteraction(request.invocationId, {
            interactionId,
            outcome: mode === "permission" ? "accepted" : "answered",
            ...(mode === "permission"
              ? {}
              : {
                  value:
                    mode === "question"
                      ? { q0: { answers: ["README.md"] } }
                      : { decision: { answers: ["Approve"] } }
                })
          });
        }
      }
      assert.ok(interactionId);
      assert.ok(
        events.some(
          (event) => event.type === "interaction.resolved" && event.payload.status === "resolved"
        )
      );
      assert.equal(terminal(events)[0].type, "run.completed");
      const reply = (await f.trace()).find((entry) => entry.id === "reverse-95" && !entry.method);
      assert.deepEqual(
        reply.result,
        mode === "permission"
          ? { outcome: { outcome: "selected", optionId: "once" } }
          : mode === "question"
            ? { outcome: "accepted", answers: { "Which file?": ["README.md"] } }
            : { outcome: "approved" }
      );
      await assert.rejects(
        f.adapter.respondInteraction(request.invocationId, { interactionId, outcome: "cancelled" }),
        /INTERACTION_NOT_ACTIVE/
      );
    }
  );
}

test(
  "Grok cancellation propagates cancel, invalidates pending questions and cleans the process",
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t, "question");
    const controller = new AbortController();
    const events = [];
    let interactionId;
    for await (const event of f.adapter.invoke({ ...base(), signal: controller.signal })) {
      events.push(event);
      if (event.type === "interaction.requested") {
        interactionId = event.payload.interactionId;
        controller.abort("test_cancel");
      }
    }
    assert.deepEqual(
      terminal(events).map((event) => event.type),
      ["run.cancelled"]
    );
    assert.ok(
      events.some(
        (event) => event.type === "interaction.resolved" && event.payload.status === "invalidated"
      )
    );
    const trace = await f.trace();
    assert.ok(trace.some((entry) => entry.method === "session/cancel"));
    assert.throws(() => process.kill(trace[0].fixturePid, 0), /ESRCH/);
    await assert.rejects(
      f.adapter.respondInteraction(base().invocationId, { interactionId, outcome: "cancelled" }),
      /INTERACTION_NOT_ACTIVE/
    );
  }
);

test("SDK host suppresses success until Grok cleanup completes and reports cleanup failure once", async (t) => {
  const f = await fixture(t, "success", { cleanupFailure: true });
  const host = new AgentExecutor();
  host.register(f.adapter);
  t.after(() => host.shutdown());
  const frames = await Array.fromAsync(
    preparedFrames(host, "grok-build", base(), { protocolMode: "canonical" })
  );
  const events = frames.filter((frame) => frame.kind === "canonical").map((frame) => frame.event);
  assert.deepEqual(
    terminal(events).map((event) => event.type),
    ["run.failed"]
  );
});

test("Grok command and version probes give actionable diagnostics; CLI catalog includes its package", async (t) => {
  const missing = await createGrokBuildAdapter({
    command: join(tmpdir(), "missing-grok-95")
  }).probe();
  assert.equal(missing.available, false);
  assert.match(missing.reason, /install Grok Build/);
  const incompatible = await createGrokBuildAdapter({ command: process.execPath }).probe();
  assert.equal(incompatible.available, false);
  assert.match(incompatible.reason, /grok_version_unsupported/);
  if (process.platform !== "win32") {
    const directory = await mkdtemp(join(tmpdir(), "grok-probe-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const command = join(directory, "grok");
    await writeFile(command, '#!/bin/sh\nprintf "grok 1.0.67 (fixture)\\n"\n', { mode: 0o700 });
    assert.equal((await createGrokBuildAdapter({ command }).probe()).version, "1.0.67");
  }
  const manifest = JSON.parse(
    await readFile(new URL("../apps/cli/src/manifest.json", import.meta.url), "utf8")
  );
  assert.ok(
    manifest.adapters.some(
      (entry) => entry.type === "grok-build" && entry.export === "grokBuildAdapter"
    )
  );
});

test("Grok rejects unsupported sandbox and MCP literals before spawning a process", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    collect(f.adapter, { ...base(), agentConfig: { sandbox: "workspace-write" } }),
    /SANDBOX_UNSUPPORTED/
  );
  await assert.rejects(
    collect(f.adapter, {
      ...base(),
      context: {
        schema: "octo.context-envelope/v3",
        items: [
          {
            namespace: "octo.execution",
            name: "mcp",
            payload: {
              mcpServers: { literal: { type: "stdio", command: "echo", args: ["$${LITERAL}"] } }
            }
          }
        ]
      }
    }),
    /MCP_LITERAL_UNSUPPORTED/
  );
  assert.equal(f.spawns.length, 0);
});

test(
  "grok-build isolates concurrent bots from each other and from a standard ACP bot",
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t, "question");
    const standard = createAcpAdapter(
      { type: "other-acp", provider: "other-acp", command: process.execPath },
      {
        acpClientFactory: (options) =>
          spawnStandardAcpClient({
            ...options,
            command: process.execPath,
            args: [fixturePath],
            env: { ...options.env, OCTO_GROK_FIXTURE: "permission" }
          })
      }
    );
    const controller = new AbortController();
    const a = {
      ...base(),
      invocationId: "grok-bot-a",
      signal: controller.signal,
      executionEnvOverrides: { env_variables: [{ key: "OCTO_TEST_VALUE", value: "bot-a" }] }
    };
    const b = {
      ...base(),
      invocationId: "grok-bot-b",
      workdir: f.directory,
      executionEnvOverrides: { env_variables: [{ key: "OCTO_TEST_VALUE", value: "bot-b" }] }
    };
    const c = { ...base(), invocationId: "other-bot-c" };
    async function pending(adapter, request) {
      const iterator = adapter.invoke(request)[Symbol.asyncIterator]();
      const events = [];
      t.after(() => iterator.return());
      while (true) {
        const result = await iterator.next();
        assert.equal(result.done, false);
        events.push(result.value);
        if (result.value.type === "interaction.requested")
          return {
            interactionId: result.value.payload.interactionId,
            async finish() {
              for await (const event of iterator) events.push(event);
              return events;
            }
          };
      }
    }
    const [first, second, third] = await Promise.all([
      pending(f.adapter, a),
      pending(f.adapter, b),
      pending(standard, c)
    ]);
    assert.notEqual(first.interactionId, second.interactionId);
    await assert.rejects(
      collect(f.adapter, {
        ...base(),
        invocationId: "failed-bot",
        executionEnvOverrides: {
          env_variables: [{ key: "OCTO_GROK_FIXTURE", value: "provider_error" }]
        }
      }),
      /provider rejected/
    );
    await assert.rejects(
      f.adapter.respondInteraction(b.invocationId, {
        interactionId: first.interactionId,
        outcome: "cancelled"
      }),
      /INTERACTION_NOT_ACTIVE/
    );
    await assert.rejects(
      standard.respondInteraction(c.invocationId, {
        interactionId: second.interactionId,
        outcome: "cancelled"
      }),
      /INTERACTION_NOT_ACTIVE/
    );
    controller.abort("only-bot-a");
    assert.deepEqual(
      terminal(await first.finish()).map((event) => event.type),
      ["run.cancelled"]
    );
    await f.adapter.respondInteraction(b.invocationId, {
      interactionId: second.interactionId,
      outcome: "answered",
      value: { q0: { answers: ["README.md"] } }
    });
    await standard.respondInteraction(c.invocationId, {
      interactionId: third.interactionId,
      outcome: "accepted"
    });
    const [secondEvents, thirdEvents] = await Promise.all([second.finish(), third.finish()]);
    for (const events of [secondEvents, thirdEvents])
      assert.deepEqual(
        terminal(events).map((event) => event.type),
        ["run.completed"]
      );
    const trace = await f.trace();
    const from = (value) => trace.filter((entry) => entry.fixtureEnv === value);
    assert.notEqual(from("bot-a")[0].fixturePid, from("bot-b")[0].fixturePid);
    assert.ok(from("bot-a").some((entry) => entry.method === "session/cancel"));
    assert.equal(
      from("bot-b").some((entry) => entry.method === "session/cancel"),
      false
    );
    assert.equal(from("bot-b")[0].fixtureCwd, await realpath(f.directory));
    // 两个子进程故意返回相同原生 sessionId 和 reverse-request id，仍不得交叉路由。
    for (const value of ["bot-a", "bot-b"])
      assert.equal(
        from(value).find((entry) => entry.method === "session/prompt").params.sessionId,
        "grok-session-1"
      );
    assert.deepEqual(
      terminal(
        await collect(f.adapter, {
          ...base(),
          invocationId: a.invocationId,
          executionEnvOverrides: { env_variables: [{ key: "OCTO_GROK_FIXTURE", value: "success" }] }
        })
      ).map((event) => event.type),
      ["run.completed"]
    );
  }
);

test("grok-build preserves safe stream-capacity diagnostics without leaking credentials", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    Array.fromAsync(
      f.adapter.invoke(base(), {
        streamLimits: { rawMessageMaxBytes: 128 }
      })
    ),
    (error) => {
      assert.equal(error.code, "PROVIDER_MESSAGE_TOO_LARGE");
      assert.equal(error.boundary, "acp.stdout");
      assert.equal(error.limitBytes, 128);
      assert.ok(error.measuredBytes > error.limitBytes);
      return true;
    }
  );
});
