import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
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
// 显式开启真实时间长测：不缩短产品心跳/退避，不改变操作者网络或真实服务。
const simulateOutages = process.env.OCTO_RECOVERY_OUTAGE === "1";
for (const mode of ["cli", "sdk"]) {
  test(
    `${mode}: offline startup, WS loss and active worker loss recover fresh IM work without recreating services`,
    {
      timeout: simulateOutages ? 240000 : 60000,
      skip: mode === "cli" && process.platform === "win32"
    },
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
            bf_token: `bf_${randomUUID()}`,
            allowed_sender_ids: ["owner"],
            adapter: { adapter_type: "test", workdir: home }
          }
        ]
      };
      const children = [],
        statusRows = [];
      let kernel, extra;
      const connectionRows = () =>
        mode === "sdk"
          ? statusRows
          : (children[1]?.output ?? "").split("\n").flatMap((line) => {
              try {
                return [JSON.parse(line)];
              } catch {
                return [];
              }
            });
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
        // 同一服务依次经历普通断开、两轮 reason 12、滚动更新式未知错误及新增断开码，再接收新消息。
        let replyCount = 1;
        for (const reason of [undefined, 12, 12, 0, 255]) {
          const connectionCount = im.connections;
          im.disconnect(reason);
          await waitFor(async () => {
            const bot = (await inspectExtra(controlEndpoint)).status.bots[0];
            return (
              bot.state === "retrying" &&
              bot.connected === false &&
              bot.error ===
                (reason === undefined ? "IM_DISCONNECTED" : `IM_SERVER_DISCONNECTED_${reason}`)
            );
          });
          await waitFor(
            async () =>
              im.connections === connectionCount + 1 &&
              (await inspectExtra(controlEndpoint)).status.bots[0].connected,
            8000
          );
          im.send(`after reconnect ${++replyCount}`);
          await waitFor(
            () => im.replies.filter((row) => row.content === "answer").length === replyCount,
            5000
          );
          assert.equal((await admissions()).length, replyCount);
        }
        let extraConnections = 0;
        if (simulateOutages) {
          const replyAfterRecovery = async (scenario) => {
            im.send(scenario);
            replyCount++;
            await waitFor(
              () => im.replies.filter((row) => row.content === "answer").length === replyCount,
              5000
            );
            assert.equal((await admissions()).length, replyCount);
            assert.equal(im.activeConnections, 1);
          };
          // 服务停机期间真实 TCP 拒绝连接，须继续 5/10/15 秒退避，而非只在恢复后测试一次。
          const stoppedAt = performance.now();
          const rowStart = connectionRows().length;
          await im.stopServer();
          await waitFor(
            () =>
              connectionRows()
                .slice(rowStart)
                .filter((row) => row.event === "channel.connection_failed").length >= 2,
            20000
          );
          const offline = (await inspectExtra(controlEndpoint)).status.bots[0];
          assert.equal(offline.state, "retrying");
          assert.equal(offline.connected, false);
          const backoff = connectionRows()
            .slice(rowStart)
            .filter((row) => row.event === "channel.retry_scheduled")
            .map((row) => row.data.delay_ms);
          assert.deepEqual(backoff, [5000, 10000, 15000]);
          const resumedAt = performance.now();
          await im.startServer();
          await waitFor(
            async () => (await inspectExtra(controlEndpoint)).status.bots[0].connected,
            18000
          );
          extraConnections++;
          await replyAfterRecovery("after server restart");
          t.diagnostic(
            JSON.stringify({
              mode,
              scenario: "server-stop-start",
              offline_ms: Math.round(resumedAt - stoppedAt),
              recovered_after_restore_ms: Math.round(performance.now() - resumedAt),
              backoff_ms: backoff,
              reply: "answer"
            })
          );

          // 静默丢弃 PING/PONG，不主动断 socket；必须由真实 90 秒阈值发现半开连接。
          const silentAt = performance.now();
          im.setBlackhole(true);
          await waitFor(async () => {
            const bot = (await inspectExtra(controlEndpoint)).status.bots[0];
            return bot.state === "retrying" && bot.error === "IM_HEARTBEAT_TIMEOUT";
          }, 125000);
          const detectedAt = performance.now();
          im.setBlackhole(false);
          assert.ok(
            detectedAt - silentAt >= 85000,
            "real heartbeat deadline must not be accelerated"
          );
          await waitFor(
            async () => (await inspectExtra(controlEndpoint)).status.bots[0].connected,
            8000
          );
          extraConnections++;
          await replyAfterRecovery("after silent network recovery");
          t.diagnostic(
            JSON.stringify({
              mode,
              scenario: "silent-packet-loss",
              detection_ms: Math.round(detectedAt - silentAt),
              recovered_after_restore_ms: Math.round(performance.now() - detectedAt),
              reply: "answer"
            })
          );
        }
        im.send("wait-for-cancel");
        await waitFor(async () => (await admissions()).length === replyCount + 1, 5000);
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
          () => im.replies.filter((row) => row.content === "answer").length === replyCount + 1,
          5000
        );
        const starts = await admissions();
        assert.equal(starts.length, replyCount + 2, "lost work must not be admitted again");
        assert.equal(new Set(starts).size, replyCount + 2);
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
        const rows = connectionRows();
        for (const event of [
          "channel.disconnected",
          "channel.retry_scheduled",
          "channel.retry_started",
          "channel.connected"
        ]) {
          assert.ok(rows.filter((row) => row.event === event).length >= 5, event);
        }
        assert.ok(
          rows.some(
            (row) =>
              row.event === "channel.disconnected" &&
              row.data.code === "IM_SERVER_DISCONNECTED_12" &&
              row.data.state === "retrying"
          )
        );
        assert.equal(
          im.connections,
          6 + extraConnections,
          "no extra connection may be created during recovery"
        );
        if (mode === "sdk") {
          assert.ok(
            statusRows.some(
              (row) => row.event === "channel.retry_scheduled" && row.data.delay_ms === 5000
            )
          );
          assert.equal(JSON.stringify(statusRows).includes(config.bots[0].bf_token), false);
          assert.doesNotMatch(
            JSON.stringify(statusRows),
            /bf_fixture|session_id|run_id|invocation_id|wait-for-cancel/
          );
        } else {
          assert.equal(children[1].output.includes(config.bots[0].bf_token), false);
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
