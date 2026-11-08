import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sanitizePublicValue } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
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
