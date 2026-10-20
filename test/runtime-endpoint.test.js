import test from "node:test";
import assert from "node:assert/strict";
import { componentEndpoint, componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
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
