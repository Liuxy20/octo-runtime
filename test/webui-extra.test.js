import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { ExtraPlugins, readExtraDirectory } from "../packages/octo-runtime-host-sdk/dist/index.js";
import load, { name } from "../packages/octo-runtime-extra-webui/dist/index.js";
import { SessionStore } from "../packages/octo-runtime-extra-webui/dist/store.js";
import { runCli } from "../apps/cli/dist/main.js";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function setup(t, host = {}, config = {}) {
  const home = await mkdtemp(join(tmpdir(), "octo-webui-"));
  const port = await freePort();
  const extras = new ExtraPlugins(
    [
      {
        name,
        config: {
          port,
          sessionStorePath: join(home, "sessions.json"),
          defaultProjectPath: home,
          ...config
        },
        load: async () => ({ name, default: load })
      }
    ],
    host
  );
  t.after(async () => {
    await extras.close();
    await rm(home, { recursive: true, force: true });
  });
  await extras.loadConfigured();
  assert.equal((await extras.inspect(name)).listening, true);
  const origin = `http://127.0.0.1:${port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Octo Runtime/);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const boot = await fetch(origin + "/api/bootstrap", { headers: { cookie } }).then((r) =>
    r.json()
  );
  const request = (path, method = "GET", body, headers = {}) =>
    fetch(origin + "/api" + path, {
      method,
      headers: {
        cookie,
        Origin: origin,
        "X-Webui-Token": boot.token,
        "Content-Type": "application/json",
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  return { home, port, extras, request, origin };
}
test("local browser boundary, adapter discovery, private JSON, revision fencing and bounded LRU", async (t) => {
  const { request, home, origin } = await setup(t, {
    list: async () => [{ type: "codex", available: true, providerPath: "/private/provider" }]
  });
  assert.deepEqual(await request("/adapters").then((r) => r.json()), [
    { providerType: "codex", available: true }
  ]);
  assert.equal((await fetch(origin + "/api/sessions")).status, 401);
  assert.equal(
    (await request("/sessions", "POST", { projectPath: home }, { Origin: "https://evil.example" }))
      .status,
    403
  );
  assert.equal((await fetch(origin, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  let first;
  for (let n = 0; n < 101; n++) {
    const response = await request("/sessions", "POST", { projectPath: home });
    assert.equal(response.status, 201);
    const session = await response.json();
    first ??= session.id;
  }
  const sessions = await request("/sessions").then((r) => r.json());
  assert.equal(sessions.length, 100);
  assert(!sessions.some((s) => s.id === first));
  const id = sessions[0].id;
  const detail = await request(`/sessions/${id}`).then((r) => r.json());
  const patch = {
    ...detail,
    title: "test",
    messages: [{ id: "message-1", role: "user", content: "persisted", createdAt: 1 }],
    providerSession: { sessionId: "opaque", extension: { key: "value" } }
  };
  assert.equal((await request(`/sessions/${id}`, "PATCH", patch)).status, 200);
  assert.equal((await request(`/sessions/${id}`, "PATCH", patch)).status, 409);
  assert.deepEqual(
    (await request(`/sessions/${id}`).then((r) => r.json())).providerSession,
    patch.providerSession
  );
  const restored = new SessionStore(join(home, "sessions.json"));
  await restored.open();
  assert.equal(restored.records.length, 100);
  const saved = await request(`/sessions/${id}`).then((r) => r.json());
  assert.equal(saved.revision, detail.revision + 1);
  assert.equal(saved.title, patch.title);
  assert.deepEqual(saved.messages, patch.messages);
  assert.deepEqual(saved.providerSession, patch.providerSession);
  assert.deepEqual(
    restored.records.find((s) => s.id === id),
    saved
  );
  assert.equal((await request(`/sessions/${id}`, "DELETE")).status, 200);
  assert.equal((await request(`/sessions/${id}`, "PATCH", { ...patch, revision: 1 })).status, 404);
  const afterDelete = new SessionStore(join(home, "sessions.json"));
  await afterDelete.open();
  assert.equal(afterDelete.records.length, 99);
  assert(!afterDelete.records.some((s) => s.id === id));
  assert.equal((await request("/sessions", "DELETE")).status, 200);
  assert.equal((await request("/sessions").then((r) => r.json())).length, 0);
  const afterClear = new SessionStore(join(home, "sessions.json"));
  await afterClear.open();
  assert.deepEqual(afterClear.records, []);
});
test("HTTP failed saves preserve sessions and revisions, then recover from the last committed state", async (t) => {
  const { request, home } = await setup(t);
  for (let n = 0; n < 100; n++) {
    assert.equal((await request("/sessions", "POST", { projectPath: home })).status, 201);
  }
  const path = join(home, "sessions.json");
  const before = await readFile(path, "utf8");
  const sessions = JSON.parse(before).sessions;
  const saved = sessions[0];
  const update = {
    ...saved,
    title: "must not leak",
    messages: [{ id: "failed-message", role: "user", content: "failed", createdAt: 1 }],
    providerSession: { sessionId: "failed-provider" }
  };
  const rename = t.mock.method(fs, "rename", async () => {
    throw Object.assign(new Error("injected storage failure"), { code: "EIO" });
  });
  syncBuiltinESMExports();
  try {
    // 满容量创建包含淘汰；更新和两种删除也必须在落盘失败时保持最后成功状态。
    for (const [route, method, body] of [
      ["/sessions", "POST", { projectPath: home }],
      ["/sessions/" + saved.id, "PATCH", update],
      ["/sessions/" + saved.id, "DELETE"],
      ["/sessions", "DELETE"]
    ]) {
      const response = await request(route, method, body);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "WEBUI_REQUEST_FAILED" });
      assert.equal(await readFile(path, "utf8"), before);
      assert.equal((await request("/sessions").then((r) => r.json())).length, 100);
      for (const session of sessions) {
        assert.deepEqual(await request("/sessions/" + session.id).then((r) => r.json()), session);
      }
      const loaded = new SessionStore(path);
      await loaded.open();
      assert.deepEqual(loaded.records, sessions);
      assert.deepEqual(await fs.readdir(home), ["sessions.json"]);
    }
  } finally {
    rename.mock.restore();
    syncBuiltinESMExports();
  }
  const recovery = { ...saved, title: "recovered" };
  const response = await request("/sessions/" + saved.id, "PATCH", recovery);
  assert.equal(response.status, 200);
  const committed = await response.json();
  assert.equal(committed.revision, saved.revision + 1);
  assert.equal(committed.title, recovery.title);
  assert.deepEqual(committed.messages, saved.messages);
  assert.equal(committed.providerSession, saved.providerSession);
  assert.equal((await request("/sessions/" + saved.id, "PATCH", recovery)).status, 409);
  const loaded = new SessionStore(path);
  await loaded.open();
  assert.deepEqual(
    loaded.records.find((s) => s.id === saved.id),
    committed
  );
  assert.equal((await request("/sessions/" + saved.id, "DELETE")).status, 200);
  assert.equal((await request("/sessions/" + saved.id)).status, 404);
  assert.equal((await request("/sessions", "POST", { projectPath: home })).status, 201);
});

test("canonical SSE passes unchanged and cleanup waits for active invocation cancellation", async (t) => {
  let received,
    aborted = false,
    responded;
  const event = {
    protocolVersion: 2,
    type: "message.delta",
    payload: { channel: "final", text: "hello" }
  };
  const host = {
    list: async () => [],
    async *invoke(input, { signal }) {
      received = input;
      yield event;
      await new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true }
        )
      );
    },
    async cancelInvocation() {
      return { accepted: true };
    },
    async respondInteraction(id, response) {
      responded = { id, response };
    }
  };
  const context = {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.control",
        name: "instructions",
        payload: { entries: [{ text: "我是明略科技的Octo助理" }] }
      }
    ]
  };
  const { request, home, extras } = await setup(t, host, { context });
  const session = await request("/sessions", "POST", { projectPath: home }).then((r) => r.json());
  const id = randomUUID();
  const input = {
    inputs: [{ type: "text", text: "hello" }],
    contexts: { schema: "octo.context-envelope/v3", items: [] },
    sessionId: session.id,
    invocationId: id,
    runId: id,
    protocol_mode: "canonical",
    workdir: home
  };
  const response = await request("/invoke", "POST", input);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.equal(first, `data: ${JSON.stringify(event)}\n\n`);
  assert.deepEqual(received, { ...input, contexts: context });
  assert.equal(
    (await request("/invoke", "POST", { ...input, invocationId: randomUUID() })).status,
    409
  );
  await request(`/invocations/${id}/respond`, "POST", {
    interactionId: "interaction",
    outcome: "accepted"
  });
  assert.equal(responded.id, id);
  await request(`/sessions/${session.id}`, "DELETE");
  assert.equal(aborted, true);
  assert.equal((await request(`/sessions/${session.id}`)).status, 404);
  await reader.cancel().catch(() => {});
  await extras.unload(name);
  assert.equal(extras.status[name].phase, "disposed");
});
test("CLI extraset retains explicit WebUI config and loads only the selected extra", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-webui-config-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const value = {
    module: "@mininglamp-oss/octo-runtime-extra-webui",
    enabled: true,
    config: { port: 13888, sessionStorePath: join(home, "extras/webui/sessions.json") }
  };
  await runCli(["--home", home, "extraset", "webui"], {
    input: Readable.from([JSON.stringify(value)]),
    output: () => {}
  });
  assert.deepEqual(
    JSON.parse(await readFile(join(home, "extras/webui/config.json"), "utf8")),
    value
  );
  assert.equal((await readExtraDirectory(join(home, "extras")))[0].name, "webui");
});

test("WebUI status reports occupied port and corrupted JSON without overwriting data", async (t) => {
  const { port, home } = await setup(t);
  const path = join(home, "broken.json");
  await writeFile(path, "{broken");
  const bad = new ExtraPlugins(
    [
      {
        name,
        config: { port: await freePort(), sessionStorePath: path },
        load: async () => ({ name, default: load })
      }
    ],
    {}
  );
  const occupied = new ExtraPlugins(
    [
      {
        name,
        config: { port, sessionStorePath: join(home, "other.json") },
        load: async () => ({ name, default: load })
      }
    ],
    {}
  );
  t.after(async () => {
    await bad.close();
    await occupied.close();
  });
  await bad.loadConfigured();
  assert.deepEqual((await bad.inspect(name)).errors, ["WEBUI_STORE_INVALID"]);
  assert.equal(await readFile(path, "utf8"), "{broken");
  await occupied.loadConfigured();
  assert.deepEqual((await occupied.inspect(name)).errors, ["WEBUI_ADDRESS_IN_USE"]);
});
