import { writeFileSync } from "node:fs";

// 每次尝试用独占创建认领序号，避免并发 read-modify-write 丢失计数。
export function claimAttempt(path) {
  for (let attempt = 1; attempt <= 1000; attempt++) {
    try {
      writeFileSync(`${path}.${attempt}`, "", { flag: "wx", mode: 0o600 });
      return attempt;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("FIXTURE_ATTEMPT_LIMIT");
}

const manifestIndex = process.argv.indexOf("--manifest");
if (manifestIndex >= 0 && process.argv[manifestIndex + 1]) {
  const attemptPath = `${process.argv[manifestIndex + 1]}.host-attempt`;
  const attempt = claimAttempt(attemptPath);
  if (attempt === 2) {
    setInterval(() => undefined, 1_000);
  } else {
    await import("../../packages/octo-runtime-executor-kernel/dist/runner.js");
  }
}
