import { appendFile } from "node:fs/promises";
import { testAdapter as adapter } from "./invoke-adapter.js";

// Count actual Provider admissions independently from client ACKs, cards and connection status.
export const testAdapter = {
  ...adapter,
  async *invoke(request, context) {
    await appendFile(process.env.OCTO_RECOVERY_STARTS_FILE, `${request.invocationId}\n`);
    yield* adapter.invoke(request, context);
  }
};
