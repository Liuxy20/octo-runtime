import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createExecutorFixture } from "../../test-support/executor-adapter.mjs";

serveWorker([createExecutorFixture()]);
