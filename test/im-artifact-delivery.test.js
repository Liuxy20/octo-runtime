import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
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
import { ImSendError } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/send-error.js";
import { ImDeliveryDispatcher } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/dispatcher.js";
import { ImRunProjector } from "../packages/octo-runtime-extra-channel-gateway/dist/presentation/run-projector.js";
import { CardSession } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/card-session.js";

import { stableEffectKey } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js";
import { ImDeliveryIdentity } from "../packages/octo-runtime-extra-channel-gateway/dist/delivery/identity.js";
import { OctoConnector } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js";
import { OctoApiError } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/api/errors.js";
import { symlinkFixture } from "../test-support/symlink-fixture.mjs";

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

function reconnectTransportFixture(t) {
  const connections = [],
    sends = [],
    files = [],
    cards = [],
    cardProfiles = [],
    closed = new Set();
  let principal = { bot_uid: "bot", space_id: "s" };
  let cardResponse;
  let onCardProfile;
  let onRequest;
  const requests = [];
  const token = `bf_${randomUUID()}`;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    options.signal?.throwIfAborted();
    requests.push({ url, options });
    const intercepted = await onRequest?.(url, options);
    if (intercepted) return intercepted;
    if (url.endsWith("/auth/verify-bot")) return Response.json(principal);
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: principal.bot_uid,
        ws_url: "wss://im-test.deepminer.com.cn/ws",
        im_token: randomUUID()
      });
    if (url.includes("/user/info")) return Response.json({ uid: "owner", name: "Owner" });
    if (url.endsWith("/bot/events")) return Response.json({ results: [] });
    if (url.endsWith("/bot/card/profile")) {
      cardProfiles.push(url);
      await onCardProfile?.();
      const ref = { id: "ai.reasoning-process", version: "0.4.1" };
      return Response.json({
        available: true,
        enabled: true,
        card_version: "1.5",
        profiles: ["octo/v1", "octo/v2"],
        config: {
          card_enabled: true,
          display_enabled: true,
          interaction_enabled: true,
          reasoning_enabled: true,
          reasoning_template_ref: ref
        },
        templating: {
          supported: true,
          wire: "template-ref/v1",
          templates: [
            {
              ...ref,
              views: [
                {
                  name: "active",
                  wire_profile: "octo/v2",
                  states: ["reasoning", "answering"],
                  submit_actions: ["reasoning_stop"]
                },
                {
                  name: "error",
                  wire_profile: "octo/v2",
                  states: ["error"],
                  submit_actions: ["reasoning_retry"]
                },
                {
                  name: "result",
                  wire_profile: "octo/v1",
                  states: ["completed", "stopped"],
                  submit_actions: []
                }
              ]
            }
          ]
        }
      });
    }
    if (url.endsWith("/bot/sendMessage") || url.endsWith("/bot/message/edit")) {
      const request = { url, body: JSON.parse(options.body), signal: options.signal };
      const { payload, channel_id, channel_type, client_msg_no } = request.body;
      if (payload?.type === 1 || payload?.type === 8) {
        const args = [
          channel_id,
          channel_type,
          payload.type === 1
            ? payload.content
            : Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "type")),
          client_msg_no,
          undefined,
          payload.mention
        ];
        (payload.type === 1 ? sends : files).push({ args });
        return Response.json({ message_id: `rest-${sends.length}-${files.length}` });
      }
      cards.push(request);
      if (cardResponse) return cardResponse(request);
      return Response.json({ message_id: "progress-card" });
    }
    if (url.includes("upload/presigned"))
      return Response.json({
        method: "PUT",
        uploadUrl: `https://storage.example.com/game.html?sig=${randomUUID()}`,
        downloadUrl: "https://cdn.example.com/game.html"
      });
    if (url.startsWith("https://storage.example.com/")) return new Response(null, { status: 200 });
    throw Error("unexpected-request");
  });
  t.mock.method(WukongConnection.prototype, "connect", async function () {
    connections.push(this);
  });
  t.mock.getter(WukongConnection.prototype, "connected", function () {
    return !closed.has(this);
  });
  t.mock.method(WukongConnection.prototype, "close", async function () {
    closed.add(this);
  });
  const message = {
    messageId: "long-task",
    fromUid: "owner",
    channelId: "owner",
    channelType: 1,
    payload: { type: 1, content: "sleep 30 seconds, then reply" }
  };
  return {
    token,
    connections,
    sends,
    files,
    cards,
    cardProfiles,
    requests,
    setRequestHook(value) {
      onRequest = value;
    },
    message,
    setCardProfileHook(value) {
      onCardProfile = value;
    },
    setCardResponse(value) {
      cardResponse = value;
    },
    setPrincipal(value) {
      principal = value;
    }
  };
}

// Exercise retained callbacks through real GatewayTransport requests and final preparation.
async function ownedTransportFixture(t) {
  const f = reconnectTransportFixture(t);
  const owner = new AbortController();
  const sockets = [];
  const transports = [];
  let current,
    inbound,
    heldToken = f.token;
  const lifetime = {
    signal: owner.signal,
    dispatcher: new ImDeliveryDispatcher(owner.signal),
    identity: new ImDeliveryIdentity(),
    token: () => heldToken
  };
  const replace = async (token = f.token, authenticate = true) => {
    heldToken = token;
    const socket = new AbortController();
    sockets.push(socket);
    current = new GatewayTransport(
      { ...config(process.cwd()), typing: false },
      async () => token,
      {
        onMessage: (message) => {
          inbound = message;
        },
        onDisconnect() {}
      },
      lifetime
    );
    transports.push(current);
    if (authenticate) await current.start(socket.signal);
    return current;
  };
  t.after(async () => {
    owner.abort();
    await Promise.all(transports.map((transport) => transport.close()));
  });
  const first = await replace();
  f.connections[0].onMessage(f.message);
  return {
    ...f,
    owner,
    sockets,
    first,
    get inbound() {
      return inbound;
    },
    replace
  };
}

const failedRun = {
  protocolVersion: 2,
  type: "run.failed",
  payload: { code: "PROVIDER_FAILED", message: "Provider failed after reconnect" }
};

