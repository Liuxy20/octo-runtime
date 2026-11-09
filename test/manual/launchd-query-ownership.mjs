import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import {
  LaunchdUserBackend,
  ServiceError
} from "../../packages/octo-runtime-cross-service/dist/index.js";
import { formatStatus } from "../../apps/cli/dist/output.js";
import { runCli } from "../../apps/cli/dist/main.js";
import { componentServiceId } from "../../packages/octo-runtime-host-sdk/dist/index.js";
import { createUnixServiceFixture } from "../../test-support/unix-service-fixture.js";

const missing = (label) => ({
  exitCode: 113,
  stderr: `Bad request.\nCould not find service "${label}" in domain for user gui: 501\n`
});
const loaded = { stdout: "state = running\npid = 123\n" };

async function fixture(t, install = true) {
  const { home, unixHome } = await createUnixServiceFixture(t, "ort158-");
  const spec = {
    id: "com.octo.ownership-158",
    command: "/usr/bin/true",
    workingDirectory: unixHome,
    timeoutStopSeconds: 1
  };
  const state = { print: () => missing(spec.id), disabled: {}, bootout: {} };
  const calls = [];
  const backend = new LaunchdUserBackend({
    platform: "darwin",
    homeDirectory: home,
    uid: 501,
    runner: {
      async run(command, args) {
        calls.push([...args]);
        const response =
          args[0] === "print"
            ? await state.print(args)
            : args[0] === "print-disabled"
              ? state.disabled
              : args[0] === "bootout"
                ? state.bootout
                : {};
        return { command, args, exitCode: 0, stdout: "", stderr: "", ...response };
      }
    }
  });
  if (install) await backend.install(spec);
  calls.length = 0;
  const path = join(home, "Library", "LaunchAgents", `${spec.id}.plist`);
  return { backend, spec, state, calls, path, home };
}

test("confirmed absence keeps stop and repeated uninstall idempotent", async (t) => {
  const { backend, spec, path, calls } = await fixture(t);
  const original = await fs.readFile(path);
  const status = await backend.inspect(spec);
  assert.equal(status.state, "stopped");
  assert.equal(status.enabled, true);
  assert.equal(status.definitionPath, path);
  await backend.stop(spec);
  assert.deepEqual(await fs.readFile(path), original);
  await backend.uninstall(spec);
  await assert.rejects(fs.stat(path), { code: "ENOENT" });
  await backend.uninstall(spec);
  assert.ok(calls.every(([operation]) => ["print", "print-disabled"].includes(operation)));
});

const failures = [
  ["permission", { exitCode: 5, stderr: "Permission denied" }],
  ["timeout", { exitCode: 124, stderr: "command timed out" }],
  ["domain unavailable", { exitCode: 113, stderr: "Could not find domain for user gui: 501" }],
  ["bare 113", { exitCode: 113 }],
  ["other label", missing("com.octo.ownership-158.other")],
  [
    "other domain",
    {
      exitCode: 113,
      stderr: 'Could not find service "com.octo.ownership-158" in domain for user gui: 502'
    }
  ],
  ["wrong exit", { ...missing("com.octo.ownership-158"), exitCode: 5 }],
  ["unrecognized diagnostic", { exitCode: 113, stderr: "service not found" }]
];

for (const [name, failure] of failures) {
  test(`${name}: all lifecycle queries fail without deleting or changing the definition`, async (t) => {
    const { backend, spec, state, calls, path } = await fixture(t);
    const original = await fs.readFile(path);
    state.print = () => failure;
    for (const method of ["inspect", "stop", "uninstall", "install", "start", "restart"]) {
      await assert.rejects(backend[method]({ ...spec, description: "replacement" }), (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "COMMAND_FAILED");
        assert.equal(error.backend, "launchd-user");
        assert.equal(error.command, "/bin/launchctl");
        assert.equal(error.exitCode, failure.exitCode);
        assert.equal(error.detail, failure.stderr?.trim());
        return true;
      });
      assert.deepEqual(await fs.readFile(path), original);
    }
    assert.ok(calls.every(([operation]) => ["print", "print-disabled"].includes(operation)));
    state.print = () => missing(spec.id);
    await backend.uninstall(spec);
    await assert.rejects(fs.stat(path), { code: "ENOENT" });
  });
}

test("initial install query failure does not create a definition or override", async (t) => {
  const { backend, spec, state, calls, path } = await fixture(t, false);
  state.print = () => ({ exitCode: 5, stderr: "Permission denied" });
  await assert.rejects(backend.install(spec), { code: "COMMAND_FAILED" });
  await assert.rejects(fs.stat(path), { code: "ENOENT" });
  assert.deepEqual(
    calls.map(([operation]) => operation),
    ["print"]
  );
});

test("print-disabled failure does not enable or start a service", async (t) => {
  const { backend, spec, state, calls, path } = await fixture(t);
  const original = await fs.readFile(path);
  state.disabled = { exitCode: 5, stderr: "Permission denied" };
  state.print = () => loaded;
  for (const method of ["inspect", "start", "restart"]) {
    await assert.rejects(backend[method](spec), { code: "COMMAND_FAILED", exitCode: 5 });
  }
  assert.deepEqual(
    calls.map(([operation]) => operation),
    Array(3).fill("print-disabled")
  );
  assert.deepEqual(await fs.readFile(path), original);
});

