import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { testAdapter } from "./test-adapter.js";

const mode = process.env.OCTO_TEST_HOST_SELECTION;
serveWorker(
  mode === "empty" ? [] : mode === "duplicate" ? [testAdapter, testAdapter] : [testAdapter]
);
