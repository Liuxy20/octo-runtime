import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  createKernelService,
  createExtraService,
  componentEndpoint,
  RuntimeHomeError,
  ServiceInitializationError,
  type KernelServiceOptions,
  type ExtraServiceOptions
} from "@mininglamp-oss/octo-runtime/host";

const home = resolve("prepared-home");
await mkdir(home);
const endpoint = componentEndpoint(home);
// 包外严格类型专项，故意缺失 Home；不初始化无效的类型样例。
// @ts-expect-error Kernel requires an explicit host Home
const missingKernelHome: KernelServiceOptions = { endpoint, adapters: [] };
// @ts-expect-error Extra requires an explicit host Home
const missingExtraHome: ExtraServiceOptions = {
  endpoint,
  module: { name: "type-only", default: () => () => {} },
  config: {},
  dependencies: {}
};
void [missingKernelHome, missingExtraHome];

const missing = resolve("missing-home");
const plugin = { name: "package-home-test", default: () => () => {} };
for (const service of [
  createKernelService({ home: missing, endpoint, adapters: [] }),
  createExtraService({ home: missing, endpoint, module: plugin, config: {}, dependencies: {} })
]) {
  await assert.rejects(service.initialize(), (error: unknown) => {
    assert.ok(error instanceof ServiceInitializationError);
    assert.ok(error.cause instanceof RuntimeHomeError);
    assert.equal(error.cause.code, "HOME_NOT_FOUND");
    assert.equal(error.cause.diagnostic.path, missing);
    assert.equal(error.cleanup.complete, true);
    return true;
  });
  assert.equal((await service.close()).complete, true);
}
await assert.rejects(access(missing), { code: "ENOENT" });

const kernel = createKernelService({
  home,
  endpoint,
  adapters: [],
  stateDirectory: join(home, "run")
});
const extra = createExtraService({ home, endpoint, module: plugin, config: {}, dependencies: {} });
try {
  await kernel.initialize();
  await extra.initialize();
  assert.equal((await kernel.client.status()).pid, process.pid);
  assert.equal((await extra.status()).kernel_available, true);
} finally {
  assert.equal((await extra.close()).complete, true);
  assert.equal((await kernel.close()).complete, true);
}
console.log(
  JSON.stringify({
    node: process.version,
    public_home_errors: 2,
    native_kernel: true,
    native_extra: true,
    cleanup: "complete"
  })
);
