import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { prepareArtifacts as prepareArtifactReply } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifacts.js";
import { artifactPolicy } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/artifact-policy.js";
import {
  uploadChatAttachment,
  attachmentUrl
} from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/files.js";
import { createImInvocation } from "../packages/octo-runtime-extra-channel-gateway/dist/execution/dispatcher.js";
import { validateImConfig } from "../packages/octo-runtime-extra-channel-gateway/dist/lifecycle/configuration.js";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { WukongConnection } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { ImRuntime } from "../packages/octo-runtime-extra-channel-gateway/dist/index.js";
import { waitFor } from "./runtime-fixture.js";
import { ImSendError } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/text-send.js";

const prepareArtifacts = async (...args) => (await prepareArtifactReply(...args)).text;

const schema = "octo.context-envelope/v3";
const signal = new AbortController().signal;
const config = (workspace) => ({
  bot_id: "bot",
  api_url: "https://im-test.deepminer.com.cn/api",
  adapter: { adapter_type: "codex", workdir: workspace }
});
const context = (workspace) => ({
  schema,
  items: [
    { namespace: "octo.execution", name: "workspace", payload: { mode: "fixed", path: workspace } }
  ]
});
async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "octo-artifacts-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  return {
    workspace,
    policy: artifactPolicy(
      { ...config(workspace), artifact_delivery: { allowed_roots: [workspace] } },
      context(workspace)
    )
  };
}

test("HTML games, arbitrary files and mixed images retain exact Markdown while realpaths upload once", async (t) => {
  const { workspace, policy } = await fixture(t);
  const uploads = [];
  for (const name of [
    "game.html",
    "report.pdf",
    "deck.pptx",
    "notes.md",
    "unknown.custom",
    "a.png",
    "a.jpg",
    "a.webp",
    "a.gif",
    "a.svg",
    "a.bmp",
    "a.tiff",
    "space name.txt"
  ])
    await writeFile(join(workspace, name), `bytes:${name}`);
  await symlink(join(workspace, "a.png"), join(workspace, "alias.png"));
  const text = [
    "# Outputs",
    '[**Play**](./game.html "Game title") and [PDF](./report.pdf)',
    "[deck](./deck.pptx) [notes](./notes.md) [custom](unknown.custom)",
    '![alt](./a.png "image title") [download](./alias.png)',
    "![photo][PHOTO] and [game][game]",
    "[PHOTO]: <./a.jpg> 'Photo title'",
    '[game]: ./game.html "Game"',
    "![webp](a.webp) ![gif](a.gif) ![svg](a.svg) ![bmp](a.bmp) ![tiff](a.tiff)",
    "[spaces](<./space name.txt>)",
    `[absolute](${join(workspace, "notes.md")}) [url](${pathToFileURL(join(workspace, "notes.md"))})`,
    "[cloud](https://cdn.example.com/already.pdf) ![remote](https://cdn.example.com/image.png)",
    "[unused]: ./never-uploaded.txt"
  ].join("\n\n");
  const result = await prepareArtifacts(text, policy, signal, async (bytes, name, mime) => {
    uploads.push({ name, mime });
    assert.equal(Buffer.from(bytes).toString(), `bytes:${name}`);
    return `https://cdn.example.com/${encodeURIComponent(name)}`;
  });
  let expected = text;
  for (const name of ["game.html", "report.pdf", "deck.pptx", "notes.md", "a.png", "a.jpg"])
    expected = expected.replaceAll(`./${name}`, `https://cdn.example.com/${name}`);
  expected = expected.replace("./alias.png", "https://cdn.example.com/a.png");
  expected = expected.replace("unknown.custom", "https://cdn.example.com/unknown.custom");
  for (const name of ["a.webp", "a.gif", "a.svg", "a.bmp", "a.tiff"])
    expected = expected.replace(`](${name})`, `](https://cdn.example.com/${name})`);
  expected = expected.replace("./space name.txt", "https://cdn.example.com/space%20name.txt");
  expected = expected.replace(join(workspace, "notes.md"), "https://cdn.example.com/notes.md");
  expected = expected.replace(
    pathToFileURL(join(workspace, "notes.md")).href,
    "https://cdn.example.com/notes.md"
  );
  assert.equal(result, expected);
  assert.equal(uploads.length, 13);
  assert.equal(uploads.find((u) => u.name === "unknown.custom").mime, "application/octet-stream");
  assert.equal(uploads.find((u) => u.name === "a.tiff").mime, "image/tiff");
});

