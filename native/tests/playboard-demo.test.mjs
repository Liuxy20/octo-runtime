import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { kernelFixture, kernelInput } from "../../test/kernel-fixture.js";
import { kernelRelay } from "../../test/kernel-relay.js";
import { createInterface } from "node:readline";
const language = process.env.OCTO_NATIVE_LANGUAGE ?? "go";
if (!["go", "python"].includes(language)) throw Error("Unknown language " + language);
const suffix = process.platform === "win32" ? ".exe" : "";
function executable() {
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
function build() {
  const command =
    language === "go"
      ? ["go", ["build", "-o", executable()[0], "./examples/demo_playboard.go"], "native/go"]
      : undefined;
  if (command) {
    const p = spawnSync(command[0], command[1], { cwd: resolve(command[2]), encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
  }
}
function run(args, input, onEvent) {
  return new Promise((yes, no) => {
    const [exe, prefix] = executable();
    const p = spawn(exe, [...prefix, ...args], {
      env: { ...process.env, PATH: "" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      p.kill();
      no(Error("demo timeout " + stderr));
    }, 30000);
    p.stdout.on("data", (x) => (stdout += x));
    const callbacks = [];
    if (onEvent)
      createInterface({ input: p.stdout }).on("line", (line) => {
        const callback = Promise.resolve().then(() => onEvent(JSON.parse(line)));
        callback.catch((e) => {
          p.kill();
          no(e);
        });
        callbacks.push(callback);
      });
    p.stderr.on("data", (x) => (stderr += x));
    p.on("error", no);
    p.on("exit", async (code) => {
      clearTimeout(timer);
      try {
        await Promise.all(callbacks);
        yes({
          code,
          stderr,
          events: stdout.trim() ? stdout.trim().split("\n").map(JSON.parse) : []
        });
      } catch (e) {
        no(e);
      }
    });
    p.stdin.end(input ? JSON.stringify(input) : "");
  });
}
test(`${language} playboard demo uses native SDK against a real Kernel with an empty client PATH`, async (t) => {
  build();
  const f = await kernelFixture(t, { manifest: resolve("native/tests/adapters.json") });
  const relay = await kernelRelay(t, f);
  for (const mode of ["native", "canonical"])
    await t.test(`${mode} can wait for an answer from a second CLI`, async () => {
      const receipt = join(f.directory, `${language}-${mode}-manual-ref.json`);
      const response = join(f.directory, `${language}-${mode}-manual-response.json`);
      await writeFile(
        response,
        JSON.stringify(
          mode === "native"
            ? { requestId: 42, payload: { id: 42, result: "approved" } }
            : { interactionId: "approval", outcome: "accepted" }
        )
      );
      let replied = false;
      const result = await run(
        ["playboard", "--endpoint", relay.endpoint, "--receipt", receipt, "--timeout", "10s"],
        { ...kernelInput("interaction"), protocol_mode: mode },
        async (event) => {
          if (
            replied ||
            !(event.type === "interaction.requested" || event.messageKind === "request")
          )
            return;
          replied = true;
          const answer = await run([
            mode === "native" ? "native-respond" : "respond",
            "--endpoint",
            relay.endpoint,
            "--ref",
            receipt,
            "--response",
            response
          ]);
          assert.equal(answer.code, 0, answer.stderr);
        }
      );
      assert.equal(replied, true);
      assert.equal(result.code, 0, result.stderr);
    });
  for (const command of ["status", "list"])
    await t.test(command, async () => {
      const result = await run([command, "--endpoint", relay.endpoint]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.events.length, 1);
    });
  for (const mode of ["native", "canonical"])
    await t.test(`${mode} stdin, receipt and get`, async () => {
      const receipt = join(f.directory, `${language}-${mode}-ref.json`);
      const request = { ...kernelInput(), protocol_mode: mode };
      const result = await run(
        ["playboard", "--endpoint", relay.endpoint, "--receipt", receipt],
        request
      );
      assert.equal(result.code, 0, result.stderr);
      assert.ok(result.events.length > 0);
      assert.equal(
        mode === "native" ? result.events.at(-1).control.state : result.events.at(-1).type,
        mode === "native" ? "completed" : "run.completed"
      );
      const ref = JSON.parse(await readFile(receipt, "utf8"));
      assert.equal(ref.run_id, request.runId);
      const query = await run(["get", "--endpoint", relay.endpoint, "--ref", receipt]);
      assert.equal(query.code, 0, query.stderr);
      assert.deepEqual(query.events[0].ref, ref);
    });
  for (const mode of ["native", "canonical"])
    await t.test(`${mode} explicit interaction reply`, async () => {
      const replies = join(f.directory, `${language}-${mode}-answers.json`);
      await writeFile(
        replies,
        JSON.stringify([
          {
            kind: mode,
            response:
              mode === "native"
                ? { requestId: 42, payload: { id: 42, result: "approved" } }
                : { interactionId: "approval", outcome: "accepted" }
          }
        ])
      );
      const result = await run(
        ["playboard", "--endpoint", relay.endpoint, "--responses", replies],
        { ...kernelInput("interaction"), protocol_mode: mode }
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        mode === "native" ? result.events.at(-1).control.state : result.events.at(-1).type,
        mode === "native" ? "completed" : "run.completed"
      );
    });
  await t.test("Codex native request and pending frames share one explicit answer", async () => {
    const replies = join(f.directory, `${language}-codex-answers.json`);
    await writeFile(
      replies,
      JSON.stringify([
        {
          kind: "native",
          response: {
            requestId: 42,
            payload: { jsonrpc: "2.0", id: 42, result: { decision: "accept" } }
          }
        }
      ])
    );
    const request = kernelInput("approval", { modelInput: "approval", approvalMode: "ask" });
    request.protocol_mode = "native";
    request.contexts.items.find(
      (i) => i.namespace === "octo.execution" && i.name === "adapter"
    ).payload.type = "codex";
    const before = relay.count("agent_run.native.respond");
    const result = await run(
      ["playboard", "--endpoint", relay.endpoint, "--responses", replies],
      request
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.events.at(-1).control.state, "completed");
    assert.equal(relay.count("agent_run.native.respond") - before, 1);
  });
  await t.test("deadline requests cancellation and observes terminal", async () => {
    const before = relay.count("agent_run.cancel");
    const result = await run(
      ["playboard", "--endpoint", relay.endpoint, "--timeout", "1s", "--cancel-grace", "2s"],
      { ...kernelInput("wait-for-cancel"), protocol_mode: "native" }
    );
    assert.equal(result.code, 124, result.stderr);
    assert.equal(result.events.at(-1).control.state, "cancelled");
    assert.equal(relay.count("agent_run.cancel") - before, 1);
  });
  await t.test("malformed input cannot submit", async () => {
    const before = relay.count("agent_run.invoke");
    const result = await run(["playboard", "--endpoint", relay.endpoint], {
      inputs: [],
      contexts: { schema: "octo.context-envelope/v3", items: [] }
    });
    assert.equal(result.code, 1);
    assert.equal(relay.count("agent_run.invoke"), before);
  });
});
