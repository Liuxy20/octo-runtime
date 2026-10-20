import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { setTimeout as delay } from "node:timers/promises";

serveWorker([
  {
    metadata: {
      type: "test",
      agentSources: ["provisioned"],
      protocolSupport: { protocol: "test.canonical", modes: ["canonical"], nativeMethods: [] }
    },
    async *invoke(request) {
      yield {
        protocolVersion: 2,
        type: "session.update",
        payload: { providerSession: { sessionId: "drained-provider-session" } }
      };
      if (!request.signal.aborted)
        await new Promise((resolve) =>
          request.signal.addEventListener("abort", resolve, { once: true })
        );
      await delay(150);
      yield { protocolVersion: 2, type: "run.cancelled", payload: {} };
    }
  }
]);
