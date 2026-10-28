import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SystemdUserBackend,
  WindowsUserTaskBackend
} from "../packages/octo-runtime-cross-service/dist/index.js";

const failure = (error) => error.code === "COMMAND_FAILED";

async function fixture(t, platform) {
  const directory = await mkdtemp(join(tmpdir(), "oc-backend-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = {
    installed: false,
    active: false,
    showFails: false,
    missingUnit: false,
    pending: 0,
    fail: "",
    unavailable: false,
    queryFails: false,
    unresolvedIdentity: "",
    statusResponse: undefined,
    calls: []
  };
  const spec = {
    id: "test.lifecycle",
    command: platform === "win32" ? "C:\\Runtime\\node.exe" : "/usr/bin/node",
    workingDirectory: platform === "win32" ? "C:\\Runtime" : "/tmp",
    enabled: true,
    timeoutStopSeconds: 1
  };
  const runner = {
    async run(command, args) {
      const verb = platform === "win32" ? args[0] : args[1];
      state.calls.push(verb);
      const reply = (exitCode = 0, stdout = "", stderr = "") => ({
        command,
        args,
        exitCode,
        stdout,
        stderr
      });
      if (state.unavailable) return reply(5, "", "manager access denied");
      const advance = () => {
        if (state.pending > 0 && --state.pending === 0) state.active = false;
      };
      if (platform === "win32") {
        if (command.endsWith("powershell.exe")) {
          if (args.at(-1).includes("Schedule.Service"))
            return reply(0, JSON.stringify({ exists: state.installed }));
          if (state.statusResponse) {
            const { exitCode = 0, stdout = "", stderr = "" } = state.statusResponse;
            return reply(exitCode, stdout, stderr);
          }
          advance();
          return reply(
            0,
            JSON.stringify({
              state: state.active ? "Running" : "Ready",
              enabled: true,
              last_exit_code: 9,
              principal_user_id: state.unresolvedIdentity === "principal" ? "short-test" : "test",
              principal_user_matches: state.unresolvedIdentity === "principal" ? null : true,
              trigger_user_id: state.unresolvedIdentity === "trigger" ? "short-test" : "test",
              trigger_user_matches: state.unresolvedIdentity === "trigger" ? null : true
            })
          );
        }
        if (verb === "/Query") return reply(state.installed && !state.queryFails ? 0 : 1);
        if (verb === state.fail) return reply(5, "", "denied");
        if (verb === "/Create") state.installed = true;
        if (verb === "/End" && !state.pending) state.active = false;
        if (verb === "/Delete") {
          assert.equal(state.active, false, "must stop before deleting the task");
          state.installed = false;
        }
        if (verb === "/Run") {
          assert.equal(state.active, false, "must wait before starting a replacement");
          state.active = true;
        }
      } else {
        if (verb === "show") {
          advance();
          return reply(
            state.showFails ? 5 : 0,
            `LoadState=${state.missingUnit ? "not-found" : "loaded"}\nActiveState=${state.active ? "active" : "inactive"}\nMainPID=${state.active ? "123" : "0"}\nUnitFileState=enabled\nExecMainStatus=0\n`
          );
        }
        if (
          verb === state.fail ||
          (state.missingUnit && ["stop", "disable", "reset-failed"].includes(verb))
        )
          return reply(5, "", "denied or absent");
        if (verb === "stop" && !state.pending) state.active = false;
        if (verb === "disable")
          assert.equal(state.active, false, "must confirm stopped before disabling/removing");
      }
      return reply();
    }
  };
  const backend =
    platform === "win32"
      ? new WindowsUserTaskBackend({
          platform,
          runner,
          homeDirectory: "C:\\Users\\test",
          windowsUserId: "test",
          environment: { SystemRoot: "C:\\Windows" },
          windowsDefinitionDirectory: directory
        })
      : new SystemdUserBackend({ platform, runner, homeDirectory: directory, environment: {} });
  await backend.install(spec);
  state.calls = [];
  const definition =
    platform === "win32"
      ? join(directory, `${spec.id}.xml`)
      : join(directory, ".config", "systemd", "user", `${spec.id}.service`);
  return { state, spec, backend, definition };
}

for (const verb of ["stop", "disable"]) {
  test(`systemd uninstall propagates ${verb} failure and preserves the unit`, async (t) => {
    const { state, spec, backend, definition } = await fixture(t, "linux");
    state.active = true;
    state.fail = verb;
    await assert.rejects(backend.uninstall(spec), failure);
    assert.ok(await readFile(definition, "utf8"));
    assert.ok(!state.calls.includes("daemon-reload"));
  });
}

test("systemd uninstall waits for inactive state before removing the definition", async (t) => {
  const { state, spec, backend, definition } = await fixture(t, "linux");
  state.active = true;
  state.pending = 3;
  await backend.uninstall(spec);
  assert.equal(state.pending, 0);
  await assert.rejects(readFile(definition), { code: "ENOENT" });
});

test("systemd accepts explicit inactive not-found, but rejects not-found with a live process", async (t) => {
  const { state, spec, backend, definition } = await fixture(t, "linux");
  state.missingUnit = true;
  state.active = true;
  await assert.rejects(backend.uninstall(spec), failure);
  assert.ok(await readFile(definition));
  state.active = false;
  state.showFails = true;
  await backend.stop(spec);
  await backend.uninstall(spec);
  await backend.uninstall(spec);
  await assert.rejects(readFile(definition), { code: "ENOENT" });
});

test("systemd rejects a failed status query even if it contains inactive-looking output", async (t) => {
  const { state, spec, backend, definition } = await fixture(t, "linux");
  state.showFails = true;
  await assert.rejects(backend.uninstall(spec), failure);
  assert.ok(await readFile(definition));
});

for (const platform of ["linux", "win32"]) {
  test(`${platform} manager failure is not absence and preserves the definition`, async (t) => {
    const { state, spec, backend, definition } = await fixture(t, platform);
    state.unavailable = true;
    await assert.rejects(backend.uninstall(spec), failure);
    assert.ok(await readFile(definition));
  });
  test(`${platform} accepted stop that never finishes fails without removing the definition`, async (t) => {
    const { state, spec, backend, definition } = await fixture(t, platform);
    state.active = true;
    state.pending = Infinity;
    await assert.rejects(backend.uninstall(spec), failure);
    assert.ok(await readFile(definition));
    assert.ok(!state.calls.includes("/Delete"));
    assert.ok(!state.calls.includes("disable"));
  });
}

for (const verb of ["/End", "/Delete"]) {
  test(`Windows uninstall propagates ${verb} failure and preserves its sidecar`, async (t) => {
    const { state, spec, backend, definition } = await fixture(t, "win32");
    state.active = true;
    state.fail = verb;
    await assert.rejects(backend.uninstall(spec), failure);
    assert.ok(await readFile(definition));
    if (verb === "/End") assert.ok(!state.calls.includes("/Delete"));
  });
}

test("Windows restart waits for old task completion and propagates stop failures", async (t) => {
  const { state, spec, backend } = await fixture(t, "win32");
  state.active = true;
  state.fail = "/End";
  await assert.rejects(backend.restart(spec), failure);
  assert.ok(!state.calls.includes("/Run"));
  state.fail = "";
  state.pending = 5;
  await backend.restart(spec);
  assert.equal(state.pending, 0);
  assert.equal(state.active, true);
  assert.equal(state.calls.at(-1), "/Run");
});

test("Windows failed stop during reinstall preserves the previous sidecar and registration", async (t) => {
  const { state, spec, backend, definition } = await fixture(t, "win32");
  const previous = await readFile(definition, "utf8");
  state.active = true;
  state.fail = "/End";
  await assert.rejects(backend.install({ ...spec, args: ["replacement"] }), failure);
  assert.equal(await readFile(definition, "utf8"), previous);
  assert.ok(!state.calls.includes("/Create"));
});

test("Windows uninstall tolerates confirmed absence and stopped tasks without calling End", async (t) => {
  const { state, spec, backend, definition } = await fixture(t, "win32");
  await backend.uninstall(spec);
  assert.ok(!state.calls.includes("/End"));
  await backend.uninstall(spec);
  await assert.rejects(readFile(definition), { code: "ENOENT" });
});

test("Windows failed Query is checked against native existence instead of assumed missing", async (t) => {
  const { state, spec, backend } = await fixture(t, "win32");
  state.queryFails = true;
  assert.notEqual((await backend.inspect(spec)).state, "not_installed");
});

for (const identity of ["principal", "trigger"]) {
  for (const active of [false, true]) {
    test(`Windows uninstall confirms manager stop with unresolved ${identity}, active=${active}`, async (t) => {
      const { state, spec, backend, definition } = await fixture(t, "win32");
      state.unresolvedIdentity = identity;
      state.active = active;
      if (active) state.pending = 5;
      const status = await backend.inspect(spec);
      assert.equal(status.state, "unknown");
      assert.match(status.detail, /identity could not be resolved/);
      assert.ok(!status.drift.includes(`manager.${identity}_user`));
      // 清理容忍身份未知，启动和重启仍必须保留拒绝边界。
      for (const action of ["start", "restart"])
        await assert.rejects(backend[action](spec), { code: "MANAGER_UNAVAILABLE" });
      assert.ok(!state.calls.includes("/Run"));
      await backend.uninstall(spec);
      assert.equal(state.active, false);
      assert.equal(state.installed, false);
      assert.equal(state.calls.includes("/End"), active);
      await assert.rejects(readFile(definition), { code: "ENOENT" });
    });
  }
}

for (const [name, response] of [
  ["failed query", { exitCode: 5, stderr: "query denied" }],
  ["invalid JSON", { stdout: "{" }],
  ["unknown manager state", { stdout: JSON.stringify({ state: "Unexpected" }) }]
]) {
  test(`Windows identity cleanup preserves task and sidecar on ${name}`, async (t) => {
    const { state, spec, backend, definition } = await fixture(t, "win32");
    state.unresolvedIdentity = "principal";
    state.statusResponse = response;
    await assert.rejects(backend.uninstall(spec), { code: "MANAGER_UNAVAILABLE" });
    assert.equal(state.installed, true);
    assert.ok(await readFile(definition));
    assert.ok(!state.calls.includes("/End"));
    assert.ok(!state.calls.includes("/Delete"));
  });
}

for (const failureMode of ["stop timeout", "/End", "/Delete"]) {
  test(`Windows unresolved identity preserves task and sidecar on ${failureMode}`, async (t) => {
    const { state, spec, backend, definition } = await fixture(t, "win32");
    state.unresolvedIdentity = "principal";
    state.active = true;
    if (failureMode === "stop timeout") state.pending = Infinity;
    else state.fail = failureMode;
    await assert.rejects(backend.uninstall(spec), failure);
    assert.equal(state.installed, true);
    assert.ok(await readFile(definition));
    if (failureMode !== "/Delete") assert.ok(!state.calls.includes("/Delete"));
  });
}
