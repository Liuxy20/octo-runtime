import { appendFile } from "node:fs/promises";
import { testAdapter as adapter } from "./invoke-adapter.js";

// Count actual Provider admissions independently from client ACKs, cards and connection status.
export const testAdapter = {
  ...adapter,
  async *invoke(request, context) {
    await appendFile(process.env.OCTO_RECOVERY_STARTS_FILE, `${request.invocationId}\n`);
    if (process.env.OCTO_RECOVERY_KEYS_FILE)
      await appendFile(
        process.env.OCTO_RECOVERY_KEYS_FILE,
        `${JSON.stringify({
          run_id: request.runId,
          invocation_id: request.invocationId,
          agent_session_id: request.agentSessionId,
          session_generation: request.sessionGeneration ?? 0,
          protocol_mode: context.protocolMode
        })}\n`
      );
    yield* adapter.invoke(request, context);
  }
};
