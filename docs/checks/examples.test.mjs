import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createKernelService, componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { runOwnedInvocation } from "../examples/service.mts";
import { invokeOnce } from "../examples/invoke.mts";
import { invokeInteractive } from "../examples/interactions.mts";
import { imagePart } from "../examples/image.mts";

const root = resolve(import.meta.dirname, "../..");
const input = (text = "documentation example") =>
  InvokeInput.check({
    inputs: [{ type: "text", text }],
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "test" } }]
    }
  });

async function options(t) {
  const directory = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ord-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    endpoint: componentEndpoint(directory),
    workerEntrypoint: join(root, "test/fixtures/direct-invoke-worker.mjs")
  };
}

test("shared public SDK service example consumes the actual Kernel stream and closes", async (t) => {
  let text = "",
    terminal;
  await runOwnedInvocation(await options(t), input(), (event) => {
    if (event.type === "message.delta") text += event.payload.text ?? "";
    if (event.type.startsWith("run.")) terminal = event.type;
  });
  assert.equal(text, "answer");
  assert.equal(terminal, "run.completed");
});

test("interactive example routes a caller decision through the original invocation", async (t) => {
  const service = createKernelService(await options(t));
  try {
    await service.initialize();
    let asked = 0;
    await invokeInteractive(
      service.client,
      input("interaction"),
      async (request) => {
        asked++;
        return { interactionId: request.interactionId, outcome: "answered", value: "example" };
      },
      () => {}
    );
    assert.equal(asked, 1);
  } finally {
    assert.equal((await service.close()).complete, true);
  }
});

test("invoke helper preserves cancellation reason after consuming the tail", async (t) => {
  const service = createKernelService(await options(t));
  const controller = new AbortController(),
    reason = new Error("example cancellation");
  try {
    await service.initialize();
    const timer = setTimeout(() => controller.abort(reason), 200);
    try {
      await assert.rejects(
        invokeOnce(service.client, input("wait-for-cancel"), () => {}, controller.signal),
        (error) => error === reason
      );
    } finally {
      clearTimeout(timer);
    }
  } finally {
    assert.equal((await service.close()).complete, true);
  }
});

test("image helper computes matching bytes and digest; malformed input is rejected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ord-img-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "pixel.png");
  await writeFile(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=",
      "base64"
    )
  );
  const part = await imagePart(path, "image/png");
  InvokeInput.check({ ...input(), inputs: [part] });
  assert.throws(() =>
    InvokeInput.check({ ...input(), inputs: [{ ...part, sha256: "0".repeat(64) }] })
  );
  assert.throws(() => InvokeInput.check({ ...input(), inputs: [] }));
});
