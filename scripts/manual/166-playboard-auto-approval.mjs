import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { createKernelService } from "../../packages/octo-runtime-executor-kernel/dist/index.js";
import { prepareInvokeInput } from "../../packages/octo-runtime-executor-core/dist/index.js";
import { AcpApprovalBridge } from "../../packages/octo-runtime-adapter-sdk/dist/approval.js";
import {
  assertCanonicalEvent,
  assertHostControl,
  assertHostFrame,
  isTerminal,
  isHostTerminal
} from "../../packages/octo-runtime-protocol/dist/index.js";
import { build, batch } from "../../native/tests/driver.mjs";
import { terminateFixtureProcess } from "../../test-support/fixture-process.mjs";
import { codexAppServerFixture, invokeRequest, withTimeout } from "../../test/runtime-fixture.js";
import { createCodexAdapter } from "../../packages/octo-runtime-adapter-codex/dist/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = join(root, "apps/cli/dist/index.js");
const item = (namespace, name, payload) => ({ namespace, name, payload });
const request = (mode, scenario = "approval", overrides = {}) => ({
  invocationId: randomUUID(),
  inputs: [{ type: "text", text: scenario }],
  contexts: { schema: "octo.context-envelope/v3", items: [] },
  protocol_mode: mode,
  ...overrides
});

