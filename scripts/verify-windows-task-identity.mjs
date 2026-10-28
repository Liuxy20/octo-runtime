/** 显式手动验收 #168；只创建独占任务，不接入默认测试或 CI。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  NodeCommandRunner,
  WindowsUserTaskBackend
} from "../packages/octo-runtime-cross-service/dist/index.js";

if (process.platform !== "win32") throw new Error("Requires native Windows");

const runner = new NodeCommandRunner();
const powershell = join(
  process.env.SystemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
const identity = await query(
  "$me=[System.Security.Principal.WindowsIdentity]::GetCurrent();" +
    "[ordered]@{qualified=$me.Name;short=$env:USERNAME;sid=$me.User.Value;" +
    "shortSid=([System.Security.Principal.NTAccount]$env:USERNAME).Translate([System.Security.Principal.SecurityIdentifier]).Value}|ConvertTo-Json -Compress"
);
assert.equal(identity.shortSid, identity.sid, "Short alias must resolve to the signed-in account");

for (const alias of ["qualified", "short", "sid"]) {
  await fixture(`alias-${alias}`, false, async ({ backend, spec, definitions }) => {
    const aliased = new WindowsUserTaskBackend({
      windowsUserId: identity[alias],
      windowsDefinitionDirectory: definitions
    });
    await aliased.install(spec);
    const status = await aliased.inspect(spec);
    assert.equal(status.state, "stopped");
    assert.deepEqual(status.drift, []);
    assert.equal(status.detail, undefined);
    if (alias === "qualified") {
      const different = new WindowsUserTaskBackend({
        windowsUserId: "S-1-5-18",
        windowsDefinitionDirectory: definitions
      });
      assert.notEqual(identity.sid, "S-1-5-18");
      const mismatch = await different.inspect(spec);
      assert.ok(mismatch.drift.includes("manager.principal_user"));
      assert.ok(mismatch.drift.includes("manager.trigger_user"));
    }
    await backend.uninstall(spec);
  });
}

for (const active of [false, true]) {
  await fixture(
    `unresolved-cleanup-active-${active}`,
    active,
    async ({ backend, spec, definitions, tick }) => {
      await backend.install(spec);
      let pid;
      if (active) {
        await backend.start(spec);
        await waitFor(async () => {
          try {
            pid = JSON.parse(await readFile(tick, "utf8")).pid;
            return Number.isInteger(pid);
          } catch (error) {
            if (error.code === "ENOENT") return false;
            throw error;
          }
        }, "native task action did not publish its PID");
        assert.equal((await backend.inspect(spec)).state, "running");
      }
      const unresolved = new WindowsUserTaskBackend({
        windowsUserId: `NoSuch168-${randomUUID()}`,
        windowsDefinitionDirectory: definitions
      });
      const status = await unresolved.inspect(spec);
      assert.equal(status.state, "unknown");
      assert.match(status.detail, /identity could not be resolved/);
      assert.ok(!status.drift.includes("manager.principal_user"));
      assert.ok(!status.drift.includes("manager.trigger_user"));
      for (const action of ["start", "restart"])
        await assert.rejects(unresolved[action](spec), { code: "MANAGER_UNAVAILABLE" });
      // 必须由同一个解析失败的后端清理；finally 的正常账号清理不能替代此断言。
      await unresolved.uninstall(spec);
      if (pid) await waitFor(() => !isAlive(pid), "native task action survived uninstall");
    }
  );
}

async function fixture(label, active, verify) {
  const directory = await mkdtemp(join(tmpdir(), "octo-168-"));
  const definitions = join(directory, "中文 definitions with spaces");
  await mkdir(definitions);
  const tick = join(directory, "tick.json");
  // 无子进程的真实文件负载；只用于确认 /End 后 action 已退出，不把请求受理当完成。
  // PID 只原子发布一次；负载另写文件，避免观察者读取和 Windows rename 覆盖互相竞争。
  const action = `import{writeFileSync,renameSync,appendFileSync}from'node:fs';const path=${JSON.stringify(tick)};writeFileSync(path+'.tmp',JSON.stringify({pid:process.pid}));renameSync(path+'.tmp',path);setInterval(()=>appendFileSync(path+'.activity','tick\\n'),250);`;
  const spec = {
    id: `octo-168-${randomUUID()}`,
    command: process.execPath,
    args: ["--input-type=module", "-e", action],
    workingDirectory: directory,
    enabled: active,
    restart: { policy: "never" },
    timeoutStopSeconds: 15
  };
  const backend = new WindowsUserTaskBackend({
    windowsUserId: identity.qualified,
    windowsDefinitionDirectory: definitions
  });
  let failure;
  try {
    await verify({ backend, spec, definitions, tick });
    await assertAbsent(backend, spec, definitions);
  } catch (error) {
    failure = error;
  } finally {
    // 失败也只处理本 fixture 的任务；清理失败保留目录与原始失败，不吞掉证据。
    try {
      await backend.uninstall(spec);
      await assertAbsent(backend, spec, definitions);
      try {
        const { pid } = JSON.parse(await readFile(tick, "utf8"));
        await waitFor(() => !isAlive(pid), "fixture action remained alive after cleanup");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        failure ? [failure, cleanupError] : [cleanupError],
        `Fixture cleanup failed: ${label}`
      );
    }
  }
  if (failure) throw failure;
  console.log(
    JSON.stringify({ scenario: label, result: "passed", taskAbsent: true, sidecarAbsent: true })
  );
}

async function assertAbsent(backend, spec, definitions) {
  assert.equal((await backend.inspect(spec)).state, "not_installed");
  await assert.rejects(access(join(definitions, `${spec.id}.xml`)), { code: "ENOENT" });
  const task = `OctoRuntime.${spec.id}`;
  const result = await query(
    "$s=New-Object -ComObject Schedule.Service;$s.Connect();" +
      `try{$null=$s.GetFolder('\\').GetTask('${task}');'{"absent":false}'}` +
      "catch{$e=$_.Exception;while($e.InnerException){$e=$e.InnerException};" +
      "if($e.HResult -eq -2147024894){'{\"absent\":true}'}else{throw}}"
  );
  assert.equal(result.absent, true);
}

async function query(script) {
  const result = await runner.run(powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';${script}`
  ]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function waitFor(check, message) {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, message);
    await sleep(100);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
