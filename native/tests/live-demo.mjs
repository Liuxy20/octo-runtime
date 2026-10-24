// Opt-in real Provider smoke; attach without managing the existing Kernel.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";

const { values } = parseArgs({
  options: {
    endpoint: { type: "string" },
    language: { type: "string", default: "all" },
    adapter: { type: "string", default: "codex" },
    evidence: { type: "string", default: ".tmp/native-live-evidence.json" }
  }
});
if (!values.endpoint)
  throw Error("--endpoint is required; the caller must own/authorize these runs");
const languages = values.language === "all" ? ["go", "python"] : [values.language];
if (languages.some((x) => !["go", "python"].includes(x))) throw Error("Unknown language");
const suffix = process.platform === "win32" ? ".exe" : "";
function executable(language) {
  if (language === "go") return [resolve(".tmp/playboard-demo-go" + suffix), []];
  return [
    resolve(
      process.env.OCTO_NATIVE_PYTHON ||
        (process.platform === "win32"
          ? "native/python/.venv/Scripts/python.exe"
          : "native/python/.venv/bin/python")
    ),
    ["-I", resolve("native/python/demo_playboard.py")]
  ];
}
function run(language, args, request) {
  return new Promise((yes, no) => {
    const [exe, prefix] = executable(language);
    const child = spawn(exe, [...prefix, ...args, "--endpoint", values.endpoint], {
      env: { ...process.env, PATH: "" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      no(Error(`${language}: demo exceeded 90 seconds`));
    }, 90_000);
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.once("error", (e) => {
      clearTimeout(timer);
      no(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      try {
        yes({
          code,
          stderr,
          events: stdout.trim() ? stdout.trim().split("\n").map(JSON.parse) : []
        });
      } catch (e) {
        no(e);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(request ? JSON.stringify(request) : "");
  });
}
const directory = await mkdtemp(join(tmpdir(), "octo-native-live-"));
const evidence = {
  date: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  clientPATH: "",
  provider: values.adapter,
  results: [],
  scope:
    "Text completion and original receipt lookup in native/canonical modes; real approval and cancellation are not covered."
};
try {
  const status = await run(languages[0], ["status"]);
  assert.equal(status.code, 0, "Kernel status failed");
  evidence.kernelInstance = status.events[0].kernel_instance_id;
  const listing = await run(languages[0], ["list"]);
  assert.equal(listing.code, 0, "Adapter listing failed");
  const metadata = listing.events[0].find((x) => x.type === values.adapter);
  assert.equal(metadata?.available, true, "Requested Provider is unavailable");
  evidence.providerVersion = metadata.providerVersion;
  for (const language of languages)
    for (const mode of ["native", "canonical"]) {
      const workspace = join(directory, `${language}-${mode}`);
      await mkdir(workspace);
      const receipt = join(directory, `${language}-${mode}.json`);
      const request = {
        protocol_mode: mode,
        inputs: [
          { type: "text", text: "Reply with OK. Do not use tools, read files, or make changes." }
        ],
        contexts: {
          schema: "octo.context-envelope/v3",
          items: [
            { namespace: "octo.execution", name: "adapter", payload: { type: values.adapter } },
            {
              namespace: "octo.execution",
              name: "workspace",
              payload: { mode: "fixed", path: workspace }
            },
            { namespace: "octo.security", name: "approval_policy", payload: { mode: "ask" } }
          ]
        }
      };
      const start = Date.now();
      const result = await run(
        language,
        ["playboard", "--timeout", "60s", "--cancel-grace", "10s", "--receipt", receipt],
        request
      );
      const last = result.events.at(-1);
      const terminal = mode === "native" ? last?.control?.state : last?.type;
      const row = {
        language,
        mode,
        exitCode: result.code,
        eventCount: result.events.length,
        terminal,
        durationMs: Date.now() - start,
        passed: false
      };
      evidence.results.push(row);
      // Do not store raw Provider payloads, inputs or stderr in evidence.
      assert.equal(result.code, 0, `${language}/${mode} failed; exit ${result.code}`);
      assert.equal(terminal, mode === "native" ? "completed" : "run.completed");
      row.ref = JSON.parse(await readFile(receipt, "utf8"));
      const snapshot = await run(language, ["get", "--ref", receipt]);
      assert.equal(snapshot.code, 0);
      assert.deepEqual(snapshot.events[0].ref, row.ref);
      assert.equal(snapshot.events[0].terminal.control.state, "completed");
      row.passed = true;
      console.log(
        `${language}/${mode}: completed, ${row.eventCount} events, original receipt verified`
      );
    }
} finally {
  await mkdir(resolve(values.evidence, ".."), { recursive: true });
  await writeFile(values.evidence, JSON.stringify(evidence, null, 2) + "\n");
  await rm(directory, { recursive: true, force: true });
}
