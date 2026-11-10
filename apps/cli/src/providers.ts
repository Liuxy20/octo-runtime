import { type AdapterMetadata } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import {
  createOpenCodeAdapter,
  openCodeMetadata
} from "@mininglamp-oss/octo-runtime-adapter-opencode";
import {
  createClaudeCodeAdapter,
  claudeCodeMetadata
} from "@mininglamp-oss/octo-runtime-adapter-claude-code";
import {
  createCodeBuddyAdapter,
  codeBuddyMetadata
} from "@mininglamp-oss/octo-runtime-adapter-codebuddy";
import {
  createAntigravityAdapter,
  antigravityMetadata
} from "@mininglamp-oss/octo-runtime-adapter-antigravity";
import {
  createGrokBuildAdapter,
  grokBuildMetadata
} from "@mininglamp-oss/octo-runtime-adapter-grok-build";
import { createHermesAdapter, hermesMetadata } from "@mininglamp-oss/octo-runtime-adapter-hermes";
import {
  createKimiCodeAdapter,
  kimiCodeMetadata
} from "@mininglamp-oss/octo-runtime-adapter-kimi-code";
import { createMcodeAdapter, mcodeMetadata } from "@mininglamp-oss/octo-runtime-adapter-mcode";
import {
  createQoderCliAdapter,
  qoderCliMetadata
} from "@mininglamp-oss/octo-runtime-adapter-qodercli";
import {
  createQoderCliCnAdapter,
  qoderCliCnMetadata
} from "@mininglamp-oss/octo-runtime-adapter-qoderclicn";
import type { HostedAdapter } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { cliProviderLaunch, unavailableCliAdapter } from "./provider-launch.js";

/** 仅 CLI 的装配便利层；不约束 SDK 构造形式，也不在 Kernel 内注册执行依赖。 */
function cliFactory(
  metadata: AdapterMetadata,
  command: string,
  construct: (options: {
    command: string;
    commandArgsPrefix: string[];
    env: NodeJS.ProcessEnv;
  }) => HostedAdapter
) {
  return (options: Record<string, unknown>, context: { env: NodeJS.ProcessEnv }) => {
    const selected = cliProviderLaunch(options, context.env, command);
    if (!selected.launch) return unavailableCliAdapter(metadata, selected.reason, selected.command);
    return construct({
      command: selected.launch.command,
      commandArgsPrefix: [...selected.launch.args],
      env: selected.launch.env
    });
  };
}

export const createCliOpenCodeAdapter = cliFactory(
  openCodeMetadata,
  "opencode",
  createOpenCodeAdapter
);
export const createCliClaudeCodeAdapter = cliFactory(
  claudeCodeMetadata,
  "claude",
  createClaudeCodeAdapter
);
export const createCliCodeBuddyAdapter = cliFactory(
  codeBuddyMetadata,
  "codebuddy",
  createCodeBuddyAdapter
);
export const createCliAntigravityAdapter = cliFactory(
  antigravityMetadata,
  "agy",
  createAntigravityAdapter
);
export const createCliGrokBuildAdapter = cliFactory(
  grokBuildMetadata,
  "grok",
  createGrokBuildAdapter
);
export const createCliHermesAdapter = cliFactory(hermesMetadata, "hermes", createHermesAdapter);
export const createCliKimiCodeAdapter = cliFactory(kimiCodeMetadata, "kimi", createKimiCodeAdapter);
export const createCliMcodeAdapter = cliFactory(mcodeMetadata, "mcode", createMcodeAdapter);
export const createCliQoderCliAdapter = cliFactory(
  qoderCliMetadata,
  "qodercli",
  createQoderCliAdapter
);
export const createCliQoderCliCnAdapter = cliFactory(
  qoderCliCnMetadata,
  "qoderclicn",
  createQoderCliCnAdapter
);
