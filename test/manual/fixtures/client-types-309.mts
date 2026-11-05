import {
  attachKernel,
  type KernelClient,
  type HostedAdapterMetadata
} from "@mininglamp-oss/octo-runtime-client";
import {
  assertInvokeInput,
  type InvokeInput,
  type HostFrame,
  type CanonicalEvent
} from "@mininglamp-oss/octo-runtime-client/protocol";
import schema from "@mininglamp-oss/octo-runtime-client/protocol/schema.json" with { type: "json" };

// 宿主传入已有服务地址；完整消费执行后关闭，业务取消由调用方显式管理。
export async function consume(endpoint: string, value: unknown): Promise<HostedAdapterMetadata[]> {
  assertInvokeInput(value);
  const input: InvokeInput = value;
  const client: KernelClient = attachKernel({ endpoint });
  try {
    const native: AsyncGenerator<HostFrame> = client.invoke({ ...input, protocol_mode: "native" });
    await native.return(undefined);
    const canonical: AsyncGenerator<CanonicalEvent> = client.invoke({
      ...input,
      protocol_mode: "canonical"
    });
    await canonical.return(undefined);
    void schema;
    return await client.list();
  } finally {
    client.close();
  }
}
