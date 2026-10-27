import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../apps/cli/dist/main.js";
import { componentEndpoint, componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
import { LaunchdUserBackend, ServiceError } from "@mininglamp-oss/octo-runtime-cross-service";
import { describeError, formatStatus, readStartupFailure } from "../apps/cli/dist/output.js";
import {
  createUnixServiceFixture,
  mapCliServiceToUnix
} from "../test-support/unix-service-fixture.js";

test("CLI start installs a missing service with progress on stderr and queries the Extra's own status", async (t) => {
  let loaded = false;
  let disabled = false;
  let queries = 0;
  let enables = 0;
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  });
  const { home, unixHome } = await createUnixServiceFixture(
    t,
    "oc75-",
    process.platform === "darwin" ? "/tmp" : tmpdir()
  );
  const backend = new LaunchdUserBackend({
    platform: "darwin",
    homeDirectory: home,
    uid: 501,
    runner: {
      async run(command, args) {
        let stdout = "";
        let exitCode = 0;
        if (args[0] === "disable") disabled = true;
        if (args[0] === "enable") {
          disabled = false;
          enables++;
        }
        if (args[0] === "print-disabled")
          stdout = `"${componentServiceId(home, "channel-wecom")}" => ${disabled}`;
        if (args[0] === "print") {
          exitCode = loaded ? 0 : 113;
          stdout = "state = running\npid = 123\n";
        }
        if (args[0] === "bootstrap") {
          assert.equal(disabled, false);
          assert.equal(
            args[2],
            join(
              home,
              "Library",
              "LaunchAgents",
              `${componentServiceId(home, "channel-wecom")}.plist`
            )
          );
          const plist = await readFile(args[2], "utf8");
          assert.match(plist, /channel-wecom/);
          assert.ok(plist.includes("<string>/usr/bin/node</string>"));
          assert.ok(plist.includes("<string>/opt/octo-runtime/cli.js</string>"));
          assert.ok(plist.includes(`<key>WorkingDirectory</key>\n  <string>${unixHome}</string>`));
          await mkdir(join(home, "sockets"), { recursive: true });
          server = net.createServer((socket) =>
            socket.once("data", (bytes) => {
              const request = JSON.parse(bytes.toString());
              queries++;
              socket.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: {
                    name: "channel-wecom",
                    pid: 123,
                    status: {
                      kernel_available: false,
                      bots: [
                        {
                          name: "test",
                          state: "offline",
                          workingTasks: 2,
                          cardDeliveries: 123,
                          deliveries: 45
                        }
                      ]
                    }
                  }
                }) + "\n"
              );
            })
          );
          await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(componentEndpoint(home, "channel-wecom"), resolve);
          });
          loaded = true;
        }
        return { command, args, stdout, stderr: "", exitCode };
      }
    }
  });
  mapCliServiceToUnix(t, backend, home, unixHome);
  const call = async (...args) => {
    let output = "";
    const progress = [];
    const code = await runCli(["--home", home, ...args], {
      backend,
      output: (line) => {
        output += line;
      },
      errorOutput: (line) => progress.push(line)
    });
    return { code, output, progress };
  };
  const started = await call("channel-wecom", "start", "--json");
  assert.equal(started.code, 0);
  assert.equal(JSON.parse(started.output).service.enabled, true);
  assert.equal(JSON.parse(started.output).action, "start");
  assert.equal(JSON.parse(started.output).runtime.pid, 123);
  assert.equal(JSON.parse(started.output).runtime.status.bots[0].workingTasks, 2);
  assert.equal(JSON.parse(started.output).runtime.status.bots[0].cardDeliveries, 123);
  assert.equal(JSON.parse(started.output).runtime.status.bots[0].deliveries, 45);
  assert.deepEqual(started.progress, [
    "channel-wecom: service not installed; installing with autostart enabled...",
    "channel-wecom: installation complete; starting service..."
  ]);
  const previousEnables = enables;
  const repeated = await call("channel-wecom", "start");
  assert.equal(repeated.code, 0);
  assert.deepEqual(repeated.progress, []);
  assert.equal(enables, previousEnables);
  const pretty = await call("channel-wecom", "status");
  assert.match(pretty.output, /autostart: on/);
  assert.match(pretty.output, /Kernel: unavailable/);
  assert.match(pretty.output, /workingTasks: 2/);
  assert.match(pretty.output, /cardDeliveries: 123/);
  assert.match(pretty.output, /deliveries: 45/);
  assert.equal(
    repeated.output,
    `channel-wecom: start succeeded\n${pretty.output}\nLogs: ${join(home, "logs")}`
  );
  const restarted = await call("channel-wecom", "restart");
  assert.equal(restarted.code, 0);
  assert.equal(
    restarted.output,
    `channel-wecom: restart succeeded\n${pretty.output}\nLogs: ${join(home, "logs")}`
  );
  const restartedJson = await call("channel-wecom", "restart", "--json");
  assert.equal(restartedJson.code, 0);
  assert.equal(JSON.parse(restartedJson.output).action, "restart");
  assert.deepEqual(JSON.parse(restartedJson.output).runtime, JSON.parse(started.output).runtime);
  const json = await call("channel-wecom", "status", "--json");
  assert.equal(JSON.parse(json.output).service.enabled, true);
  assert.equal(JSON.parse(json.output).runtime.status.bots[0].workingTasks, 2);
  assert.match(json.output, /\n  "service":/);
  assert.ok(queries >= 3);
  let managerFailure;
  assert.equal(
    await runCli(["--home", home, "channel-wecom", "status", "--json"], {
      backend: {
        kind: "fixture",
        inspect: async () => {
          throw new ServiceError("MANAGER_UNAVAILABLE", "secret");
        }
      },
      output: (line) => {
        managerFailure = JSON.parse(line);
      }
    }),
    0
  );
  assert.equal(managerFailure.service.detail, "MANAGER_UNAVAILABLE");
  assert.equal(managerFailure.runtime.status.bots[0].workingTasks, 2);
});