test("code, HTML, quotes and unused definitions are untouched, including definitions shared with examples", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "a.png"), "image");
  const examples =
    "`[code](./a.png)`\n\n```md\n![code](./a.png)\n```\n\n> ![quote][r]\n\n<div>\n[html](./a.png)\n</div>";
  const text = `${examples}\n\n![*live*][r] ![inline](./a.png)\n\n[r]: <./a.png> 'keep title'\n\n[unused]: ./other.txt`;
  let uploads = 0;
  const result = await prepareArtifacts(text, policy, signal, async () => {
    uploads++;
    return "https://cdn.example.com/a.png";
  });
  assert.equal(uploads, 1);
  assert.equal(
    result,
    text
      .replace("![*live*][r]", "![*live*](<https://cdn.example.com/a.png> 'keep title')")
      .replace("![inline](./a.png)", "![inline](https://cdn.example.com/a.png)")
  );
  assert.equal(
    await prepareArtifacts(examples, policy, signal, () => {
      throw Error("must not upload");
    }),
    examples
  );
});

test("protected reference expansions retain nested image uploads without overlapping edits", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "a.png"), "image");
  await writeFile(join(workspace, "game.html"), "game");
  for (const image of ["![alt](./a.png)", "![alt][image]"]) {
    const text = `> [example][game]\n\n> ![example][image]\n\n[${image} play][game]\n\n[game]: ./game.html 'Play'\n\n[image]: ./a.png 'Image'`;
    const uploads = [];
    const result = await prepareArtifacts(text, policy, signal, async (_bytes, name) => {
      uploads.push(name);
      return `https://cdn.example.com/${name}`;
    });
    const nested = image.includes("[image]")
      ? "![alt](<https://cdn.example.com/a.png> 'Image')"
      : "![alt](https://cdn.example.com/a.png)";
    assert.equal(
      result,
      text.replace(
        `[${image} play][game]`,
        `[${nested} play](<https://cdn.example.com/game.html> 'Play')`
      )
    );
    assert.deepEqual(uploads.sort(), ["a.png", "game.html"]);
  }
});

test("partial failure preserves successful URLs and reports inaccessible, forbidden and non-file paths", async (t) => {
  const { workspace, policy } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "octo-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "secret.txt"), "private");
  await symlink(join(outside, "secret.txt"), join(workspace, "escape.txt"));
  await mkdir(join(workspace, "directory"));
  await writeFile(join(workspace, "good.html"), "game");
  const calls = [];
  const upload = async (_bytes, name) => {
    calls.push(name);
    return "https://cdn.example.com/good.html";
  };
  const text = `[good](good.html) [missing](missing.pdf) [escape](escape.txt) [dir](directory) [outside](${join(outside, "secret.txt")}) [windows](C:/provider/out.pdf)`;
  const result = await prepareArtifacts(text, policy, signal, upload);
  assert.deepEqual(calls, ["good.html"]);
  assert.match(result, /\[good\]\(https:\/\/cdn.example.com\/good.html\)/);
  for (const reason of [
    "file-unavailable",
    "directory-policy",
    "not-regular-file",
    "path-unavailable"
  ])
    assert.ok(result.includes(reason), reason);
  assert.match(result, /generation was not rerun/);
});

