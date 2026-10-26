import { serveWorker } from "../../packages/octo-runtime-executor-kernel/dist/index.js";
import { dshAdapter } from "../../packages/octo-runtime-adapter-dsh/dist/index.js";
serveWorker([dshAdapter]);
