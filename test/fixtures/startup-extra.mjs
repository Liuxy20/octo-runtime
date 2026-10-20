import { appendFile } from "node:fs/promises";

export const name = "startup-extra";
export default function (context, config) {
  context.onDispose(async () => {
    await appendFile(config.trace, "dispose\n");
    if (config.failDispose) throw new Error("private-disposal-error");
  });
  return async () => {
    await appendFile(config.trace, "initialize\n");
    if (config.failStart) throw new Error("private-startup-error");
  };
}