test("size, total, count, MIME and root policies reject before transfer", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "one.txt"), "1234");
  await writeFile(join(workspace, "two.txt"), "1234");
  for (const [override, reason, expectedCalls] of [
    [{ maxFileBytes: 3 }, "file-size-limit", 0],
    [{ maxTotalBytes: 5 }, "total-size-limit", 1],
    [{ maxFiles: 1 }, "file-count-limit", 1],
    [{ mimeTypes: [] }, "type-policy", 0],
    [{ roots: [] }, "directory-policy", 0]
  ]) {
    let calls = 0;
    const output = await prepareArtifacts(
      "[one](one.txt) [two](two.txt)",
      { ...policy, ...override },
      signal,
      async () => {
        calls++;
        return "https://cdn.example.com/file";
      }
    );
    assert.equal(calls, expectedCalls);
    assert.ok(output.includes(reason));
  }
});

test("upload failure is cached across aliases and owner cancellation stops preparation", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "file.txt"), "bytes");
  let calls = 0;
  const failure = await prepareArtifacts(
    "[a](file.txt) [b](./file.txt)",
    policy,
    signal,
    async () => {
      calls++;
      throw new Error("service-rejected");
    }
  );
  assert.equal(calls, 1);
  assert.match(failure, /service-rejected/);
  const owner = new AbortController();
  const operation = prepareArtifacts(
    "[a](file.txt)",
    policy,
    owner.signal,
    async (_bytes, _name, _mime, uploadSignal) => {
      owner.abort();
      uploadSignal.throwIfAborted();
    }
  );
  await assert.rejects(operation, { name: "AbortError" });
  const timed = await prepareArtifacts(
    "[a](file.txt)",
    { ...policy, timeoutMs: 5 },
    signal,
    async (_bytes, _name, _mime, uploadSignal) => {
      await new Promise((_resolve, reject) =>
        uploadSignal.addEventListener("abort", () => reject(uploadSignal.reason), { once: true })
      );
    }
  );
  assert.match(timed, /delivery-timeout/);
});

test("chat upload uses signed PUT headers and exposes only the persistent download URL", async (t) => {
  const token = `bf_${randomUUID()}`;
  const uploadUrl = `https://storage.example.com/object?signature=${randomUUID()}`;
  for (const downloadUrl of ["https://cdn.example.com/chat/game.html", "assets/game.html"]) {
    let puts = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(init.redirect, "error");
      if (init.method === "GET") {
        assert.equal(new URL(url).pathname, "/api/v1/bot/upload/presigned");
        assert.equal(new URL(url).searchParams.get("filename"), "game.html");
        assert.equal(new URL(url).searchParams.get("fileSize"), "17");
        assert.equal(init.headers.Authorization, `Bearer ${token}`);
        return Response.json({
          method: "PUT",
          uploadUrl,
          downloadUrl,
          contentType: "text/html; charset=utf-8",
          contentDisposition: "attachment; filename=game.html",
          maxFileSize: 17,
          expiredTime: Math.floor(Date.now() / 1000) + 60
        });
      }
      puts++;
      assert.equal(init.method, "PUT");
      assert.equal(url, uploadUrl);
      assert.deepEqual(init.headers, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "attachment; filename=game.html"
      });
      assert.equal(Buffer.from(init.body).toString(), "<html>game</html>");
      return new Response(null, { status: 200 });
    });
    const url = await uploadChatAttachment(
      config().api_url,
      token,
      Buffer.from("<html>game</html>"),
      "game.html",
      "text/html",
      signal
    );
    assert.equal(
      url,
      downloadUrl.startsWith("https:")
        ? downloadUrl
        : "https://im-test.deepminer.com.cn/api/assets/game.html"
    );
    assert.equal(puts, 1);
  }
  for (const raw of [
    "file:///secret",
    "javascript:evil",
    `https://${randomUUID()}:${randomUUID()}@cdn.example.com/a`,
    `https://cdn.example.com/a?X-Amz-Signature=${randomUUID()}`,
    "file/preview/chat/a.html",
    "/v1/bot/file/download/a",
    "/api/v1/botfile/chat/a.html"
  ])
    assert.throws(() => attachmentUrl(raw, config().api_url));
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(65537)));
  await assert.rejects(
    uploadChatAttachment(config().api_url, token, Buffer.from("x"), "a.txt", "text/plain", signal),
    /byte limit/
  );
});

