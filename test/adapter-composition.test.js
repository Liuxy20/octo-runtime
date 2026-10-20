import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { invocationInput, canonicalEvents } from "@mininglamp-oss/octo-runtime-protocol";
import { invokeRequest, waitFor } from "./runtime-fixture.js";

const entrypoint = fileURLToPath(new URL("./fixtures/direct-adapter-host.js", import.meta.url));

test("direct-import Host serves only its selected adapter without a manifest", async () => {
  const host = await spawnWorker({ entrypoint });
  try {
    assert.deepEqual(
      host.adapters.map((item) => item.type),
      ["test"]
    );
    assert.ok(host.adapters.every((item) => !Object.hasOwn(item, "executionFeatures")));
    const events = [];
    for await (const event of canonicalEvents(
      host.client.invokeFrames(
        invocationInput(invokeRequest({ approvalMode: "full_access" }), "canonical", "test")
      )
    ))
      events.push(event);
    assert.ok(events.some((event) => event.type === "run.completed"));
    await assert.rejects(async () => {
      for await (const frame of host.client.invokeFrames(
        invocationInput(invokeRequest(), "canonical", "codex")
      ))
        void frame;
    }, /adapter.*codex|unknown adapter/i);
  } finally {
    await host.close();
  }
});

test("JSON loader discovers and executes an Adapter without feature metadata", async () => {
  const host = await spawnWorker({
    entrypoint: fileURLToPath(
      new URL("../packages/octo-runtime-executor-kernel/dist/runner.js", import.meta.url)
    ),
    manifest: fileURLToPath(new URL("./fixtures/adapters.json", import.meta.url))
  });
  try {
    const adapters = await host.client.list();
    assert.deepEqual(
      adapters.map((item) => item.type),
      ["test"]
    );
    for (const metadata of [...host.adapters, ...adapters]) {
      assert.equal(Object.hasOwn(metadata, "executionFeatures"), false);
      assert.equal(Object.hasOwn(metadata, "capabilities"), false);
      assert.deepEqual(metadata.agentSources, ["provisioned"]);
    }
    const events = [];
    for await (const event of canonicalEvents(
      host.client.invokeFrames(
        invocationInput(
          invokeRequest({ prompt: "featureless-loader", approvalMode: "full_access" }),
          "canonical",
          "test"
        )
      )
    ))
      events.push(event);
    assert.ok(
      events.some(
        (event) =>
          event.type === "message.delta" && event.payload.text === "Handled: featureless-loader"
      )
    );
    assert.equal(events.at(-1).type, "run.completed");
  } finally {
    await host.close();
  }
});

test("independent Host selections support empty sets and reject duplicates before ready", async () => {
  const empty = await spawnWorker({
    entrypoint,
    env: { ...process.env, OCTO_TEST_HOST_SELECTION: "empty" }
  });
  try {
    assert.deepEqual(empty.adapters, []);
  } finally {
    await empty.close();
  }
  await assert.rejects(
    spawnWorker({
      entrypoint,
      env: { ...process.env, OCTO_TEST_HOST_SELECTION: "duplicate" }
    }),
    /duplicate|already registered/i
  );
});
