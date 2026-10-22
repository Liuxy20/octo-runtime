#!/usr/bin/env node
// 通用清单 worker 不包含产品准备逻辑；SDK 自有 worker 原生 import 后直接调用 serveWorker。
import { loadManifestAdapters } from "./manifest-adapters.js";
import { serveWorker } from "./index.js";

serveWorker(await loadManifestAdapters());
