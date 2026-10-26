import test from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync
} from "node:crypto";
import { WebSocketServer } from "ws";
import { WukongConnection } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/wukong.js";
import { setImmediate as settle } from "node:timers/promises";
import { GatewayTransport } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/channel.js";
import { CardSession } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/card-session.js";
import { OctoConnector } from "../packages/octo-runtime-extra-channel-gateway/dist/transport/connector.js";
import { imCardProfile } from "./fixtures/im-card-profile.js";

const hash = (value) => createHash("md5").update(value).digest("hex");
function integer(value, bytes = 4) {
  const buffer = Buffer.alloc(bytes);
  if (bytes === 8) buffer.writeBigUInt64BE(BigInt(value));
  else buffer.writeUInt32BE(value);
  return buffer;
}
function string(value) {
  const body = Buffer.from(value);
  const size = Buffer.alloc(2);
  size.writeUInt16BE(body.length);
  return Buffer.concat([size, body]);
}
function packet(kind, body, flags = 0) {
  let remaining = body.length;
  const size = [];
  do {
    const digit = remaining % 128;
    remaining = Math.floor(remaining / 128);
    size.push(digit | (remaining ? 128 : 0));
  } while (remaining);
  return Buffer.concat([Buffer.from([(kind << 4) | flags, ...size]), body]);
}
function reader(data) {
  let offset = 1;
  while (data[offset++] & 128) {}
  return {
    byte: () => data[offset++],
    rest: () => data.subarray(offset),
    skip: (count) => {
      offset += count;
    },
    uint: () => {
      const value = data.readUInt32BE(offset);
      offset += 4;
      return value;
    },
    text: () => {
      const length = data.readUInt16BE(offset);
      offset += 2;
      const value = data.subarray(offset, offset + length).toString();
      offset += length;
      return value;
    }
  };
}

test("gateway observation keeps scope gates, separates execution admission and binds ACK/card positions to their original turn", async (context) => {
  let wire;
  const admitted = [];
  const observed = [];
  const sends = [];
  const changes = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/auth/verify-bot"))
      return Response.json({ bot_uid: "bot", space_id: "space" });
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: "bot",
        owner_uid: "owner",
        owner_channel_id: "owner",
        ws_url: "wss://im-test.deepminer.com.cn/ws",
        im_token: "fixture"
      });
    if (url.endsWith("/bot/events"))
      return new Promise((resolve) => {
        const done = () => resolve(Response.json({ results: [] }));
        if (options.signal.aborted) done();
        else options.signal.addEventListener("abort", done, { once: true });
      });
    throw Error("unexpected fixture request");
  });
  context.mock.method(WukongConnection.prototype, "connect", async function () {
    wire = this;
  });
  context.mock.method(WukongConnection.prototype, "close", async () => {});
  context.mock.getter(WukongConnection.prototype, "connected", () => true);
  context.mock.method(WukongConnection.prototype, "sendText", async (...args) => {
    sends.push(args);
    return "output";
  });
  context.mock.getter(CardSession.prototype, "messageId", () => "known-card");
  const transport = new GatewayTransport(
    {
      bot_id: "bot",
      api_url: "https://im-test.deepminer.com.cn/api",
      group_ids: ["group"],
      typing: false,
      adapter: { adapter_type: "codex" }
    },
    async () => "bf_fixture",
    {
      onMessage: (message) => admitted.push(message),
      onRulesChanged: (change) => changes.push(change),
      onPosition: (position) => observed.push(position),
      onDisconnect() {}
    }
  );
  context.after(() => transport.close());
  await transport.start(new AbortController().signal);
  const position = {
    channelId: "group____topic",
    channelType: 5,
    fromUid: "stranger",
    messageSeq: 101,
    messageId: "101",
    clientMsgNo: "peer",
    spaceId: "space"
  };
  for (const override of [
    {},
    { channelId: "other____topic" },
    { spaceId: "other" },
    { channelType: 1 }
  ])
    wire.onPosition({ ...position, ...override });
  assert.equal(observed.length, 1);
  const notification = {
    ...position,
    payload: {
      type: 1,
      content: "GROUP.md updated",
      space_id: "space",
      mention: { uids: ["bot"] },
      event: { type: "thread_md_updated", version: 2 }
    }
  };
  for (const fromUid of ["owner", "stranger", "bot"]) wire.onMessage({ ...notification, fromUid });
  assert.deepEqual(changes, Array(3).fill({ groupNo: "group", shortId: "topic" }));
  for (const override of [
    { channelId: "other____topic" },
    { payload: { ...notification.payload, space_id: "other" } },
    { payload: { ...notification.payload, event: { type: "thread_md_updated", version: -1 } } },
    {
      payload: {
        ...notification.payload,
        event: { type: "thread_md_updated", version: 3, group_no: "other" }
      }
    }
  ])
    wire.onMessage({ ...notification, ...override });
  assert.equal(changes.length, 3);
  assert.equal(admitted.length, 0);
  assert.equal(sends.length, 0);
  wire.onMessage({ ...position, payload: { type: 1, content: "/reset" } });
  assert.equal(admitted.length, 0);
  wire.onMessage({
    ...position,
    fromUid: "owner",
    payload: { type: 1, content: "summary", mention: { uids: ["bot"] } }
  });
  assert.equal(admitted.length, 1);
  wire.onMessage({
    ...notification,
    fromUid: "owner",
    payload: { ...notification.payload, event: undefined }
  });
  assert.equal(admitted.length, 2);
  const original = { sessionId: "old-session", generation: 1, processEpoch: "epoch" };
  admitted[0].bindHistoryTurn(original);
  await admitted[0].reply("output", "effect");
  admitted[0].beginPresentation("run", () => {}, {
    async cancelInvocation() {
      return false;
    },
    retry() {
      return false;
    }
  });
  admitted[0].bindHistoryTurn({ ...original, sessionId: "new-session", generation: 2 });
  sends[0][7](102);
  assert.deepEqual(observed.at(-1).turn, original);
  wire.onPosition({ ...position, fromUid: "bot", messageId: "known-card", messageSeq: 103 });
  assert.deepEqual(observed.at(-1).turn, original);
});

