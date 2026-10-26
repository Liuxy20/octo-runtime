import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { octoCliEnvironment } from "@mininglamp-oss/octo-runtime-extra-channel-gateway";
import { childEnvironment, octoEnvironment } from "../test-support/recovery-live-probes.mjs";

// 显式指定本机 CLI，普通 CI 不安装外部工具；所有账号仅在私有 fixture 内生成。
async function runCli(executable, args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
      killSignal: "SIGKILL"
    });
    let stdout = "",
      stderr = "";
    child.once("error", reject);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("close", (code) => {
      try {
        resolve({ code, result: JSON.parse(stdout || stderr) });
      } catch {
        reject(new Error("QA_CLI_ENVELOPE_MISSING"));
      }
    });
    child.stdin.on("error", reject);
    child.stdin.end(input);
  });
}

async function storeSnapshot(directory) {
  const entries = await readdir(directory);
  return Promise.all(
    entries.sort().map(async (name) => [name, await readFile(join(directory, name))])
  );
}

for (const [name, executable, priority] of [
  ["recovery CLI uses an empty trial store", process.env.OCTO_RECOVERY_QA_CLI, false],
  ["Gateway Bot outranks default CLI credentials", process.env.OCTO_CHANNEL_QA_CLI, true]
]) {
  test(name, { skip: !executable }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "octo-credential-priority-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const count of [0, 1, 2]) {
      await t.test(`${count} saved profiles`, async () => {
        const home = join(root, `home-${count}`);
        const defaultStore = join(home, ".octo-cli");
        const explicitStore = join(root, `operator-${count}`);
        const trialStore = join(root, `trial-${count}`);
        for (const directory of [defaultStore, explicitStore, trialStore])
          await mkdir(directory, { recursive: true, mode: 0o700 });
        const inherited = { ...childEnvironment(process.env), HOME: home, USERPROFILE: home };
        for (const directory of [defaultStore, explicitStore]) {
          for (let i = 0; i < count; i++) {
            const login = await runCli(
              executable,
              ["auth", "login", "--profile", `operator-${i}`, "--with-token"],
              { ...inherited, OCTO_CONFIG_DIR: directory },
              `uk_${randomUUID()}\n`
            );
            assert.equal(login.code, 0, "fixture profile creation must succeed offline");
          }
        }
        const snapshots = await Promise.all([defaultStore, explicitStore].map(storeSnapshot));
        for (const configured of [false, true]) {
          const source = {
            ...inherited,
            ...(configured ? { OCTO_CONFIG_DIR: explicitStore } : {}),
            OCTO_TOKEN: `uk_${randomUUID()}`,
            OCTO_BOT_TOKEN: `bf_${randomUUID()}`
          };
          for (const prefix of priority ? ["bf_"] : ["bf_", "uk_"]) {
            const token = prefix + randomUUID();
            const env = priority
              ? {
                  ...source,
                  ...Object.fromEntries(
                    octoCliEnvironment(
                      "https://im-test.deepminer.com.cn/api",
                      token
                    ).env_variables.map(({ key, value }) => [key, value])
                  )
                }
              : octoEnvironment(source, { token, configDirectory: trialStore });
            const { code, result } = await runCli(executable, ["config", "show"], env);
            assert.equal(code, 0, "config show must resolve without network access");
            assert.equal(result.ok, true);
            assert.equal(result.identity.source, "env:OCTO_TOKEN");
            assert.equal(result.identity.bot_kind, prefix === "uk_" ? "user_key" : "user_bot");
            assert.equal(result.data.profile, null);
            assert.equal(result.data.api_base_url, "https://im-test.deepminer.com.cn");
          }
        }
        assert.deepEqual(
          await Promise.all([defaultStore, explicitStore].map(storeSnapshot)),
          snapshots,
          "operator stores must remain byte-for-byte unchanged"
        );
        assert.deepEqual(await readdir(trialStore), []);
      });
    }
  });
}
