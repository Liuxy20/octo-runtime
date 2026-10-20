process.send({ type: "component.failed", error: "FIXTURE_START_FAILED" });
process.send({ type: "component.stopped", complete: true }, () => {
  process.disconnect();
});