test("interaction finalization retains failed resolutions and attempts every remaining card", async (context) => {
  let wire,
    incoming,
    reasoningFinished = 0;
  const edits = [];
  let created = 0;
  context.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/auth/verify-bot"))
      return Response.json({ bot_uid: "bot", space_id: "space" });
    if (url.endsWith("/bot/register"))
      return Response.json({
        robot_id: "bot",
        owner_uid: "owner",
        owner_channel_id: "owner",
        ws_url: "wss://im-test.deepminer.com.cn/ws",
        im_token: "fixture"
      });
    if (url.endsWith("/bot/events"))
      return new Promise((resolve) => {
        const done = () => resolve(Response.json({ results: [] }));
        if (options.signal.aborted) done();
        else options.signal.addEventListener("abort", done, { once: true });
      });
    throw Error("unexpected fixture request");
  });
  context.mock.method(WukongConnection.prototype, "connect", async function () {
    wire = this;
  });
  context.mock.method(WukongConnection.prototype, "close", async () => {});
  context.mock.getter(WukongConnection.prototype, "connected", () => true);
  context.mock.method(CardSession.prototype, "finish", async () => {
    reasoningFinished++;
  });
  context.mock.method(
    OctoConnector.prototype,
    "interactionCard",
    async (_address, _document, effect, messageId) => {
      if (!messageId) return ++created === 1 ? "first-card" : "second-card";
      edits.push(messageId);
      if (messageId.includes("first")) throw Error("fixture card edit failed");
      return messageId;
    }
  );
  const transport = new GatewayTransport(
    {
      bot_id: "bot",
      api_url: "https://im-test.deepminer.com.cn/api",
      typing: false,
      adapter: { adapter_type: "codex" }
    },
    async () => "bf_fixture",
    {
      onMessage: (message) => {
        incoming = message;
      },
      onDisconnect() {}
    }
  );
  context.after(() => transport.close());
  await transport.start(new AbortController().signal);
  wire.onMessage({
    channelId: "owner",
    channelType: 1,
    fromUid: "owner",
    messageId: "request",
    payload: { type: 1, content: "run", space_id: "space" }
  });
  assert.ok(incoming);
  const presentation = incoming.beginPresentation("run", () => {}, {
    cancel: async () => false,
    retry: () => false
  });
  for (const id of ["first", "second"])
    assert.equal(
      await presentation.interaction({
        interactionId: id,
        kind: "approval",
        request: { operation: { summary: "fixture" } }
      }),
      true
    );
  await assert.rejects(
    presentation.resolveInteraction("first", "accepted"),
    /fixture card edit failed/
  );
  await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
  assert.equal(
    edits.filter((id) => id.includes("first")).length,
    2,
    "failed resolution must remain for terminal invalidation"
  );
  assert.equal(
    edits.filter((id) => id.includes("second")).length,
    1,
    "one failure must not skip other cards"
  );
  assert.equal(reasoningFinished, 1);
  await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
});