test("status isolates manager failures and includes all configured Extras without importing modules", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oc75-status-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const backend = {
    kind: "fixture",
    inspect: async (spec) => {
      if (spec.id.endsWith("executor-kernel"))
        throw new ServiceError("MANAGER_UNAVAILABLE", "private fixture secret");
      return { manager: "fixture", state: "not_installed", enabled: false, drift: [] };
    }
  };
  await runCli(["--home", home, "extraset", "custom-extra"], {
    backend,
    output() {},
    input: Readable.from([JSON.stringify({ module: "not-installed-module", config: {} })])
  });
  let output;
  assert.equal(
    await runCli(["--home", home, "status", "--json"], {
      backend,
      output: (line) => {
        output = line;
      }
    }),
    0
  );
  const result = JSON.parse(output);
  assert.equal(result["executor-kernel"].service.detail, "MANAGER_UNAVAILABLE");
  assert.ok(result["custom-extra"]);
  assert.ok(result["channel-gateway"]);
  assert.doesNotMatch(output, /private fixture secret/);
});

test("CLI preserves backend codes and suggests help without printing private exception text", async () => {
  let output;
  const backend = {
    install: async () => {
      throw new ServiceError("MANAGER_UNAVAILABLE", "secret", {
        exitCode: 7,
        backend: "launchd-user"
      });
    }
  };
  assert.equal(
    await runCli(["executor-kernel", "install", "--json"], {
      backend,
      output: (line) => {
        output = line;
      }
    }),
    4
  );
  assert.equal(JSON.parse(output).error.code, "MANAGER_UNAVAILABLE");
  assert.equal(JSON.parse(output).error.exit_code, 7);
  assert.doesNotMatch(output, /secret/);
  assert.equal(
    await runCli(["executor-kernel", "nonsense"], {
      errorOutput: (line) => {
        output = line;
      }
    }),
    2
  );
  assert.match(output, /--help/);
  assert.match(
    describeError(new ServiceError("SERVICE_DISABLED", "disabled")).message,
    /install --autostart=true/
  );
  assert.equal(
    describeError(
      new Error("SERVICE_INITIALIZATION_FAILED", { cause: new Error("MANIFEST_INVALID") })
    ).cause_code,
    "MANIFEST_INVALID"
  );
});

test("human status bounds retained detail while preserving operational counts", () => {
  const status = formatStatus("channel-gateway", {
    service: { manager: "launchd-user", state: "running", enabled: true, drift: [] },
    runtime: {
      status: {
        bots: [
          {
            name: "test",
            connected: true,
            workingTasks: 3,
            queuedTasks: 4,
            deliveries: Array(512).fill({ sessionId: "private-session-id" })
          }
        ]
      }
    }
  });
  assert.match(status, /workingTasks: 3/);
  assert.match(status, /queuedTasks: 4/);
  assert.match(status, /deliveries: 512 entries/);
  assert.doesNotMatch(status, /private-session-id/);
});

test("startup diagnostics use bounded structured events from the current attempt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "oc75-diagnostic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const now = Date.now();
  const row = (event, code, time = now) =>
    JSON.stringify({ time: new Date(time).toISOString(), source: "kernel", event, data: { code } });
  await writeFile(
    join(directory, "kernel-20261021T03.log"),
    [
      "x".repeat(70000),
      row("cli.initialization_failed", "STALE_FAILURE", now - 10000),
      row("cli.initialization_cause", "ENOENT"),
      row("cli.initialization_failed", "SERVICE_INITIALIZATION_FAILED"),
      row("unrelated.event", "IGNORED")
    ].join("\n")
  );
  const failure = await readStartupFailure(directory, "executor-kernel", now);
  assert.equal(failure.message, "SERVICE_INITIALIZATION_FAILED");
  assert.equal(failure.cause.message, "ENOENT");
  assert.equal(await readStartupFailure(directory, "executor-kernel", now + 1000), undefined);
  assert.equal(await readStartupFailure(directory, "channel-wecom", now), undefined);
});
