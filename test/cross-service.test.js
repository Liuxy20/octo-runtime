import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  LaunchdUserBackend,
  ServiceError,
  SystemdUserBackend,
  WindowsUserTaskBackend,
  createServiceBackend,
  normalizeServiceSpec,
  quoteWindowsArgument,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTaskXml
} from "../packages/octo-runtime-cross-service/dist/index.js";

const unixSpec = {
  id: "cn.mininglamp.octo-runtime.daemon",
  description: "Octo Runtime daemon",
  command: "/opt/octo runtime/bin/octo-daemon",
  args: ["run", "--profile", "trusted user", "literal&value"],
  workingDirectory: "/Users/alice/.octo-runtime",
  environment: { OCTO_PROFILE: "trusted & local" },
  stdoutPath: "/Users/alice/.octo-runtime/logs/service.out.log",
  stderrPath: "/Users/alice/.octo-runtime/logs/service.err.log",
  enabled: true,
  restart: { policy: "on-failure", delaySeconds: 7, maxBurst: 4 },
  timeoutStopSeconds: 30
};

const windowsSpec = {
  id: "cn.mininglamp.octo-runtime.daemon",
  description: "Octo Runtime daemon",
  command: "C:\\Program Files\\Octo Runtime\\octo-daemon.exe",
  args: ["run", "--profile", "trusted user", "ends-with\\"],
  workingDirectory: "C:\\Users\\alice\\.octo-runtime",
  enabled: true,
  restart: { policy: "on-failure", delaySeconds: 5, maxBurst: 4 }
};

test("service specs reject relative paths, multiline text, and likely credentials", () => {
  assert.throws(
    () => normalizeServiceSpec({ ...unixSpec, command: "octo-daemon" }, "linux"),
    (error) => error instanceof ServiceError && error.code === "INVALID_SPEC"
  );
  assert.throws(
    () => normalizeServiceSpec({ ...unixSpec, description: "line one\nline two" }, "linux"),
    (error) => error instanceof ServiceError && error.code === "INVALID_SPEC"
  );
  assert.throws(
    () => normalizeServiceSpec({ ...unixSpec, args: ["--token", "secret"] }, "linux"),
    (error) => error instanceof ServiceError && error.code === "INVALID_SPEC"
  );
  assert.throws(
    () => normalizeServiceSpec({ ...unixSpec, environment: { ACCESS_TOKEN: "secret" } }, "linux"),
    (error) => error instanceof ServiceError && error.code === "INVALID_SPEC"
  );
});

