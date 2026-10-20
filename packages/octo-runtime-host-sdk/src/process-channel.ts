import type { ChildProcess } from "node:child_process";
import type { DependencyChannel } from "./dependencies.js";

/** Node IPC 的发送队列有界，超额即失败；禁止把凭据或业务函数放进 argv。 */
export function processChannel(target: ChildProcess | NodeJS.Process): DependencyChannel {
  let pending = 0;
  let bytes = 0;
  return {
    send(message) {
      const size = Buffer.byteLength(JSON.stringify(message));
      if (pending >= 64 || bytes + size > 2 * 1024 * 1024 || !target.connected)
        throw new Error("DEPENDENCY_DISCONNECTED");
      pending++;
      bytes += size;
      const send = target.send?.bind(target) as
        ((message: object, callback: (error: Error | null) => void) => boolean) | undefined;
      send?.call(target, message, (error) => {
        pending--;
        bytes -= size;
        if (error && target.connected) target.disconnect?.();
      });
    },
    on(listener) {
      target.on("message", listener);
      return () => {
        target.off("message", listener);
      };
    }
  };
}
