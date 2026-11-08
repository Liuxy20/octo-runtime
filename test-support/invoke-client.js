/** 回归测试共同的应用调用路径：将 CLI wire 拆为平铺参数，以 interrupt 代替旧 signal 参数。 */
export function invokeClient(client, input, environment = {}) {
  const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
  const run = client.invoke({ ...content, parts }, sessionId, providerSession, agentEnv);
  const interrupt = () => {
    void client.interrupt(run.invocationId, "caller_aborted").catch(() => undefined);
  };
  environment.signal?.addEventListener("abort", interrupt, { once: true });
  if (environment.signal?.aborted) interrupt();
  const next = run.next.bind(run),
    finish = run.return.bind(run),
    fail = run.throw.bind(run);
  const cleanup = () => environment.signal?.removeEventListener("abort", interrupt);
  run.next = async (...args) => {
    try {
      const value = await next(...args);
      if (value.done) cleanup();
      return value;
    } catch (error) {
      cleanup();
      throw error;
    }
  };
  run.return = async (...args) => {
    try {
      return await finish(...args);
    } finally {
      cleanup();
    }
  };
  run.throw = async (...args) => {
    try {
      return await fail(...args);
    } finally {
      cleanup();
    }
  };
  return run;
}