for (const stage of ["cleanup", "retry-backoff"]) {
  for (const outcome of stage === "cleanup"
    ? ["same", "changed", "task-stop", "owner-stop", "http-denied"]
    : ["same", "changed"]) {
    test(`REST retirement: ${stage} remains independent of WS and handles ${outcome}`, async (t) => {
      const f = reconnectTransportFixture(t);
      let inbound,
        releaseCleanup,
        closeEntered = false;
      let credential = f.token;
      const cleanup = new Promise((resolve) => {
        releaseCleanup = resolve;
      });
      const originalStart = GatewayTransport.prototype.start;
      t.mock.method(GatewayTransport.prototype, "start", function (signal) {
        this.callbacks.onMessage = (message) => {
          inbound = message;
        };
        return originalStart.call(this, signal);
      });
      const originalClose = WukongConnection.prototype.close;
      t.mock.method(WukongConnection.prototype, "close", async function () {
        await originalClose.call(this);
        if (this === f.connections[0]) {
          closeEntered = true;
          await cleanup;
        }
      });
      const runtime = new ImRuntime(
        { ...config(process.cwd()), typing: false },
        {
          credentials: async () => credential,
          kernel: {
            async *invoke() {
              assert.fail("delivery must not rerun execution");
            }
          }
        }
      );
      t.after(async () => {
        releaseCleanup();
        t.mock.timers.reset();
        await runtime.close();
      });
      await runtime.start();
      f.connections[0].onMessage(f.message);
      t.mock.timers.enable({ apis: ["setTimeout"] });
      if (outcome === "changed") credential = `bf_${randomUUID()}`;
      f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
      for (let i = 0; i < 80; i++) await Promise.resolve();
      assert.equal(closeEntered, true);
      if (stage === "retry-backoff") {
        releaseCleanup();
        for (let i = 0; i < 80; i++) await Promise.resolve();
      }
      assert.equal(runtime.status.state, "retrying");
      assert.equal(f.connections.length, 1, "replacement must not be published yet");
      const task = new AbortController();
      if (outcome === "task-stop") task.abort();
      if (outcome === "owner-stop") {
        releaseCleanup();
        await runtime.close();
      }
      if (outcome === "http-denied")
        f.setRequestHook((url) =>
          url.endsWith("/bot/sendMessage") ? new Response(null, { status: 403 }) : undefined
        );
      let settled = false;
      const operation = inbound
        .replyFailure(failedRun, "retiring:failure", { signal: task.signal })
        .then(
          () => {
            settled = true;
          },
          (error) => {
            settled = true;
            return error;
          }
        );
      for (let i = 0; i < 80; i++) await Promise.resolve();
      assert.equal(settled, true, "REST must settle without waiting for WS replacement");
      if (outcome === "task-stop" || outcome === "owner-stop") {
        const error = await operation;
        assert.ok(error.code === "IM_DELIVERY_CANCELLED" || error.name === "AbortError");
        assert.equal(f.cardProfiles.length, 0);
        releaseCleanup();
        return;
      }
      const error = await operation;
      if (outcome === "http-denied") {
        assert.equal(error.status, 403);
        assert.equal(f.cards.length, 0);
      } else {
        assert.equal(error, undefined);
        assert.equal(f.cards.length, 1);
        assert.equal(
          new Headers(
            f.requests.find(({ url }) => url.endsWith("/bot/sendMessage")).options.headers
          ).get("Authorization"),
          `Bearer ${f.token}`,
          "use the owner-held init value; external source freshness is not required"
        );
      }
      releaseCleanup();
      for (let i = 0; i < 80; i++) await Promise.resolve();
      t.mock.timers.tick(0);
      for (let i = 0; i < 150; i++) await Promise.resolve();
    });
  }
}

test("REST retirement: pending and failed WS handshakes do not pause REST", async (t) => {
  const f = reconnectTransportFixture(t);
  let inbound, rejectHandshake, releaseCleanup;
  const handshake = new Promise((_, reject) => {
    rejectHandshake = reject;
  });
  const cleanup = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const originalStart = GatewayTransport.prototype.start;
  t.mock.method(GatewayTransport.prototype, "start", function (signal) {
    this.callbacks.onMessage = (message) => {
      inbound = message;
    };
    return originalStart.call(this, signal);
  });
  const originalConnect = WukongConnection.prototype.connect;
  t.mock.method(WukongConnection.prototype, "connect", async function (registration) {
    await originalConnect.call(this, registration);
    if (this === f.connections[1]) await handshake;
  });
  const originalClose = WukongConnection.prototype.close;
  t.mock.method(WukongConnection.prototype, "close", async function () {
    await originalClose.call(this);
    if (this === f.connections[1]) await cleanup;
  });
  const runtime = new ImRuntime(
    { ...config(process.cwd()), bf_token: f.token, typing: false },
    {
      kernel: {
        async *invoke() {
          assert.fail("delivery must not rerun execution");
        }
      }
    }
  );
  t.after(async () => {
    releaseCleanup();
    t.mock.timers.reset();
    await runtime.close();
  });
  await runtime.start();
  f.connections[0].onMessage(f.message);
  let now = performance.now();
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
  for (let i = 0; i < 80; i++) await Promise.resolve();
  t.mock.timers.tick(0);
  for (let i = 0; i < 150; i++) await Promise.resolve();
  assert.equal(f.connections.length, 2);
  assert.equal(runtime.status.state, "retrying");
  await inbound.replyFailure(failedRun, "verified:failure");
  assert.equal(f.cards.length, 1, "verified REST must not wait for WS online");
  rejectHandshake(new Error("IM_DISCONNECTED"));
  for (let i = 0; i < 80; i++) await Promise.resolve();
  const profiles = f.cardProfiles.length;
  const operation = inbound.replyFailure(failedRun, "failed-handshake:failure");
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.equal(f.cardProfiles.length, profiles + 1, "failed WS handshake cannot block REST");
  await operation;
  assert.equal(f.cards.length, 2, "REST completes while failed WS cleanup is still pending");
  releaseCleanup();
  for (let i = 0; i < 80; i++) await Promise.resolve();
  now += 1000;
  t.mock.timers.tick(1000);
  for (let i = 0; i < 150; i++) await Promise.resolve();
  await operation;
  assert.equal(f.cards.length, 2);
});

