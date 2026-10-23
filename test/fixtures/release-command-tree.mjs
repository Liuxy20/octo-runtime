import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `
  import { writeFileSync } from 'node:fs';
  writeFileSync(process.argv[1], String(process.pid));
  setInterval(() => {}, 1000);
`,
    process.argv[2]
  ],
  { stdio: "ignore" }
);
// POSIX 正常 TERM 时先收割自己的子进程，避免测试把孤儿僵尸交给系统 init。
process.on("SIGTERM", () => {
  child.once("exit", () => process.exit());
  child.kill("SIGTERM");
});
setInterval(() => {}, 1000);
