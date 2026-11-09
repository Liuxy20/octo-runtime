import { ServiceError } from "@mininglamp-oss/octo-runtime-cross-service";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../apps/cli/dist/main.js";
import { describeError, readStartupFailure } from "../apps/cli/dist/output.js";

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
    await runCli(["install", "--json"], {
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
