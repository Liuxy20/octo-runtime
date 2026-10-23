import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sanitizePublicValue,
  HourlyLogWriter
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import { readStoredExtra } from "../packages/octo-runtime-host-sdk/dist/index.js";
import { configureCliOpenClaw, syncCliOpenClawToolEnvironment } from "../apps/cli/dist/openclaw.js";
import { claimAttempt } from "./fixtures/restart-hanging-adapter-host.js";

const execute = promisify(execFile);
const cwd = fileURLToPath(new URL("..", import.meta.url));
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), "octo-security-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("public diagnostics redact complete, repeated and truncated private keys", () => {
  for (const label of ["", "RSA ", "EC ", "ENCRYPTED "]) {
    const begin = `-----BEGIN ${label}PRIVATE KEY-----`;
    const end = `-----END ${label}PRIVATE KEY-----`;
    assert.equal(
      sanitizePublicValue(`before ${begin}\nprivate-bytes\n${end} after`),
      "before [REDACTED] after"
    );
    assert.equal(sanitizePublicValue(`before ${begin}\nprivate-bytes`), "before [REDACTED]");
    assert.equal(sanitizePublicValue(`${begin}${begin}private-bytes${end}`), "[REDACTED]");
  }
  assert.equal(
    sanitizePublicValue("-----BEGIN CERTIFICATE-----public-----END CERTIFICATE-----"),
    "-----BEGIN CERTIFICATE-----public-----END CERTIFICATE-----"
  );
});

test("adversarial PEM, app IDs and API suffixes finish within a bounded child process", async () => {
  const code = `
    import assert from 'node:assert/strict';
    import { sanitizePublicValue } from './packages/octo-runtime-adapter-sdk/dist/index.js';
    import { resolveHostHome, profileNameFor } from './packages/octo-runtime-host-sdk/dist/index.js';
    import { getJson } from './packages/octo-runtime-extra-channel-gateway/dist/transport/api/client.js';
    assert.equal(sanitizePublicValue('-----BEGIN PRIVATE KEY-----'.repeat(30000)), '[REDACTED]');
    const suffix = '-'.repeat(200000);
    assert.equal(resolveHostHome('My App'+suffix), resolveHostHome('My App'));
    assert.equal(profileNameFor('My App'+suffix, 'tenant'), profileNameFor('My App', 'tenant'));
    assert.equal(profileNameFor('My App'+suffix+'x', 'tenant').slice(0, 48), 'my-app'+'-'.repeat(42));
    assert.equal(profileNameFor('---My App---', 'tenant'), profileNameFor('My App', 'tenant'));
    globalThis.fetch = async (url) => {
      assert.equal(url, 'https://example.invalid/api/status');
      return Response.json({ok:true});
    };
    assert.deepEqual(await getJson('https://example.invalid/api'+'/'.repeat(200000), 'fixture', '/status'), {ok:true});
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith('x/status'));
      return Response.json({ok:true});
    };
    await getJson('https://example.invalid/'+'/'.repeat(200000)+'x', 'fixture', '/status');
  `;
  await execute(process.execPath, ["--input-type=module", "-e", code], { cwd, timeout: 5000 });
});

