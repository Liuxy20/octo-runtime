import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// 只创建本次隔离 Home 的用户服务，不修改默认 Home 或全局安装包。
const exec = promisify(execFile);
const cli = resolve(process.argv[2] ?? "apps/cli/dist/index.js");
const legacy = process.argv[3] && resolve(process.argv[3]);
const root = await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "oc75-live-"));
const home = join(root, "new");
const evidence = [];
const installed = new Set();
const call = async (entry, selectedHome, args, expected = 0, input) => {
  const child = exec(process.execPath, [entry, "--home", selectedHome, ...args], {
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (input !== undefined) child.child.stdin.end(input);
  else child.child.stdin.end();
  let result;
  try {
    result = { ...(await child), code: 0 };
  } catch (error) {
    result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
  evidence.push({ args, code: result.code, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.code, expected, `${args.join(" ")}: ${result.stdout}\n${result.stderr}`);
  return result;
};
const run = (args, expected, input) => call(cli, home, args, expected, input);
const status = async (component) => JSON.parse((await run([component, "status", "--json"])).stdout);

try {
  if (legacy) {
    const oldHome = join(root, "old");
    try {
      await call(legacy, oldHome, ["executor-kernel", "install"]);
      const failure = await call(legacy, oldHome, ["executor-kernel", "start"], 1);
      assert.equal(JSON.parse(failure.stdout).error.code, "COMMAND_FAILED");
    } finally {
      await call(legacy, oldHome, ["executor-kernel", "uninstall"]);
      await rm(oldHome, { recursive: true, force: true });
    }
  }
  const failedHome = join(root, "failed");
  try {
    await call(cli, failedHome, [
      "executor-kernel",
      "install",
      "--manifest",
      join(root, "missing-manifest.json")
    ]);
    const failure = await call(cli, failedHome, ["executor-kernel", "start", "--json"], 1);
    assert.equal(JSON.parse(failure.stdout).error.code, "ENOENT");
    const logs = join(failedHome, "logs");
    const log = (
      await Promise.all(
        (await readdir(logs))
          .filter((name) => /^kernel-.*\.log$/.test(name))
          .map((name) => readFile(join(logs, name), "utf8"))
      )
    ).join("\n");
    assert.match(log, /cli.initialization_failed/);
    assert.match(log, /ENOENT/);
  } finally {
    await call(cli, failedHome, ["executor-kernel", "uninstall"]);
    await rm(failedHome, { recursive: true, force: true });
  }
  assert.match((await run(["executor-kernel"])).stdout, /Usage:.*executor-kernel/);
  assert.match((await run(["executor-kernel", "bad-command"], 2)).stderr, /--help/);
  assert.equal((await status("executor-kernel")).service.state, "not_installed");
  await run(["executor-kernel", "restart", "--json"], 3);

  for (const component of ["channel-gateway", "channel-wecom"]) {
    await run(
      ["extraset", component],
      0,
      JSON.stringify({
        module: `@mininglamp-oss/octo-runtime-extra-${component}`,
        config: { bots: [] }
      })
    );
  }
  const services = ["executor-kernel", "channel-gateway", "channel-wecom"];
  for (const component of services) {
    assert.equal((await status(component)).service.state, "not_installed");
  }
  const firstStart = async (component, json = false) => {
    installed.add(component);
    const result = await run([component, "start", ...(json ? ["--json"] : [])]);
    assert.equal(
      result.stderr,
      `${component}: service not installed; installing with autostart enabled...\n${component}: installation complete; starting service...\n`
    );
    if (json) {
      const value = JSON.parse(result.stdout);
      assert.equal(value.service.enabled, true);
      if (component === "executor-kernel") assert.equal(value.runtime.execution_ready, true);
      else assert.deepEqual(value.runtime.status.bots, []);
    } else {
      assert.match(result.stdout, /service: running  autostart: on  IPC: ready/);
      assert.match(result.stdout, /Manager: .*PID: \d+/);
      assert.match(result.stdout, /Definition: /);
      assert.match(result.stdout, /Bots: 0/);
    }
    assert.equal((await status(component)).service.enabled, true);
  };
  // Extra 先启动，Kernel 不存在时仍须完成自己的初始化。
  await firstStart("channel-gateway");
  await firstStart("channel-wecom", true);
  assert.equal((await status("channel-gateway")).runtime.status.kernel_available, false);
  assert.equal((await status("executor-kernel")).service.state, "not_installed");
  await firstStart("executor-kernel", true);
  assert.equal((await run(["executor-kernel", "start", "--json"])).stderr, "");
  assert.equal((await status("executor-kernel")).runtime.execution_ready, true);
  assert.equal((await status("channel-gateway")).runtime.status.kernel_available, true);
  const gatewayPid = (await status("channel-gateway")).runtime.pid;
  const wecomPid = (await status("channel-wecom")).runtime.pid;
  const kernelInstance = (await status("executor-kernel")).runtime.kernel_instance_id;
  assert.notEqual(gatewayPid, wecomPid);
  const gatewayRestart = await run(["channel-gateway", "restart"]);
  assert.match(gatewayRestart.stdout, /service: running  autostart: on  IPC: ready/);
  assert.match(gatewayRestart.stdout, /Bots: 0/);
  assert.notEqual((await status("channel-gateway")).runtime.pid, gatewayPid);
  assert.equal((await status("channel-wecom")).runtime.pid, wecomPid);
  assert.equal((await status("executor-kernel")).runtime.kernel_instance_id, kernelInstance);
  await run(["executor-kernel", "stop"]);
  assert.equal((await status("channel-gateway")).runtime.status.kernel_available, false);
  const kernelStart = await run(["executor-kernel", "start"]);
  assert.match(kernelStart.stdout, /service: running  autostart: on  IPC: ready/);
  assert.match(kernelStart.stdout, /Manager: .*PID: \d+/);
  assert.match(kernelStart.stdout, /Worker: ready/);
  assert.match(kernelStart.stdout, /Definition: /);
  assert.equal((await status("channel-gateway")).runtime.status.kernel_available, true);

  for (const component of services) {
    const before = (await status(component)).runtime.pid;
    await run([component, "install", "--autostart=true"]);
    await run([component, "install"]);
    const value = await status(component);
    assert.equal(value.service.enabled, true);
    if (process.platform === "darwin") {
      assert.equal(value.runtime.pid, before);
      assert.match(value.service.definitionPath, /Library\/LaunchAgents/);
      assert.match(
        await readFile(value.service.definitionPath, "utf8"),
        /<key>RunAtLoad<\/key>\s*<true\/>/
      );
    }
    await run([component, "stop"]);
  }
  // 两个自启服务的激活顺序不固定，分别模拟管理器的两种调度顺序。
  for (const order of [
    ["channel-gateway", "executor-kernel"],
    ["executor-kernel", "channel-gateway"]
  ]) {
    for (const component of order) await run([component, "start"]);
    assert.equal((await status("channel-gateway")).runtime.status.kernel_available, true);
    assert.equal((await status("executor-kernel")).service.enabled, true);
    assert.equal((await status("channel-gateway")).service.enabled, true);
    const pretty = (await run(["status"])).stdout;
    assert.match(pretty, /Worker: ready/);
    assert.match(pretty, /Bots: 0/);
    const data = (await run(["status", "--json"])).stdout;
    assert.match(data, /\n  "executor-kernel":/);
    assert.ok(JSON.parse(data)["channel-wecom"]);
    for (const component of order) await run([component, "stop"]);
  }
  for (const component of services) {
    await run([component, "install", "--autostart=false"]);
    assert.equal((await status(component)).service.enabled, false);
    for (const action of ["start", "restart"]) {
      const failure = await run([component, action, "--json"], 1);
      assert.equal(JSON.parse(failure.stdout).error.code, "SERVICE_DISABLED");
    }
    await run([component, "install"]);
    assert.equal((await status(component)).service.enabled, true);
    await run([component, "start"]);
    const restarted = await run([component, "restart", "--json"]);
    const value = JSON.parse(restarted.stdout);
    assert.equal(value.action, "restart");
    assert.equal(value.service.state, "running");
    if (component === "executor-kernel") assert.equal(value.runtime.execution_ready, true);
    else assert.deepEqual(value.runtime.status.bots, []);
    assert.equal((await status(component)).service.enabled, true);
    await run([component, "stop"]);
    assert.equal((await status(component)).service.state, "stopped");
  }
  // 连续快速停启覆盖 bootout 尚未完成时 kickstart 旧 job 的真机竞态。
  for (let attempt = 0; attempt < 3; attempt++) {
    await run(["executor-kernel", "start"]);
    await run(["executor-kernel", "stop"]);
    assert.equal((await status("executor-kernel")).service.state, "stopped");
  }
  const marker = join(home, "user-data-marker");
  await writeFile(marker, "preserved");
  for (const component of [...installed]) {
    await run([component, "uninstall"]);
    installed.delete(component);
    assert.equal((await status(component)).service.state, "not_installed");
    assert.equal((await status(component)).runtime.available, false);
  }
  assert.equal(await readFile(marker, "utf8"), "preserved");
  console.log(
    JSON.stringify(
      { passed: true, platform: process.platform, cli, commands: evidence.length, root },
      null,
      2
    )
  );
} catch (error) {
  for (const component of installed) {
    const value = await status(component);
    evidence.push({ diagnostic: component, value });
    const path = value.service.definitionPath;
    if (process.platform === "darwin" && path) {
      const label = path
        .split("/")
        .at(-1)
        .replace(/\.plist$/, "");
      const printed = await exec("/bin/launchctl", [
        "print",
        `gui/${process.getuid()}/${label}`
      ]).catch(() => ({ stdout: "" }));
      evidence.push({
        diagnostic: "launchd",
        component,
        state: printed.stdout
          .split("\n")
          .filter((line) =>
            /^\s*(state|pid|runs|last exit code|program|path|active count) =/.test(line)
          )
      });
    }
  }
  const logs = join(home, "logs");
  for (const name of await readdir(logs).catch(() => [])) {
    if (/^(kernel|extra)-.*\.log$/.test(name))
      evidence.push({ diagnostic: name, log: await readFile(join(logs, name), "utf8") });
  }
  throw error;
} finally {
  for (const component of [...installed].reverse()) {
    try {
      await run([component, "uninstall"]);
      installed.delete(component);
    } catch {
      console.error(`Cleanup failed for ${component} in ${home}`);
    }
  }
  await writeFile(join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${join(root, "evidence.json")}`);
  // 保留证据；仅删除已完整清理的隔离 Home，便于失败时手动排障。
  if (!installed.size) await rm(home, { recursive: true, force: true });
}
