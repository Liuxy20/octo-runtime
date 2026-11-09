import { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createCodexAdapter,
  createManagedCodexEngine
} from "../packages/octo-runtime-adapter-codex/dist/index.js";
import { homedir } from "node:os";
import { join } from "node:path";

const scopes = new Set();
// Existing single-turn tests now explicitly own their service for the test lifetime.
afterEach(async () => {
  const owned = [...scopes];
  scopes.clear();
  const deadline = performance.now() + 2500;
  const results = await Promise.allSettled(owned.map((owner) => owner.close({ deadline })));
  for (const result of results) {
    assert.equal(result.status, "fulfilled");
    assert.equal(result.value.complete, true);
  }
});
export function createScopedCodexAdapter(options = {}) {
  const owner = createManagedCodexEngine({
    ...options,
    codexHome:
      options.codexHome ??
      options.env?.CODEX_HOME ??
      process.env.CODEX_HOME ??
      join(homedir(), ".codex")
  });
  const adapter = createCodexAdapter({ engine: owner.provider });
  const scope = adapter.createExecutionScope({ log: () => {} });
  const close = async ({ deadline }) => {
    owner.beginShutdown();
    const local = await scope.close({ deadline });
    const engine = await owner.close({ deadline });
    return { ...engine, complete: local.complete && engine.complete };
  };
  scopes.add(owner);
  return {
    ...adapter,
    invoke: scope.invoke.bind(scope),
    respondInteraction: scope.respondInteraction.bind(scope),
    respondNative: scope.respondNative.bind(scope),
    close: () => close({ deadline: performance.now() + 2500 })
  };
}

export function createOwnedCodexAdapter(options = {}) {
  const owner = createManagedCodexEngine({
    ...options,
    codexHome:
      options.codexHome ??
      options.env?.CODEX_HOME ??
      process.env.CODEX_HOME ??
      join(homedir(), ".codex")
  });
  scopes.add(owner);
  return createCodexAdapter({ engine: owner.provider });
}
