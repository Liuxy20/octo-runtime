import { codeBuddyFixture } from "./codebuddy-fixture.js";

// Kernel 使用实际独立 worker；仅 ACP 上游响应由离线 fixture 提供。
export const adapters = [codeBuddyFixture().adapter];
