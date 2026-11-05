import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CodexEventNormalizer,
  normalizeCodexEvent
} from "@mininglamp-oss/octo-runtime-adapter-codex";

function item(command, extra = {}) {
  return {
    type: "commandExecution",
    id: "rg-157",
    command,
    status: "failed",
    exitCode: 1,
    aggregatedOutput: "",
    ...extra
  };
}

function completed(input) {
  const events = normalizeCodexEvent({ method: "item/completed", params: { item: input } });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool_call.update");
  assert.equal(events[0].protocolVersion, 2);
  assert.equal(events[0].payload.id, input.id);
  assert.equal(events[0].payload.exitCode, input.exitCode);
  assert.deepEqual(events[0].payload.output, input.aggregatedOutput ?? "");
  return events[0].payload;
}

test("independent literal rg commands keep the no-match exception", () => {
  for (const command of [
    "rg -n TODO index.html",
    "rg.exe -q TODO index.html",
    "/usr/bin/rg --fixed-strings TODO index.html",
    "C:/tools/rg.exe TODO index.html",
    'rg "two words" "file name.txt"',
    "rg 'two words' file.txt",
    "rg TODO 中文.txt",
    "  rg\tTODO file.txt  "
  ]) {
    assert.equal(completed(item(command)).status, "completed", command);
  }
});

test("compound commands and shell syntax never establish an rg exit origin", () => {
  for (const command of [
    "exit /b 1 && rg TODO missing-dir",
    "false && rg TODO file.txt",
    "true && rg TODO file.txt",
    "rg -q TODO file.txt && false",
    "false || rg TODO file.txt",
    "rg -q TODO file.txt || false",
    "rg TODO file.txt | false",
    "rg TODO file.txt & false",
    "rg TODO file.txt; false",
    "rg TODO file.txt\nfalse",
    "rg TODO file.txt\r\nfalse",
    "rg TODO file.txt > output.txt",
    "rg TODO file.txt 2>/dev/null",
    "rg TODO file.txt # comment",
    "rg $(false) file.txt",
    "rg `false` file.txt",
    "rg ${pattern} file.txt",
    "rg %PATTERN% file.txt",
    "rg !PATTERN! file.txt",
    "rg TODO file.txt^& false",
    "rg TODO file.txt\\\nfalse",
    "rg TODO file.txt\n",
    "rg TODO file.txt\u0000"
  ]) {
    assert.equal(completed(item(command)).status, "failed", command);
  }
});

test("quoted operators, escaping and wrappers stay conservatively failed", () => {
  for (const command of [
    "rg 'TODO|FIXME' file.txt",
    'rg "&&" file.txt',
    "rg ';' file.txt",
    "rg '$(false)' file.txt",
    "rg TODO 'unclosed",
    'rg TODO "unclosed',
    'rg "escaped\\" text" file.txt',
    "rg foo\\ bar file.txt",
    "C:\\tools\\rg.exe TODO file.txt",
    '"C:/Program Files/rg.exe" TODO file.txt',
    "& 'C:/Program Files/rg.exe' TODO file.txt",
    "command rg TODO file.txt",
    "env rg TODO file.txt",
    "rg.cmd TODO file.txt",
    "not-rg TODO file.txt",
    "myrg TODO file.txt",
    "/bin/bash -c 'rg TODO file.txt'",
    '/bin/zsh -lc "false && rg TODO file.txt"',
    '/bin/zsh -lc "rg TODO file.txt"',
    'cmd.exe /d /s /c "rg TODO file.txt"',
    'pwsh -NoProfile -Command "rg TODO file.txt"'
  ]) {
    assert.equal(completed(item(command)).status, "failed", command);
  }
});

