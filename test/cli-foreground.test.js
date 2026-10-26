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
import { createWindowsConsole, consoleProcessId } from "../test-support/windows-console.mjs";

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
    const began = Date.now();
    const stage = (name) =>
      t.diagnostic(`foreground stage: ${name}, elapsed=${Date.now() - began}ms`);
    const home = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "ocf-"));
    const processes = [];
    let client;
    let consoleControl;
    t.after(async () => {
      // 先关闭所属进程再删除 Home；目录删除失败不能跳过进程回收。
      client?.close();
      const errors = [];
      for (const entry of processes.reverse()) {
        try {
          await stop(entry);
        } catch (error) {
          errors.push(error);
          try {
            if (consoleControl && entry.pid) await consoleControl.terminate(entry.pid);
            else entry.child.kill("SIGKILL");
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
      }
      await rm(home, { recursive: true, force: true });
      if (errors.length) throw new AggregateError(errors, "foreground fixture cleanup failed");
    });
    consoleControl = await createWindowsConsole();
    stage("console ready");
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
    async function start(component) {
      const args = [
        resolve("apps/cli/dist/index.js"),
        "--json",
        "--home",
        home,
        component,
        "run",
        ...(component === "executor-kernel"
          ? ["--manifest", resolve("test/fixtures/adapters.json")]
          : [])
      ];
      const options = { stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
      const child = consoleControl
        ? consoleControl.spawn(args, options)
        : spawn(process.execPath, args, options);
      const entry = {
        child,
        pid: consoleControl ? undefined : child.pid,
        output: "",
        errors: "",
        exited: new Promise((resolve, reject) => {
          child.once("close", (code, signal) => resolve({ code, signal }));
          child.once("error", reject);
        })
      };
      processes.push(entry);
      child.stdout.on("data", (chunk) => {
        entry.output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        entry.errors += chunk;
        if (consoleControl) entry.pid ??= consoleProcessId(entry.errors);
      });
      await waitFor(() => {
        if (child.exitCode !== null) throw Error(entry.output + entry.errors);
        return entry.output.includes('"state": "ready"') && entry.pid;
      }, 10_000);
      assert.ok(entry.pid, "the fixture must observe the actual service PID");
      return entry;
    }
    async function stop(entry) {
      if (entry.stopped) return entry.stopped;
      return (entry.stopped = (async () => {
        const started = Date.now();
        if (entry.child.exitCode === null && entry.child.signalCode === null) {
          if (consoleControl) await consoleControl.interrupt(entry.pid);
          else entry.child.kill("SIGTERM");
        }
        let timer;
        try {
          const result = await Promise.race([
            entry.exited,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`foreground did not close: ${entry.output}${entry.errors}`)),
                7_000
              );
            })
          ]);
          assert.ok(Date.now() - started < 7_000);
          assert.throws(() => process.kill(entry.pid, 0), { code: "ESRCH" });
          t.diagnostic(
            `${consoleControl ? "CTRL_C_EVENT" : "SIGTERM"}: pid=${entry.pid}, code=${result.code}, signal=${result.signal}, close=${Date.now() - started}ms`
          );
          return result;
        } finally {
          clearTimeout(timer);
        }
      })());
    }
    const calls = [];
    // 本测试验证真实前台进程和 IPC，不依赖机器的任务计划程序安装状态。
    // status 与 start/restart 共用假管理器，避免每次状态观测启动 schtasks/PowerShell，
    // 将系统管理器竞争混入独立启动、取消及资源回收的 20 秒总预算。
    const backend = {
      inspect: async () => ({ state: "stopped", enabled: false, drift: [] }),
      start: async (spec) => calls.push(["start", spec.id]),
      restart: async (spec) => calls.push(["restart", spec.id])
    };
    const gateway = await start("channel-gateway");
    stage("gateway ready");
    const status = async () => {
      let value;
      assert.equal(
        await runCli(["--json", "--home", home, "status"], {
          backend,
          output: (line) => {
            value = JSON.parse(line);
          }
        }),
        0
      );
      return value;
    };
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, false);
    assert.equal((await status())["channel-gateway"].runtime.pid, gateway.pid);
    stage("initial status checked");
    const kernel = await start("executor-kernel");
    stage("kernel ready");
    client = attachKernel({ endpoint: componentEndpoint(home) });
    const kernelStatus = await client.status();
    const instance = kernelStatus.kernel_instance_id;
    assert.equal(kernelStatus.pid, kernel.pid);
    assert.ok(kernelStatus.worker.pid);
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
    const gatewayExit = await stop(gateway);
    stage("service control and gateway stop checked");
    assert.equal(gateway.child.exitCode, 0);
    assert.equal((await client.status()).kernel_instance_id, instance);
    const next = await start("channel-gateway");
    stage("gateway restarted");
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, true);
    const kernelExit = await stop(kernel);
    assert.throws(() => process.kill(kernelStatus.worker.pid, 0), { code: "ESRCH" });
    assert.equal((await status())["channel-gateway"].runtime.status.kernel_available, false);
    stage("final status checked");
    assert.equal(next.child.exitCode, null);
    const nextExit = await stop(next);
    assert.equal(next.child.exitCode, 0);
    t.diagnostic(
      "post-shutdown: Kernel instance survived sibling stop; gateway restarted; Kernel worker exited; remaining gateway reported unavailable and stopped independently"
    );
    // 保留原 0 断言，但在其前完成所有 post-shutdown 观测，避免掩盖独立的失败阶段。
    assert.equal(kernel.child.exitCode, 0, kernel.output + kernel.errors);
    for (const result of [gatewayExit, kernelExit, nextExit])
      assert.deepEqual(result, { code: 0, signal: null });
  }
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(
    `Windows child.kill(${signal}) is forced termination, separate from console cancellation`,
    { timeout: 5_000, skip: process.platform !== "win32" },
    async (t) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
        process.on('SIGTERM', () => process.stdout.write('HANDLED'));
        process.on('SIGINT', () => process.stdout.write('HANDLED'));
        setInterval(() => {}, 1000);
        process.stdout.write('ready');
      `
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.resume();
      const exited = once(child, "close");
      await waitFor(() => output.includes("ready"), 2_000);
      child.kill(signal);
      const [code, observedSignal] = await exited;
      assert.deepEqual({ code, signal: observedSignal }, { code: null, signal });
      assert.doesNotMatch(output, /HANDLED/);
      assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
      t.diagnostic(
        `forced child.kill: code=${code}, signal=${observedSignal}; JS handler not invoked`
      );
    }
  );
}