test("invalid or expired upload grants are rejected before any bytes leave Gateway", async (t) => {
  const valid = {
    method: "PUT",
    uploadUrl: `https://storage.example.com/object?sig=${randomUUID()}`,
    downloadUrl: "https://cdn.example.com/a.txt",
    contentType: "text/plain",
    maxFileSize: 1
  };
  for (const override of [
    { method: "POST" },
    { uploadUrl: "http://storage.example.com/object" },
    { uploadUrl: `https://${randomUUID()}:${randomUUID()}@storage.example.com/object` },
    { downloadUrl: `https://cdn.example.com/a.txt?sig=${randomUUID()}` },
    { downloadUrl: "/v1/botfile/chat/a.txt" },
    { maxFileSize: 2 },
    { expiredTime: Math.floor(Date.now() / 1000) - 1 },
    { contentType: `text/plain\r\nAuthorization: ${randomUUID()}` },
    { contentDisposition: `attachment\r\nAuthorization: ${randomUUID()}` }
  ]) {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      requests++;
      assert.equal(init.method, "GET");
      return Response.json({ ...valid, ...override });
    });
    await assert.rejects(
      uploadChatAttachment(
        config().api_url,
        `bf_${randomUUID()}`,
        Buffer.from("x"),
        "a.txt",
        "text/plain",
        signal
      )
    );
    assert.equal(requests, 1);
  }
});

test("invocation establishes the contract before execution and cannot accept forged access policy from Context", async () => {
  for (const mode of [undefined, "tools"]) {
    const bot = {
      ...config(process.cwd()),
      artifact_delivery: { allowed_roots: [process.cwd()], ...(mode ? { mode } : {}) }
    };
    const submitted = {
      schema,
      items: [
        { namespace: "extra.im", name: "artifact-delivery", payload: { allowedRoots: ["/"] } }
      ]
    };
    const original = structuredClone(submitted);
    const { request } = createImInvocation(
      bot,
      { messageId: "m", text: "Create a game" },
      submitted,
      "key",
      { id: "session", generation: 1 },
      signal
    );
    const contract = request.contexts.items.find((item) => item.name === "artifact-delivery");
    assert.equal(contract.payload.mode, mode ?? "channel");
    assert.deepEqual(contract.payload.allowedRoots, [process.cwd()]);
    if (mode) assert.match(contract.guidance, /does not automatically upload/);
    else {
      assert.equal(
        contract.guidance,
        "If your final deliverable is a local file, reference it using Markdown with an absolute path: [label](/absolute/path); for images, use ![alt](/absolute/path)."
      );
      assert.doesNotMatch(contract.guidance, /upload|tool calls|Do not send|publish/);
    }
    assert.deepEqual(submitted, original);
  }
  const noUpload = "[cloud](https://cdn.example.com/game.html)";
  assert.equal(
    await prepareArtifacts(noUpload, { mode: "tools" }, signal, () => {
      throw Error();
    }),
    noUpload
  );
  for (const invalid of [
    null,
    { mode: "guess" },
    { allowed_roots: ["relative"] },
    { max_file_bytes: 999999999 },
    { allowed_mime_types: ["*"] }
  ])
    assert.throws(
      () => validateImConfig({ ...config(process.cwd()), artifact_delivery: invalid }),
      /ARTIFACT_CONFIG/
    );
});

