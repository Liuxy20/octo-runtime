import { serveWorker, type HostedAdapter } from "@mininglamp-oss/octo-runtime/executor-kernel";

const adapter: HostedAdapter = {
  metadata: {
    type: "release-fixture",
    agentSources: ["provisioned"],
    protocolSupport: {
      protocol: "release.fixture",
      modes: ["native", "canonical"],
      nativeMethods: []
    }
  },
  probe: () => ({ available: true, command: process.execPath }),
  async *invoke(_request, context) {
    if (context?.protocolMode === "canonical") {
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    } else {
      yield { kind: "native", messageKind: "notification", payload: { answer: "public kernel" } };
      yield { kind: "control", control: { type: "state", state: "completed" } };
    }
  }
};
serveWorker([adapter]);