test("only explicit empty output and exit 1 can qualify; native facts stay intact", () => {
  for (const extra of [
    { exitCode: 2 },
    { exitCode: undefined },
    { exitCode: "1" },
    { aggregatedOutput: "rg: search failed" },
    { aggregatedOutput: "\n" },
    { aggregatedOutput: undefined },
    { aggregatedOutput: null },
    { aggregatedOutput: {} },
    { status: "declined" },
    { type: "dynamicToolCall", tool: "rg" }
  ]) {
    const input = item("rg TODO file.txt", extra);
    if (input.type === "dynamicToolCall") input.aggregatedOutput = null;
    const event = normalizeCodexEvent({ method: "item/completed", params: { item: input } })[0];
    assert.equal(event.payload.status, "failed", JSON.stringify(extra));
    assert.equal(
      event.payload.exitCode,
      typeof input.exitCode === "number" ? input.exitCode : undefined
    );
    assert.deepEqual(
      event.payload.output,
      input.type === "dynamicToolCall" ? null : (input.aggregatedOutput ?? "")
    );
  }
  assert.equal(
    completed(
      item("rg TODO file.txt", { status: "completed", exitCode: 0, aggregatedOutput: "TODO\n" })
    ).status,
    "completed"
  );
  assert.equal(
    completed(item("rg TODO file.txt", { status: "failed", exitCode: 2, aggregatedOutput: "" }))
      .status,
    "failed"
  );
  assert.equal(
    completed(
      item("false && rg TODO file.txt", {
        commandActions: [
          { type: "search", command: "rg TODO file.txt", query: "TODO", path: "file.txt" }
        ]
      })
    ).status,
    "failed"
  );
});

test("canonical identity, step, output ordering and running lifecycle are retained", () => {
  const normalizer = new CodexEventNormalizer();
  const input = item("false && rg TODO file.txt", { cwd: "/fixture" });
  const snapshot = structuredClone(input);
  const start = normalizer.normalize({
    method: "item/started",
    params: { turnId: "turn-157", item: { ...input, status: "inProgress" } }
  });
  const delta = normalizer.normalize({
    method: "item/commandExecution/outputDelta",
    params: { itemId: input.id, delta: "part\n" }
  });
  const end = normalizer.normalize({ method: "item/completed", params: { item: input } });
  const toolEvents = [...start, ...delta, ...end].filter((event) =>
    event.type.startsWith("tool_call.")
  );
  assert.deepEqual(
    toolEvents.map((event) => event.type),
    ["tool_call.create", "tool_call.delta", "tool_call.update"]
  );
  assert.equal(toolEvents[0].payload.name, "exec_command");
  assert.deepEqual(toolEvents[0].payload.args, { command: input.command, cwd: input.cwd });
  assert.equal(toolEvents[0].payload.status, "running");
  assert.equal(toolEvents[1].payload.outputDelta, "part\n");
  assert.equal(toolEvents[2].payload.status, "failed");
  assert.ok(toolEvents[0].payload.stepId);
  for (const event of toolEvents) {
    assert.equal(event.payload.id, input.id);
    assert.equal(event.payload.stepId, toolEvents[0].payload.stepId);
  }
  assert.equal(toolEvents[2].payload.exitCode, 1);
  assert.equal(toolEvents[2].payload.output, "");
  assert.deepEqual(input, snapshot);
});

