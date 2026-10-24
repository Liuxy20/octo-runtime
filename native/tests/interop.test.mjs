import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { kernelFixture, kernelInput } from "../../test/kernel-fixture.js";
import { invocationInput } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest } from "../../test/runtime-fixture.js";

const language = process.env.OCTO_NATIVE_LANGUAGE ?? "go";
import { build as buildDriver, call as callDriver } from "./driver.mjs";
const build = () => buildDriver(language);
const call = (command) => callDriver(language, command);
function nativeInput(mode = "native", scenario = "normal") {
  return invocationInput(
    invokeRequest({
      invocationId: randomUUID(),
      runId: randomUUID(),
      agentSessionId: randomUUID(),
      modelInput: scenario,
      approvalMode: "full_access"
    }),
    mode,
    "codex"
  );
}

test(`${language} public API talks to real Kernel + isolated fake Provider`, async (t) => {
  build();
  const { endpoint } = await kernelFixture(t, { manifest: resolve("native/tests/adapters.json") });
  for (const [name, input, op] of [
    ["canonical", kernelInput(), "invoke"],
    ["native", nativeInput(), "invoke"],
    ["advanced", nativeInput(), "submit"],
    ["cancel", kernelInput("wait-for-cancel"), "cancel"]
  ])
    await t.test(name, async () => {
      const result = await call({ endpoint, input, op });
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.ok(result.instance);
      assert.equal(result.adapters, 2);
      const frames = result.frames ?? result.events;
      assert.ok(frames.length > 0);
      if (op === "invoke") {
        assert.equal(result.before, 0);
        assert.deepEqual(result.registry, []);
      }
      if (name === "canonical") assert.ok(frames.some((e) => e.type === "run.completed"));
      if (name === "native") assert.equal(frames.at(-1).control.state, "completed");
      if (name === "cancel") assert.equal(frames.at(-1).control.state, "cancelled");
      if (result.snapshot) assert.deepEqual(result.snapshot.ref, result.ref);
    });
});
