import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  normalizedHome,
  homeHash,
  componentEndpoint,
  componentServiceId
} from "@mininglamp-oss/octo-runtime-host-sdk";
test("endpoints and service identities isolate both Home and component on POSIX and Windows", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const home = platform === "win32" ? "C:\\Users\\tester\\runtime" : "/tmp/runtime";
    assert.notEqual(
      componentEndpoint(home, "executor-kernel", platform),
      componentEndpoint(home, "channel-gateway", platform)
    );
    assert.notEqual(
      componentServiceId(home, "executor-kernel", platform),
      componentServiceId(home + "-other", "executor-kernel", platform)
    );
    assert.notEqual(
      componentServiceId(home, "executor-kernel", platform),
      componentServiceId(home, "channel-gateway", platform)
    );
    if (platform === "win32")
      assert.equal(
        componentEndpoint(home, "executor-kernel", platform),
        componentEndpoint(home.toUpperCase(), "executor-kernel", platform)
      );
    else
      assert.equal(
        componentEndpoint(home, "executor-kernel", platform),
        "/tmp/runtime/sockets/octo-runtime-executor-kernel.sock"
      );
  }
});

for (const platform of ["darwin", "linux"]) {
  test(`${platform} derivation uses POSIX semantics independently of the host`, () => {
    const home = "/tmp/runtime";
    assert.equal(normalizedHome("/tmp/base/../runtime", platform), home);
    assert.equal(homeHash(home, platform), "b7751491b5d75faf");
    assert.equal(
      componentEndpoint(home, "executor-kernel", platform),
      "/tmp/runtime/sockets/octo-runtime-executor-kernel.sock"
    );
    assert.equal(
      componentServiceId(home, "executor-kernel", platform),
      "cn.mininglamp.octo-runtime.hb7751491b5d75faf.executor-kernel"
    );
    // POSIX 大小写和字面反斜杠不可被宿主 Windows 语义合并或转换。
    for (const derive of [normalizedHome, homeHash])
      assert.notEqual(derive(home, platform), derive("/tmp/Runtime", platform));
    for (const derive of [componentEndpoint, componentServiceId])
      assert.notEqual(
        derive(home, "executor-kernel", platform),
        derive("/tmp/Runtime", "executor-kernel", platform)
      );
    assert.equal(normalizedHome("/tmp/runtime\\literal", platform), "/tmp/runtime\\literal");
    assert.equal(
      componentEndpoint("/tmp/runtime\\literal", "executor-kernel", platform),
      "/tmp/runtime\\literal/sockets/octo-runtime-executor-kernel.sock"
    );
  });
}

test("Windows derivation retains normalization and existing pipe and service names", () => {
  const home = "C:\\Users\\tester\\runtime";
  for (const input of [home, home.toUpperCase(), `${home}\\..\\runtime`]) {
    assert.equal(normalizedHome(input, "win32"), "c:\\users\\tester\\runtime");
    assert.equal(homeHash(input, "win32"), "d36734f1d02ec17f");
    assert.equal(
      componentEndpoint(input, "executor-kernel", "win32"),
      "\\\\.\\pipe\\octo-runtime-kernel-d36734f1d02ec17f"
    );
    assert.equal(
      componentServiceId(input, "executor-kernel", "win32"),
      "cn.mininglamp.octo-runtime.hd36734f1d02ec17f.executor-kernel"
    );
  }
  assert.equal(
    componentEndpoint(home, "channel-gateway", "win32"),
    "\\\\.\\pipe\\octo-runtime-channel-gateway-d36734f1d02ec17f"
  );
});

test("omitted platform and component retain their native defaults", () => {
  const home = resolve("runtime-endpoint-fixture");
  assert.equal(normalizedHome(home), normalizedHome(home, process.platform));
  assert.equal(homeHash(home), homeHash(home, process.platform));
  assert.equal(
    componentEndpoint(home),
    componentEndpoint(home, "executor-kernel", process.platform)
  );
  assert.equal(
    componentServiceId(home, "executor-kernel"),
    componentServiceId(home, "executor-kernel", process.platform)
  );
});

test("endpoint and service derivation retain component validation and Home isolation", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const home = platform === "win32" ? "C:\\Users\\tester\\runtime" : "/tmp/runtime";
    for (const derive of [componentEndpoint, componentServiceId]) {
      assert.notEqual(
        derive(home, "executor-kernel", platform),
        derive(`${home}-other`, "executor-kernel", platform)
      );
      for (const component of ["", "../kernel", "Kernel", "a".repeat(71)])
        assert.throws(() => derive(home, component, platform), /COMPONENT_INVALID/);
      for (const component of ["a", "a".repeat(70)])
        assert.doesNotThrow(() => derive(home, component, platform));
    }
  }
});
