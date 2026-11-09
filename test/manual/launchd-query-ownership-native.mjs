import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import {
  LaunchdUserBackend,
  NodeCommandRunner
} from "../../packages/octo-runtime-cross-service/dist/index.js";

const enabled = process.platform === "darwin" && process.env.OCTO_LAUNCHD_OWNERSHIP_NATIVE === "1";

// 仅管理本次独占 label；真实 launchctl 与注入查询故障的证据分别记录。
test(
  "native launchd ownership survives query failures and cleans up",
  { skip: !enabled },
  async (t) => {
    const native = new NodeCommandRunner();
    const uid = process.getuid();
    const domain = `gui/${uid}`;
    const label = `com.octo.ownership-${randomUUID()}`;
    const target = `${domain}/${label}`;
    const probe = await native.run("/bin/launchctl", ["print", domain]);
    assert.equal(probe.exitCode, 0, "GUI domain unavailable: native verification blocked");
    const home = await mkdtemp(join(tmpdir(), "ort158-native-"));
    const path = join(home, "Library", "LaunchAgents", `${label}.plist`);
    const pids = new Set();
    let fault;
    let bootedOut = false;
    const backend = new LaunchdUserBackend({
      homeDirectory: home,
      uid,
      runner: {
        async run(command, args, options) {
          if (
            (args[0] === "print" &&
              (fault === "print" || (fault === "after-bootout" && bootedOut))) ||
            (args[0] === "print-disabled" && fault === "disabled")
          ) {
            return {
              command,
              args,
              exitCode: 5,
              stdout: "",
              stderr: "injected permission failure"
            };
          }
          const result = await native.run(command, args, options);
          if (args[0] === "bootout" && result.exitCode === 0) bootedOut = true;
          const pid = result.stdout.match(/^\s*pid = (\d+)$/m)?.[1];
          if (pid) pids.add(Number(pid));
          return result;
        }
      }
    });
    const control = new LaunchdUserBackend({ homeDirectory: home, uid, runner: native });
    const spec = {
      id: label,
      command: "/bin/sleep",
      args: ["300"],
      workingDirectory: home,
      restart: { policy: "never" },
      timeoutStopSeconds: 1
    };
    const waitForExit = async () => {
      for (const pid of pids) {
        const until = Date.now() + 10_000;
        while (true) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            if (error.code === "ESRCH") break;
            throw error;
          }
          assert.ok(Date.now() < until, `owned process ${pid} has not exited`);
          await sleep(50);
        }
      }
    };
    const start = async () => {
      fault = undefined;
      bootedOut = false;
      await backend.install(spec);
      await backend.start(spec);
      const until = Date.now() + 10_000;
      while (true) {
        const status = await backend.inspect(spec);
        if (status.state === "running" && status.pid) {
          pids.add(status.pid);
          t.diagnostic(`loaded ${label} pid=${status.pid}`);
          return;
        }
        assert.ok(Date.now() < until, "native fixture failed to run");
        await sleep(50);
      }
    };
    let primaryFailure;
    try {
      await start();
      const bytes = await readFile(path);
      for (const mode of ["print", "disabled"]) {
        fault = mode;
        await assert.rejects(backend.inspect(spec), { code: "COMMAND_FAILED" });
        if (mode === "print") {
          await assert.rejects(backend.stop(spec), { code: "COMMAND_FAILED" });
          await assert.rejects(backend.uninstall(spec), { code: "COMMAND_FAILED" });
        } else {
          await assert.rejects(backend.start(spec), { code: "COMMAND_FAILED" });
          await assert.rejects(backend.restart(spec), { code: "COMMAND_FAILED" });
        }
        assert.deepEqual(await readFile(path), bytes);
        assert.equal((await control.inspect(spec)).state, "running");
        t.diagnostic(`injected ${mode} failure: definition retained; native job still running`);
      }
      fault = undefined;
      await backend.stop(spec);
      assert.equal((await control.inspect(spec)).state, "stopped");
      assert.deepEqual(await readFile(path), bytes);
      await waitForExit();
      await backend.uninstall(spec);
      await backend.uninstall(spec);
      await assert.rejects(readFile(path), { code: "ENOENT" });
      t.diagnostic("native stop/uninstall and repeated uninstall confirmed");

      await start();
      fault = "after-bootout";
      await assert.rejects(backend.uninstall(spec), { code: "COMMAND_FAILED" });
      assert.equal(bootedOut, true);
      assert.deepEqual(await readFile(path), bytes);
      t.diagnostic(
        "injected post-bootout query failure: definition retained, no successful uninstall claimed"
      );
      fault = undefined;
      await backend.uninstall(spec);
      await assert.rejects(readFile(path), { code: "ENOENT" });
      await waitForExit();
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      // 独立 control 不注入故障；失败时保留路径和 label，不能吞掉清理失败。
      try {
        const remaining = await native.run("/bin/launchctl", ["print", target]);
        const pid = remaining.stdout.match(/^\s*pid = (\d+)$/m)?.[1];
        if (pid) pids.add(Number(pid));
        await control.uninstall(spec);
        const absent = await native.run("/bin/launchctl", ["print", target]);
        assert.equal(absent.exitCode, 113);
        assert.ok(absent.stderr.includes(`Could not find service "${label}"`));
        await waitForExit();
        await rm(home, { recursive: true, force: true });
        t.diagnostic(`cleanup confirmed: ${target}; pids=${[...pids].join(",")}; home removed`);
      } catch (error) {
        const cleanupFailure = new Error(
          `native cleanup incomplete: ${target}; pids=${[...pids].join(",")}; home=${home}`,
          { cause: error }
        );
        if (primaryFailure) {
          throw new AggregateError(
            [primaryFailure, cleanupFailure],
            "native verification and cleanup failed"
          );
        }
        throw cleanupFailure;
      }
    }
  }
);
