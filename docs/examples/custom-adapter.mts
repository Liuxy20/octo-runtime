import { AgentExecutor, type HostedAdapter } from "@mininglamp-oss/octo-runtime/executor-core";
import type { InvokeRequest, CanonicalEvent } from "@mininglamp-oss/octo-runtime/protocol";

interface XxxClient {
  execute(request: InvokeRequest, tenant: string): AsyncIterable<CanonicalEvent>;
}
const metadata = {
  type: "black-box",
  agentSources: ["provisioned"] as ["provisioned"],
  protocolSupport: {
    protocol: "business.canonical",
    modes: ["canonical"] as ["canonical"],
    nativeMethods: []
  }
};

/** client/连接生命周期归业务；构造参数不限于 client，也不要求 options 对象。 */
class BlackBoxAdapter implements HostedAdapter {
  readonly metadata = metadata;
  constructor(
    private client: XxxClient,
    private tenant: string,
    private observe: () => void
  ) {}
  invoke(request: InvokeRequest) {
    this.observe();
    return this.client.execute(request, this.tenant);
  }
}

export function assemble(client: XxxClient, tenant: string, observe: () => void) {
  const core = new AgentExecutor();
  core.register(new BlackBoxAdapter(client, tenant, observe));
  return core;
}

/** 同样可以直接组装闭包对象；Core 不解释构造参数。 */
export function assembleClosure(client: XxxClient, tenant: string) {
  const core = new AgentExecutor();
  core.register({ metadata, invoke: (request) => client.execute(request, tenant) });
  return core;
}