test("invocation freezes delivery mode and allowed roots before SDK configuration changes", () => {
  const bot = {
    ...config(process.cwd()),
    artifact_delivery: { allowed_roots: [process.cwd()] }
  };
  const prepared = createImInvocation(
    bot,
    { messageId: "m", text: "Output" },
    context(process.cwd()),
    "key",
    { id: "session", generation: 1 },
    signal
  );
  bot.artifact_delivery.mode = "tools";
  bot.artifact_delivery.allowed_roots.push(tmpdir());
  assert.equal(prepared.artifacts.mode, "channel");
  assert.deepEqual(prepared.artifacts.roots, [process.cwd()]);
  assert.deepEqual(
    prepared.request.contexts.items.find((item) => item.name === "artifact-delivery").payload
      .allowedRoots,
    [process.cwd()]
  );
});

for (const cardState of ["failed", "unknown"]) {
  test(`transport preserves links and sends native cards once across text retries, with explicit ${cardState} card receipts`, async (t) => {
    const { workspace, policy } = await fixture(t);
    await writeFile(join(workspace, "game.html"), "html");
    await writeFile(join(workspace, "notes.md"), "markdown");
    await writeFile(join(workspace, "image.png"), "image");
    const token = `bf_${randomUUID()}`;
    let receive,
      inbound,
      uploads = 0;
    const sends = [];
    const cards = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("/auth/verify-bot")) return Response.json({ bot_uid: "bot", space_id: "s" });
      if (url.endsWith("/bot/register"))
        return Response.json({
          robot_id: "bot",
          ws_url: "wss://im-test.deepminer.com.cn/ws",
          im_token: randomUUID()
        });
      if (url.includes("upload/presigned")) {
        const name = new URL(url).searchParams.get("filename");
        return Response.json({
          method: "PUT",
          uploadUrl: `https://storage.example.com/${name}?sig=${randomUUID()}`,
          downloadUrl: `https://cdn.example.com/chat/generated-${name}`
        });
      }
      if (url.startsWith("https://storage.example.com/")) {
        uploads++;
        return new Response(null, { status: 200 });
      }
      if (url.includes("/user/info"))
        return Response.json({ uid: "owner", name: "Owner", robot: false });
      throw new Error("unexpected-request");
    });
    t.mock.method(WukongConnection.prototype, "connect", async function () {
      receive = this.onMessage;
    });
    t.mock.getter(WukongConnection.prototype, "connected", () => true);
    t.mock.method(WukongConnection.prototype, "close", async () => {});
    t.mock.method(WukongConnection.prototype, "sendFile", async (...args) => {
      cards.push(args);
      if (args[2].name === "notes.md") throw new ImSendError("IM_SEND_TEST_RECEIPT", cardState);
      return "file-sent";
    });
    t.mock.method(WukongConnection.prototype, "sendText", async (...args) => {
      sends.push(args);
      if (sends.length === 1) throw new Error("retry");
      return "sent";
    });
    const transport = new GatewayTransport(
      { ...config(workspace), cards: false },
      async () => token,
      {
        onMessage(message) {
          inbound = message;
        },
        onDisconnect() {}
      }
    );
    await transport.start(signal);
    t.after(() => transport.close());
    receive({
      messageId: "m",
      fromUid: "owner",
      channelId: "owner",
      channelType: 1,
      payload: { type: 1, content: "create a game" }
    });
    const text =
      "[Play](game.html) [Again](./game.html) [Notes][n] ![Image](image.png) @[owner:Owner]\n\n[n]: notes.md";
    const options = {
      artifacts: policy,
      signal,
      obsolete: () => false
    };
    await assert.rejects(inbound.replyFinal(text, "final:run", options), /retry/);
    await inbound.replyFinal(text, "final:run", options);
    assert.equal(uploads, 3);
    assert.equal(cards.length, 2);
    assert.deepEqual(cards[0][2], {
      url: "https://cdn.example.com/chat/generated-game.html",
      name: "game.html",
      size: 4,
      extension: "html"
    });
    assert.notEqual(cards[0][3], cards[1][3]);
    assert.equal(transport.status.cardDeliveries, 2);
    assert.equal(sends.length, 2);
    assert.equal(sends[0][3], sends[1][3]);
    assert.ok(sends[1][2].startsWith("[Play](https://cdn.example.com/chat/generated-game.html)"));
    assert.match(sends[1][2], /\[Again\]\(https:\/\/cdn.example.com\/chat\/generated-game.html\)/);
    assert.match(sends[1][2], /!\[Image\]\(https:\/\/cdn.example.com\/chat\/generated-image.png\)/);
    assert.match(sends[1][2], /\[n\]: https:\/\/cdn.example.com\/chat\/generated-notes.md/);
    assert.match(
      sends[1][2],
      new RegExp(
        `File card delivery unconfirmed: notes.md \\(${cardState}: IM_SEND_TEST_RECEIPT\\)`
      )
    );
    const mention = sends[1][5].entities[0];
    assert.equal(sends[1][2].slice(mention.offset, mention.offset + mention.length), "@Owner");
    await inbound.replyFinal(
      "[Already uploaded](https://cdn.example.com/tool.html)",
      "final:tool",
      options
    );
    assert.equal(uploads, 3);
    assert.equal(cards.length, 2);
  });
}

