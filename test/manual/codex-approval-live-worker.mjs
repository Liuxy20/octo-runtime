import { createFixtureCodexHost } from "../../test-support/codex-owner.mjs";
const host = createFixtureCodexHost();
export const owner = host.owner;
export const adapters = [host.adapter];