test("launchd renderer keeps executable and argv structured and escapes XML", () => {
  const plist = renderLaunchdPlist(unixSpec);
  assert.match(plist, /<key>ProgramArguments<\/key>\s*<array>/);
  assert.match(plist, /<string>\/opt\/octo runtime\/bin\/octo-daemon<\/string>/);
  assert.match(plist, /<string>literal&amp;value<\/string>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(plist, /<key>EnvironmentVariables<\/key>/);
  assert.doesNotMatch(plist, /sh -c|\/bin\/sh/);
});

test("systemd renderer quotes argv without a shell and applies lifecycle settings", () => {
  const unit = renderSystemdUnit(unixSpec);
  assert.match(
    unit,
    /^ExecStart=:"\/opt\/octo runtime\/bin\/octo-daemon" "run" "--profile" "trusted user" "literal&value"$/m
  );
  assert.match(unit, /^Environment="OCTO_PROFILE=trusted & local"$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^RestartSec=7s$/m);
  assert.match(unit, /^TimeoutStopSec=30s$/m);
  assert.doesNotMatch(unit, /sh -c|\/bin\/sh/);
});

test("Windows renderer uses a least-privilege current-user logon task", () => {
  const xml = renderWindowsTaskXml(windowsSpec, "WORKGROUP\\alice");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-16"\?>/);
  assert.match(xml, /<UserId>WORKGROUP\\alice<\/UserId>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<Command>C:\\Program Files\\Octo Runtime\\octo-daemon\.exe<\/Command>/);
  assert.match(xml, /<Arguments>run --profile &quot;trusted user&quot; ends-with\\<\/Arguments>/);
  assert.match(xml, /<Interval>PT60S<\/Interval>/);
  assert.doesNotMatch(xml, /LocalSystem|SYSTEM|HighestAvailable/);

  assert.equal(quoteWindowsArgument("plain"), "plain");
  assert.equal(quoteWindowsArgument("two words"), '"two words"');
  assert.equal(quoteWindowsArgument('say"hello'), '"say\\"hello"');
  assert.equal(quoteWindowsArgument("C:\\path with space\\"), '"C:\\path with space\\\\"');
});

for (const directory of [
  "/home/alice/.octo-runtime",
  "/home/trusted user/.octo runtime",
  "/home/alice/100% literal %h %n",
  '/home/alice/中文 "quoted" \\literal',
  "/home/alice/trailing\\\\"
]) {
  test(`systemd renders literal path directives for ${directory}`, () => {
    const spec = {
      ...unixSpec,
      workingDirectory: directory,
      stdoutPath: join(directory, 'out "quoted" %n.log'),
      stderrPath: join(directory, "err \\literal %h.log"),
      args: ["with spaces", 'with "quotes"', "100%", "\\literal"],
      environment: { OCTO_PROFILE: 'with "quotes" \\literal 100%' }
    };
    const lines = renderSystemdUnit(spec).split("\n");
    assert.ok(lines.includes(`WorkingDirectory=${directory.replaceAll("%", "%%")}`));
    assert.ok(lines.includes(`StandardOutput=append:${spec.stdoutPath.replaceAll("%", "%%")}`));
    assert.ok(lines.includes(`StandardError=append:${spec.stderrPath.replaceAll("%", "%%")}`));
    assert.ok(
      lines.includes(
        'ExecStart=:"/opt/octo runtime/bin/octo-daemon" "with spaces" "with \\"quotes\\"" "100%%" "\\\\literal"'
      )
    );
    assert.ok(lines.includes('Environment="OCTO_PROFILE=with \\"quotes\\" \\\\literal 100%%"'));
  });
}

for (const field of ["workingDirectory", "stdoutPath", "stderrPath"]) {
  for (const suffix of ["\v", "\f"]) {
    test(`systemd preserves ${JSON.stringify(suffix)} in ${field}`, () => {
      const path = `/home/alice/path${suffix}`;
      const directive = {
        workingDirectory: "WorkingDirectory",
        stdoutPath: "StandardOutput",
        stderrPath: "StandardError"
      }[field];
      const prefix = field === "workingDirectory" ? "" : "append:";
      assert.ok(
        renderSystemdUnit({ ...unixSpec, [field]: path })
          .split("\n")
          .includes(`${directive}=${prefix}${path}`)
      );
    });
  }
  for (const count of [1, 2, 3, 4]) {
    test(`systemd preserves ${count} trailing backslashes in ${field}`, () => {
      const path = `/home/alice/path${"\\".repeat(count)}`;
      const directive = {
        workingDirectory: "WorkingDirectory",
        stdoutPath: "StandardOutput",
        stderrPath: "StandardError"
      }[field];
      const prefix = field === "workingDirectory" ? "" : "append:";
      assert.ok(
        renderSystemdUnit({ ...unixSpec, [field]: path })
          .split("\n")
          .includes(`${directive}=${prefix}${path}${count % 2 === 0 ? "" : " "}`)
      );
    });
  }
  for (const suffix of [" ", "\t"]) {
    test(`systemd rejects unrepresentable ${field} suffix ${JSON.stringify(suffix)}`, () => {
      assert.throws(
        () => renderSystemdUnit({ ...unixSpec, [field]: `/home/alice/path${suffix}` }),
        (error) => error instanceof ServiceError && error.code === "UNSUPPORTED_SPEC"
      );
    });
  }
}

test("Windows backend rejects fields Task Scheduler cannot preserve", () => {
  assert.throws(
    () =>
      renderWindowsTaskXml(
        { ...windowsSpec, environment: { OCTO_PROFILE: "default" } },
        "WORKGROUP\\alice"
      ),
    (error) => error instanceof ServiceError && error.code === "UNSUPPORTED_SPEC"
  );
  assert.throws(
    () =>
      renderWindowsTaskXml({ ...windowsSpec, restart: { policy: "always" } }, "WORKGROUP\\alice"),
    (error) => error instanceof ServiceError && error.code === "UNSUPPORTED_SPEC"
  );
});

test("systemd install is idempotent and does not start a new service", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-cross-service-systemd-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const runner = new FakeRunner((_command, args) => {
    if (args.includes("show")) {
      return result(
        0,
        "LoadState=loaded\nUnitFileState=enabled\nActiveState=inactive\nSubState=dead\nMainPID=0\nExecMainStatus=0\n"
      );
    }
    return result();
  });
  const backend = new SystemdUserBackend({
    platform: "linux",
    runner,
    homeDirectory: home,
    environment: {}
  });
  const localSpec = {
    ...unixSpec,
    workingDirectory: home,
    stdoutPath: join(home, "logs", "service.out.log"),
    stderrPath: join(home, "logs", "service.err.log")
  };

  await backend.install(localSpec);
  await backend.install(localSpec);

  const unitPath = join(home, ".config", "systemd", "user", `${unixSpec.id}.service`);
  assert.equal(await readFile(unitPath, "utf8"), renderSystemdUnit(localSpec));
  assert.equal(runner.calls.filter((call) => call.args.includes("daemon-reload")).length, 1);
  assert.equal(runner.calls.filter((call) => call.args.includes("enable")).length, 2);
  assert.equal(runner.calls.filter((call) => call.args.includes("start")).length, 0);
  assert.ok(runner.calls.every((call) => call.options?.env !== process.env));
});