async function fixture(t, { nativeHost = false } = {}) {
  const directory = await realpath(await mkdtemp("/tmp/ort166-"));
  const trace = join(directory, "trace.jsonl");
  const adapter = {
    type: "codex",
    module: join(root, "packages/octo-runtime-adapter-codex/dist/index.js"),
    export: "createCodexAdapter",
    factory: true,
    options: {
      command: process.execPath,
      appServerArgs: [join(root, "scripts/manual/166-playboard-provider.mjs")]
    }
  };
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      version: 1,
      adapters: [
        adapter,
        {
          type: "ort166-legacy",
          module: join(root, "scripts/manual/166-playboard-legacy-adapter.mjs"),
          export: "adapter"
        }
      ]
    })
  );
  const env = {
    ...process.env,
    ORT166_TRACE: trace,
    OCTO_RUNTIME_HOME: join(directory, "home"),
    OCTO_RUNTIME_CLI_SYNC_OPENCLAW_TOOLS: "0"
  };
  t.after(async () => {
    // 先确认本专项 Provider 已退出，再删除其目录；不把 kill 请求当回收证据。
    for (const row of await readTrace({ trace })) {
      if (row.pid) assert.throws(() => process.kill(row.pid, 0), { code: "ESRCH" });
      if (row.hostPid) {
        // 原生 SDK 只关闭服务资源；测试宿主必须继续存活，CLI 子宿主则须已经退出。
        if (nativeHost) {
          assert.equal(row.hostPid, process.pid);
          assert.doesNotThrow(() => process.kill(row.hostPid, 0));
        } else assert.throws(() => process.kill(row.hostPid, 0), { code: "ESRCH" });
      }
      if (row.temporary) await rm(row.temporary, { recursive: true, force: true });
    }
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, trace, adapter, manifest, env };
}
async function readTrace(settings) {
  try {
    return (await readFile(settings.trace, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function cli(settings, value, { signal, cleanup } = {}) {
  const args = cleanup
    ? [
        "--experimental-test-module-mocks",
        "--import",
        join(root, "scripts/manual/166-playboard-cleanup-failure.mjs")
      ]
    : [];
  const child = spawn(
    process.execPath,
    [...args, entry, "playboard", "--manifest", settings.manifest],
    {
      cwd: settings.directory,
      env: { ...settings.env, ...(cleanup ? { TEST_PLAYBOARD_CLEANUP: cleanup } : {}) },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  let stdout = "",
    stderr = "",
    pendingAt,
    signalled = false,
    timedOut = false;
  let timer, cleanupTask;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (
      stdout.includes('"responseRequired":true') ||
      stdout.includes('"interactionId":"legacy-question"')
    )
      pendingAt ??= Date.now();
    if (signal && !signalled && stdout.includes('"responseRequired":false')) {
      signalled = true;
      assert.equal(child.kill(signal), true, "signal was not sent to owned CLI");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      cleanupTask = (async () => {
        const rows = await readTrace(settings);
        const pids = new Set(rows.flatMap((row) => [row.pid, row.hostPid]).filter(Boolean));
        // 所属 Provider 先退，CLI 最后；每个 PID 的退出确认独立有界。
        for (const pid of pids) await terminateFixtureProcess(pid);
        await terminateFixtureProcess(child.pid);
      })();
      void cleanupTask.then(
        () => reject(new Error(`CLI timeout; owned PID ${child.pid} terminated`)),
        (error) => reject(new AggregateError([error], `CLI cleanup incomplete: PID ${child.pid}`))
      );
    }, 20000);
    child.once("error", reject);
    child.once("close", resolve);
    child.stdin.end(JSON.stringify(value));
  }).finally(async () => {
    clearTimeout(timer);
    await cleanupTask;
  });
  assert.equal(timedOut, false, stderr);
  if (pendingAt)
    assert.ok(Date.now() - pendingAt < 5000, "external interaction did not fail promptly");
  const frames = stdout.trim().split("\n").filter(Boolean).map(JSON.parse);
  for (const frame of frames)
    "kind" in frame ? assertHostFrame(frame) : assertCanonicalEvent(frame);
  return { code, stderr, frames };
}
const completed = (frames) =>
  frames.some((f) => f.type === "run.completed" || f.control?.state === "completed");
const pending = (frames) =>
  frames.find((f) => f.type === "interaction.requested" || f.control?.status === "pending");
const responseRequired = (frame) =>
  frame.payload?.responseRequired ?? frame.control?.responseRequired;
let canonicalApproval;

for (const mode of ["canonical", "native"]) {
  test(`${mode}: default and explicit full_access complete three times each`, async (t) => {
    const settings = await fixture(t);
    for (const overrides of [{}, { approvalMode: "full_access" }]) {
      for (let repetition = 0; repetition < 3; repetition++) {
        const result = await cli(settings, request(mode, "approval", overrides));
        assert.equal(result.code, 0, result.stderr);
        assert.ok(completed(result.frames));
        assert.equal(responseRequired(pending(result.frames)), false);
        assert.equal(
          result.frames.filter((f) => ("kind" in f ? isHostTerminal(f) : isTerminal(f))).length,
          1
        );
        if (mode === "canonical") canonicalApproval = pending(result.frames).payload;
      }
    }
    const trace = await readTrace(settings);
    assert.equal(trace.filter((r) => r.approvalReply).length, 6);
    assert.ok(trace.filter((r) => r.cwd).every((r) => r.cwd === settings.directory));
  });
  test(`${mode}: policy sources, questions and provider failure`, async (t) => {
    const settings = await fixture(t);
    for (const policy of ["ask", "full_access"]) {
      const result = await cli(
        settings,
        request(mode, "approval", {
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [item("octo.security", "approval_policy", { mode: policy })]
          }
        })
      );
      assert.equal(result.code, policy === "ask" ? 1 : 0, result.stderr);
      if (policy === "ask") assert.match(result.stderr, /PLAYBOARD_INTERACTION_REQUIRED/);
    }
    const ask = await cli(settings, request(mode, "approval", { approvalMode: "ask" }));
    assert.equal(ask.code, 1);
    assert.match(ask.stderr, /PLAYBOARD_INTERACTION_REQUIRED/);
    for (const scenario of ["question", "elicitation", "approval-then-question"]) {
      const result = await cli(settings, request(mode, scenario, { approvalMode: "full_access" }));
      assert.equal(result.code, 1, result.stderr);
      assert.match(result.stderr, /PLAYBOARD_INTERACTION_REQUIRED/);
      assert.equal(completed(result.frames), false);
      assert.ok(result.frames.some((f) => responseRequired(f) === true));
    }
    const failure = await cli(settings, request(mode, "fail-after-approval"));
    assert.equal(failure.code, 1);
    assert.equal(completed(failure.frames), false);
    assert.ok(
      failure.frames.some(
        (f) => f.type === "interaction.resolved" || f.control?.status === "resolved"
      )
    );
    assert.equal((await readTrace(settings)).filter((r) => r.externalReply).length, 0);
  });
  test(`${mode}: SDK default ask remains answerable, full_access resolves`, async (t) => {
    const settings = await fixture(t, { nativeHost: true });
    // 原生装配保留 Provider 工厂参数；每轮环境通过 RPC 传递，不修改宿主 process.env。
    const kernel = createKernelService({
      endpoint: join(settings.directory, "k.sock"),
      adapters: [createCodexAdapter(settings.adapter.options)]
    });
    try {
      await kernel.initialize();
      for (const policy of [undefined, "full_access"]) {
        const input = request(mode, "approval", policy ? { approvalMode: policy } : {});
        const snapshot = structuredClone(input);
        const frames = [];
        for await (const frame of kernel.client.invoke(input, {
          executionEnvOverrides: {
            env_variables: [{ key: "ORT166_TRACE", value: settings.trace }]
          }
        })) {
          frames.push(frame);
          if (
            (frame.type === "interaction.requested" || frame.control?.status === "pending") &&
            !policy
          ) {
            assert.equal(responseRequired(frame), true);
            if (mode === "native")
              await kernel.client.respondNativeInteraction(input.invocationId, {
                requestId: frame.control.requestId,
                payload: {
                  jsonrpc: "2.0",
                  id: frame.control.requestId,
                  result: { decision: "accept" }
                }
              });
            else
              await kernel.client.respondInteraction(input.invocationId, {
                interactionId: frame.payload.interactionId,
                outcome: "accepted"
              });
          }
        }
        assert.ok(completed(frames));
        assert.deepEqual(input.contexts, snapshot.contexts);
      }
    } finally {
      assert.equal((await kernel.close()).complete, true);
    }
  });
}

test("invalid policies and conflicting values fail without starting Provider", async (t) => {
  const settings = await fixture(t);
  for (const overrides of [
    { approvalMode: null },
    { approvalMode: "" },
    { approvalMode: "invalid" },
    {
      approvalMode: "ask",
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [item("octo.security", "approval_policy", { mode: "full_access" })]
      }
    },
    {
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [item("octo.security", "approval_policy", { mode: null })]
      }
    }
  ]) {
    const result = await cli(settings, request("canonical", "approval", overrides));
    assert.notEqual(result.code, 0);
  }
  assert.deepEqual(await readTrace(settings), []);
});

