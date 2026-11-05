import assert from "node:assert/strict";
import test from "node:test";
import { createScopedCodexAdapter as createCodexAdapter } from "../test-support/scoped-codex-adapter.mjs";
import { codexAppServerFixture, invokeRequest } from "./runtime-fixture.js";

for (const source of ["stdin", "stdout", "stderr"]) {
  test(
    `Codex ${source} error produces one failed turn and preserves first cause`,
    { timeout: 3000 },
    async () => {
      const fixture = codexAppServerFixture();
      const child = fixture.spawnFn();
      const adapter = createCodexAdapter({
        command: "fixture",
        spawnFn: () => {
          setImmediate(() => {
            child[source].emit("error", new Error("first transport failure"));
            child[source].emit("error", new Error("later transport failure"));
          });
          return child;
        }
      });
      const events = [];
      for await (const event of adapter.invoke(invokeRequest({ approvalMode: "full_access" })))
        events.push(event);
      const failures = events.filter((event) => event.type === "run.failed");
      assert.equal(failures.length, 1);
      assert.match(failures[0].payload.message, /first transport failure/);
      assert.equal(
        events.some((event) => event.type === "run.completed"),
        false
      );
      await adapter.close();
      assert.ok(child.exitCode !== null || child.signalCode !== null);
    }
  );
}