test("native card preparation follows ordinary link usage while images stay inline and aliases share one upload", async (t) => {
  const { workspace, policy } = await fixture(t);
  await writeFile(join(workspace, "image.png"), "image");
  await symlink(join(workspace, "image.png"), join(workspace, "alias.png"));
  let uploads = 0;
  const upload = async () => {
    uploads++;
    return "https://cdn.example.com/image.png";
  };
  const imageOnly = await prepareArtifactReply(
    "> [example][image]\n\n![Photo][image]\n\n[image]: image.png",
    policy,
    signal,
    upload
  );
  assert.deepEqual(imageOnly.files, []);
  const mixed = await prepareArtifactReply(
    "![Photo][image]\n\n[Download][image] [Alias](alias.png)\n\n[image]: image.png",
    policy,
    signal,
    upload
  );
  assert.equal(uploads, 2);
  assert.deepEqual(mixed.files, [
    {
      url: "https://cdn.example.com/image.png",
      name: "image.png",
      size: 5,
      extension: "png"
    }
  ]);
  assert.match(mixed.text, /!\[Photo\]\[image\]/);
  assert.match(mixed.text, /\[Download\]\[image\]/);
  assert.match(mixed.text, /\[image\]: https:\/\/cdn.example.com\/image.png/);
});

for (const command of ["/stop", "/reset", "shutdown"]) {
  test(`${command} cancels in-flight final delivery without rerunning generation`, async (t) => {
    let receive,
      entered = false,
      aborted = false,
      calls = 0;
    const replies = [];
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = (message) => this.callbacks.onMessage(message);
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(config(process.cwd()), {
      kernel: {
        async *invoke() {
          calls++;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "[Game](game.html)" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          return { accepted: false };
        }
      }
    });
    await runtime.start();
    const message = {
      messageId: "m",
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text: "create a game",
      async buildContext() {
        return { schema, items: [] };
      },
      async reply(text) {
        replies.push(text);
      },
      async replyFinal(_text, _key, options) {
        entered = true;
        assert.equal(options.artifacts.workspace, process.cwd());
        await new Promise((resolve) =>
          options.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          )
        );
        assert.equal(options.obsolete(), true);
        options.signal.throwIfAborted();
      }
    };
    receive(message);
    await waitFor(() => entered);
    if (command === "shutdown") await assert.rejects(runtime.close(), /DISPOSE_FAILED/);
    else {
      receive({ ...message, messageId: "control", text: command });
      await waitFor(() => aborted && runtime.status.sessions.length === 0);
      await runtime.close();
    }
    assert.equal(aborted, true);
    assert.equal(calls, 1);
    assert.equal(
      replies.some((reply) => reply.includes("[Game]")),
      false
    );
  });
}

