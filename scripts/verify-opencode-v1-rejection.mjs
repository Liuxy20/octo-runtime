import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";
import { invokeRequest } from "../test/runtime-fixture.js";

// V1 仅解包到临时目录用于拒绝验收，绝不安装到全局或更改宿主 PATH。
const directory = await mkdtemp(join(tmpdir(), "octo-opencode-v1-"));
const execute = promisify(execFile);
try {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const { stdout } = await execute(
    "npm",
    [
      "pack",
      `opencode-${platform}-${process.arch}@1.18.30`,
      "--pack-destination",
      directory,
      "--json"
    ],
    { timeout: 120000 }
  );
  const [pkg] = JSON.parse(stdout);
  await execute("tar", ["-xf", join(directory, pkg.filename), "-C", directory]);
  const command = join(
    directory,
    "package",
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode"
  );
  const adapter = createOpenCodeAdapter({ command });
  const probe = await adapter.probe();
  assert.equal(probe.version, "1.18.30");
  assert.equal(probe.available, false);
  assert.match(probe.reason, /OpenCode 1 is no longer supported/);
  for (const approvalMode of ["ask", "full_access"]) {
    await assert.rejects(async () => {
      for await (const _ of adapter.invoke(invokeRequest({ approvalMode }))) {
        /* drain */
      }
    }, /OPENCODE_VERSION_UNSUPPORTED.*1\.18\.30/);
  }
  console.log(
    JSON.stringify({
      version: probe.version,
      probeRejected: true,
      askRejected: true,
      fullAccessRejected: true,
      isolatedPackage: pkg.integrity
    })
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
