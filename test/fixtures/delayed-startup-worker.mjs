import { writeFile } from "node:fs/promises";
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";

await writeFile(process.env.OCTO_TEST_WORKER_PID, String(process.pid));
await new Promise((resolve) => setTimeout(resolve, 10_000));
serveWorker([]);
