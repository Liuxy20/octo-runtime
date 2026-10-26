import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WindowsUserTaskBackend } from "../packages/octo-runtime-cross-service/dist/index.js";
import {
  readDefinition,
  writeDefinition
} from "../packages/octo-runtime-cross-service/dist/common.js";
import { runCli } from "../apps/cli/dist/main.js";
import { resolveServiceControl } from "../apps/cli/dist/service-control.js";

test("service definition I/O migrates UTF-8 to UTF-16LE BOM atomically and stays idempotent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "octo-task-encoding-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "task.xml");
  const content = '<?xml version="1.0" encoding="UTF-16"?><Task>中文 &amp; spaces</Task>';
  await writeFile(path, content, "utf8");
  assert.equal(await readDefinition(path), content);
  assert.equal(await writeDefinition(path, content, "utf16le"), true);
  const bytes = await readFile(path);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(await readDefinition(path), content);
  assert.equal(await writeDefinition(path, content, "utf16le"), false);
  assert.equal(await writeDefinition(path, content), true);
  assert.equal(await readFile(path, "utf8"), content);
});

for (const suffix of ["ascii", "中文 home with spaces"]) {
  for (const enabled of [false, true]) {
    test(
      `native Windows SDK and CLI install/query/delete: ${suffix}, autostart=${enabled}`,
      {
        skip: process.platform !== "win32",
        timeout: 180_000
      },
      async (t) => {
        const directory = await mkdtemp(join(tmpdir(), "octo-task-native-"));
        const home = join(directory, suffix);
        await mkdir(home);
        const backend = new WindowsUserTaskBackend({
          windowsDefinitionDirectory: join(home, "definitions")
        });
        const spec = {
          id: `octo-fixture-${randomUUID()}`,
          command: process.execPath,
          args: ["--version", "中文 argument", 'quoted"value', "trailing space\\"],
          workingDirectory: home,
          enabled
        };
        const control = resolveServiceControl();
        const cliSpec = control.spec(home, "executor-kernel", enabled);
        // 只删除本次随机 ID / 独占 Home 对应的任务；即使安装中途失败也核对最终不存在。
        t.after(async () => {
          await backend.uninstall(spec);
          await control.backend.uninstall(cliSpec);
          assert.equal((await backend.inspect(spec)).state, "not_installed");
          assert.equal((await control.backend.inspect(cliSpec)).state, "not_installed");
          await rm(directory, { recursive: true, force: true });
        });
        await backend.install(spec);
        const installed = await backend.inspect(spec);
        assert.equal(installed.state, "stopped");
        assert.equal(installed.enabled, enabled);
        assert.deepEqual(installed.drift, []);
        await backend.install(spec);
        assert.deepEqual((await backend.inspect(spec)).drift, []);
        const output = [];
        assert.equal(
          await runCli(
            ["executor-kernel", "install", "--home", home, `--autostart=${enabled}`, "--json"],
            { output: (value) => output.push(value) }
          ),
          0,
          output.join("\n")
        );
        const cliInstalled = await control.backend.inspect(cliSpec);
        assert.equal(cliInstalled.state, "stopped");
        assert.equal(cliInstalled.enabled, enabled);
        assert.deepEqual(cliInstalled.drift, []);
        assert.equal(
          await runCli(["executor-kernel", "uninstall", "--home", home, "--json"], {
            output: (value) => output.push(value)
          }),
          0,
          output.join("\n")
        );
      }
    );
  }
}