test(
  "Windows real shells feed their actual output and exit code into the normalizer",
  { skip: process.platform !== "win32", timeout: 180_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "octo-157-rg-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "fixture.txt"), "TODO present\n");
    const cmd = process.env.ComSpec || "C:/Windows/System32/cmd.exe";
    const pwsh = process.env.OCTO_157_PWSH;
    assert.ok(pwsh, "run with OCTO_157_PWSH set to the actual PowerShell 7 executable");
    const rgPath = process.env.OCTO_157_RG;
    assert.ok(rgPath, "run with OCTO_157_RG set to the actual rg executable");
    const version = spawnSync("rg", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    });
    assert.equal(version.status, 0, version.error?.message);
    t.diagnostic(version.stdout.trim().split(/\r?\n/)[0]);

    const cases = [
      [
        "cmd-exe-no-match",
        cmd,
        ["/d", "/s", "/c"],
        "rg.exe absent fixture.txt",
        1,
        "completed",
        ""
      ],
      [
        "cmd-shell-wrapper",
        cmd,
        ["/d", "/s", "/c"],
        'cmd /d /s /c "rg absent fixture.txt"',
        1,
        "failed",
        ""
      ],
      [
        "pwsh-quoted-executable-path",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        `& '${rgPath.replaceAll("'", "''")}' absent fixture.txt`,
        1,
        "failed",
        ""
      ],
      [
        "cmd-failed-prefix-rg-not-run",
        cmd,
        ["/d", "/s", "/c"],
        "exit /b 1 && rg TODO missing-dir",
        1,
        "failed",
        ""
      ],
      [
        "cmd-independent-no-match",
        cmd,
        ["/d", "/s", "/c"],
        "rg absent fixture.txt",
        1,
        "completed",
        ""
      ],
      [
        "cmd-independent-match",
        cmd,
        ["/d", "/s", "/c"],
        "rg TODO fixture.txt",
        0,
        "completed",
        "TODO present\r?\n"
      ],
      ["cmd-rg-real-error", cmd, ["/d", "/s", "/c"], "rg TODO missing-dir", 2, "failed", undefined],
      [
        "cmd-rg-error-suppressed",
        cmd,
        ["/d", "/s", "/c"],
        "rg TODO missing-dir 2>nul",
        2,
        "failed",
        ""
      ],
      [
        "cmd-suffix-failed",
        cmd,
        ["/d", "/s", "/c"],
        "rg -q TODO fixture.txt && cmd /d /c exit 1",
        1,
        "failed",
        ""
      ],
      [
        "cmd-prefix-success-still-ambiguous",
        cmd,
        ["/d", "/s", "/c"],
        "cmd /d /c exit 0 && rg absent fixture.txt",
        1,
        "failed",
        ""
      ],
      [
        "cmd-or-failed",
        cmd,
        ["/d", "/s", "/c"],
        "rg -q absent fixture.txt || cmd /d /c exit 1",
        1,
        "failed",
        ""
      ],
      [
        "cmd-pipeline-failed",
        cmd,
        ["/d", "/s", "/c"],
        "rg -q TODO fixture.txt | cmd /d /c exit 1",
        1,
        "failed",
        ""
      ],
      [
        "cmd-sequence-failed",
        cmd,
        ["/d", "/s", "/c"],
        "rg -q TODO fixture.txt & cmd /d /c exit 1",
        1,
        "failed",
        ""
      ],
      [
        "cmd-quoted-operator-literal",
        cmd,
        ["/d", "/s", "/c"],
        'rg -F "&&" fixture.txt',
        1,
        "failed",
        ""
      ],
      [
        "pwsh-independent-no-match",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        "rg absent fixture.txt",
        1,
        "completed",
        ""
      ],
      [
        "pwsh-semicolon-failed",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        "rg -q TODO fixture.txt; exit 1",
        1,
        "failed",
        ""
      ],
      [
        "pwsh-newline-failed",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        "rg -q TODO fixture.txt\nexit 1",
        1,
        "failed",
        ""
      ],
      [
        "pwsh-and-failed",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        "cmd /d /c exit 1 && rg TODO missing-dir",
        1,
        "failed",
        ""
      ],
      [
        "pwsh-or-failed",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        "rg -q absent fixture.txt || cmd /d /c exit 1",
        1,
        "failed",
        ""
      ],
      [
        "pwsh-quoted-operator-literal",
        pwsh,
        ["-NoProfile", "-NonInteractive", "-Command"],
        "rg -F 'TODO|FIXME' fixture.txt",
        1,
        "failed",
        ""
      ]
    ];
    for (const [
      name,
      shell,
      args,
      command,
      expectedExit,
      expectedStatus,
      expectedOutput
    ] of cases) {
      await t.test(name, () => {
        // cmd 不采用 C argv 的反斜杠引号规则，显式保留 /s /c 的整条命令边界。
        const result = spawnSync(shell, [...args, shell === cmd ? `"${command}"` : command], {
          cwd: directory,
          encoding: "utf8",
          timeout: 15_000,
          windowsVerbatimArguments: shell === cmd,
          windowsHide: true
        });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        assert.equal(result.status, expectedExit, result.stderr);
        const output = result.stdout + result.stderr;
        if (expectedOutput !== undefined)
          assert.match(output, new RegExp(`^(?:${expectedOutput})$`));
        else
          assert.ok(
            output.includes("missing-dir"),
            "the independent rg counterfactual really reports its missing input"
          );
        const payload = completed(
          item(command, {
            status: result.status === 0 ? "completed" : "failed",
            exitCode: result.status,
            aggregatedOutput: output
          })
        );
        t.diagnostic(
          JSON.stringify({
            name,
            shell,
            command,
            exitCode: result.status,
            output,
            normalizedStatus: payload.status
          })
        );
        assert.equal(payload.status, expectedStatus);
      });
    }
  }
);
