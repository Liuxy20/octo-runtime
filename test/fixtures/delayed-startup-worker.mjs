import { writeFile } from "node:fs/promises";

await writeFile(process.env.OCTO_TEST_WORKER_PID, String(process.pid));
// 保持未就绪直到父进程取消，避免慢身份登记与固定启动 timer 争抢先后。
setInterval(() => {}, 1000);
