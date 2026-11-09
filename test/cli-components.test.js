import { componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli } from "../apps/cli/dist/main.js";
import { resolveServiceControl } from "../apps/cli/dist/service-control.js";
function backend() {
  const state = new Map(),
    calls = [];
  return {
    kind: "fixture",
    calls,
    state,
    inspect: async (spec) => ({
      state: state.has(spec.id) ? "stopped" : "not_installed",
      enabled: state.get(spec.id)?.enabled ?? false,
      drift: []
    }),
    install: async (spec) => {
      calls.push(["install", spec]);
      state.set(spec.id, spec);
    },
    uninstall: async (spec) => {
      calls.push(["uninstall", spec]);
      state.delete(spec.id);
    },
    stop: async (spec) => {
      calls.push(["stop", spec]);
    },
    start: async (spec) => {
      calls.push(["start", spec]);
    },
    restart: async (spec) => {
      calls.push(["restart", spec]);
    }
  };
}
test("Kernel CLI install with autostart by default and act on one component only", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oc-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const native = backend();
  const run = (args) => runCli([...args, "--home", home], { backend: native, output() {} });
  await writeFile(join(home, "identity-marker"), "original");
  for (const component of ["executor-kernel"]) {
    assert.equal(await run(["restart"]), 3);
    assert.equal(await run(["install"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, true);
    assert.equal(await run(["install", "--autostart=false"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, false);
    assert.equal(await run(["install"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, true);
    assert.equal(await run(["install", "--autostart=true"]), 0);
    assert.equal(await run(["install"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, true);
    const before = native.calls.length;
    assert.equal(await run(["stop"]), 0);
    assert.equal(native.calls.length, before + 1);
    assert.equal(native.calls.at(-1)[1].id, componentServiceId(home, component));
    assert.equal(await run(["uninstall"]), 0);
  }
  assert.equal(await readFile(join(home, "identity-marker"), "utf8"), "original");
  assert.equal(await run(["daemon", "start"]), 2);
  assert.equal(await run(["executor-kernel", "enable"]), 2);
  assert.notEqual(
    componentServiceId(home, "executor-kernel"),
    componentServiceId(`${home}/other`, "executor-kernel")
  );
});

test("Service definitions launch the root run command while retaining Kernel identity", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    const home = platform === "win32" ? "C:\\octo-cli-service-argv" : "/tmp/octo-cli-service-argv";
    const service = resolveServiceControl({ backend: backend(), platform });
    const spec = service.spec(home, "executor-kernel", true, ["--profile", "work"]);
    assert.equal(spec.id, componentServiceId(home, "executor-kernel", platform));
    assert.deepEqual(spec.args.slice(1), ["run", "--home", resolve(home), "--profile", "work"]);
    assert.ok(!spec.args.includes("executor-kernel"));
  }
});
