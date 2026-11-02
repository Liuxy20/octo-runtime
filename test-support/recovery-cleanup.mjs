import { withTimeout } from "../test/runtime-fixture.js";
import { inspect } from "node:util";
import { performance } from "node:perf_hooks";

/** 登记所属子进程的退出与错误；信号错误不结束退出等待，启动失败保留原 errno。 */
export function trackRecoveryChild(child, component) {
  const entry = {
    child,
    component,
    output: "",
    errors: "",
    exitObserved: false,
    closeObserved: false,
    processErrors: []
  };
  entry.exited = new Promise((resolve) => {
    child.once("exit", () => {
      entry.exitObserved = true;
    });
    child.once("close", () => {
      entry.closeObserved = true;
      resolve();
    });
    child.on("error", (error) => {
      entry.processErrors.push(error);
      if (child.pid == null) resolve();
    });
  });
  return entry;
}

/** 逐项清理测试拥有的资源。错误延后汇总，发出信号不等于已确认退出。 */
export async function cleanupRecovery({
  client,
  services = [],
  children = [],
  gracefulMs = 7000,
  forceMs = 3000,
  onEvent = () => {}
}) {
  const errors = [];
  let complete = true;
  const emit = (event) => {
    try {
      onEvent(event);
    } catch (cause) {
      errors.push(new Error("recovery cleanup observer failed", { cause }));
    }
  };
  const attempt = async (component, stage, operation, pid, timing = {}) => {
    emit({ component, stage, pid, event: "attempt", ...timing });
    try {
      const result = await operation();
      if (result?.complete === false) {
        complete = false;
        throw new Error("FIXTURE_SERVICE_CLEANUP_INCOMPLETE", { cause: result });
      }
      emit({ component, stage, pid, event: "done" });
    } catch (cause) {
      if (stage === "close") complete = false;
      errors.push(new Error(`${component} ${stage} (pid=${pid ?? "none"})`, { cause }));
      emit({ component, stage, pid, event: "error", message: cause?.message ?? String(cause) });
    }
  };
  if (client) await attempt("client", "close", () => client.close());
  for (const { component, close } of services) await attempt(component, "close", close);
  for (const entry of [...children].reverse()) {
    const { child, component, exited } = entry;
    const running = () => child.pid != null && child.exitCode === null && child.signalCode === null;
    const signal = (name) => {
      if (!child.kill(name)) throw new Error(`FIXTURE_SIGNAL_FAILED: ${name}`);
    };
    const gracefulStartedAt = performance.now();
    const gracefulUntil = gracefulStartedAt + gracefulMs;
    if (running())
      await attempt(
        component,
        entry.requestClose ? "native-close" : "SIGTERM",
        () =>
          entry.requestClose
            ? withTimeout(
                Promise.resolve().then(() => entry.requestClose()),
                gracefulMs,
                "FIXTURE_CLOSE_REQUEST_TIMEOUT"
              )
            : signal("SIGTERM"),
        child.pid,
        { gracefulStartedAt, gracefulUntil }
      );
    await attempt(
      component,
      "graceful-exit",
      () =>
        withTimeout(
          exited,
          Math.max(0, gracefulUntil - performance.now()),
          "FIXTURE_SHUTDOWN_TIMEOUT"
        ),
      child.pid
    );
    if (running()) {
      await attempt(component, "SIGKILL", () => signal("SIGKILL"), child.pid);
      // 即使信号失败，也单独有限等待退出；不能卡住后续 Kernel 清理。
      await attempt(
        component,
        "forced-exit",
        () => withTimeout(exited, forceMs, "FIXTURE_FORCE_SHUTDOWN_TIMEOUT"),
        child.pid
      );
    }
    if (child.pid != null && (!entry.exitObserved || !entry.closeObserved)) {
      complete = false;
      errors.push(new Error(`${component} cleanup incomplete (pid=${child.pid})`));
    }
    emit({
      component,
      stage: "exit-result",
      event: "observed",
      pid: child.pid,
      exitObserved: entry.exitObserved,
      closeObserved: entry.closeObserved,
      exitCode: child.exitCode,
      signalCode: child.signalCode
    });
    for (const error of entry.processErrors)
      await attempt(
        component,
        "process-error",
        () => {
          throw error;
        },
        child.pid
      );
  }
  return { errors, complete };
}

/** 保留主体失败对象；仅有清理失败或两者同时失败时聚合，诊断逐项展示原始 cause。 */
export function finishRecovery(failure, cleanup, diagnostic = () => {}) {
  if (!cleanup.errors.length) {
    if (failure.failed) throw failure.error;
    return;
  }
  const errors = failure.failed ? [failure.error, ...cleanup.errors] : cleanup.errors;
  const describe = (error) => {
    if (!(error instanceof Error)) return inspect(error, { depth: 5 });
    return `${error.stack ?? error.message}${error.cause === undefined ? "" : `\nCaused by: ${describe(error.cause)}`}`;
  };
  for (const error of errors) diagnostic(describe(error));
  throw new AggregateError(
    errors,
    "Recovery test cleanup failed",
    failure.failed ? { cause: failure.error } : undefined
  );
}
