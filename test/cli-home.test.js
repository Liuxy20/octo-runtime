import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../apps/cli/dist/main.js";
for (const component of ["executor-kernel", "channel-gateway"]) {
  for (const action of ["start", "restart"]) {
    test(`${component} ${action} never installs or enables a missing service`, async (t) => {
      const home = await mkdtemp(join(tmpdir(), "oc-missing-"));
      t.after(() => rm(home, { recursive: true, force: true }));
      const calls = [];
      const backend = {
        inspect: async () => ({ state: "not_installed", enabled: false, drift: [] }),
        install: async () => calls.push("install"),
        enable: async () => calls.push("enable"),
        start: async () => calls.push("start"),
        restart: async () => calls.push("restart")
      };
      assert.equal(await runCli([component, action, "--home", home], { backend, output() {} }), 3);
      assert.deepEqual(calls, []);
    });
  }
}
