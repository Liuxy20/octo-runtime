import { writeFileSync } from "node:fs";

// 只记录本 fixture 的 PID，供测试确认 Adapter 独立进程组的实际生存状态。
writeFileSync(process.env.ISSUE_210_CODEX_PID_PATH, String(process.pid), { mode: 0o600 });
await import("../../../test-support/fake-native-codex.mjs");
