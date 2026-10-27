/** Dedicated log thread: reuse hourly retention, capacity limits and cross-process exclusion. */
import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { HourlyLogWriter } from "./hourly-log.js";
import type { RuntimeLoggingOptions } from "./runtime-log.js";

const directory = (workerData as RuntimeLoggingOptions).directory;
const writers = new Map<string, HourlyLogWriter>();
parentPort!.on(
  "message",
  (message: "close" | { extra?: string; status?: boolean; line: string }) => {
    if (message === "close") {
      for (const writer of writers.values()) writer.close();
      parentPort!.postMessage("closed");
      parentPort!.close();
      return;
    }
    try {
      const category = message.extra
        ? `${message.extra}${message.status ? "-status" : ""}`
        : `kernel${message.status ? "-status" : ""}`;
      const key = message.extra ? `extra:${category}` : category;
      let writer = writers.get(key);
      if (!writer && writers.size < 128) {
        writer = new HourlyLogWriter(
          message.extra ? join(directory, "extras") : directory,
          category,
          { onError: () => {} }
        );
        writers.set(key, writer);
      }
      writer?.write(message.line);
    } catch {
      /* Dropping a diagnostic must never affect execution. */
    }
    parentPort!.postMessage({ written: message.status === true });
  }
);
