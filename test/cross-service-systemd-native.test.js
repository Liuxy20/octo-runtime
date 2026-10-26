import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import {
  SystemdUserBackend,
  renderSystemdUnit
} from "../packages/octo-runtime-cross-service/dist/index.js";

const nativeParserAvailable =
  process.platform === "linux" && spawnSync("systemd-analyze", ["--version"]).status === 0;

test(
  "native systemd parser accepts literal directory and append paths",
  {
    skip: !nativeParserAvailable
  },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "octo-systemd-verify-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    // 只验证生成的 unit；宿主自带服务的弃用警告不属于本测试的输入。
    // 保留服务的默认依赖，用最小 target 满足解析，不改写待测 unit。
    for (const name of ["sysinit", "basic", "shutdown", "default", "network-online"])
      await writeFile(
        join(home, `${name}.target`),
        "[Unit]\nDescription=Isolated parser fixture\nDefaultDependencies=no\n"
      );
    const verify = (unitPath) =>
      spawnSync("systemd-analyze", ["verify", "--man=no", unitPath], {
        encoding: "utf8",
        env: { ...process.env, SYSTEMD_UNIT_PATH: home }
      });
    for (const suffix of [
      "ordinary",
      "with spaces",
      "vertical-tab\v",
      "form-feed\f",
      '中文 "quotes" \\literal 100% %h %n\\',
      '中文 "quotes" \\literal 100% %h %n\\\\'
    ]) {
      const directory = join(home, suffix);
      const spec = {
        id: "octo-native-verify",
        command: process.execPath,
        args: ["--version"],
        workingDirectory: directory,
        stdoutPath: join(directory, 'stdout "quoted" %n.log\\'),
        stderrPath: join(directory, "stderr \\literal %h.log\\\\")
      };
      const unitPath = join(home, `${spec.id}.service`);
      await writeFile(unitPath, renderSystemdUnit(spec));
      const verified = verify(unitPath);
      assert.equal(verified.status, 0, verified.stderr);
      assert.equal(verified.stderr, "");
    }
    // 隔离不能掩盖生成内容错误：同一解析器仍须拒绝相对工作目录。
    const invalidPath = join(home, "octo-invalid-verify.service");
    await writeFile(
      invalidPath,
      renderSystemdUnit({
        id: "octo-invalid-verify",
        command: process.execPath,
        args: ["--version"],
        workingDirectory: home
      }).replace(/^WorkingDirectory=.*$/m, "WorkingDirectory=relative")
    );
    const invalid = verify(invalidPath);
    assert.notEqual(invalid.status, 0, "invalid unit must fail native verification");
    assert.match(invalid.stderr, /WorkingDirectory/);
  }
);

for (const [label, suffix] of [
  ["odd-backslash", "\\"],
  ["even-backslash", "\\\\"],
  ["vertical-tab", "\v"],
  ["form-feed", "\f"]
]) {
  test(
    `native systemd user manager repairs old units and preserves cwd and both logs with ${label}`,
    {
      skip: process.platform !== "linux" || process.env.OCTO_TEST_SYSTEMD_USER !== "1",
      timeout: 30_000
    },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "octo-systemd-start-"));
      const directory = join(home, `中文 "quotes" \\literal 100% %h %n${suffix}`);
      await mkdir(directory);
      const backend = new SystemdUserBackend();
      const spec = {
        id: `octo-native-start-${process.pid}-${label}`,
        command: process.execPath,
        args: [
          "-e",
          'console.log(JSON.stringify(process.cwd())); console.error("native stderr"); setInterval(() => {}, 1000)'
        ],
        workingDirectory: directory,
        stdoutPath: join(directory, `stdout "quoted" %n.log${suffix}`),
        stderrPath: join(directory, `stderr \\literal %h.log${suffix}`),
        restart: { policy: "never" }
      };
      t.after(async () => {
        try {
          await backend.uninstall(spec);
        } finally {
          await rm(home, { recursive: true, force: true });
        }
      });
      const unitPath = (await backend.inspect(spec)).definitionPath;
      assert.equal(typeof unitPath, "string");
      await mkdir(dirname(unitPath), { recursive: true });
      await writeFile(
        unitPath,
        renderSystemdUnit(spec).replace(/^WorkingDirectory=(.*)$/m, 'WorkingDirectory="$1"')
      );
      const reload = spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
      assert.equal(reload.status, 0, reload.stderr);
      const invalid = spawnSync(
        "systemctl",
        ["--user", "show", `${spec.id}.service`, "-p", "LoadState", "--value"],
        { encoding: "utf8" }
      );
      assert.equal(invalid.stdout.trim(), "bad-setting");
      await backend.install(spec);
      await backend.start(spec);
      assert.equal((await backend.inspect(spec)).state, "running");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const stderr = await readFile(spec.stderrPath, "utf8").catch((error) => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
        if (stderr.includes("native stderr")) break;
        await sleep(50);
      }
      assert.equal(await readFile(spec.stdoutPath, "utf8"), `${JSON.stringify(directory)}\n`);
      assert.equal(await readFile(spec.stderrPath, "utf8"), "native stderr\n");
      await backend.install(spec);
      assert.equal((await backend.inspect(spec)).state, "running");
    }
  );
}
