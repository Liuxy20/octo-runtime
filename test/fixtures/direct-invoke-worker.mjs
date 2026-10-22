import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { testAdapter } from "./invoke-adapter.js";

// SDK 文档的宿主自有 worker：原生导入所选实现，不读取 CLI 或 Home 清单。
serveWorker([testAdapter]);
