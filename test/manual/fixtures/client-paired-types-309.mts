import type { KernelClient as Standalone } from "@mininglamp-oss/octo-runtime-client";
import type { KernelClient as Full } from "@mininglamp-oss/octo-runtime/executor-kernel";
import type {
  InvokeInput as ClientInput,
  HostFrame as ClientFrame
} from "@mininglamp-oss/octo-runtime-client/protocol";
import type {
  InvokeInput as FullInput,
  HostFrame as FullFrame
} from "@mininglamp-oss/octo-runtime/protocol";

// 结构化 API 与 wire 数据跨发行物兼容；类和 WeakSet 身份仅在各发行物内共享。
export const fullToClient = (value: Full): Standalone => value;
export const clientToFull = (value: Standalone): Full => value;
export const fullInput = (value: ClientInput): FullInput => value;
export const clientInput = (value: FullInput): ClientInput => value;
export const fullFrame = (value: ClientFrame): FullFrame => value;
export const clientFrame = (value: FullFrame): ClientFrame => value;