for (const scenario of ["/stop", "/reset", "shutdown", "finish-error-stop", "complete"]) {
  test(`presentation cleanup retains final-delivery cancellation ownership: ${scenario}`, async (t) => {
    const { workspace } = await fixture(t);
    await writeFile(join(workspace, "game.html"), "game");
    let receive,
      release,
      finishing = false,
      calls = 0,
      cancellations = 0,
      uploads = 0,
      cards = 0;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const replies = [],
      finals = [],
      snapshots = [],
      terminals = [];
    t.mock.method(GatewayTransport.prototype, "start", async function () {
      receive = (message) => this.callbacks.onMessage(message);
    });
    t.mock.method(GatewayTransport.prototype, "close", async () => {});
    const runtime = new ImRuntime(config(workspace), {
      kernel: {
        async *invoke() {
          calls++;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "[Game](game.html)" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          cancellations++;
          return { accepted: false };
        }
      },
      log(_level, event, data) {
        if (event === "agent_run.finished") terminals.push(data.status);
      }
    });
    t.after(async () => {
      release();
      await runtime.close().catch(() => {});
    });
    await runtime.start();
    const message = {
      messageId: "create",
      senderId: "owner",
      conversationId: "owner",
      conversationKind: "direct",
      text: "create a game",
      async buildContext() {
        return { schema, items: [] };
      },
      async reply(text) {
        replies.push(text);
      },
      beginPresentation() {
        return {
          update(snapshot) {
            snapshots.push(snapshot);
          },
          async finish() {
            finishing = true;
            await gate;
            if (scenario === "finish-error-stop") throw new Error("synthetic finish failure");
          }
        };
      },
      async replyFinal(text, _key, options) {
        options.signal.throwIfAborted();
        assert.equal(options.obsolete(), false);
        const prepared = await prepareArtifactReply(
          text,
          options.artifacts,
          options.signal,
          async (_bytes, name) => {
            uploads++;
            return `https://cdn.example.com/${name}`;
          }
        );
        cards += prepared.files.length;
        finals.push(prepared.text);
      }
    };
    receive(message);
    await waitFor(() => finishing);
    assert.deepEqual(terminals, ["completed"]);
    assert.equal(snapshots.at(-1).terminal, "completed");
    assert.deepEqual(runtime.status.tasks, []);
    assert.equal(runtime.status.sessions[0].active, false);
    assert.equal(uploads, 0);
    if (scenario === "shutdown") await assert.rejects(runtime.close(), /IM_DISPOSE_FAILED/);
    else if (scenario !== "complete") {
      receive({
        ...message,
        messageId: "control",
        text: scenario === "finish-error-stop" ? "/stop" : scenario
      });
      await waitFor(() => replies.length > 0);
    }
    release();
    await waitFor(() => runtime.status.sessions.length === 0);
    assert.equal(calls, 1);
    assert.equal(cancellations, 0, "a confirmed completed execution must not be cancelled again");
    assert.deepEqual(terminals, ["completed"]);
    assert.equal(uploads, scenario === "complete" ? 1 : 0);
    assert.equal(cards, scenario === "complete" ? 1 : 0);
    assert.equal(finals.length, scenario === "complete" ? 1 : 0);
    if (scenario === "complete")
      assert.equal(finals[0], "[Game](https://cdn.example.com/game.html)");
    if (scenario !== "shutdown") {
      if (scenario === "/stop" || scenario === "finish-error-stop")
        assert.ok(replies.includes("已请求停止本轮执行。"));
      receive({ ...message, messageId: "after", text: "/stop" });
      await waitFor(() => replies.at(-1) === "当前没有可停止的执行。");
      await runtime.close();
    }
  });
}