for (const mode of ["disabled", "404", "healthy"]) {
  for (const action of ["resolve", "finish"]) {
    test(`interaction ${action} requires a confirmed terminal edit with a ${mode} profile`, async (context) => {
      let wire,
        incoming,
        changed = false,
        created = 0,
        profileReads = 0,
        reasoningFinished = 0;
      const edits = [],
        diagnostics = [];
      context.mock.method(globalThis, "fetch", async (url, options) => {
        if (url.endsWith("/auth/verify-bot"))
          return Response.json({ bot_uid: "bot", space_id: "space" });
        if (url.endsWith("/bot/register"))
          return Response.json({
            robot_id: "bot",
            owner_uid: "owner",
            owner_channel_id: "owner",
            ws_url: "wss://fixture.invalid/ws",
            im_token: "fixture"
          });
        if (url.endsWith("/bot/card/profile")) {
          profileReads++;
          if (changed && mode === "404") return Response.json({}, { status: 404 });
          const profile = imCardProfile();
          if (changed && mode === "disabled") profile.enabled = false;
          return Response.json(profile);
        }
        if (url.endsWith("/bot/sendMessage"))
          return Response.json({ message_id: `approval-${++created}` });
        if (url.endsWith("/bot/message/edit")) {
          edits.push(JSON.parse(options.body).message_id);
          return Response.json({});
        }
        if (url.endsWith("/bot/events"))
          return new Promise((resolve) => {
            const done = () => resolve(Response.json({ results: [] }));
            if (options.signal.aborted) done();
            else options.signal.addEventListener("abort", done, { once: true });
          });
        throw Error("unexpected fixture request");
      });
      context.mock.method(WukongConnection.prototype, "connect", async function () {
        wire = this;
      });
      context.mock.method(WukongConnection.prototype, "close", async () => {});
      context.mock.getter(WukongConnection.prototype, "connected", () => true);
      context.mock.method(CardSession.prototype, "finish", async () => {
        reasoningFinished++;
      });
      const transport = new GatewayTransport(
        {
          bot_id: "bot",
          api_url: "https://fixture.invalid/api",
          typing: false,
          adapter: { adapter_type: "codex" }
        },
        async () => "bf_fixture",
        {
          onMessage: (message) => {
            incoming = message;
          },
          onDisconnect() {}
        }
      );
      context.after(() => transport.close());
      await transport.start(new AbortController().signal);
      wire.onMessage({
        channelId: "owner",
        channelType: 1,
        fromUid: "owner",
        messageId: "request",
        payload: { type: 1, content: "run", space_id: "space" }
      });
      const presentation = incoming.beginPresentation("run", (code) => diagnostics.push(code), {
        cancel: async () => false,
        retry: () => false
      });
      for (const id of ["first", "second"])
        assert.equal(
          await presentation.interaction({
            interactionId: id,
            kind: "approval",
            request: { operation: { summary: "fixture" } }
          }),
          true
        );
      changed = true;
      if (action === "resolve") {
        const resolution = presentation.resolveInteraction("first", "accepted");
        if (mode === "healthy") await resolution;
        else await assert.rejects(resolution, /IM_INTERACTION_CARD_FINALIZATION_UNCONFIRMED/);
      }
      if (mode !== "healthy") {
        const beforeFinish = profileReads;
        await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
        assert.equal(profileReads - beforeFinish, 2, "all pending cards must be attempted");
        assert.equal(reasoningFinished, 1, "reasoning finalization must still run");
        assert.equal(diagnostics.filter((code) => code === "IM_INTERACTION_CARD_FAILED").length, 2);
        assert.deepEqual(edits, [], "unavailable profiles must not send edits");
        await assert.rejects(presentation.finish(), /IM_PRESENTATION_FAILED/);
        changed = false;
      }
      await presentation.finish();
      assert.deepEqual(
        edits,
        ["approval-1", "approval-2"],
        "pending evidence must survive until the original cards are finalized"
      );
      assert.equal(created, 2, "finalization must not create replacement cards");
      const settledReads = profileReads;
      await presentation.finish();
      assert.equal(profileReads, settledReads, "confirmed cards must be removed from pending work");
    });
  }
}

