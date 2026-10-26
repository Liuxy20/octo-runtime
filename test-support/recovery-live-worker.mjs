import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";

// SDK 宿主自己的执行入口直接装配 Adapter，不读取 CLI manifest。
serveWorker([createCodexAdapter()]);
