import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { recoveryImFixture } from "./recovery-im-fixture.js";
import { kernelInput, frames } from "./kernel-fixture.js";
import { waitFor } from "./runtime-fixture.js";
import { cleanupRecovery, finishRecovery } from "../test-support/recovery-cleanup.mjs";
import {
  launchRecoveryChild,
  launchRecoveryKernel,
  recoveryOutputRows
} from "../test-support/recovery-dependency.mjs";

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
    `${mode}: offline startup, WS loss recover fresh IM work without recreating services`,
    {
      timeout: simulateOutages ? 240000 : 60000,
      skip: mode === "cli" && process.platform === "win32"
    },
    async (t) => {
      const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "or-"));
      let cleanupComplete = false;
      t.after(() => {
        if (cleanupComplete) return rm(home, { recursive: true, force: true });
        t.diagnostic(`Recovery cleanup incomplete; retained Home: ${home}`);
      });
      const im = await recoveryImFixture(t);
      const startsFile = join(home, "starts");
      const endpoint = componentEndpoint(home),
        controlEndpoint = componentEndpoint(home, "channel-gateway");
      const keysFile = join(home, "keys.jsonl");
      const env = {
        ...process.env,
        OCTO_RECOVERY_STARTS_FILE: startsFile,
        OCTO_RECOVERY_KEYS_FILE: keysFile
      };
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
      const children = [];
      let kernelDependency, gatewayHost;
      const connectionRows = () => (gatewayHost ? recoveryOutputRows(gatewayHost) : []);
      const client = attachKernel({ endpoint });
      const failure = { failed: false, error: undefined };
      let probe;
      try {
        // 仅显式手动专项加载注入器；普通恢复用例不增加场景或改变服务行为。
        if (process.env.OCTO_RECOVERY_TEARDOWN_PROBE) {
          const { createRecoveryProbe } = await import("./manual/recovery-teardown-probe.mjs");
          probe = createRecoveryProbe(process.env.OCTO_RECOVERY_TEARDOWN_PROBE);
          probe.register({ home, children });
        }
        kernelDependency = launchRecoveryKernel(children, endpoint, env, home);
        probe?.register({ home, children });
        await waitFor(
          async () =>
            client.status().then(
              (value) => value.execution_ready,
              () => {
                if (kernelDependency.processErrors.length || kernelDependency.exitObserved)
                  throw new Error("Kernel dependency startup failed", {
                    cause: kernelDependency.processErrors[0] ?? kernelDependency.errors
                  });
                return false;
              }
            ),
          10000
        );
        if (mode === "sdk") {
          gatewayHost = launchRecoveryChild(
            children,
            "channel-gateway",
            [resolve("test-support/recovery-gateway-host.mjs")],
            env,
            true
          );
          gatewayHost.child.send({ home, endpoint, controlEndpoint, config });
        } else {
          await mkdir(join(home, "extras", "channel-gateway"), { recursive: true });
          await writeFile(
            join(home, "extras", "channel-gateway", "config.json"),
            JSON.stringify({ config }),
            { mode: 0o600 }
          );
          gatewayHost = launchRecoveryChild(
            children,
            "channel-gateway",
            [resolve("apps/cli/dist/index.js"), "channel-gateway", "run", "--home", home, "--json"],
            env
          );
        }
        probe?.register({ home, children });
        let initial;
        await waitFor(async () => {
          for (const entry of children)
            if (entry.exitObserved || entry.processErrors.length)
              throw new Error(`Fixture child failed: ${entry.output} ${entry.errors}`, {
                cause: entry.processErrors[0]
              });
          initial = await inspectExtra(controlEndpoint).catch(() => undefined);
          return initial?.status.bots?.[0]?.state === "retrying";
        }, 10000);
        const before = await client.status();
        assert.equal(initial.status.bots[0].connected, false);
        assert.equal(initial.pid, gatewayHost.child.pid);
        assert.equal(before.pid, kernelDependency.child.pid);
        assert.equal(new Set([initial.pid, before.pid, process.pid]).size, 3);
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
          const rowStart = connectionRows().length;
          im.disconnect(reason);
          // 立即重连可能在两次 IPC 查询之间完成；用已发生的状态事件核验断线，不要求卡在 retrying。
          // 后续仍核验新的单次连接、online、真实回复和执行次数，不能用日志代替恢复结果。
          await waitFor(() =>
            connectionRows()
              .slice(rowStart)
              .some(
                (row) =>
                  row.event === "channel.disconnected" &&
                  row.data.state === "retrying" &&
                  row.data.code ===
                    (reason === undefined ? "IM_DISCONNECTED" : `IM_SERVER_DISCONNECTED_${reason}`)
              )
          );
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
          // 服务停机期间真实 TCP 拒绝连接，验证立即重连、十次快速重试及后续 5/10/15 秒退避。
          const stoppedAt = performance.now();
          const rowStart = connectionRows().length;
          await im.stopServer();
          await waitFor(
            () =>
              connectionRows()
                .slice(rowStart)
                .filter((row) => row.event === "channel.connection_failed").length >= 13,
            40000
          );
          const offline = (await inspectExtra(controlEndpoint)).status.bots[0];
          assert.equal(offline.state, "retrying");
          assert.equal(offline.connected, false);
          const backoff = connectionRows()
            .slice(rowStart)
            .filter((row) => row.event === "channel.retry_scheduled")
            .map((row) => row.data.delay_ms);
          assert.deepEqual(backoff, [0, ...Array(10).fill(1000), 5000, 10000, 15000]);
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

          // 静默丢弃 PING/PONG，不主动断 socket；使用真实 10 秒探测及 10 秒 PONG 预算。
          const silentAt = performance.now();
          im.setBlackhole(true);
          await waitFor(async () => {
            const bot = (await inspectExtra(controlEndpoint)).status.bots[0];
            return bot.state === "retrying" && bot.error === "IM_HEARTBEAT_TIMEOUT";
          }, 30000);
          const detectedAt = performance.now();
          im.setBlackhole(false);
          assert.ok(
            detectedAt - silentAt >= 9500,
            "real heartbeat deadline must not be accelerated"
          );
          // 立即重连的 CONNECT 可能在解除丢包前已被丢弃，须容纳原有 15 秒握手超时及下一次重试。
          await waitFor(
            async () => (await inspectExtra(controlEndpoint)).status.bots[0].connected,
            22000
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
          const statusRows = connectionRows();
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
        if (probe) {
          await probe.beforeShutdown({ children, client, endpoint });
          if (process.env.OCTO_RECOVERY_TEARDOWN_BODY_FAILURE === "1")
            throw new Error("FIXTURE_ORIGINAL_BODY_FAILURE");
        }
      } catch (error) {
        failure.failed = true;
        failure.error = error;
      } finally {
        const gatewayCleanup = await cleanupRecovery({
          children: gatewayHost ? [gatewayHost] : [],
          onEvent: (event) => probe?.event(event)
        });
        try {
          if (mode === "sdk" && gatewayHost?.exitObserved) {
            const result = recoveryOutputRows(gatewayHost).find(
              (row) => row.event === "fixture.cleanup"
            )?.result;
            assert.ok(result, "SDK host must report native close result");
            assert.equal(result.complete, true, JSON.stringify(result));
            assert.equal(gatewayHost.child.exitCode, 0);
          }
          if (mode === "cli" && gatewayHost?.exitObserved && !gatewayHost.child.signalCode) {
            assert.equal(gatewayHost.child.exitCode, 0, gatewayHost.errors);
          }
        } catch (error) {
          gatewayCleanup.errors.push(error);
        }
        try {
          if (probe && kernelDependency && gatewayHost)
            await probe.afterShutdown({ client, endpoint, gatewayHost });
        } catch (error) {
          gatewayCleanup.errors.push(error);
        }
        // 只有外层环境拥有 Kernel 回收权限；Gateway 关闭或探针失败都不能跳过它。
        const environmentCleanup = await cleanupRecovery({
          client,
          children: kernelDependency ? [kernelDependency] : [],
          onEvent: (event) => probe?.event(event)
        });
        const cleanup = {
          complete: gatewayCleanup.complete && environmentCleanup.complete,
          errors: [...gatewayCleanup.errors, ...environmentCleanup.errors]
        };
        if (kernelDependency?.exitObserved && kernelDependency.child.exitCode !== 0)
          cleanup.errors.push(
            new Error(
              `Kernel dependency exited with ${kernelDependency.child.exitCode}: ${kernelDependency.output} ${kernelDependency.errors}`
            )
          );
        cleanupComplete = cleanup.complete;
        finishRecovery(failure, cleanup, (message) => t.diagnostic(message));
      }
    }
  );
}