test("bootout failure retains the definition", async (t) => {
  const { backend, spec, state, calls, path } = await fixture(t);
  const original = await fs.readFile(path);
  state.print = () => loaded;
  state.bootout = { exitCode: 5, stderr: "Permission denied" };
  for (const method of ["stop", "uninstall"]) {
    await assert.rejects(backend[method](spec), { code: "COMMAND_FAILED", exitCode: 5 });
    assert.deepEqual(await fs.readFile(path), original);
  }
  assert.deepEqual(
    calls.map(([operation]) => operation),
    ["print", "bootout", "print", "bootout"]
  );
});

for (const method of ["stop", "uninstall", "install"]) {
  test(`${method}: failed post-bootout query cannot confirm cleanup or bootstrap`, async (t) => {
    const { backend, spec, state, calls, path } = await fixture(t);
    let count = 0;
    // install queries loaded before writing and again at the start of bootout.
    state.print = () =>
      ++count <= (method === "install" ? 2 : 1)
        ? loaded
        : { exitCode: 5, stderr: "Permission denied" };
    const original = await fs.readFile(path);
    await assert.rejects(backend[method]({ ...spec, args: ["replacement"] }), {
      code: "COMMAND_FAILED"
    });
    const retained = await fs.readFile(path);
    if (method === "install")
      assert.ok(retained.toString().includes("<string>replacement</string>"));
    else assert.deepEqual(retained, original);
    assert.equal(calls.filter(([operation]) => operation === "bootout").length, 1);
    assert.ok(!calls.some(([operation]) => operation === "bootstrap"));
    state.print = () => missing(spec.id);
    await backend.uninstall(spec);
  });
}

test("changed loaded definition remains on disk if replacement cannot stop the old job", async (t) => {
  const { backend, spec, state, calls, path } = await fixture(t);
  state.print = () => loaded;
  state.bootout = { exitCode: 5, stderr: "Permission denied" };
  await assert.rejects(backend.install({ ...spec, args: ["changed"] }), { code: "COMMAND_FAILED" });
  assert.ok((await fs.readFile(path, "utf8")).includes("<string>changed</string>"));
  assert.ok(!calls.some(([operation]) => operation === "bootstrap"));
});

test("bootout waits for confirmed absence", async (t) => {
  const { backend, spec, state, calls, path } = await fixture(t);
  let count = 0;
  state.print = () => (++count < 4 ? loaded : missing(spec.id));
  await backend.uninstall(spec);
  assert.equal(count, 4);
  assert.deepEqual(
    calls.map(([operation]) => operation),
    ["print", "bootout", "print", "print", "print"]
  );
  await assert.rejects(fs.stat(path), { code: "ENOENT" });
});

test("a job that remains loaded times out and retains the definition", async (t) => {
  const { backend, spec, state, path } = await fixture(t);
  const original = await fs.readFile(path);
  state.print = () => loaded;
  let clock = 0;
  t.mock.method(Date, "now", () => (clock += 10_000));
  await assert.rejects(backend.uninstall(spec), { code: "COMMAND_FAILED", exitCode: 124 });
  assert.deepEqual(await fs.readFile(path), original);
});

test("runner exceptions remain manager failures with their original cause", async (t) => {
  const { backend, spec, state, path } = await fixture(t);
  const original = await fs.readFile(path);
  const cause = Object.assign(new Error("launchctl unavailable"), { code: "ENOENT" });
  state.print = () => {
    throw cause;
  };
  await assert.rejects(backend.uninstall(spec), { code: "MANAGER_UNAVAILABLE", cause });
  assert.deepEqual(await fs.readFile(path), original);
});

test("definition removal failures are not reported as successful uninstall", async (t) => {
  const { backend, spec, path } = await fixture(t);
  const original = await fs.readFile(path);
  const remove = fs.rm;
  const denied = Object.assign(new Error("fixture removal denied"), { code: "EACCES" });
  const mocked = t.mock.method(fs, "rm", (target, ...args) => {
    if (target === path) throw denied;
    return remove(target, ...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(backend.uninstall(spec), denied);
    assert.deepEqual(await fs.readFile(path), original);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("status formatter distinguishes failed queries from known autostart", () => {
  for (const [state, enabled, detail, expected] of [
    ["running", true, undefined, "on"],
    ["stopped", false, undefined, "off"],
    ["unknown", true, undefined, "on"],
    ["unknown", false, "COMMAND_FAILED", "unknown"],
    ["unknown", false, "MANAGER_UNAVAILABLE", "unknown"]
  ]) {
    const output = formatStatus("fixture", {
      service: { manager: "launchd-user", state, enabled, detail, drift: [] },
      runtime: { available: false }
    });
    assert.ok(output.includes(`autostart: ${expected}  IPC:`));
  }
});

test("CLI reports unknown with the real backend and query failure", async (t) => {
  const { backend, spec, state, home, calls } = await fixture(t);
  const componentSpec = { ...spec, id: componentServiceId(home, "executor-kernel") };
  state.print = () => missing(componentSpec.id);
  await backend.install(componentSpec);
  state.print = () => ({ exitCode: 5, stderr: "Permission denied" });
  calls.length = 0;
  const invoke = async (json) => {
    const lines = [];
    const exitCode = await runCli(["status", "--home", home, ...(json ? ["--json"] : [])], {
      backend,
      output: (line) => lines.push(line)
    });
    assert.equal(exitCode, 0);
    return lines.join("\n");
  };
  assert.match(await invoke(false), /service: unknown  autostart: unknown/);
  const json = JSON.parse(await invoke(true))["executor-kernel"];
  assert.equal(json.service.state, "unknown");
  assert.equal(json.service.detail, "COMMAND_FAILED");
  assert.equal(json.service.enabled, false);
  assert.ok(!JSON.stringify(json).includes("Permission denied"));
  assert.ok(calls.every(([operation]) => ["print", "print-disabled"].includes(operation)));
});