test("Extra config reads preserve missing/permission failures and reject links and oversized files", async (t) => {
  const root = await directory(t);
  await mkdir(join(root, "example"));
  const file = join(root, "example", "config.json");
  await assert.rejects(readStoredExtra(root, "example"), { code: "ENOENT" });
  await writeFile(file, JSON.stringify({ config: { value: 1 } }), { mode: 0o600 });
  assert.deepEqual(await readStoredExtra(root, "example"), { config: { value: 1 } });
  if (process.platform !== "win32") {
    await chmod(file, 0o644);
    await assert.rejects(readStoredExtra(root, "example"), /EXTRA_CONFIG_PERMISSIONS_INVALID/);
    await chmod(file, 0o600);
  }
  await writeFile(file, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(readStoredExtra(root, "example"), /EXTRA_CONFIG_TOO_LARGE/);
  await rm(file);
  await mkdir(file);
  await assert.rejects(readStoredExtra(root, "example"), /EXTRA_CONFIG_PERMISSIONS_INVALID/);
  await rm(file, { recursive: true });
  const target = join(root, "target.json");
  await writeFile(target, JSON.stringify({ config: { private: "keep" } }), { mode: 0o600 });
  try {
    await symlink(target, file);
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return;
    throw error;
  }
  await assert.rejects(readStoredExtra(root, "example"));
  assert.equal(JSON.parse(await readFile(target, "utf8")).config.private, "keep");
});

test("OpenClaw dotenv synchronization refuses a symbolic link without modifying its target", async (t) => {
  const root = await directory(t);
  const native = join(root, "native"),
    profile = join(root, "profile");
  await mkdir(native);
  await writeFile(
    join(native, "openclaw.json"),
    JSON.stringify({ gateway: { auth: { token: "fixture" } } })
  );
  await configureCliOpenClaw(profile, { openclawHome: native });
  const target = join(root, "target.env");
  await writeFile(target, "KEEP=untouched\n");
  try {
    await symlink(target, join(native, ".env"));
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return;
    throw error;
  }
  await assert.rejects(
    syncCliOpenClawToolEnvironment(profile, [
      {
        name: "channel-gateway",
        config: {
          bots: [
            {
              bot_id: "fixture",
              bf_token: "bf_fixture",
              api_url: "https://example.invalid/api",
              adapter: { adapter_type: "openclaw" }
            }
          ]
        }
      }
    ])
  );
  assert.equal(await readFile(target, "utf8"), "KEEP=untouched\n");
});

test("Extra config validation and reading use the same file when the path is replaced", async (t) => {
  const root = await directory(t);
  await mkdir(join(root, "example"));
  const file = join(root, "example", "config.json");
  await writeFile(file, JSON.stringify({ config: { value: "original" } }), { mode: 0o600 });
  const originalOpen = fs.open;
  let swapped = false;
  const mock = t.mock.method(fs, "open", async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === file && !swapped) {
      swapped = true;
      await fs.rename(file, join(root, "original.json"));
      await writeFile(file, JSON.stringify({ config: { value: "replacement" } }), { mode: 0o644 });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    if (process.platform === "win32") {
      await assert.rejects(readStoredExtra(root, "example"), /EXTRA_CONFIG_PERMISSIONS_INVALID/);
    } else {
      const value = await readStoredExtra(root, "example");
      assert.deepEqual(value, { config: { value: "original" } });
    }
    assert.equal(swapped, true);
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});

test("restart fixture claims unique attempts across concurrent processes and propagates I/O failures", async (t) => {
  const root = await directory(t),
    path = join(root, "attempt");
  assert.equal(claimAttempt(path), 1);
  const code = `import {claimAttempt} from './test/fixtures/restart-hanging-adapter-host.js'; console.log(claimAttempt(process.argv[1]));`;
  const attempts = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const { stdout } = await execute(
        process.execPath,
        ["--input-type=module", "-e", code, path],
        { cwd, timeout: 5000 }
      );
      return Number(stdout.trim());
    })
  );
  assert.deepEqual(
    attempts.sort((a, b) => a - b),
    [2, 3, 4, 5, 6, 7, 8, 9]
  );
  assert.throws(() => claimAttempt(join(root, "missing", "attempt")), { code: "ENOENT" });
});

test(
  "FIFO config and log paths fail without blocking the host",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await directory(t);
    await mkdir(join(root, "example"));
    const file = join(root, "example", "config.json");
    await execute("mkfifo", ["-m", "600", file]);
    const code = `
    import assert from 'node:assert/strict';
    import {readStoredExtra} from './packages/octo-runtime-host-sdk/dist/index.js';
    await assert.rejects(readStoredExtra(process.argv[1], 'example'), /EXTRA_CONFIG_PERMISSIONS_INVALID/);
  `;
    await execute(process.execPath, ["--input-type=module", "-e", code, root], {
      cwd,
      timeout: 5000
    });
    const log = join(root, "test-20261023T00.log");
    await execute("mkfifo", ["-m", "600", log]);
    const writer = new HourlyLogWriter(root, "test", {
      now: () => Date.UTC(2026, 9, 23),
      onError() {}
    });
    t.after(() => writer.close());
    assert.equal(writer.write("must not block"), false);
  }
);

test(
  "WeCom probe rejects public credential files and emits only a controlled error",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await directory(t),
      file = join(root, "credentials.json");
    await writeFile(file, '{"appSecret":"fixture-must-not-appear"}', { mode: 0o644 });
    // 创建 mode 会被宿主 umask 收紧；只对本测试文件显式设置被测的公开权限。
    await chmod(file, 0o644);
    await assert.rejects(
      execute(
        process.execPath,
        ["packages/octo-runtime-extra-channel-wecom/scripts/probe-wecom.mjs", file],
        { cwd, timeout: 5000 }
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(JSON.parse(error.stderr).code, "WECOM_CREDENTIAL_FILE_REQUIRES_0600");
        assert.doesNotMatch(error.stdout + error.stderr, /fixture-must-not-appear/);
        return true;
      }
    );
  }
);
