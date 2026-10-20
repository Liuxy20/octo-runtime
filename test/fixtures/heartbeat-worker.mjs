import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { testAdapter } from "./test-adapter.js";
serveWorker([testAdapter]);
process.on("SIGUSR2", () => {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    /* 故意阻塞主循环，不能由 timer 或线程代答心跳。 */
  }
});