test("legacy interaction and incomplete cleanup remain failures", async (t) => {
  const settings = await fixture(t);
  const legacy = await cli(
    settings,
    request("canonical", "legacy", {
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [item("octo.execution", "adapter", { type: "ort166-legacy" })]
      }
    })
  );
  assert.equal(legacy.code, 1);
  assert.match(legacy.stderr, /PLAYBOARD_INTERACTION_REQUIRED/);
  for (const cleanup of ["reject", "incomplete"]) {
    const result = await cli(settings, request("canonical"), { cleanup });
    assert.notEqual(result.code, 0);
    assert.ok(completed(result.frames));
    assert.match(result.stderr, /TEST_CLEANUP_REJECTED|COMPONENT_CLEANUP_INCOMPLETE/);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal}: cancel automatic interaction and confirm Provider cleanup`, async (t) => {
    const settings = await fixture(t);
    const result = await cli(settings, request("native", "hang-after-approval"), { signal });
    assert.equal(result.code, signal === "SIGINT" ? 130 : 143, result.stderr);
    assert.equal(completed(result.frames), false);
  });
}

test("shared approval bridge marks automatic ownership before write confirmation", async () => {
  for (const policy of ["ask", "full_access"]) {
    const input = prepareInvokeInput(
      request("canonical", "approval", { approvalMode: policy })
    ).request;
    const bridge = new AcpApprovalBridge(input, 25);
    const params = { options: [{ kind: "allow_once", optionId: "allow" }] };
    const reply = bridge.requestPermission(params);
    void reply.catch(() => {});
    const controller = new AbortController();
    const iterator = bridge.stream(
      (async function* () {
        await new Promise((resolve) =>
          controller.signal.addEventListener("abort", resolve, { once: true })
        );
      })()
    );
    try {
      const first = await iterator.next();
      assert.equal(first.value.payload.responseRequired, policy === "ask");
      if (policy === "full_access") {
        await reply;
        bridge.responseWritten(params);
        const resolved = await iterator.next();
        assert.equal(resolved.value.type, "interaction.resolved");
      }
    } finally {
      controller.abort();
      bridge.close();
      await iterator.return();
    }
  }
});

for (const mode of ["canonical", "native"]) {
  for (const fault of ["write-failure", "write-stalled", "cancelled"]) {
    test(`${mode}: ${fault} while automatic response write is held`, async (t) => {
      let monotonic = performance.now();
      if (fault === "write-stalled") {
        // 回复已入队后由共享发送器的单调时钟约束；5 秒无进展先于审批过期。
        t.mock.method(performance, "now", () => monotonic);
        t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
      }
      const server = codexAppServerFixture({ holdResponseWrites: true });
      const child = server.spawnFn();
      const adapter = createCodexAdapter({ command: "fixture", spawnFn: server.spawnFn });
      const controller = new AbortController();
      const iterator = adapter.invoke(
        invokeRequest({ approvalMode: "full_access", signal: controller.signal }),
        { protocolMode: mode }
      );
      const frames = [];
      try {
        while (!pending(frames)) {
          const next = await withTimeout(iterator.next(), 2000, "automatic pending not observed");
          assert.equal(next.done, false);
          frames.push(next.value);
        }
        assert.equal(responseRequired(pending(frames)), false);
        assert.equal(
          server.writes.filter((m) => m.id === "native-request-1" && m.result).length,
          1
        );
        assert.equal(
          frames.some((f) => f.type === "interaction.resolved" || f.control?.status === "resolved"),
          false
        );
        if (fault === "write-failure") child.stdin.emit("error", new Error("ORT166_WRITE_FAILED"));
        else if (fault === "cancelled") controller.abort(new Error("ORT166_CANCELLED"));
        else {
          monotonic += 5000;
          t.mock.timers.tick(5000);
          server.close(1);
        }
        if (fault === "cancelled") server.close(null, "SIGTERM");
        try {
          for await (const frame of iterator) frames.push(frame);
        } catch (error) {
          // native Driver 把传输错误交给 Host 包装；直接 Adapter 专项观察原始错误。
          assert.equal(mode, "native");
          assert.notEqual(fault, "cancelled");
          assert.match(error.message, /ORT166_WRITE_FAILED|CODEX_STDIN_STALLED/);
        }
        server.flushResponseWrites();
        assert.equal(completed(frames), false);
        assert.ok(
          frames.some(
            (f) =>
              f.type === "interaction.resolved" ||
              ["invalidated", "expired"].includes(f.control?.status)
          )
        );
        if (fault === "write-stalled")
          assert.ok(
            frames.some(
              (f) => f.payload?.status === "invalidated" || f.control?.status === "invalidated"
            )
          );
        assert.equal(child.exitCode === null && child.signalCode === null, false);
      } finally {
        controller.abort();
        server.close(1);
        server.flushResponseWrites();
        if (fault === "write-stalled") t.mock.timers.reset();
        await iterator.return();
      }
    });
  }
}

test("explicit workspace and preset cwd retain shared input semantics", async (t) => {
  const settings = await fixture(t);
  const workspace = await realpath(await mkdtemp(join(settings.directory, "workspace-")));
  for (const overrides of [
    { workdir: workspace },
    {
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [item("octo.execution", "workspace", { mode: "fixed", path: workspace })]
      }
    }
  ])
    assert.equal((await cli(settings, request("canonical", "approval", overrides))).code, 0);
  assert.ok((await readTrace(settings)).filter((r) => r.cwd).every((r) => r.cwd === workspace));
  const conflict = await cli(
    settings,
    request("canonical", "approval", {
      workdir: settings.directory,
      contexts: {
        schema: "octo.context-envelope/v3",
        items: [item("octo.execution", "workspace", { mode: "fixed", path: workspace })]
      }
    })
  );
  assert.notEqual(conflict.code, 0);
  const preset = request("canonical", "approval", {
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [item("octo.execution", "adapter", { type: "openclaw" })]
    }
  });
  const snapshot = structuredClone(preset);
  assert.equal(prepareInvokeInput(preset).request.workdir, "");
  assert.deepEqual(preset, snapshot);
});

test("optional interaction fields have matching TS, Schema and Go/Python codec behavior", async () => {
  assert.ok(canonicalApproval);
  const cases = [];
  for (const value of [undefined, true, false, null, 0, "false"]) {
    for (const kind of ["approval", "question", "elicitation"]) {
      const payload = {
        ...canonicalApproval,
        kind,
        request: kind === "approval" ? canonicalApproval.request : {}
      };
      if (value === undefined) delete payload.responseRequired;
      else payload.responseRequired = value;
      const valid =
        value === undefined || value === true || (value === false && kind === "approval");
      const event = { protocolVersion: 2, type: "interaction.requested", payload };
      if (valid) assert.doesNotThrow(() => assertCanonicalEvent(event));
      else assert.throws(() => assertCanonicalEvent(event));
      cases.push({ definition: "InteractionRequestedPayload", value: payload, valid });
    }
    for (const status of ["pending", "resolved"]) {
      const control = {
        type: "interaction",
        requestId: 42,
        status,
        ...(status === "pending" ? { expiresAt: Date.now() + 60000 } : {})
      };
      if (value !== undefined) control.responseRequired = value;
      const valid = value === undefined || (status === "pending" && typeof value === "boolean");
      if (valid) assert.doesNotThrow(() => assertHostControl(control));
      else assert.throws(() => assertHostControl(control));
      cases.push({ definition: "HostControl", value: control, valid });
    }
  }
  const schema = JSON.parse(
    await readFile(join(root, "packages/octo-runtime-protocol/schema/protocol.schema.json"))
  );
  const ajv = new Ajv({ strict: false, validateFormats: false });
  ajv.addSchema(schema, "protocol");
  for (const row of cases)
    assert.equal(
      ajv.validate({ $ref: `protocol#/definitions/${row.definition}` }, row.value),
      row.valid
    );
  for (const language of ["go", "python"]) {
    build(language);
    const results = await batch(
      language,
      cases.map((row) => ({ op: "codec", definition: row.definition, value: row.value }))
    );
    for (let i = 0; i < cases.length; i++)
      assert.equal(results[i].valid, cases[i].valid, `${language}: ${JSON.stringify(cases[i])}`);
  }
});