for (const useXdg of [false, true]) {
  test(`systemd reinstall repairs quoted path directives in ${useXdg ? "XDG" : "default"} config and reloads before starting`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "octo-systemd-reinstall-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const spec = {
      ...unixSpec,
      workingDirectory: home,
      stdoutPath: join(home, "stdout.log"),
      stderrPath: join(home, "stderr.log")
    };
    const configHome = join(home, useXdg ? "xdg-config" : ".config");
    const environment = useXdg ? { XDG_CONFIG_HOME: configHome } : {};
    const unitPath = join(configHome, "systemd", "user", `${spec.id}.service`);
    const repaired = renderSystemdUnit(spec);
    await mkdir(dirname(unitPath), { recursive: true });
    await writeFile(
      unitPath,
      repaired.replace(/^(WorkingDirectory|StandardOutput|StandardError)=(.*)$/gm, '$1="$2"')
    );
    let reloaded = false;
    let started = false;
    const runner = new FakeRunner((_command, args) => {
      if (args.includes("daemon-reload")) reloaded = true;
      if (args.includes("enable") || args.includes("start")) assert.equal(reloaded, true);
      if (args.includes("start")) started = true;
      if (args.includes("show"))
        return result(
          0,
          `LoadState=${reloaded ? "loaded" : "bad-setting"}\nUnitFileState=enabled\nActiveState=${started ? "active" : "inactive"}\nSubState=${started ? "running" : "dead"}\nMainPID=${started ? 123 : 0}\n`
        );
      return result();
    });
    const backend = new SystemdUserBackend({
      platform: "linux",
      runner,
      homeDirectory: home,
      environment
    });
    const previous = await backend.inspect(spec);
    assert.equal(previous.definitionPath, unitPath);
    assert.deepEqual(previous.drift, ["definition_content"]);
    await backend.install(spec);
    assert.equal(await readFile(unitPath, "utf8"), repaired);
    assert.equal(started, false);
    await backend.start(spec);
    assert.equal(started, true);
    await backend.install(spec);
    assert.equal(runner.calls.filter((call) => call.args.includes("daemon-reload")).length, 1);
    assert.equal(runner.calls.filter((call) => call.args.includes("restart")).length, 0);
    assert.ok(runner.calls.every((call) => call.options?.env === environment));
  });
}

test("launchd install then start bootstraps the current user's LaunchAgent", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "octo-cross-service-launchd-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const runner = new FakeRunner((_command, args) => {
    if (args[0] === "print-disabled") return result(0, "disabled services = {\n}\n");
    if (args[0] === "print") return result(113, "", "Could not find service");
    return result();
  });
  const backend = new LaunchdUserBackend({
    platform: "darwin",
    runner,
    homeDirectory: home,
    environment: {},
    uid: 501
  });
  const localSpec = {
    ...unixSpec,
    workingDirectory: home,
    stdoutPath: join(home, "logs", "service.out.log"),
    stderrPath: join(home, "logs", "service.err.log")
  };

  await backend.install(localSpec);
  assert.equal(
    runner.calls.some((call) => call.args[0] === "bootstrap"),
    false
  );
  await backend.start(localSpec);

  const bootstrap = runner.calls.find((call) => call.args[0] === "bootstrap");
  assert.deepEqual(bootstrap?.args.slice(0, 2), ["bootstrap", "gui/501"]);
  assert.match(
    bootstrap?.args[2] ?? "",
    /Library\/LaunchAgents\/cn\.mininglamp\.octo-runtime\.daemon\.plist$/
  );
});

