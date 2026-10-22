import type { Writable } from "node:stream";
import {
  extraStatusRecord,
  type ExtraStatusRecord
} from "@mininglamp-oss/octo-runtime-adapter-sdk";

/** Bound stdout buffering without blocking Extras; report dropped records when the pipe drains. */
export class StatusOutput {
  #queue: string[] = [];
  #bytes = 0;
  #blocked = false;
  #closed = false;
  #dropped = 0;
  #extra = "extra";
  constructor(private readonly output: Writable) {
    output.on("error", this.close);
  }
  readonly write = (record: ExtraStatusRecord): void => {
    if (this.#closed) return;
    this.#extra = record.extra_type;
    const line = `${JSON.stringify(record)}\n`;
    if (this.#queue.length >= 128 || this.#bytes + Buffer.byteLength(line) > 1024 * 1024) {
      this.#dropped = Math.min(Number.MAX_SAFE_INTEGER, this.#dropped + 1);
      return;
    }
    this.#queue.push(line);
    this.#bytes += Buffer.byteLength(line);
    this.#flush();
  };
  readonly #drain = (): void => {
    this.#blocked = false;
    this.#flush();
  };
  #flush(): void {
    if (this.#closed || this.#blocked) return;
    while (this.#queue.length) {
      const line = this.#queue.shift()!;
      this.#bytes -= Buffer.byteLength(line);
      try {
        if (!this.output.write(line)) {
          this.#blocked = true;
          this.output.once("drain", this.#drain);
          return;
        }
      } catch {
        this.close();
        return;
      }
    }
    if (this.#dropped) {
      const record = extraStatusRecord(this.#extra, "warn", "service.output_dropped", {
        dropped_count: this.#dropped
      })!;
      this.#dropped = 0;
      this.write(record);
    }
  }
  readonly close = (): void => {
    this.#closed = true;
    this.#queue = [];
    this.#bytes = 0;
    this.output.off("drain", this.#drain);
    this.output.off("error", this.close);
  };
}
