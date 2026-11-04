import {
  assertRuntimeLogging,
  type RuntimeLoggingOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import { withStartupContext, type StartupLocation } from "./startup-diagnostics.js";

/** 先验证纯配置再启动资源；各宿主保留原错误类型及调用阶段。 */
export function assertStartupLogging(
  logging: RuntimeLoggingOptions | undefined,
  location: StartupLocation
): void {
  try {
    assertRuntimeLogging(logging);
  } catch (error) {
    throw withStartupContext(error, {
      ...location,
      context: {
        resource: "logging",
        operation: "validate-logging",
        ...(typeof logging?.directory === "string" ? { path: logging.directory } : {})
      }
    });
  }
}
