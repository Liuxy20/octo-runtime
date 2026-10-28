import {
  AgentExecutor,
  type HostedAdapter,
  type HostedAdapterMetadata
} from "@mininglamp-oss/octo-runtime/executor-core";
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import {
  createJsonCliAdapter,
  defineAdapter,
  type Adapter
} from "../packages/octo-runtime-adapter-sdk/dist/index.js";
import type { AdapterProtocolSupport } from "@mininglamp-oss/octo-runtime/protocol";

// 仅显式执行 tsc：覆盖发行入口的注册合同，不启动 worker 或真实 Provider。
export function checkAdapterProtocolContract(executor: AgentExecutor): void {
  const definition: Adapter = {
    metadata: { type: "contract", agentSources: ["provisioned"] },
    async *invoke() {
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  };

  // @ts-expect-error 直接注册的元数据必须声明协议支持。
  const missing: HostedAdapterMetadata = { type: "missing", agentSources: ["provisioned"] };
  // @ts-expect-error 未规范化的编写输入不能直接注册。
  executor.register(definition);
  // @ts-expect-error worker 与 Core 的注册要求一致。
  serveWorker([definition]);

  const adapter = defineAdapter(definition);
  const support: AdapterProtocolSupport = adapter.metadata.protocolSupport;
  const hosted: HostedAdapter = adapter;
  executor.register(adapter);
  serveWorker([adapter]);

  const undefinedSupport = defineAdapter({
    ...definition,
    metadata: { ...definition.metadata, protocolSupport: undefined }
  });
  const defaultSupport: AdapterProtocolSupport = undefinedSupport.metadata.protocolSupport;
  executor.register(undefinedSupport);

  const extended = defineAdapter({
    ...definition,
    metadata: { ...definition.metadata, implementation: "custom" as const },
    extension: "retained" as const,
    customMethod: () => 42 as const
  });
  const implementation: "custom" = extended.metadata.implementation;
  const extension: "retained" = extended.extension;
  const answer: 42 = extended.customMethod();
  executor.register(extended);

  const explicit = defineAdapter({
    ...definition,
    metadata: {
      ...definition.metadata,
      protocolSupport: {
        protocol: "contract.native" as const,
        modes: ["native", "canonical"],
        nativeMethods: []
      } satisfies AdapterProtocolSupport
    }
  });
  const protocol: AdapterProtocolSupport = explicit.metadata.protocolSupport;
  executor.register(explicit);

  const cli = createJsonCliAdapter({
    metadata: definition.metadata,
    buildCommand: () => ({ command: process.execPath }),
    normalize: () => []
  });
  const cliSupport: AdapterProtocolSupport = cli.metadata.protocolSupport;
  executor.register(cli);
  serveWorker([cli]);
  void [
    missing,
    support,
    hosted,
    defaultSupport,
    implementation,
    extension,
    answer,
    protocol,
    cliSupport
  ];
}
