import { codeBuddyModelFixture } from "./codebuddy-model-fixture.js";

// 真实 Kernel worker；只替换 ACP 上游，测试宿主负责临时目录和 Kernel 清理。
export const adapters = [codeBuddyModelFixture({ audit: true }).adapter];
