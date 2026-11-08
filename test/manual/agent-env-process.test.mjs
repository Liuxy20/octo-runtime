// 显式本地专项：公开四参数通过真实 Kernel/子进程传递 envs，不扩大默认 CI。
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { invocationEnvironment } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
import { kernelFixture, kernelInput } from "../kernel-fixture.js";
import { testAdapter } from "../fixtures/invoke-adapter.js";

test("flat invoke envs reach a child without leaking into inputs or mutating the host", async (t) => {
  const key = "OCTO_AGENT_ENV_PROBE";
  const before = process.env[key];
  const adapter = {
    ...testAdapter,
    async *invoke(request) {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["-e", `process.stdout.write(JSON.stringify(process.env.${key}))`],
        { env: invocationEnvironment(request) }
      );
      yield {
        kind: "native",
        messageKind: "notification",
        payload: {
          value: JSON.parse(stdout),
          parts: request.modelInputParts
        }
      };
      yield { kind: "control", control: { type: "state", state: "completed" } };
    }
  };
  const { client } = await kernelFixture(t, { adapters: [adapter] });
  const values = [randomUUID(), randomUUID()];
  await Promise.all(
    values.map(async (value) => {
      const input = kernelInput("business material");
      input.agentEnv.items.push({
        namespace: "octo.execution",
        name: "envs",
        payload: {
          env_variables: [{ key, value }]
        }
      });
      const events = await Array.fromAsync(
        client.invoke(input.inputs, undefined, undefined, input.agentEnv)
      );
      const output = events.find((event) => event.kind === "native").payload;
      assert.equal(output.value, value);
      assert.deepEqual(output.parts, input.inputs);
      assert.equal(JSON.stringify(output.parts).includes(value), false);
      assert.equal(events.at(-1).control.state, "completed");
    })
  );
  assert.equal(process.env[key], before);
});

test("flat invoke rejects old executionEnvOverrides carriers before submission", async (t) => {
  const { client } = await kernelFixture(t);
  const { inputs, agentEnv } = kernelInput();
  const executionEnvOverrides = { env_variables: [] };
  assert.throws(() =>
    client.invoke({ parts: inputs, executionEnvOverrides }, undefined, undefined, agentEnv)
  );
  assert.throws(() =>
    client.invoke(inputs, undefined, undefined, { ...agentEnv, executionEnvOverrides })
  );
  assert.throws(
    () => client.invoke({ inputs, agentEnv }, { executionEnvOverrides }),
    /requires inputs/
  );
  assert.deepEqual(client.invocations.snapshot(), []);
});
