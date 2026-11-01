import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { terminateFixtureProcess } from "../../test-support/fixture-process.mjs";

// 显式 non-gating 验收：真实 Codex 仅在本次私有目录创建固定回执，不请求网络或其他业务操作。
const cli = fileURLToPath(new URL("../../apps/cli/dist/index.js", import.meta.url));
for (const mode of ["canonical", "native"]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ort166-live-")));
  const marker = `ORT166_${randomUUID()}`;
  const child = spawn(process.execPath, [cli, "playboard"], {
    cwd: directory,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "",
    stderr = "",
    timer,
    cleanupTask,
    verifiedCompletion = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const code = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        // CLI 自有 signal/close 先执行；截止后独立确认 leader，未确认清理不删除目录。
        child.kill("SIGINT");
        cleanupTask = new Promise((done) => setTimeout(done, 5000)).then(() =>
          terminateFixtureProcess(child.pid)
        );
        void cleanupTask.then(() => reject(new Error("LIVE_TIMEOUT")), reject);
      }, 90000);
      child.once("error", reject);
      child.once("close", resolve);
      child.stdin.end(
        JSON.stringify({
          protocol_mode: mode,
          inputs: [
            {
              type: "text",
              text: `Use the command execution tool exactly once to run: printf '%s' '${marker}' > receipt.txt\nThen reply DONE. Only create receipt.txt in the current working directory. Do not access the network or modify other files.`
            }
          ],
          contexts: {
            schema: "octo.context-envelope/v3",
            items: [
              { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
              {
                namespace: "octo.execution",
                name: "limits",
                payload: { run_timeout_ms: 60000, cancel_grace_ms: 1000 }
              }
            ]
          }
        })
      );
    });
    assert.equal(code, 0, `CLI failed (${code}); stderr: ${stderr}`);
    const frames = stdout.trim().split("\n").map(JSON.parse);
    const last = frames.at(-1);
    assert.ok(last.type === "run.completed" || last.control?.state === "completed");
    assert.equal(await readFile(join(directory, "receipt.txt"), "utf8"), marker);
    verifiedCompletion = true;
    console.log(
      JSON.stringify({
        mode,
        code,
        terminal: "completed",
        receipt: "verified",
        approvalNotifications: frames.filter(
          (f) => f.type === "interaction.requested" || f.control?.status === "pending"
        ).length
      })
    );
  } finally {
    clearTimeout(timer);
    await cleanupTask;
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
    // 超时只确认了 leader；不把该事实当作后代已退出，保留可能仍被写入的目录。
    if (verifiedCompletion) await rm(directory, { recursive: true, force: true });
    else console.error(`Live cleanup not confirmed; retained ${directory}`);
  }
}
