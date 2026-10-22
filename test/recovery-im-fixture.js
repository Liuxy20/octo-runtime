import { createServer } from "node:http";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  generateKeyPairSync,
  diffieHellman
} from "node:crypto";
import { WebSocketServer } from "ws";
import { imCardProfile } from "./fixtures/im-card-profile.js";

// Reuse the binary protocol exercised by im-runtime.test.js; all traffic stays on loopback.
const md5 = (value) => createHash("md5").update(value).digest("hex");
const str = (value) => {
  const bytes = Buffer.from(value),
    length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
};
const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
const u64 = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
};
const pack = (header, body) => {
  const bytes = [];
  let n = body.length;
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 128;
    bytes.push(b);
  } while (n);
  return Buffer.concat([Buffer.from([header, ...bytes]), body]);
};
function reader(bytes) {
  let p = 0;
  return {
    byte: () => bytes[p++],
    str() {
      const n = bytes.readUInt16BE(p);
      p += 2;
      const text = bytes.subarray(p, p + n).toString();
      p += n;
      return text;
    },
    u32() {
      const n = bytes.readUInt32BE(p);
      p += 4;
      return n;
    },
    skip(n) {
      p += n;
    },
    rest: () => bytes.subarray(p)
  };
}
export async function recoveryImFixture(t) {
  let offline = true,
    sequence = 0,
    connections = 0,
    current;
  const replies = [],
    cards = [];
  const http = createServer(async (req, res) => {
    if (offline) {
      res.writeHead(503).end("{}");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === "/v1/auth/verify-bot")
      res.end(JSON.stringify({ bot_uid: "bot", space_id: "space" }));
    else if (req.url === "/v1/bot/register")
      res.end(
        JSON.stringify({
          robot_id: "bot",
          owner_uid: "owner",
          owner_channel_id: "owner",
          im_token: "fixture",
          ws_url: `ws://127.0.0.1:${http.address().port}`
        })
      );
    else if (req.url.startsWith("/v1/bot/user/info"))
      res.end(JSON.stringify({ uid: "owner", name: "Owner", robot: 0 }));
    else if (req.url === "/v1/bot/card/profile") res.end(JSON.stringify(imCardProfile()));
    else if (req.url === "/v1/bot/sendMessage") {
      cards.push(JSON.parse(Buffer.concat(chunks)));
      res.end(JSON.stringify({ message_id: String(2000 + cards.length) }));
    } else if (req.url === "/v1/bot/events") {
      const timer = setTimeout(() => res.end('{"results":[]}'), 500);
      res.once("close", () => clearTimeout(timer));
    } else res.end("{}");
  });
  const ws = new WebSocketServer({ server: http });
  ws.on("connection", (socket) => {
    connections++;
    const iv = Buffer.from("0123456789abcdef");
    let key;
    const crypt = (value, decrypt = false) => {
      const cipher = decrypt
        ? createDecipheriv("aes-128-cbc", key, iv)
        : createCipheriv("aes-128-cbc", key, iv);
      return Buffer.concat([
        cipher.update(decrypt ? Buffer.from(value, "base64") : Buffer.from(value)),
        cipher.final()
      ]).toString(decrypt ? "utf8" : "base64");
    };
    socket.on("message", (data) => {
      const kind = data[0] >> 4;
      if (kind === 7) {
        socket.send(Buffer.from([0x80]));
        return;
      }
      let offset = 1;
      while (data[offset++] & 128) {}
      const r = reader(data.subarray(offset));
      if (kind === 1) {
        r.byte();
        r.byte();
        r.str();
        r.str();
        r.str();
        r.skip(8);
        const publicBytes = Buffer.from(r.str(), "base64"),
          pair = generateKeyPairSync("x25519");
        const pub = createPublicKey({
          format: "der",
          type: "spki",
          key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), publicBytes])
        });
        key = Buffer.from(
          md5(
            diffieHellman({ privateKey: pair.privateKey, publicKey: pub }).toString("base64")
          ).slice(0, 16)
        );
        current = { socket, crypt };
        socket.send(
          pack(
            0x21,
            Buffer.concat([
              Buffer.from([4]),
              u64(0),
              Buffer.from([1]),
              str(
                pair.publicKey
                  .export({ format: "der", type: "spki" })
                  .subarray(-32)
                  .toString("base64")
              ),
              str(iv.toString()),
              u64(1)
            ])
          )
        );
      } else if (kind === 3) {
        r.byte();
        const seq = r.u32();
        r.str();
        r.str();
        r.byte();
        r.u32();
        r.str();
        replies.push(JSON.parse(crypt(r.rest().toString(), true)));
        socket.send(
          pack(0x40, Buffer.concat([u64(100 + seq), u32(seq), u32(seq), Buffer.from([1])]))
        );
      }
    });
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });
  return {
    url: `http://127.0.0.1:${http.address().port}`,
    replies,
    cards,
    online() {
      offline = false;
    },
    get connections() {
      return connections;
    },
    disconnect() {
      current.socket.terminate();
    },
    send(content) {
      const n = ++sequence,
        id = BigInt(1000 + n),
        stamp = 12345,
        clientNo = `incoming-${n}`;
      const payload = current.crypt(JSON.stringify({ type: 1, content, space_id: "space" }));
      const hash = md5(current.crypt(`${id}${n}${clientNo}${stamp}ownerbot1${payload}`));
      current.socket.send(
        pack(
          0x52,
          Buffer.concat([
            Buffer.from([0]),
            str(hash),
            str("owner"),
            str("bot"),
            Buffer.from([1]),
            u32(0),
            str(clientNo),
            u64(id),
            u32(n),
            u32(stamp),
            Buffer.from(payload)
          ])
        )
      );
    }
  };
}
