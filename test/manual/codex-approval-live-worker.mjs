import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { codexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
serveWorker([codexAdapter]);