// Advance the real Runtime reconnect timer at adjacent microtask boundaries;
// publishing an unverified WS must never block REST using the owner's init credential.
for (let microtasks = 0; microtasks <= 32; microtasks++) {
  test(`HTTP dispatch race: reconnect after ${microtasks} continuations leaves REST independent`, async (t) => {
    const f = reconnectTransportFixture(t);
    let inbound;
    const originalStart = GatewayTransport.prototype.start;
    t.mock.method(GatewayTransport.prototype, "start", function (signal) {
      this.callbacks.onMessage = (message) => {
        inbound = message;
      };
      return originalStart.call(this, signal);
    });
    const runtime = new ImRuntime(
      { ...config(process.cwd()), bf_token: f.token, typing: false },
      {
        kernel: {
          async *invoke() {
            assert.fail("delivery must not invoke a provider");
          }
        }
      }
    );
    let release;
    const verification = new Promise((resolve) => {
      release = resolve;
    });
    t.after(async () => {
      release();
      t.mock.timers.reset();
      await runtime.close();
    });
    await runtime.start();
    f.connections[0].onMessage(f.message);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    let authenticating = false;
    f.setRequestHook(async (url) => {
      if (url.endsWith("/auth/verify-bot")) {
        authenticating = true;
        await verification;
      }
    });
    const operation = inbound.replyFailure(failedRun, "dispatch-race");
    for (let i = 0; i < microtasks; i++) await Promise.resolve();
    t.mock.timers.tick(0);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    assert.equal(authenticating, true, "real reconnect must be pending verification");
    await operation;
    assert.equal(f.cards.length, 1, "REST must finish before WS verification is released");
    for (const { url, options } of f.requests) {
      if (url.endsWith("/bot/sendMessage"))
        assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${f.token}`);
    }
    release();
    await operation;
    assert.equal(f.cards.length, 1, "same identity resumes without duplicating the card");
  });
}

for (const path of ["failure", "progress"]) {
  for (const stage of ["before-profile", "before-write"]) {
    test(`auth recovery: ${path} sends once ${stage} without waiting for WS verification`, async (t) => {
      const f = await ownedTransportFixture(t);
      f.sockets[0].abort();
      await f.first.close();
      let release,
        authenticating = false,
        start;
      const auth = new Promise((resolve) => {
        release = resolve;
      });
      t.after(async () => {
        release();
        await start?.catch(() => {});
      });
      f.setRequestHook(async (url) => {
        if (url.endsWith("/auth/verify-bot")) {
          authenticating = true;
          await auth;
        }
      });
      const recover = async () => {
        f.setCardProfileHook(undefined);
        const next = await f.replace(f.token, false);
        start = next.start(f.sockets.at(-1).signal);
      };
      if (stage === "before-profile") await recover();
      else f.setCardProfileHook(recover);
      let settled = false;
      const diagnostics = [];
      const operation =
        path === "failure"
          ? f.inbound.replyFailure(failedRun, "auth:failure")
          : (() => {
              const presentation = f.inbound.beginPresentation(
                "auth:progress",
                (code) => diagnostics.push(code),
                {}
              );
              const projector = new ImRunProjector("auth:progress");
              projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
              projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
              presentation.update(projector.snapshot());
              return presentation.finish();
            })();
      const result = operation.then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          return error;
        }
      );
      // The failed baseline can skip replyFailure entirely; do not wait indefinitely for its profile hook.
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, true, "WS authentication must not pause REST");
      assert.equal(authenticating, true);
      assert.equal(f.cardProfiles.length, 1);
      assert.equal(f.cards.length, 1);
      release();
      await start;
      assert.equal(await result, undefined);
      assert.equal(f.cards.length, 1);
      assert.deepEqual(diagnostics, []);
      assert.equal(f.cards[0].signal.aborted, false);
      if (path === "failure") assert.equal(f.cards[0].body.payload.state, "error");
      if (path === "progress") assert.equal(f.cards[0].body.payload.state, "completed");
    });
  }
}

test("HTTP dispatch race: a rate-limited mention lookup retries independently of WS authentication", async (t) => {
  const f = await ownedTransportFixture(t);
  let release,
    start,
    authenticating = false,
    lookups = 0;
  const verification = new Promise((resolve) => {
    release = resolve;
  });
  t.after(async () => {
    release();
    t.mock.timers.reset();
    await start?.catch(() => {});
  });
  f.setRequestHook(async (url) => {
    if (url.endsWith("/auth/verify-bot")) {
      authenticating = true;
      await verification;
    }
    if (url.includes("/user/info")) {
      if (++lookups === 1) {
        const next = await f.replace(f.token, false);
        start = next.start(f.sockets.at(-1).signal);
        return new Response("rate limited", { status: 429, headers: { "Retry-After": "0.001" } });
      }
    }
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const operation = f.inbound.replyFinal("@[owner:Owner] done", "retry:mention");
  for (let i = 0; i < 100; i++) await Promise.resolve();
  assert.equal(authenticating, true);
  // Advance the HTTP retry while holding the replacement verification unresolved.
  t.mock.timers.tick(5);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  assert.equal(lookups, 2, "REST retry proceeds independently of the new WS handshake");
  release();
  await start;
  t.mock.timers.reset();
  await operation;
  assert.equal(lookups, 2);
  assert.equal(f.sends.length, 1);
});

for (const outcome of ["changed", "owner-stop", "task-stop", "failed-then-same", "http-denied"]) {
  test(`REST failure card during WS recovery handles ${outcome}`, async (t) => {
    const f = await ownedTransportFixture(t);
    f.sockets[0].abort();
    await f.first.close();
    const pending = await f.replace(f.token, false);
    const task = new AbortController();
    f.setCardProfileHook(async () => {
      f.setCardProfileHook(undefined);
      if (outcome === "changed") {
        f.setPrincipal({ bot_uid: "bot", space_id: "other" });
        await f.replace();
      } else if (outcome === "owner-stop") f.owner.abort();
      else if (outcome === "task-stop") task.abort();
      else if (outcome === "http-denied")
        f.setRequestHook((url) =>
          url.endsWith("/bot/sendMessage") ? new Response(null, { status: 403 }) : undefined
        );
      else {
        f.setRequestHook((url) =>
          url.endsWith("/auth/verify-bot") ? Response.json({}, { status: 503 }) : undefined
        );
        await assert.rejects(pending.start(f.sockets.at(-1).signal));
        await pending.close();
        f.setRequestHook(undefined);
      }
    });
    const result = f.inbound
      .replyFailure(failedRun, "auth:failure", {
        signal: task.signal,
        obsolete: () => task.signal.aborted
      })
      .then(
        () => undefined,
        (error) => error
      );
    const error = await result;
    if (outcome === "failed-then-same") assert.equal(error, undefined);
    else if (outcome === "http-denied") assert.equal(error.status, 403);
    else if (outcome === "changed") assert.equal(error?.code, "IM_CONNECTION_IDENTITY_CHANGED");
    else assert.ok(error?.code === "IM_DELIVERY_CANCELLED" || error?.name === "AbortError");
    assert.equal(f.cards.length, outcome === "failed-then-same" ? 1 : 0);
  });
}

for (const stage of ["before-profile", "before-write"]) {
  test(`auth recovery: failure card respects task cancellation ${stage}`, async (t) => {
    const f = await ownedTransportFixture(t);
    const task = new AbortController();
    if (stage === "before-profile") task.abort();
    else
      f.setCardProfileHook(() => {
        task.abort();
      });
    await assert.rejects(
      f.inbound.replyFailure(failedRun, "auth:failure", {
        signal: task.signal,
        obsolete: () => task.signal.aborted
      })
    );
    assert.equal(f.cards.length, 0);
  });
}

for (const stage of ["changed-then-pre-auth", "changed-then-original"]) {
  test(`review: old REST identity remains closed during ${stage}`, async (t) => {
    const f = await ownedTransportFixture(t);
    const presentation = f.inbound.beginPresentation("identity-review", () => {}, {});
    const projector = new ImRunProjector("identity-review");
    projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
    presentation.update(projector.snapshot());
    await waitFor(() => f.cards.length === 1);
    await new Promise((resolve) => setImmediate(resolve));
    f.sockets[0].abort();
    await f.first.close();
    f.setPrincipal({ bot_uid: "bot", space_id: "other" });
    await f.replace();
    f.setPrincipal({ bot_uid: "bot", space_id: "s" });
    await f.replace(f.token, stage === "changed-then-original");
    const count = f.cards.length;
    await assert.rejects(f.inbound.replyFailure(failedRun, "review:failure"));
    projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
    presentation.update(projector.snapshot());
    await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
    assert.equal(f.cards.length, count, "old identity must not resume HTTP writes");
  });
}

for (const stage of ["presign", "put"]) {
  for (const change of ["same", "changed"]) {
    test(`review: ${change} identity during artifact ${stage}`, async (t) => {
      const f = await ownedTransportFixture(t);
      const { workspace, policy } = await fixture(t);
      await writeFile(join(workspace, "one.txt"), "first");
      await writeFile(join(workspace, "two.txt"), "second");
      let switched = false,
        pendingSignal;
      f.setRequestHook(async (url, options) => {
        if (
          !switched &&
          (stage === "presign" ? url.includes("upload/presigned") : options.method === "PUT")
        ) {
          switched = true;
          pendingSignal = options.signal;
          f.sockets[0].abort();
          await f.first.close();
          if (change === "changed") f.setPrincipal({ bot_uid: "bot", space_id: "other" });
          await f.replace();
        }
      });
      const result = f.inbound.replyFinal("[one](one.txt) [two](two.txt)", "review:files", {
        artifacts: policy,
        signal: f.owner.signal,
        obsolete: () => false
      });
      if (change === "same") await result;
      else await assert.rejects(result, (error) => error.code === "IM_CONNECTION_IDENTITY_CHANGED");
      assert.equal(
        pendingSignal.aborted,
        change === "changed",
        "identity cancellation reaches in-flight HTTP"
      );
      assert.equal(
        f.requests.filter((r) => r.url.includes("upload/presigned")).length,
        change === "same" ? 2 : 1
      );
      assert.equal(
        f.requests.filter((r) => r.options.method === "PUT").length,
        change === "same" ? 2 : stage === "put" ? 1 : 0
      );
      assert.equal(f.sends.length, change === "same" ? 1 : 0);
    });
  }
}

for (const creation of ["before-reconnect", "during-create"]) {
  test(`review: interaction finalization survives reconnect, created ${creation}`, async (t) => {
    const f = await ownedTransportFixture(t);
    const diagnostics = [];
    const presentation = f.inbound.beginPresentation(
      "interaction-review",
      (code) => diagnostics.push(code),
      {}
    );
    const request = {
      interactionId: "question",
      kind: "approval",
      request: { operation: { summary: "continue" } },
      expiresAt: new Date(Date.now() + 60000).toISOString()
    };
    const reconnect = async () => {
      f.setCardProfileHook(undefined);
      f.sockets[0].abort();
      await f.first.close();
      await f.replace();
    };
    if (creation === "during-create") f.setCardProfileHook(reconnect);
    assert.equal(await presentation.interaction(request), creation === "before-reconnect");
    if (creation === "before-reconnect") await reconnect();
    assert.equal(
      await presentation.interaction({ ...request, interactionId: "new-question" }),
      false,
      "retired button bindings cannot accept new interactions"
    );
    await presentation.finish();
    assert.deepEqual(diagnostics, []);
    const edit = f.cards.find((r) => r.url.endsWith("/message/edit"));
    assert.equal(edit.body.message_id, "progress-card");
    assert.match(JSON.parse(edit.body.content_edit).card.body[0].text, /invalidated/);
  });
}

test("REST confirmations survive repeated WS replacement without resending", async (t) => {
  const f = await ownedTransportFixture(t);
  await f.first.close();
  const second = await f.replace();
  await f.inbound.reply("first", "review:first");
  await second.close();
  await f.replace();
  await f.inbound.reply("second", "review:second");
  assert.equal(f.cards.length, 0);
  await f.inbound.reply("first", "review:first");
  assert.equal(f.sends.length, 2, "confirmed effect must not resend on the third connection");
});

test("review: identity confirmations are bounded and isolated across target identities", () => {
  const identity = new ImDeliveryIdentity();
  const first = identity.accept("bot:space");
  for (let i = 0; i < 513; i++) first.confirm(`effect:${i}`);
  assert.equal(first.isConfirmed("effect:0"), false);
  assert.equal(first.isConfirmed("effect:512"), true);
  assert.equal(identity.accept("bot:space"), first);
  const second = identity.accept("bot:other-space");
  assert.equal(first.signal.aborted, true);
  assert.equal(second.isConfirmed("effect:512"), false);
  const third = identity.accept("bot:space");
  assert.notEqual(third, first);
  assert.equal(third.isConfirmed("effect:512"), false);
  first.confirm("late-old-ack");
  assert.equal(third.isConfirmed("late-old-ack"), false);
});

for (const failure of ["upload", "peer", "group"]) {
  test(`review: ${failure} preparation failure degrades without poisoning final delivery`, async (t) => {
    const f = await ownedTransportFixture(t);
    const { workspace, policy } = await fixture(t);
    await writeFile(join(workspace, "one.txt"), "first");
    await writeFile(join(workspace, "two.txt"), "second");
    // Use a fresh group callback for the member-list branch.
    if (failure === "group") {
      // Accept direct/group messages under the same fixture configuration.
      f.connections[0].onMessage({
        ...f.message,
        channelType: 2,
        channelId: "group",
        payload: { type: 1, content: "@bot final", mention: { uids: ["bot"] } }
      });
    }
    let failed = false;
    f.setRequestHook(async (url) => {
      if (
        !failed &&
        (failure === "upload"
          ? url.includes("filename=two.txt")
          : failure === "peer"
            ? url.includes("/user/info")
            : url.includes("/groups/group/members"))
      ) {
        failed = true;
        throw new TypeError("temporary network loss");
      }
      if (url.includes("/groups/group/members")) return Response.json({ members: [] });
    });
    // A confirmed HTTP rejection may retry delivery without repeating completed uploads.
    let attempts = 0;
    const originalMessage = OctoConnector.prototype.message;
    t.mock.method(
      OctoConnector.prototype,
      "message",
      async function (address, payload, key, observe) {
        if (payload.type === 1 && ++attempts === 1) {
          f.sends.push({ args: [address.channelId, address.channelType, payload.content, key] });
          throw new OctoApiError({
            status: 429,
            path: "/fixture",
            body: "limited",
            retryAfterMs: 0
          });
        }
        return originalMessage.call(this, address, payload, key, observe);
      }
    );
    const options = { artifacts: policy, signal: f.owner.signal, obsolete: () => false };
    const text = "[one](one.txt) [two](two.txt) @[owner:Owner]";
    await assert.rejects(
      f.inbound.replyFinal(text, "review:preparation", options),
      (error) => error.status === 429
    );
    await f.inbound.replyFinal(text, "review:preparation", options);
    assert.equal(failed, true);
    assert.equal(f.sends.length, 2, "preparation failure must not prevent sending the body");
    assert.equal(
      f.requests.filter((r) => r.url.includes("upload/presigned")).length,
      2,
      "successful uploads stay cached"
    );
    if (failure === "upload") assert.match(f.sends.at(-1).args[2], /Attachment delivery failed/);
    else assert.match(f.sends.at(-1).args[2], /@Owner/);
  });
}

for (const scenario of ["token", "api", "space", "bot", "same", "rest-only"]) {
  for (const stage of ["before-profile", "before-send"]) {
    test(`REST failure card identity: ${scenario} ${stage}`, async (t) => {
      const f = reconnectTransportFixture(t);
      const owner = new AbortController();
      let current, inbound;
      const lifetime = {
        signal: owner.signal,
        dispatcher: new ImDeliveryDispatcher(owner.signal),
        identity: new ImDeliveryIdentity()
      };
      const first = new GatewayTransport(
        { ...config(process.cwd()), typing: false },
        async () => f.token,
        {
          onMessage(message) {
            inbound = message;
          },
          onDisconnect() {}
        },
        lifetime
      );
      current = first;
      t.after(async () => {
        owner.abort();
        await first.close();
        await current?.close();
      });
      await first.start(owner.signal);
      f.connections[0].onMessage(f.message);
      await first.close();
      current = undefined;
      const recover = async () => {
        if (scenario === "rest-only") return;
        f.setPrincipal({
          bot_uid: scenario === "bot" ? "other" : "bot",
          space_id: scenario === "space" ? "other" : "s"
        });
        current = new GatewayTransport(
          {
            ...config(process.cwd()),
            typing: false,
            ...(scenario === "api" ? { api_url: "https://other.example/api" } : {}),
            ...(scenario === "bot" ? { bot_id: "other" } : {})
          },
          async () => (scenario === "token" ? `bf_${randomUUID()}` : f.token),
          { onMessage() {}, onDisconnect() {} },
          lifetime
        );
        await current.start(owner.signal);
      };
      if (stage === "before-profile") await recover();
      else f.setCardProfileHook(recover);
      const failure = inbound.replyFailure(failedRun, "failure");
      if (["same", "rest-only", "token"].includes(scenario)) {
        await failure;
        assert.equal(f.cardProfiles.length, 1);
        assert.equal(f.cards.length, 1);
        assert.equal(f.cards[0].body.payload.state, "error");
      } else {
        await assert.rejects(
          failure,
          (error) => error.code === "IM_CONNECTION_IDENTITY_CHANGED" && error.state === "failed"
        );
        assert.equal(
          f.cardProfiles.length,
          stage === "before-profile" ? 0 : 1,
          "guard applies before every REST request"
        );
        assert.equal(f.cards.length, 0, "no failure card may mutate a retired identity");
      }
      assert.equal(f.sends.length, 0, "failure cards must not send an extra text message");
    });
  }
}

test("long task invokes once, completes its original REST card and sends final after WS recovery", async (t) => {
  const f = reconnectTransportFixture(t);
  const releaseCard = t.mock.method(CardSession.prototype, "release");
  const originalStart = GatewayTransport.prototype.start;
  t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
    const receive = this.callbacks.onMessage;
    // 保留真实回复、REST 卡片与 Runtime 恢复，仅隔离与本次验证无关的上下文读取。
    this.callbacks.onMessage = (message) =>
      receive({
        ...message,
        buildContext: async () => ({ schema, items: [] })
      });
    return originalStart.call(this, signal);
  });
  let release,
    invokes = 0;
  const completion = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = new ImRuntime(
    { ...config(process.cwd()), bf_token: f.token, typing: false },
    {
      kernel: {
        async *invoke() {
          invokes++;
          yield { protocolVersion: 2, type: "run.started", payload: {} };
          await completion;
          yield {
            protocolVersion: 2,
            type: "message.delta",
            payload: { channel: "final", text: "done after sleep" }
          };
          yield { protocolVersion: 2, type: "run.completed", payload: {} };
        },
        async cancelInvocation() {
          return { accepted: false };
        }
      }
    }
  );
  t.after(async () => {
    release();
    await runtime.close();
  });
  await runtime.start();
  f.connections[0].onMessage(f.message);
  await waitFor(() => invokes === 1);
  await waitFor(() => f.cards.length === 1);
  f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
  await waitFor(() => f.connections.length === 2 && runtime.status.state === "online");
  assert.equal(releaseCard.mock.callCount(), 0, "reconnection must preserve the running REST card");
  release();
  await waitFor(() => runtime.status.workingTasks === 0);
  assert.equal(invokes, 1);
  assert.equal(f.sends.length, 1);
  assert.equal(
    f.requests.filter(
      ({ url, options }) =>
        url.endsWith("/bot/sendMessage") && JSON.parse(options.body).payload?.type === 1
    ).length,
    1
  );
  assert.equal(f.sends[0].args[0], "owner");
  assert.equal(f.sends[0].args[2], "done after sleep");
  assert.equal(f.cards.filter((r) => r.url.endsWith("/sendMessage")).length, 1);
  assert.equal(f.cards.at(-1).body.message_id, "progress-card");
  assert.equal(f.cards.at(-1).body.state, "completed");
  assert.equal(f.cards.at(-1).body.transient, undefined);
  assert.equal(
    releaseCard.mock.callCount(),
    1,
    "task finalization releases the original card once"
  );
  assert.equal(
    runtime.status.cardDeliveries,
    f.cards.length,
    "all retained card receipts remain visible after reconnect"
  );
});

for (const command of ["/stop", "/reset"]) {
  test(`empty final in-flight REST delivery respects ${command}`, async (t) => {
    const f = reconnectTransportFixture(t);
    let releaseTask,
      releaseReconnect,
      started = 0,
      invokes = 0,
      replyStarted = false;
    const completion = new Promise((resolve) => {
      releaseTask = resolve;
    });
    const reconnect = new Promise((resolve) => {
      releaseReconnect = resolve;
    });
    f.setRequestHook(async (url, options) => {
      if (
        url.endsWith("/bot/sendMessage") &&
        JSON.parse(options.body).payload?.content === "执行已结束，未返回文本。"
      )
        await new Promise((_, reject) => {
          const cancel = () => reject(options.signal.reason);
          if (options.signal.aborted) cancel();
          else options.signal.addEventListener("abort", cancel, { once: true });
        });
    });
    const originalStart = GatewayTransport.prototype.start;
    t.mock.method(GatewayTransport.prototype, "start", async function (signal) {
      if (++started === 2) await reconnect;
      const receive = this.callbacks.onMessage;
      this.callbacks.onMessage = (message) =>
        receive({
          ...message,
          buildContext: async () => ({ schema, items: [] }),
          reply: (...args) => {
            if (args[0] === "执行已结束，未返回文本。") replyStarted = true;
            return message.reply(...args);
          }
        });
      return originalStart.call(this, signal);
    });
    const runtime = new ImRuntime(
      { ...config(process.cwd()), bf_token: f.token, cards: false, typing: false },
      {
        kernel: {
          async *invoke() {
            invokes++;
            yield { protocolVersion: 2, type: "run.started", payload: {} };
            await completion;
            yield { protocolVersion: 2, type: "run.completed", payload: {} };
          },
          async cancelInvocation() {
            return { accepted: false };
          }
        }
      }
    );
    t.after(async () => {
      releaseTask();
      releaseReconnect();
      await runtime.close();
    });
    await runtime.start();
    f.connections[0].onMessage(f.message);
    await waitFor(() => invokes === 1);
    f.connections[0].onDisconnect(new Error("IM_DISCONNECTED"));
    releaseTask();
    await waitFor(() => replyStarted);
    assert.equal(f.sends.length, 0, "terminal HTTP request remains in flight until cancelled");
    releaseReconnect();
    await waitFor(() => f.connections.length === 2 && runtime.status.state === "online");
    f.connections[1].onMessage({
      ...f.message,
      messageId: `control-${command}`,
      payload: { type: 1, content: command }
    });
    await waitFor(() => runtime.status.workingTasks === 0 && f.sends.length > 0);
    assert.equal(invokes, 1);
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].args[2], command === "/stop" ? "已请求停止本轮执行。" : "会话已经重置");
  });
}

for (const scenario of ["rest-only", "recovered", "in-flight", "stop", "identity", "transient"]) {
  test(`REST progress card lifetime across WS close: ${scenario}`, async (t) => {
    const f = reconnectTransportFixture(t);
    const owner = new AbortController();
    const oldSocket = new AbortController();
    let current, inbound;
    const lifetime = {
      signal: owner.signal,
      dispatcher: new ImDeliveryDispatcher(owner.signal),
      identity: new ImDeliveryIdentity()
    };
    const first = new GatewayTransport(
      { ...config(process.cwd()), typing: false },
      async () => f.token,
      {
        onMessage(message) {
          inbound = message;
        },
        onDisconnect() {}
      },
      lifetime
    );
    current = first;
    t.after(async () => {
      owner.abort();
      await first.close();
      await current?.close();
    });
    await first.start(oldSocket.signal);
    f.connections[0].onMessage(f.message);
    const diagnostics = [];
    const presentation = inbound.beginPresentation(
      "long-task",
      (code) => diagnostics.push(code),
      {}
    );
    const projector = new ImRunProjector("long-task");
    projector.accept({ protocolVersion: 2, type: "run.started", payload: {} });
    presentation.update(projector.snapshot());
    await waitFor(() => f.cards.length === 1);
    await new Promise((resolve) => setImmediate(resolve));
    let release, pendingSignal;
    if (scenario === "in-flight" || scenario === "stop") {
      f.setCardResponse(
        ({ signal }) =>
          new Promise((resolve, reject) => {
            pendingSignal = signal;
            const abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
            release = () => {
              signal.removeEventListener("abort", abort);
              resolve(Response.json({}));
            };
          })
      );
      presentation.update(projector.snapshot());
      await waitFor(() => pendingSignal);
    }
    oldSocket.abort();
    await first.close();
    current = undefined;
    assert.equal(f.cards[0].signal.aborted, false, "WS teardown must not cancel REST");
    if (pendingSignal) {
      assert.equal(pendingSignal.aborted, false, "in-flight REST must survive WS teardown");
      if (scenario === "stop") {
        owner.abort();
        assert.equal(pendingSignal.aborted, true, "Bot stop cancels REST");
        projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
        presentation.update(projector.snapshot());
        await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
        assert.equal(f.cards.length, 2);
        return;
      }
      release();
      f.setCardResponse(undefined);
    }
    if (scenario === "recovered" || scenario === "identity") {
      if (scenario === "identity") f.setPrincipal({ bot_uid: "bot", space_id: "other" });
      current = new GatewayTransport(
        { ...config(process.cwd()), typing: false },
        async () => f.token,
        { onMessage() {}, onDisconnect() {} },
        lifetime
      );
      assert.equal(
        current.status.cardDeliveries,
        1,
        "retained receipts remain visible before new transport authentication"
      );
      await current.start(owner.signal);
    }
    if (scenario === "rest-only" || scenario === "transient") {
      if (scenario === "transient")
        f.setCardResponse(() => {
          throw new TypeError("network changed");
        });
      presentation.update(projector.snapshot());
      await waitFor(() => f.cards.length === 2);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.connections.length, 1, "REST must not wait for a replacement WS");
      f.setCardResponse(undefined);
    }
    projector.accept({ protocolVersion: 2, type: "run.completed", payload: {} });
    presentation.update(projector.snapshot());
    if (scenario === "identity") {
      await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
      assert.equal(f.cards.length, 1, "identity change must stop old-card HTTP requests");
      return;
    }
    await presentation.finish();
    const terminalCount = f.cards.length;
    presentation.update({ ...projector.snapshot(), terminal: undefined, phase: "thinking" });
    await presentation.finish();
    assert.equal(f.cards.length, terminalCount, "late progress must not overwrite terminal");
    assert.equal(f.cards.filter((r) => r.url.endsWith("/sendMessage")).length, 1);
    assert.ok(f.cards.slice(1).every((r) => r.body.message_id === "progress-card"));
    assert.equal(f.cards.at(-1).body.state, "completed");
    assert.equal(f.cards.at(-1).body.transient, undefined);
    assert.ok(f.cards.slice(1).every((r, i) => r.body.card_seq === i + 2));
    if (scenario !== "transient") assert.deepEqual(diagnostics, []);
  });
}

for (const scenario of [
  "recovered",
  "file",
  "stop",
  "rest-only",
  "token",
  "space",
  "bot",
  "api",
  "unknown"
]) {
  test(`final delivery after reconnect: ${scenario}`, async (t) => {
    const f = reconnectTransportFixture(t);
    const owner = new AbortController();
    let current, inbound;
    const lifetime = {
      signal: owner.signal,
      dispatcher: new ImDeliveryDispatcher(owner.signal),
      identity: new ImDeliveryIdentity()
    };
    const first = new GatewayTransport(
      config(process.cwd()),
      async () => f.token,
      {
        onMessage(message) {
          inbound = message;
        },
        onDisconnect() {}
      },
      lifetime
    );
    current = first;
    const oldSignal = new AbortController();
    await first.start(oldSignal.signal);
    f.connections[0].onMessage(f.message);
    oldSignal.abort();
    await first.close();
    current = undefined;
    t.after(() => {
      owner.abort();
    });
    let text = "done",
      options;
    if (scenario === "file") {
      const { workspace, policy } = await fixture(t);
      await writeFile(join(workspace, "game.html"), "html");
      text = "[Game](game.html)";
      options = { artifacts: policy, signal: owner.signal, obsolete: () => false };
    }
    if (scenario === "stop") {
      owner.abort();
      await assert.rejects(inbound.replyFinal(text, "final:long-task", options));
      assert.equal(f.sends.length, 0);
      return;
    }
    if (scenario === "rest-only") {
      await inbound.replyFinal(text, "final:long-task", options);
      assert.equal(f.sends.length, 1, "REST succeeds while WS remains unavailable");
      return;
    }
    f.setPrincipal({
      bot_uid: scenario === "bot" ? "other" : "bot",
      space_id: scenario === "space" ? "other" : "s"
    });
    const nextConfig = {
      ...config(process.cwd()),
      ...(scenario === "bot" ? { bot_id: "other" } : {}),
      ...(scenario === "api" ? { api_url: "https://other.example/api" } : {})
    };
    current = new GatewayTransport(
      nextConfig,
      async () => (scenario === "token" ? `bf_${randomUUID()}` : f.token),
      { onMessage() {}, onDisconnect() {} },
      lifetime
    );
    t.after(() => current.close());
    await current.start(owner.signal);
    if (scenario === "unknown") {
      t.mock.method(OctoConnector.prototype, "message", async function (address, payload, key) {
        f.sends.push({ args: [address.channelId, address.channelType, payload.content, key] });
        throw new ImSendError("IM_DISCONNECTED", "unknown");
      });
    }
    const result = await inbound
      .replyFinal(text, "final:long-task", options)
      .catch((error) => error);
    if (["space", "bot", "api"].includes(scenario)) {
      assert.equal(result.code, "IM_CONNECTION_IDENTITY_CHANGED");
      assert.equal(result.state, "failed");
      assert.equal(f.sends.length, 0);
    } else if (scenario === "unknown") {
      assert.equal(result.state, "unknown");
      let attempts = 0;
      const receipt = await new ImDeliveryDispatcher(owner.signal).deliver(
        "final:unknown",
        async () => {
          attempts++;
          throw result;
        }
      );
      assert.equal(receipt.state, "unknown");
      assert.equal(attempts, 1);
      assert.equal(f.sends.length, 1);
    } else {
      assert.equal(result, undefined);
      assert.equal(f.sends.length, 1);
      assert.equal(f.sends[0].args[0], "owner");
      if (scenario === "file") {
        assert.equal(f.files.length, 1);
        assert.equal(f.files[0].args[0], "owner");
        assert.equal(
          current.status.cardDeliveries,
          1,
          "file receipt is retained in Bot card statistics"
        );
        assert.match(f.sends[0].args[2], /https:\/\/cdn.example.com\/game.html/);
      }
    }
  });
}

for (const links of ["ordinary paths", "symlink aliases"]) {
  test(`HTML games, arbitrary files and mixed images retain exact Markdown while realpaths upload once: ${links}`, async (t) => {
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
    const alias = links === "symlink aliases" ? "alias.png" : "a.png";
    if (
      links === "symlink aliases" &&
      !(await symlinkFixture(t, join(workspace, "a.png"), join(workspace, alias)))
    )
      return;
    const text = [
      "# Outputs",
      '[**Play**](./game.html "Game title") and [PDF](./report.pdf)',
      "[deck](./deck.pptx) [notes](./notes.md) [custom](unknown.custom)",
      `![alt](./a.png "image title") [download](./${alias})`,
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
}

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

for (const links of ["ordinary paths", "symlink escape"]) {
  test(`partial failure preserves successful URLs and reports inaccessible, forbidden and non-file paths: ${links}`, async (t) => {
    const { workspace, policy } = await fixture(t);
    const outside = await mkdtemp(join(tmpdir(), "octo-outside-"));
    t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, "secret.txt"), "private");
    if (
      links === "symlink escape" &&
      !(await symlinkFixture(t, join(outside, "secret.txt"), join(workspace, "escape.txt")))
    )
      return;
    await mkdir(join(workspace, "directory"));
    await writeFile(join(workspace, "good.html"), "game");
    const calls = [];
    const upload = async (_bytes, name) => {
      calls.push(name);
      return "https://cdn.example.com/good.html";
    };
    const escape = links === "symlink escape" ? "[escape](escape.txt) " : "";
    // 盘符路径在 Windows 合法；编码分隔符的 file URL 在所有平台均不可转换为本地路径。
    const text = `[good](good.html) [missing](missing.pdf) ${escape}[dir](directory) [outside](${join(outside, "secret.txt")}) [windows](C:/provider/out.pdf) [invalid](file:///invalid%2Fpath)`;
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
    if (links === "symlink escape") {
      assert.match(result, /\[escape\]\(escape.txt\)/);
      assert.ok(result.includes("escape.txt (directory-policy)"));
    }
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "private");
  });
}

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
  test(`transport preserves links and finalized file budgets across text retries, with explicit ${cardState} card receipts`, async (t) => {
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
    t.mock.method(globalThis, "fetch", async (url, request) => {
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
      if (url.endsWith("/bot/sendMessage")) {
        const { channel_id, channel_type, payload, client_msg_no } = JSON.parse(request.body);
        const args = [
          channel_id,
          channel_type,
          payload.type === 1
            ? payload.content
            : Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "type")),
          client_msg_no,
          undefined,
          payload.mention
        ];
        if (payload.type === 8) {
          cards.push(args);
          if (payload.name === "notes.md") throw new ImSendError("IM_SEND_TEST_RECEIPT", cardState);
        } else {
          sends.push(args);
          if (sends.length === 1)
            return Response.json({}, { status: 429, headers: { "Retry-After": "0.001" } });
        }
        return Response.json({ message_id: `sent-${cards.length}-${sends.length}` });
      }
      throw new Error("unexpected-request");
    });
    t.mock.method(WukongConnection.prototype, "connect", async function () {
      receive = this.onMessage;
    });
    t.mock.getter(WukongConnection.prototype, "connected", () => true);
    t.mock.method(WukongConnection.prototype, "close", async () => {});
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
    await assert.rejects(
      inbound.replyFinal(text, "final:run", options),
      (error) => error.status === 429
    );
    const fileAttempts = cards.length;
    await inbound.replyFinal(text, "final:run", options);
    assert.equal(uploads, 3);
    assert.equal(cards.length, fileAttempts, "text retries cannot reopen file delivery budgets");
    assert.equal(cards.filter((args) => args[2].name === "game.html").length, 1);
    assert.equal(
      cards.filter((args) => args[2].name === "notes.md").length,
      cardState === "unknown" ? 4 : 1
    );
    assert.equal(new Set(cards.map((args) => args[3])).size, 2);
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
    assert.equal(cards.length, fileAttempts, "remote links must not create extra file cards");
  });
}

for (const links of ["ordinary paths", "symlink aliases"]) {
  test(`native card preparation follows ordinary link usage while images stay inline and aliases share one upload: ${links}`, async (t) => {
    const { workspace, policy } = await fixture(t);
    await writeFile(join(workspace, "image.png"), "image");
    const alias = links === "symlink aliases" ? "alias.png" : "./image.png";
    if (
      links === "symlink aliases" &&
      !(await symlinkFixture(t, join(workspace, "image.png"), join(workspace, alias)))
    )
      return;
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
      `![Photo][image]\n\n[Download][image] [Alias](${alias})\n\n[image]: image.png`,
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
}

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
