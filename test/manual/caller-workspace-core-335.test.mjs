import {
  withAgentEnvItems,
  defineAdapter,
  invocationWorkdir
} from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
// 显式本地专项：真实 Core/IPC 路径验证，不进入默认 CI glob。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  AgentExecutor,
  prepareInvokeInput
} from "../../packages/octo-runtime-executor-core/dist/index.js";
import { kernelFixture } from "../kernel-fixture.js";
const modes = ["canonical", "native"];
function input(workdir, mode = "canonical", items = [], extra = {}) {
  return {
    inputs: [{ type: "text", text: "caller prepared input" }],
    protocol_mode: mode,
    agentEnv: withAgentEnvItems(
      {
        schema: "octo.context-envelope/v3",
        items: [
          { namespace: "octo.execution", name: "adapter", payload: { type: "workspace-fixture" } },
          { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } }
        ]
      },
      [
        ...(workdir === undefined
          ? []
          : [{ namespace: "octo.execution", name: "workspace", payload: { path: workdir } }]),
        ...items
      ]
    ),
    ...extra
  };
}
function adapter(received, metadata = {}, verifyChildCwd = false) {
  return defineAdapter({
    metadata: {
      type: "workspace-fixture",

      protocolSupport: { protocol: "workspace-fixture", modes, nativeMethods: [] },
      ...metadata
    },
    async *invoke(request, context) {
      received.push(request);
      if (verifyChildCwd) {
        const { stdout } = await promisify(execFile)(process.execPath, ["-p", "process.cwd()"], {
          cwd: invocationWorkdir(request)
        });
        assert.equal(stdout.trim(), await realpath(invocationWorkdir(request)));
      }
      if (context.protocolMode === "native") {
        yield {
          kind: "native",
          messageKind: "notification",
          payload: { cwd: invocationWorkdir(request) }
        };
        yield { kind: "control", control: { type: "state", state: "completed" } };
      } else yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  });
}
async function core(t, metadata = {}, verifyChildCwd = false) {
  const received = [];
  const executor = new AgentExecutor();
  executor.register(adapter(received, metadata, verifyChildCwd));
  t.after(() => executor.shutdown());
  return { executor, received };
}
function assertFailure(frames, mode, code) {
  if (mode === "canonical") {
    const event = frames.find((frame) => frame.event?.type === "run.failed")?.event;
    assert.ok(event, JSON.stringify(frames));
    assert.equal(event.payload.code, code);
    assert.match(event.payload.message, /working directory/i);
    assert.equal(event.payload.failure.code, "OH-ADP-3004");
    assert.equal(event.payload.failure.reasonCode, code);
  } else {
    const error = frames.find((frame) => frame.control?.type === "error")?.control;
    assert.ok(error, JSON.stringify(frames));
    assert.equal(error.code, code);
    assert.match(error.message, /working directory/i);
    assert.equal(error.failure.code, "OH-ADP-3004");
    assert.equal(error.failure.reasonCode, code);
  }
  assert.equal(frames.at(-1).control.state, "failed");
}
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), "workspace-335-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("Core snapshots the submitted workspace without deriving another path", () => {
  assert.equal(invocationWorkdir(prepareInvokeInput(input()).request), "");
  assert.equal(invocationWorkdir(prepareInvokeInput(input("")).request), "");
  const path = resolve("prepared-caller-directory");
  const value = input(path);
  assert.equal(invocationWorkdir(prepareInvokeInput(value).request), path);
  assert.throws(
    () => prepareInvokeInput({ ...value, agentEnv: { ...value.agentEnv, workdir: "/other" } }),
    /CONTEXT_SCHEMA_INVALID/
  );
});
test("caller-created paths survive both output views, continuation and recovery inputs", async (t) => {
  const path = await directory(t);
  const { executor, received } = await core(t, {}, true);
  for (const mode of modes) {
    for (const recovery of [false, true]) {
      const value = input(
        path,
        mode,
        [],
        recovery
          ? {
              providerSession: { sessionId: "caller-provider-session" },
              continuityMode: "continue",
              freshFallbackModelInput: "caller recovery",
              freshFallbackModelInputParts: [{ type: "text", text: "caller recovery" }]
            }
          : {}
      );
      const frames = await Array.fromAsync(executor.invokeFrames(value));
      assert.equal(frames.at(-1).control.state, "completed");
      assert.equal(invocationWorkdir(received.at(-1)), path);

      if (recovery) assert.equal(received.at(-1).freshFallbackModelInput, "caller recovery");
    }
    const fromContext = input(undefined, mode);
    fromContext.agentEnv.items.push({
      namespace: "octo.execution",
      name: "workspace",
      payload: { path }
    });
    const frames = await Array.fromAsync(executor.invokeFrames(fromContext));
    assert.equal(frames.at(-1).control.state, "completed");
    assert.equal(invocationWorkdir(received.at(-1)), path);
  }
});
test("invalid local paths fail before Adapter invocation in both views without creating data", async (t) => {
  const root = await directory(t);
  const file = join(root, "existing-file");
  await writeFile(file, "preserve user data");
  const { executor, received } = await core(t);
  for (const mode of modes) {
    for (const [path, code] of [
      [undefined, "WORKDIR_REQUIRED"],
      ["", "WORKDIR_REQUIRED"],
      ["relative-directory", "WORKDIR_INVALID"],
      [join(root, "missing", "child"), "WORKDIR_NOT_FOUND"],
      [file, "WORKDIR_NOT_DIRECTORY"],
      [join(file, "child"), "WORKDIR_NOT_DIRECTORY"]
    ])
      assertFailure(await Array.fromAsync(executor.invokeFrames(input(path, mode))), mode, code);
  }
  assert.equal(received.length, 0);
  assert.deepEqual(await readdir(root), ["existing-file"]);
  assert.equal(await readFile(file, "utf8"), "preserve user data");
});
test("a removed continuation workspace fails without recreating or replacing it", async (t) => {
  const root = await directory(t);
  const path = join(root, "caller-random-name");
  await mkdir(path);
  const { executor, received } = await core(t);
  await Array.fromAsync(executor.invokeFrames(input(path)));
  await rm(path, { recursive: true });
  for (const mode of modes) {
    const value = input(path, mode, [], {
      providerSession: { sessionId: "existing-provider-session" },
      continuityMode: "continue",
      freshFallbackModelInput: "caller recovery"
    });
    assertFailure(await Array.fromAsync(executor.invokeFrames(value)), mode, "WORKDIR_NOT_FOUND");
  }
  assert.equal(received.length, 1);
  assert.deepEqual(await readdir(root), []);
});
test("Provider-owned workspaces do not require or inspect local paths", async (t) => {
  const root = await directory(t);
  const { executor, received } = await core(t, { workspace: false });
  for (const mode of modes) {
    for (const path of [undefined, join(root, "not-created")]) {
      const frames = await Array.fromAsync(executor.invokeFrames(input(path, mode)));
      assert.equal(frames.at(-1).control.state, "completed");
    }
  }
  assert.equal(received.length, 4);
  const preset = await core(t, { type: "openclaw", workspace: false });
  const value = input(undefined, "canonical", [
    { namespace: "octo.execution", name: "adapter", payload: { type: "openclaw" } },
    { namespace: "adapter.openclaw", name: "options", payload: { agentId: "main" } }
  ]);
  const frames = await Array.fromAsync(preset.executor.invokeFrames(value));
  assert.equal(frames.at(-1).control.state, "completed");
  assert.equal(invocationWorkdir(preset.received[0]), "");
  assert.deepEqual(await readdir(root), []);
});
test("inaccessible prepared directories fail before Provider on supported POSIX accounts", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0)
    return t.skip("POSIX non-root permissions required");
  const root = await directory(t);
  const path = join(root, "locked");
  await mkdir(path);
  await chmod(path, 0o600);
  try {
    const { executor, received } = await core(t);
    for (const mode of modes)
      assertFailure(
        await Array.fromAsync(executor.invokeFrames(input(path, mode))),
        mode,
        "WORKDIR_UNAVAILABLE"
      );
    assert.equal(received.length, 0);
  } finally {
    await chmod(path, 0o700);
  }
});
test("local IPC retains WORKDIR failures and successful caller paths in both output views", async (t) => {
  const root = await directory(t);
  const received = [];
  const { client } = await kernelFixture(t, { adapters: [adapter(received)] });
  for (const mode of modes) {
    for (const path of [undefined, join(root, "not-created")]) {
      const value = input(path, mode);
      const stream = client.invoke(
        { parts: value.inputs, protocol_mode: mode },
        undefined,
        undefined,
        value.agentEnv
      );
      const events = await Array.fromAsync(stream);
      const frames = mode === "canonical" ? events.map((event) => ({ event })) : events;
      if (mode === "canonical") {
        const failure = events.find((event) => event.type === "run.failed");
        assert.equal(failure.payload.code, path ? "WORKDIR_NOT_FOUND" : "WORKDIR_REQUIRED");
        assert.equal(failure.payload.failure.code, "OH-ADP-3004");
      } else assertFailure(frames, mode, path ? "WORKDIR_NOT_FOUND" : "WORKDIR_REQUIRED");
    }
    const value = input(root, mode);
    await Array.fromAsync(
      client.invoke(
        { parts: value.inputs, protocol_mode: mode },
        undefined,
        undefined,
        value.agentEnv
      )
    );
    assert.equal(invocationWorkdir(received.at(-1)), root);
  }
  assert.equal(received.length, 2);
  assert.deepEqual(await readdir(root), []);
});
