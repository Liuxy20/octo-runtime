import test from "node:test";
import assert from "node:assert/strict";
import { WorkerHeartbeat } from "../packages/octo-runtime-executor-kernel/dist/heartbeat.js";

test("an early timer tick keeps the fixed deadline and the next tick observes expiry", () => {
  let now = 0;
  const health = new WorkerHeartbeat(
    () => now,
    () => now
  );
  assert.equal(health.tick().type, "ping");
  for (now = 999.9; now < 5000; now += 1000) {
    assert.equal(health.tick().type, "waiting");
  }
  assert.equal(health.tick().type, "expired");
});

for (const gap of ["wall", "monotonic", "both", "rollback"]) {
  test(`scheduler ${gap} gap starts a fresh bounded probe and fences old pongs`, () => {
    let wall = 10000,
      mono = 10000;
    const health = new WorkerHeartbeat(
      () => wall,
      () => mono
    );
    const old = health.tick();
    if (gap === "wall" || gap === "both") wall += 3_600_000;
    if (gap === "monotonic" || gap === "both") mono += 3_600_000;
    if (gap === "rollback") wall -= 5000;
    health.pong(old.id);
    const fresh = health.tick();
    assert.equal(fresh.type, "ping");
    assert.notEqual(fresh.id, old.id);
    assert.equal(health.activeMs, 0);
    health.pong(old.id);
    for (let i = 0; i < 4; i++) {
      wall += 1000;
      mono += 1000;
      assert.equal(health.tick().type, "waiting");
    }
    wall += 1000;
    mono += 1000;
    assert.equal(health.tick().type, "expired");
    health.pong(fresh.id);
    assert.equal(health.tick().type, "expired");
  });
}

test("matching fresh pong preserves health and counts only observed active intervals", () => {
  let now = 0;
  const health = new WorkerHeartbeat(
    () => now,
    () => now
  );
  for (let i = 0; i < 61; i++) {
    const probe = health.tick();
    assert.equal(probe.type, "ping");
    health.pong(probe.id);
    now += 1000;
  }
  assert.equal(health.healthyMs, 60000);
  now += 3_600_000;
  assert.equal(health.tick().type, "ping");
  assert.equal(health.healthyMs, 0);
  assert.equal(health.activeMs, 60000);
});