test("Windows install registers structured XML and inspect detects no drift", async (t) => {
  const definitionDirectory = await mkdtemp(join(tmpdir(), "octo-cross-service-windows-"));
  t.after(() => rm(definitionDirectory, { recursive: true, force: true }));
  let registered = false;
  const runner = new FakeRunner((command, args) => {
    if (command.endsWith("schtasks.exe") && args[0] === "/Query") {
      return registered ? result() : result(1, "", "task not found");
    }
    if (command.endsWith("powershell.exe")) {
      if (args.at(-1).includes("Schedule.Service"))
        return result(0, JSON.stringify({ exists: registered }));
      if (!registered) return result(1, "", "task not found");
      return result(
        0,
        JSON.stringify({
          state: "Ready",
          enabled: true,
          last_exit_code: 0,
          execute: windowsSpec.command,
          arguments: 'run --profile "trusted user" ends-with\\',
          working_directory: windowsSpec.workingDirectory,
          principal_user_id: "WORKGROUP\\alice",
          principal_logon_type: "Interactive",
          trigger_user_id: "WORKGROUP\\alice"
        })
      );
    }
    if (args[0] === "/Create") registered = true;
    return result();
  });
  const backend = new WindowsUserTaskBackend({
    platform: "win32",
    runner,
    homeDirectory: "C:\\Users\\alice",
    environment: { SystemRoot: "C:\\Windows" },
    windowsUserId: "WORKGROUP\\alice",
    windowsDefinitionDirectory: definitionDirectory
  });

  await backend.install(windowsSpec);
  const create = runner.calls.find((call) => call.args[0] === "/Create");
  assert.deepEqual(create?.args.slice(0, 4), [
    "/Create",
    "/TN",
    "\\OctoRuntime.cn.mininglamp.octo-runtime.daemon",
    "/XML"
  ]);
  assert.equal(
    runner.calls.some((call) => call.args[0] === "/Run"),
    false
  );
  const bytes = await readFile(join(definitionDirectory, `${windowsSpec.id}.xml`));
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  assert.match(bytes.subarray(2).toString("utf16le"), /<LogonType>InteractiveToken<\/LogonType>/);

  const status = await backend.inspect(windowsSpec);
  assert.equal(status.state, "stopped");
  assert.equal(status.enabled, true);
  assert.deepEqual(status.drift, []);
});

test("backend factory selects the native user manager and rejects unsupported platforms", () => {
  const runner = new FakeRunner(() => result());
  assert.equal(
    createServiceBackend({ platform: "darwin", runner, homeDirectory: "/tmp", uid: 501 }).kind,
    "launchd-user"
  );
  assert.equal(
    createServiceBackend({ platform: "linux", runner, homeDirectory: "/tmp" }).kind,
    "systemd-user"
  );
  assert.equal(
    createServiceBackend({
      platform: "win32",
      runner,
      homeDirectory: "C:\\Users\\alice",
      windowsUserId: "alice"
    }).kind,
    "windows-user-task"
  );
  assert.throws(
    () => createServiceBackend({ platform: "freebsd", runner, homeDirectory: "/tmp" }),
    (error) => error instanceof ServiceError && error.code === "UNSUPPORTED_PLATFORM"
  );
});

test("launchd stop waits for asynchronous bootout before a subsequent start", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "oc75-launchd-stop-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  let state = "absent";
  let pendingPrints = 0;
  const runner = new FakeRunner((_command, args) => {
    if (args[0] === "print") {
      if (state === "unloading" && pendingPrints-- <= 0) state = "absent";
      return state === "absent"
        ? result(113)
        : result(0, `state = ${state === "unloading" ? "not running" : "running"}\n`);
    }
    if (args[0] === "bootout") {
      state = "unloading";
      pendingPrints = 2;
    }
    if (args[0] === "bootstrap") {
      assert.equal(state, "absent");
      state = "running";
    }
    assert.notEqual(args[0], "kickstart", "must not kickstart the exiting job");
    return result();
  });
  const backend = new LaunchdUserBackend({
    platform: "darwin",
    runner,
    homeDirectory: home,
    uid: 501
  });
  const spec = {
    ...unixSpec,
    workingDirectory: home,
    stdoutPath: undefined,
    stderrPath: undefined
  };
  await backend.install(spec);
  await backend.start(spec);
  await backend.stop(spec);
  assert.equal((await backend.inspect(spec)).state, "stopped");
  await backend.start(spec);
  assert.equal((await backend.inspect(spec)).state, "running");
});

for (const value of ["true", "disabled", "false", "enabled"]) {
  test(`launchd recognizes the ${value} override format`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "oc75-launchd-format-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const runner = new FakeRunner((_command, args) => {
      if (args[0] === "print-disabled") return result(0, `"${unixSpec.id}" => ${value}`);
      if (args[0] === "print") return result(113);
      return result();
    });
    const backend = new LaunchdUserBackend({
      platform: "darwin",
      runner,
      homeDirectory: home,
      uid: 501
    });
    const spec = {
      ...unixSpec,
      workingDirectory: home,
      stdoutPath: undefined,
      stderrPath: undefined
    };
    await backend.install(spec);
    const disabled = value === "true" || value === "disabled";
    assert.equal((await backend.inspect(spec)).enabled, !disabled);
    if (disabled)
      await assert.rejects(backend.start(spec), (error) => error.code === "SERVICE_DISABLED");
    else await backend.start(spec);
    assert.equal(
      runner.calls.some((call) => call.args[0] === "bootstrap"),
      !disabled
    );
  });
}

class FakeRunner {
  calls = [];

  constructor(handler) {
    this.handler = handler;
  }

  async run(command, args, options) {
    this.calls.push({ command, args: [...args], options });
    const response = this.handler(command, args, options);
    return { command, args: [...args], ...response };
  }
}

function result(exitCode = 0, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}
