import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  extraStatusRecord,
  type ExtraStatusRecord
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

const MAX_READ = 4 * 1024 * 1024;
const MAX_LINE = 4096;
interface Cursor {
  offset: number;
  identity: string;
  pending: string;
  skipping: boolean;
}
function record(line: string, extra: string): ExtraStatusRecord | undefined {
  if (Buffer.byteLength(line) > MAX_LINE) return;
  try {
    const value = JSON.parse(line) as ExtraStatusRecord;
    if (value.source !== "extra" || value.extra_type !== extra || typeof value.time !== "string")
      return;
    return extraStatusRecord(extra, value.level, value.event, value.data, value.time);
  } catch {
    return;
  }
}
async function files(home: string, extra: string): Promise<string[]> {
  const directory = join(home, "logs", "extras");
  for (const path of [join(home, "logs"), directory]) {
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("LOG_DIRECTORY_NOT_REGULAR");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  const pattern = new RegExp(`^${extra}-status-\\d{8}T\\d{2}\\.log$`);
  // Keep only three candidates while scanning, without loading an unbounded directory listing.
  const selected: string[] = [];
  let count = 0;
  for await (const entry of await opendir(directory)) {
    if (++count > 10000) throw new Error("LOG_SCAN_LIMIT");
    if (!pattern.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
    selected.push(join(directory, entry.name));
    selected.sort();
    if (selected.length > 3) selected.shift();
  }
  return selected;
}
async function read(path: string, start: number | undefined, maximum: number) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("LOG_NOT_REGULAR_FILE");
    const offset =
      start === undefined ? Math.max(0, stat.size - maximum) : Math.min(start, stat.size);
    const buffer = Buffer.alloc(Math.min(maximum, stat.size - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      offset,
      end: offset + bytesRead,
      identity: `${stat.dev}:${stat.ino}`,
      size: stat.size
    };
  } finally {
    await handle.close();
  }
}

export async function showExtraLogs(options: {
  home: string;
  extra: string;
  lines: number;
  follow: boolean;
  json: boolean;
  output: (line: string, signal?: AbortSignal) => void | Promise<void>;
  errorOutput: (line: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(options.extra) ||
    !Number.isInteger(options.lines) ||
    options.lines < 1 ||
    options.lines > 10000
  )
    throw new Error("INVALID_ARGUMENTS");
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (options.follow) {
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
  }
  const cursors = new Map<string, Cursor>();
  const emit = async (value: ExtraStatusRecord) => {
    const text = options.json
      ? JSON.stringify(value)
      : `${value.time} ${value.level.toUpperCase()} ${value.extra_type} ${value.event}${Object.keys(value.data).length ? ` ${JSON.stringify(value.data)}` : ""}`;
    await options.output(text, controller.signal);
  };
  try {
    const selected = await files(options.home, options.extra);
    let remaining = MAX_READ;
    const chunks: ExtraStatusRecord[][] = [];
    // Spend the shared byte budget newest-first, then emit complete records in file order.
    for (const path of [...selected].reverse()) {
      try {
        const value = await read(path, undefined, remaining);
        remaining -= Buffer.byteLength(value.text);
        const lines = value.text.split("\n");
        if (value.offset > 0) lines.shift();
        const pending = lines.pop() ?? "";
        cursors.set(path, {
          offset: value.end,
          identity: value.identity,
          pending: pending.length <= MAX_LINE ? pending : "",
          skipping: pending.length > MAX_LINE
        });
        chunks.unshift(
          lines
            .map((line) => record(line, options.extra))
            .filter((value): value is ExtraStatusRecord => !!value)
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const tail = chunks.flat().slice(-options.lines);
    for (const value of tail) await emit(value);
    if (!tail.length) options.errorOutput(`${options.extra}: no service status logs`);
    if (!options.follow) return;
    while (!controller.signal.aborted) {
      await delay(500, undefined, { signal: controller.signal });
      const current = await files(options.home, options.extra);
      for (const path of cursors.keys()) if (!current.includes(path)) cursors.delete(path);
      let budget = MAX_READ;
      for (const path of current) {
        if (controller.signal.aborted || budget <= 0) break;
        try {
          // Inode/size changes reset the cursor; preserve partial records across appends.
          let cursor = cursors.get(path);
          let value = await read(path, cursor?.offset ?? 0, budget);
          if (!cursor || cursor.identity !== value.identity || cursor.offset > value.size) {
            cursor = { offset: 0, identity: value.identity, pending: "", skipping: false };
            if (value.offset !== 0) value = await read(path, 0, budget);
          }
          budget -= Buffer.byteLength(value.text);
          const lines = (cursor.pending + value.text).split("\n");
          if (cursor.skipping) {
            if (lines.length === 1) {
              cursors.set(path, { ...cursor, offset: value.end });
              continue;
            }
            lines.shift();
          }
          const pending = lines.pop() ?? "";
          for (const line of lines) {
            const value = record(line, options.extra);
            if (value) await emit(value);
          }
          cursors.set(path, {
            offset: value.end,
            identity: value.identity,
            pending: pending.length <= MAX_LINE ? pending : "",
            skipping: pending.length > MAX_LINE
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    options.signal?.removeEventListener("abort", stop);
  }
}
