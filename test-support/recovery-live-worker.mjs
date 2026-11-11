import { createFixtureCodexHost } from "./codex-owner.mjs";

// SDK 宿主自己的执行入口直接装配 Adapter，不读取 CLI manifest。
const host = createFixtureCodexHost();
export const owner = host.owner;
export const adapters = [host.adapter];
