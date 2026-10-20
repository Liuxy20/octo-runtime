import { pathToFileURL } from "node:url";
const diagnosticLimit = 4_000;

function boundedDiagnostic(value) {
  const text = String(value ?? "").trim();
  return text.length <= diagnosticLimit ? text : text.slice(-diagnosticLimit);
}

export function commandDiagnostic(error) {
  if (!error || typeof error !== "object") return boundedDiagnostic(error);
  const details = [
    error instanceof Error ? error.message : String(error),
    "stderr" in error && error.stderr ? `stderr: ${error.stderr}` : "",
    "stdout" in error && error.stdout ? `stdout: ${error.stdout}` : ""
  ].filter(Boolean);
  return boundedDiagnostic(details.join("\n"));
}

function readinessFailure(reason, lastStatusError, componentErrors) {
  const details = [
    reason,
    lastStatusError ? `last status error:\n${commandDiagnostic(lastStatusError)}` : "",
    componentErrors ? `component stderr:\n${boundedDiagnostic(componentErrors)}` : ""
  ].filter(Boolean);
  return new Error(details.join("\n"));
}

export async function waitForComponentReady({
  queryStatus,
  componentExited,
  componentStopped,
  componentErrors = () => "",
  timeoutMs = 60_000,
  pollIntervalMs = 250,
  now = Date.now,
  delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}) {
  const deadline = now() + timeoutMs;
  let lastStatusError;
  while (now() < deadline) {
    if (componentExited()) {
      throw readinessFailure(
        "component exited before reporting ready",
        lastStatusError,
        componentErrors()
      );
    }
    const statusAbort = new AbortController();
    const status = Promise.resolve()
      .then(() => queryStatus(deadline - now(), statusAbort.signal))
      .then(
        (ready) => ({ type: "status", ready }),
        (error) => ({ type: "status_error", error })
      );
    const result = componentStopped
      ? await Promise.race([status, componentStopped.then(() => ({ type: "component_exit" }))])
      : await status;
    if (result.type === "component_exit") {
      statusAbort.abort();
      await status;
      throw readinessFailure(
        "component exited before reporting ready",
        lastStatusError,
        componentErrors()
      );
    }
    if (result.type === "status" && result.ready) return;
    if (result.type === "status_error") lastStatusError = result.error;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await delay(Math.min(pollIntervalMs, remaining));
  }
  throw readinessFailure("component readiness timed out", lastStatusError, componentErrors());
}

export async function verifyWindowsRelease(archiveInput, expectedCommit) {
  if (process.platform !== "win32") throw new Error("This verification requires Windows");
  if (!/^[a-f0-9]{40,64}$/.test(expectedCommit ?? ""))
    throw new Error("Expected a full commit SHA");
  const { verifyRelease } = await import("./verify-release.mjs");
  await verifyRelease(archiveInput, { expectedCommit, requireClean: true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyWindowsRelease(process.argv[2], process.argv[3]);
}
