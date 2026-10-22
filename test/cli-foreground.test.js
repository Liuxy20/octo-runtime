import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { runCli } from "../apps/cli/dist/main.js";
import { attachKernel } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint, componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
import { waitFor } from "./runtime-fixture.js";

test(
  "extraget preserves complete JSON under slow stdout backpressure",
  { timeout: 15_000 },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "oco-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const stored = { module: "example-extra", config: { value: "x".repeat(700_000) } };
    assert.equal(
      await runCli(["--home", home, "extraset", "example"], {
        input: Readable.from([JSON.stringify(stored)]),
        output() {}
      }),
      0
    );
    const child = spawn(
      process.execPath,
      [resolve("apps/cli/dist/index.js"), "extraget", "example", "--home", home],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const exited = new Promise((resolve, reject) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", reject);
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    // 首批输出已进入管道后才暂停读取，跨过旧 250ms timer，实际制造写入背压。
    await once(child.stdout, "readable");
    const first = child.stdout.read();
    assert.ok(first?.length > 0);
    await delay(800);
    const chunks = [first];
    for await (const chunk of child.stdout) chunks.push(chunk);
    const output = Buffer.concat(chunks);
    assert.deepEqual(await exited, { code: 0, signal: null });
    const expected = Buffer.from(`${JSON.stringify(stored)}\n`);
    assert.equal(output.length, expected.length);
    assert.equal(output.toString(), expected.toString());
    assert.deepEqual(JSON.parse(output.toString()), stored);
    assert.equal(errors, `Config file: ${join(home, "extras", "example", "config.json")}\n`);
  }
);

for (const mode of ["hang", "reject", "startup-failure"]) {
  test(
    `CLI exits after incomplete cleanup despite a referenced timer (${mode})`,
    { timeout: 15_000, skip: process.platform === "win32" && mode !== "startup-failure" },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "ocx-"));
      t.after(() => rm(home, { recursive: true, force: true }));
      assert.equal(
        await runCli(["--home", home, "extraset", "channel-gateway"], {
          input: Readable.from([
            JSON.stringify({
              module: resolve("test/fixtures/stuck-cli-extra.mjs"),
              config: { mode }
            })
          ]),
          output() {}
        }),
        0
      );
      const manifest = join(home, "explicit-manifest.json");
      await writeFile(
        manifest,
        JSON.stringify({
          version: 1,
          adapters: [],
          extras: [
            { name: "channel-gateway", module: resolve("test/fixtures/stuck-cli-extra.mjs") }
          ]
        })
      );
      const child = spawn(
        process.execPath,
        [
          resolve("apps/cli/dist/index.js"),
          "--json",
          "--home",
          home,
          "--manifest",
          manifest,
          "channel-gateway",
          "run"
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      const exited = new Promise((resolve, reject) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
        child.once("error", reject);
      });
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      });
      await waitFor(() => {
        if (child.exitCode !== null) throw new Error(output + errors);
        return output.includes(
          mode === "startup-failure" ? "SERVICE_INITIALIZATION_FAILED" : '"state": "ready"'
        );
      }, 5000);
      const started = Date.now();
      if (mode !== "startup-failure") child.kill("SIGTERM");
      let timer;
      try {
        const result = await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`CLI did not exit: ${output}${errors}`)),
              7000
            );
          })
        ]);
        assert.deepEqual(result, { code: 5, signal: null });
        assert.ok(Date.now() - started < 7000);
        if (mode === "startup-failure") assert.match(output, /SERVICE_INITIALIZATION_FAILED/);
      } finally {
        clearTimeout(timer);
      }
    }
  );
}

test(
  "foreground components stop independently and report Kernel availability without implicit startup",
  { timeout: 20_000 },
  async (t) => {
    const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ocf-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    assert.equal(
      await runCli(["--home", home, "extraset", "channel-gateway"], {
        input: Readable.from([
          JSON.stringify({
            module: "@mininglamp-oss/octo-runtime-extra-channel-gateway",
            config: { bots: [] }
          })
        ]),
        output() {}
      }),
      0
    );
    const processes = [];
    async function start(component) {
      const child = spawn(
        process.execPath,
        [
          resolve("apps/cli/dist/index.js"),
          "--json",
          "--home",
          home,
          component,
          "run",
          ...(component === "executor-kernel"
            ? ["--manifest", resolve("test/fixtures/adapters.json")]
            : [])
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      const entry = {
        child,
        output: "",
        errors: "",
        exited: new Promise((resolve, reject) => {
          child.once("exit", resolve);
          child.once("error", reject);
        })
      };
      processes.push(entry);
      child.stdout.on("data", (chunk) => {
        entry.output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        entry.errors += chunk;
      });
      await waitFor(() => {
        if (child.exitCode !== null) throw Error(entry.output + entry.errors);
        return entry.output.includes('"state": "ready"');
      }, 10_000);
      return entry;
    }
    async function stop(entry) {
      if (entry.child.exitCode === null && entry.child.signalCode === null)
        entry.child.kill("SIGTERM");
      await entry.exited;
    }
    t.after(async () => {
      for (const entry of processes.reverse()) await stop(entry);
    });
    const gateway = await start("channel-gateway");
    const status = async () => {
      let value;
      assert.equal(
        await runCli(["--json", "--home", home, "status"], {
          output: (line) => {
            value = JSON.parse(line);
          }
        }),
        0
      );
      return value;
    };
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, false);
    assert.equal((await status())["channel-gateway"].runtime.pid, gateway.child.pid);
    const kernel = await start("executor-kernel");
    const client = attachKernel({ endpoint: componentEndpoint(home) });
    t.after(() => client.close());
    const instance = (await client.status()).kernel_instance_id;
    assert.equal((await client.status()).pid, kernel.child.pid);
    const calls = [];
    const backend = {
      inspect: async () => ({ state: "stopped", enabled: false, drift: [] }),
      start: async (spec) => calls.push(["start", spec.id]),
      restart: async (spec) => calls.push(["restart", spec.id])
    };
    for (const component of ["executor-kernel", "channel-gateway"]) {
      for (const action of ["start", "restart"]) {
        const before = calls.length;
        assert.equal(
          await runCli(["--home", home, component, action], { backend, output() {} }),
          0
        );
        assert.equal(calls.length, before + 1);
        assert.deepEqual(calls.at(-1), [action, componentServiceId(home, component)]);
      }
    }
    await stop(gateway);
    assert.equal(gateway.child.exitCode, 0);
    assert.equal((await client.status()).kernel_instance_id, instance);
    const next = await start("channel-gateway");
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, true);
    await stop(kernel);
    assert.equal(kernel.child.exitCode, 0);
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, false);
    assert.equal(next.child.exitCode, null);
    await stop(next);
    assert.equal(next.child.exitCode, 0);
  }
);
