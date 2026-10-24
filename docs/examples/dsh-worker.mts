import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

// 宿主单独编译此 worker；Kernel 服务仍由宿主进程构造和关闭。
serveWorker([dshAdapter]);
