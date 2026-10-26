import {
  assertContextEnvs,
  contextItem,
  type InvokeRequest
} from "@mininglamp-oss/octo-runtime-protocol";

/** Read only the frozen execution context; never expose its values as model input. */
export function invocationEnvs(request: InvokeRequest): Record<string, string> {
  const envs = contextItem(request.context, "octo.execution", "envs")?.payload ?? {
    env_variables: []
  };
  assertContextEnvs(envs);
  const overrides = request.executionEnvOverrides ?? { env_variables: [] };
  assertContextEnvs(overrides);
  return mergeProcessEnvironment(
    Object.fromEntries(envs.env_variables.map(({ key, value }) => [key, value])),
    Object.fromEntries(overrides.env_variables.map(({ key, value }) => [key, value]))
  );
}

/** Each invocation owns its environment. Adapter transport settings take precedence. */
export function invocationEnvironment(
  request: InvokeRequest,
  overrides: NodeJS.ProcessEnv = {},
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return mergeProcessEnvironment(inherited, invocationEnvs(request), overrides);
}

/** 每层后写覆盖前层；Windows 环境键不区分大小写，保留最终拼写且不修改输入对象。 */
export function mergeProcessEnvironment<T>(...layers: Record<string, T>[]): Record<string, T> {
  const entries = new Map<string, [string, T]>();
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      entries.set(process.platform === "win32" ? key.toUpperCase() : key, [key, value]);
    }
  }
  return Object.fromEntries(entries.values());
}

/** 读取实际进程环境时沿用平台键身份；只读自有属性，Windows 后写别名优先。 */
export function processEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (process.platform !== "win32") return Object.hasOwn(env, name) ? env[name] : undefined;
  const identity = name.toUpperCase();
  let value: string | undefined;
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === identity) value = env[key];
  }
  return value;
}