test("wire positions distinguish SENDACK client/message sequences, observe own RECV without executing it, and ignore failed ACKs", async (context) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  let socket;
  let key;
  const payloads = [];
  const iv = Buffer.from("0123456789abcdef");
  const encrypt = (value) => {
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([cipher.update(value), cipher.final()]).toString("base64");
  };
  server.on("connection", (connection) => {
    socket = connection;
    connection.on("message", (data) => {
      const incoming = reader(data);
      const kind = data[0] >> 4;
      if (kind === 1) {
        incoming.skip(2);
        incoming.text();
        incoming.text();
        incoming.text();
        incoming.skip(8);
        const publicBytes = Buffer.from(incoming.text(), "base64");
        const pair = generateKeyPairSync("x25519");
        const publicKey = createPublicKey({
          format: "der",
          type: "spki",
          key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), publicBytes])
        });
        key = Buffer.from(
          hash(diffieHellman({ privateKey: pair.privateKey, publicKey }).toString("base64")).slice(
            0,
            16
          )
        );
        connection.send(
          packet(
            2,
            Buffer.concat([
              Buffer.from([4]),
              integer(0, 8),
              Buffer.from([1]),
              string(
                pair.publicKey
                  .export({ format: "der", type: "spki" })
                  .subarray(-32)
                  .toString("base64")
              ),
              string(iv.toString()),
              integer(1, 8)
            ]),
            1
          )
        );
      } else if (kind === 3) {
        incoming.byte();
        const clientSequence = incoming.uint();
        const clientNo = incoming.text();
        incoming.text();
        incoming.byte();
        incoming.skip(4);
        incoming.text();
        const decipher = createDecipheriv("aes-128-cbc", key, iv);
        payloads.push(
          JSON.parse(
            Buffer.concat([
              decipher.update(Buffer.from(incoming.rest().toString(), "base64")),
              decipher.final()
            ]).toString()
          )
        );
        const reason = clientNo === "rejected" ? 2 : 1;
        connection.send(
          packet(
            4,
            Buffer.concat([
              integer(900 + clientSequence, 8),
              integer(clientSequence),
              integer(700 + clientSequence),
              Buffer.from([reason])
            ])
          )
        );
      }
    });
  });
  const messages = [];
  const positions = [];
  const acknowledgements = [];
  const connection = new WukongConnection(
    (message) => messages.push(message),
    () => {},
    (position) => positions.push(position)
  );
  context.after(async () => {
    await connection.close();
    await new Promise((resolve) => server.close(resolve));
  });
  await connection.connect({
    robot_id: "bot",
    im_token: "fixture",
    owner_uid: "owner",
    owner_channel_id: "owner",
    ws_url: `ws://127.0.0.1:${server.address().port}`
  });
  assert.equal(
    await connection.sendText(
      "group____topic",
      5,
      "fixture",
      "accepted",
      "space",
      undefined,
      undefined,
      (sequence) => acknowledgements.push(sequence)
    ),
    "901"
  );
  assert.deepEqual(acknowledgements, [701]);
  await assert.rejects(
    connection.sendText(
      "group____topic",
      5,
      "fixture",
      "rejected",
      "space",
      undefined,
      undefined,
      (sequence) => acknowledgements.push(sequence)
    )
  );
  assert.deepEqual(acknowledgements, [701]);
  const file = {
    url: "https://cdn.example.com/game.html",
    name: "game.html",
    size: 42,
    extension: "html"
  };
  assert.equal(
    await connection.sendFile(
      "group____topic",
      5,
      file,
      "file-accepted",
      "space",
      undefined,
      (sequence) => acknowledgements.push(sequence)
    ),
    "903"
  );
  assert.deepEqual(payloads.at(-1), { type: 8, ...file, space_id: "space" });
  assert.deepEqual(acknowledgements, [701, 703]);
  assert.equal(connection.isDelivered("file-accepted"), true);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    connection.sendFile("group____topic", 5, file, "file-cancelled", "space", cancelled.signal),
    /IM_DELIVERY_CANCELLED/
  );
  assert.equal(payloads.length, 3);
  for (const [fromUid, sequence] of [
    ["bot", 702],
    ["peer", 703],
    ["bot", 704]
  ]) {
    const clientNo = `fixture-${sequence}`;
    const timestamp = 1;
    const messageId = 1000 + sequence;
    const encrypted = encrypt(
      JSON.stringify({
        type: 1,
        content: "unmentioned",
        space_id: "space",
        ...(sequence === 704 ? { event: { type: "thread_md_updated", version: 2 } } : {})
      })
    );
    const signature = hash(
      encrypt(`${messageId}${sequence}${clientNo}${timestamp}${fromUid}group____topic5${encrypted}`)
    );
    socket.send(
      packet(
        5,
        Buffer.concat([
          Buffer.from([0]),
          string(signature),
          string(fromUid),
          string("group____topic"),
          Buffer.from([5]),
          integer(0),
          string(clientNo),
          integer(messageId, 8),
          integer(sequence),
          integer(timestamp),
          Buffer.from(encrypted)
        ])
      )
    );
  }
  for (let attempt = 0; positions.length < 3 && attempt < 1000; attempt++) await settle();
  assert.deepEqual(
    positions.map((position) => position.messageSeq),
    [702, 703, 704]
  );
  assert.deepEqual(
    messages.map((message) => message.fromUid),
    ["peer", "bot"]
  );
  assert.equal(
    positions.some((position) => Object.hasOwn(position, "payload")),
    false
  );
});
