import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { ExtraPlugins } from "../../packages/octo-runtime-host-sdk/dist/index.js";
import load, { name } from "../../packages/octo-runtime-extra-webui/dist/index.js";
import {
  IMAGE_INPUT_LIMITS,
  assertModelInputParts
} from "../../packages/octo-runtime-protocol/dist/index.js";

function image(size = 68, mimeType = "image/png") {
  const bytes = Buffer.alloc(size);
  const header =
    mimeType === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10]
      : mimeType === "image/jpeg"
        ? [255, 216, 255]
        : [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80];
  bytes.set(header);
  return {
    type: "image",
    id: randomUUID(),
    mimeType,
    byteSize: bytes.length,
    data: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
test("155 actual HTTP image boundaries reject before execution and accept once", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-155-http-"));
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let calls = 0;
  const extras = new ExtraPlugins(
    [
      {
        name,
        config: { port, sessionStorePath: join(home, "sessions.json"), defaultProjectPath: home },
        load: async () => ({ name, default: load })
      }
    ],
    {
      invoke: async function* () {
        calls++;
        yield { type: "run.completed", payload: {} };
      }
    }
  );
  t.after(async () => {
    await extras.close();
    await rm(home, { recursive: true, force: true });
  });
  await extras.loadConfigured();
  const origin = `http://127.0.0.1:${port}`;
  const page = await fetch(origin);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const boot = await fetch(origin + "/api/bootstrap", { headers: { cookie } }).then((r) =>
    r.json()
  );
  const request = (path, body) =>
    fetch(origin + "/api" + path, {
      method: "POST",
      headers: {
        cookie,
        Origin: origin,
        "X-Webui-Token": boot.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  const session = await request("/sessions", { projectPath: home }).then((r) => r.json());
  for (const [label, inputs, status] of [
    ["four", Array.from({ length: 4 }, () => image()), 200],
    ["five", Array.from({ length: 5 }, () => image()), 400],
    ["2 MiB", [image(IMAGE_INPUT_LIMITS.maxBytes)], 200],
    ["2 MiB+1", [image(IMAGE_INPUT_LIMITS.maxBytes + 1)], 400],
    ["8 MiB total", Array.from({ length: 4 }, () => image(IMAGE_INPUT_LIMITS.maxBytes)), 200],
    [
      "total above bound",
      [...Array.from({ length: 4 }, () => image(IMAGE_INPUT_LIMITS.maxBytes)), image()],
      400
    ],
    ["JPEG", [image(68, "image/jpeg")], 200],
    ["WebP", [image(68, "image/webp")], 200],
    ["unsupported", [{ ...image(), mimeType: "image/gif" }], 400],
    [
      "bad header",
      [
        {
          ...image(),
          data: Buffer.alloc(68).toString("base64"),
          sha256: createHash("sha256").update(Buffer.alloc(68)).digest("hex")
        }
      ],
      400
    ],
    ["bad digest", [{ ...image(), sha256: "0".repeat(64) }], 400],
    ["noncanonical base64", [{ ...image(), data: "!!!!" }], 400]
  ])
    await t.test(label, async () => {
      const before = calls;
      const response = await request("/invoke", {
        inputs,
        contexts: { schema: "octo.context-envelope/v3", items: [] },
        sessionId: session.id,
        invocationId: randomUUID(),
        protocol_mode: "canonical",
        workdir: home
      });
      assert.equal(response.status, status, label);
      const body = await response.text();
      if (status === 400) assert.match(body, /WEBUI_INVOKE_INVALID/);
      else assert.match(body, /run.completed/);
      assert.equal(calls - before, status === 200 ? 1 : 0, label);
    });
  // 当前 4 × 2 MiB = 8 MiB，超总量必先触犯单图或张数；整体输入校验仍独立保留总量约束。
  assert.equal(
    IMAGE_INPUT_LIMITS.maxCount * IMAGE_INPUT_LIMITS.maxBytes,
    IMAGE_INPUT_LIMITS.maxTotalBytes
  );
  assert.throws(
    () =>
      assertModelInputParts(Array.from({ length: 5 }, () => image(IMAGE_INPUT_LIMITS.maxBytes))),
    /IMAGE_LIMIT_EXCEEDED/
  );
});
