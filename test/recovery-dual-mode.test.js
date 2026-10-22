import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createKernelService,
  createExtraService,
  componentEndpoint
} from "@mininglamp-oss/octo-runtime/host";
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import { recoveryImFixture } from "./recovery-im-fixture.js";
import { kernelInput, frames } from "./kernel-fixture.js";
import { waitFor, withTimeout } from "./runtime-fixture.js";

function inspectExtra(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let pending = "";
    socket.setTimeout(2000, () => socket.destroy(new Error("FIXTURE_STATUS_TIMEOUT")));
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write('{"jsonrpc":"2.0","id":"fixture","method":"status"}\n')
    );
    socket.on("data", (chunk) => {
      pending += chunk;
      if (pending.includes("\n")) {
        resolve(JSON.parse(pending.split("\n")[0]).result);
        socket.destroy();
      }
    });
  });
}
for (const mode of ["cli", "sdk"]) {
  test(
    `${mode}: offline startup, WS loss and active worker loss recover fresh IM work without recreating services`,
    { timeout: 40000, skip: mode === "cli" && process.platform === "win32" },
    async (t) => {
      const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "or-"));
      t.after(() => rm(home, { recursive: true, force: true }));
      const im = await recoveryImFixture(t);
      const startsFile = join(home, "starts");
      const endpoint = componentEndpoint(home),
        controlEndpoint = componentEndpoint(home, "channel-gateway");
      const env = { ...process.env, OCTO_RECOVERY_STARTS_FILE: startsFile };
      const config = {
        bots: [
          {
            bot_id: "bot",
            api_url: im.url,
            bf_token: "bf_fixture",
            allowed_sender_ids: ["owner"],
            adapter: { adapter_type: "test", workdir: home }
          }
        ]
      };
      const children = [],
        statusRows = [];
      let kernel, extra;
      const launch = (component, args = []) => {
        const child = spawn(
          process.execPath,
          [resolve("apps/cli/dist/index.js"), component, "run", "--home", home, "--json", ...args],
          { env, stdio: ["ignore", "pipe", "pipe"] }
        );
        const exited = new Promise((resolve, reject) => {
          child.once("exit", resolve);
          child.once("error", reject);
        });
        const entry = { child, exited, output: "", errors: "" };
        children.push(entry);
        child.stdout.on("data", (chunk) => {
          entry.output = (entry.output + chunk).slice(-65536);
        });
        child.stderr.on("data", (chunk) => {
          entry.errors = (entry.errors + chunk).slice(-4096);
        });
        return entry;
      };
      const client = attachKernel({ endpoint });
      try {
        if (mode === "sdk") {
          kernel = createKernelService({
            endpoint,
            workerEntrypoint: resolve("packages/octo-runtime-executor-kernel/dist/runner.js"),
            manifest: resolve("test/fixtures/recovery-adapters.json"),
            env
          });
          extra = createExtraService({
            endpoint,
            controlEndpoint,
            module: gateway,
            config,
            dependencies: {},
            logging: { directory: join(home, "logs"), statusOutput: (row) => statusRows.push(row) }
          });
          await kernel.initialize();
          await extra.initialize();
        } else {
          await mkdir(join(home, "extras", "channel-gateway"), { recursive: true });
          await writeFile(
            join(home, "extras", "channel-gateway", "config.json"),
            JSON.stringify({ config }),
            { mode: 0o600 }
          );
          launch("executor-kernel", [
            "--manifest",
            resolve("test/fixtures/recovery-adapters.json")
          ]);
          await waitFor(
            async () =>
              client.status().then(
                (value) => value.execution_ready,
                () => false
              ),
            10000
          );
          launch("channel-gateway");
        }
        let initial;
        await waitFor(async () => {
          for (const entry of children)
            if (entry.child.exitCode !== null)
              throw new Error(`Fixture child exited: ${entry.output} ${entry.errors}`);
          initial = await inspectExtra(controlEndpoint).catch(() => undefined);
          return initial?.status.bots?.[0]?.state === "retrying";
        }, 10000);
        const before = await client.status();
        assert.equal(initial.status.bots[0].connected, false);
        assert.equal(initial.pid === process.pid, mode === "sdk");
        im.online();
        await waitFor(
          async () => (await inspectExtra(controlEndpoint)).status.bots[0].connected,
          8000
        );
        im.send("baseline");
        await waitFor(
          () => im.replies.filter((row) => row.content === "answer").length === 1,
          5000
        );
        const admissions = async () => (await readFile(startsFile, "utf8")).trim().split("\n");
        assert.equal((await admissions()).length, 1);
        im.disconnect();
        await waitFor(
          async () => (await inspectExtra(controlEndpoint)).status.bots[0].state === "retrying"
        );
        await waitFor(
          async () =>
            im.connections === 2 && (await inspectExtra(controlEndpoint)).status.bots[0].connected,
          8000
        );
        im.send("after reconnect");
        await waitFor(
          () => im.replies.filter((row) => row.content === "answer").length === 2,
          5000
        );
        assert.equal((await admissions()).length, 2);
        im.send("wait-for-cancel");
        await waitFor(async () => (await admissions()).length === 3, 5000);
        const active = await client.status();
        process.kill(active.worker.pid, "SIGKILL");
        await waitFor(async () => {
          const value = await client.status();
          return value.execution_ready && value.worker.generation > active.worker.generation;
        }, 10000);
        await waitFor(
          async () => (await inspectExtra(controlEndpoint)).status.bots[0].workingTasks === 0,
          5000
        );
        im.send("after worker loss");
        await waitFor(
          () => im.replies.filter((row) => row.content === "answer").length === 3,
          5000
        );
        const starts = await admissions();
        assert.equal(starts.length, 4, "lost work must not be admitted again");
        assert.equal(new Set(starts).size, 4);
        const fresh = attachKernel({ endpoint });
        try {
          for (const observer of [client, fresh])
            for (const agentSessionId of ["session-test", "fresh-session"]) {
              const { ref } = await observer.submit(
                kernelInput("direct probe", { agentSessionId })
              );
              assert.equal((await frames(observer, ref)).at(-1).control.state, "completed");
              assert.equal(ref.kernel_instance_id, before.kernel_instance_id);
            }
        } finally {
          fresh.close();
        }
        const after = await inspectExtra(controlEndpoint);
        assert.equal(after.pid, initial.pid);
        assert.equal(after.status.bots[0].connected, true);
        assert.equal((await client.status()).pid, before.pid);
        if (mode === "sdk") {
          assert.ok(
            statusRows.some(
              (row) => row.event === "channel.retry_scheduled" && row.data.delay_ms === 5000
            )
          );
          assert.doesNotMatch(
            JSON.stringify(statusRows),
            /bf_fixture|session_id|run_id|invocation_id|wait-for-cancel/
          );
        } else {
          assert.match(children[1].output, /channel.retry_scheduled/);
          assert.doesNotMatch(
            children[1].output,
            /bf_fixture|session_id|run_id|invocation_id|wait-for-cancel/
          );
        }
      } finally {
        client.close();
        if (extra) await extra.close();
        if (kernel) await kernel.close();
        for (const entry of children.reverse()) {
          if (entry.child.exitCode === null && entry.child.signalCode === null)
            entry.child.kill("SIGTERM");
          try {
            await withTimeout(entry.exited, 7000, "FIXTURE_SHUTDOWN_TIMEOUT");
          } finally {
            if (entry.child.exitCode === null && entry.child.signalCode === null) {
              entry.child.kill("SIGKILL");
              await entry.exited;
            }
          }
        }
      }
    }
  );
}
