import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../apps/cli/dist/main.js";
import { componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
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
test("both CLI groups install with autostart by default and act on one component only", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oc-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const native = backend();
  const run = (args) => runCli([...args, "--home", home], { backend: native, output() {} });
  await writeFile(join(home, "identity-marker"), "original");
  for (const component of ["executor-kernel", "channel-gateway"]) {
    assert.equal(await run([component, "restart"]), 3);
    assert.equal(await run([component, "install"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, true);
    assert.equal(await run([component, "install", "--autostart=false"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, false);
    assert.equal(await run([component, "install"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, true);
    assert.equal(await run([component, "install", "--autostart=true"]), 0);
    assert.equal(await run([component, "install"]), 0);
    assert.equal(native.state.get(componentServiceId(home, component)).enabled, true);
    const before = native.calls.length;
    assert.equal(await run([component, "stop"]), 0);
    assert.equal(native.calls.length, before + 1);
    assert.equal(native.calls.at(-1)[1].id, componentServiceId(home, component));
    assert.equal(await run([component, "uninstall"]), 0);
  }
  assert.equal(await readFile(join(home, "identity-marker"), "utf8"), "original");
  assert.equal(await run(["daemon", "start"]), 2);
  assert.equal(await run(["executor-kernel", "enable"]), 2);
  assert.notEqual(
    componentServiceId(home, "executor-kernel"),
    componentServiceId(`${home}/other`, "executor-kernel")
  );
});
