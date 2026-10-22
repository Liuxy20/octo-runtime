import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { grokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";

// 源码 workspace 宿主拥有此入口，编译后交给 Kernel；不加载 CLI manifest。
serveWorker([grokBuildAdapter]);
