import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import * as wecom from "@mininglamp-oss/octo-runtime/extras/channel-wecom";
import * as webui from "@mininglamp-oss/octo-runtime/extras/webui";

/** 只安装实际主包，原生构造全部内置模块并确认发行物包含可读取的静态资源。 */
export async function verifyBuiltinExtras(endpoint: string): Promise<void> {
  for (const module of [gateway, wecom]) {
    const extra = createExtraService({
      endpoint,
      module,
      config: { bots: [] },
      dependencies: { loadContexts: () => [] }
    });
    try {
      await extra.initialize();
      const status = await extra.status();
      assert.equal(status.pid, process.pid);
      assert.equal(status.phase, "ready");
      assert.deepEqual(status.plugin.bots, []);
      assert.deepEqual(status.plugin.errors, []);
    } finally {
      assert.equal((await extra.close()).complete, true);
    }
  }
  const listener = createServer();
  await new Promise<void>((accept) => listener.listen(0, "127.0.0.1", accept));
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((accept, reject) =>
    listener.close((error) => (error ? reject(error) : accept()))
  );
  const extra = createExtraService({
    endpoint,
    module: webui,
    dependencies: {},
    config: {
      port,
      sessionStorePath: resolve("webui/sessions.json"),
      defaultProjectPath: resolve("webui/project")
    }
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    await extra.initialize();
    const status = await extra.status();
    assert.equal(status.pid, process.pid);
    assert.equal(status.plugin.listening, true);
    assert.deepEqual(status.plugin.errors, []);
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
      (match) => match[1]!
    );
    assert.ok(assets.some((asset) => asset.endsWith(".js")));
    assert.ok(assets.some((asset) => asset.endsWith(".css")));
    for (const asset of assets) {
      const resource = await fetch(new URL(asset, origin));
      assert.equal(resource.status, 200, asset);
      assert.ok((await resource.text()).length > 0, asset);
    }
  } finally {
    assert.equal((await extra.close()).complete, true);
  }
  await assert.rejects(fetch(origin));
  for (const name of ["channel-gateway", "channel-wecom", "webui"]) {
    const path = import.meta.resolve(
      `@mininglamp-oss/octo-runtime/extras/${name}/config-schema.json`
    );
    const schema = JSON.parse(await readFile(new URL(path), "utf8")) as { type?: string };
    assert.equal(schema.type, "object");
  }
}
