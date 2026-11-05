import { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createCodexAdapter } from "../packages/octo-runtime-adapter-codex/dist/index.js";

const scopes = new Set();
// Existing single-turn tests now explicitly own their service for the test lifetime.
afterEach(async () => {
  const owned = [...scopes];
  scopes.clear();
  for (const scope of owned)
    assert.equal((await scope.close({ deadline: performance.now() + 2500 })).complete, true);
});
export function createScopedCodexAdapter(options) {
  const adapter = createCodexAdapter(options);
  const scope = adapter.createExecutionScope({ log: () => {} });
  scopes.add(scope);
  return {
    ...adapter,
    invoke: scope.invoke.bind(scope),
    respondInteraction: scope.respondInteraction.bind(scope),
    respondNative: scope.respondNative.bind(scope),
    close: () => scope.close({ deadline: performance.now() + 2500 })
  };
}
