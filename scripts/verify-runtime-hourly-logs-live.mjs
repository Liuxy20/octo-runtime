import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  startOwnedKernel,
  startExtra,
  componentEndpoint
} from "../packages/octo-runtime-host-sdk/dist/index.js";

assert.ok(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "Set protected QA account file path");
const blocks = (await readFile(process.env.OCTO_CHANNEL_QA_ACCOUNTS, "utf8"))
  .split(/(?=Bot Name:)/)
  .slice(1);
const block = blocks[Number(process.env.OCTO_CAPACITY_QA_INDEX ?? 3)];
const field = (key) => block?.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
assert.equal(field("API Server"), "https://im-test.deepminer.com.cn/api");
assert.ok(field("Bot Token")?.startsWith("bf_"));
const home = await mkdtemp(join(tmpdir(), "oh-log-"));
const previous = process.env.OCTO_RUNTIME_DEBUG;
process.env.OCTO_RUNTIME_DEBUG = "1";
const endpoint = componentEndpoint(home);
const kernel = await startOwnedKernel({
  endpoint,
  workerEntrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
  manifest: resolve("apps/cli/dist/default_adapters.json"),
  env: { ...process.env, OCTO_RUNTIME_HOME: home }
});
let extras = [];
const stopExtras = async () => {
  const closing = extras;
  extras = [];
  for (const extra of closing) assert.equal((await extra.stop()).complete, true);
};
const loadExtra = async (declaration) => {
  const extra = await startExtra({
    endpoint,
    declaration,
    logging: { directory: join(home, "logs") }
  });
  extras.push(extra);
  return extra;
};
const sizes = [];
try {
  for (let round = 0; round < 2; round++) {
    await loadExtra({
      name: "log-output",
      module: resolve("test/fixtures/log-output-extra.js"),
      config: {}
    });
    await loadExtra({
      name: "channel-gateway",
      module: resolve("packages/octo-runtime-extra-channel-gateway/dist/extra.js"),
      config: {
        bots: [
          {
            bot_id: field("Bot ID"),
            bf_token: field("Bot Token"),
            api_url: field("API Server"),
            adapter: { adapter_type: "codex" },
            cards: false,
            typing: false,
            allowed_sender_ids: ["hourly-qa-no-inbound"]
          }
        ]
      }
    });
    const status = await extras.find((extra) => extra.name === "channel-gateway").status();
    assert.equal(status.bots[0].state, "online");
    await stopExtras();
    const logs = join(home, "logs", "extras");
    const names = await readdir(logs);
    assert.ok(!names.includes("embedded-runtime.log"));
    const hourly = names.filter((name) => /^log-output-\d{8}T\d{2}\.log$/.test(name));
    assert.equal(hourly.length, 1);
    const path = join(logs, hourly[0]),
      text = await readFile(path, "utf8");
    assert.ok(text.includes("fixture.disposed"));
    assert.ok(!text.includes(field("Bot Token")));
    sizes.push((await stat(path)).size);
  }
  assert.ok(sizes[1] > sizes[0]);
  console.log(
    JSON.stringify({
      endpoint: "https://im-test.deepminer.com.cn",
      onlineRestarts: 2,
      files: 1,
      sizes,
      finalOutputDrained: true,
      credentialsLogged: false
    })
  );
} finally {
  await stopExtras();
  assert.equal((await kernel.stop()).complete, true);
  if (previous === undefined) delete process.env.OCTO_RUNTIME_DEBUG;
  else process.env.OCTO_RUNTIME_DEBUG = previous;
  await rm(home, { recursive: true, force: true });
}
