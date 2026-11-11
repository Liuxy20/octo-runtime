import { withAgentEnvItems } from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeCommand } from "@mininglamp-oss/octo-runtime-adapter-claude-code";
import { buildOpenCodeCommand } from "@mininglamp-oss/octo-runtime-adapter-opencode";
import { invokeRequest } from "./runtime-fixture.js";
for (const resumed of [false, true]) {
  test(`Claude forwards caller startup text without a system prompt file: resumed=${resumed}`, async () => {
    const command = await buildClaudeCommand(
      invokeRequest({
        modelInput: "Caller startup\nBusiness context\nCurrent input",
        ...(resumed ? { providerSession: { sessionId: "session" } } : {})
      })
    );
    try {
      const index = command.args.indexOf("--append-system-prompt-file");
      assert.equal(index, -1);
      const input = JSON.parse(command.input);
      assert.equal(input.message.content, "Caller startup\nBusiness context\nCurrent input");
    } finally {
      await command.cleanup();
    }
  });
}
for (const resumed of [false, true]) {
  test(`OpenCode forwards caller startup text as ordinary input: resumed=${resumed}`, async () => {
    const command = await buildOpenCodeCommand(
      invokeRequest({
        modelInput: "Caller startup\nBusiness context\nCurrent input",
        ...(resumed ? { providerSession: { sessionId: "session" } } : {}),
        agentEnv: withAgentEnvItems(
          (resumed ? { providerSession: { sessionId: "session" } } : {}).agentEnv,
          [
            {
              namespace: "octo.security",
              name: "approval_policy",
              payload: { mode: "full_access" }
            }
          ]
        )
      })
    );
    try {
      const config = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT);
      assert.equal(config.instructions, undefined);
      assert.equal(command.input, "Caller startup\nBusiness context\nCurrent input");
    } finally {
      await command.cleanup();
    }
  });
}
