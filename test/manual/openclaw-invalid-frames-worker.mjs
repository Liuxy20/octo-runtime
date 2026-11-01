// 仅由显式专项启动，复用生产 Adapter 和同一个 AgentExecutor/worker。
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createOpenClawAdapter } from "@mininglamp-oss/octo-runtime-adapter-openclaw";

serveWorker([createOpenClawAdapter()]);
