import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../apps/cli/dist/main.js";
for (const component of ["executor-kernel", "channel-gateway"]) {
  test(`${component} restart never installs or enables a missing service`, async (t) => {
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
    assert.equal(
      await runCli([component, "restart", "--home", home], {
        backend,
        output() {},
        errorOutput() {}
      }),
      3
    );
    assert.deepEqual(calls, []);
  });

  test(`${component} start reports automatic installation failure without starting`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "oc-install-failed-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const calls = [];
    const progress = [];
    let output;
    const manifest = join(home, "adapters.json");
    const backend = {
      inspect: async () => ({ state: "not_installed", enabled: false, drift: [] }),
      install: async (spec) => {
        calls.push("install");
        assert.equal(spec.enabled, true);
        assert.ok(spec.args.includes(component));
        assert.deepEqual(spec.args.slice(-4), ["--profile", "work", "--manifest", manifest]);
        throw new Error("INSTALL_FAILED");
      },
      start: async () => calls.push("start")
    };
    assert.equal(
      await runCli(
        [component, "start", "--home", home, "--profile", "work", "--manifest", manifest, "--json"],
        {
          backend,
          output: (line) => {
            output = line;
          },
          errorOutput: (line) => progress.push(line)
        }
      ),
      1
    );
    assert.deepEqual(calls, ["install"]);
    assert.deepEqual(progress, [
      `${component}: service not installed; installing with autostart enabled...`
    ]);
    assert.equal(JSON.parse(output).error.code, "INSTALL_FAILED");
  });
}
