import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { spawnJsonLines } from "../../packages/octo-runtime-adapter-sdk/dist/index.js";

const nativeSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = nativeSpawn(...args);
  const pipe = args[2]?.env?.OCTO_FIXTURE_PIPE_FAULT;
  if (pipe)
    child.once("spawn", () =>
      setImmediate(() => {
        child[pipe].emit(
          "error",
          Object.assign(new Error("fixture read ENOTCONN"), { code: "ENOTCONN" })
        );
      })
    );
  return child;
};
syncBuiltinESMExports();

export const testAdapter = {
  metadata: {
    type: "test",
    agentSources: ["provisioned"],
    protocolSupport: {
      protocol: "test.pipes",
      modes: ["canonical"],
      nativeMethods: []
    }
  },
  buildCommand(request) {
    const mode = request.prompt;
    const gate = request.runMetadata?.gate;
    return {
      command: mode === "missing" ? `octo-missing-${process.pid}` : process.execPath,
      args: [
        "-e",
        mode === "sibling"
          ? `const fs=require('node:fs');console.log(JSON.stringify({ready:true}));const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(t);console.log(JSON.stringify({done:true}));}},20)`
          : "console.log(JSON.stringify({done:true}));setInterval(()=>{},1000)"
      ],
      env: { OCTO_FIXTURE_PIPE_FAULT: ["stdout", "stderr"].includes(mode) ? mode : undefined }
    };
  },
  async *invoke(request) {
    let close;
    try {
      for await (const value of spawnJsonLines({
        ...this.buildCommand(request),
        cwd: request.workdir,
        signal: request.signal,
        parseLine: JSON.parse,
        onSpawn: (cleanup) => {
          close = cleanup;
        }
      })) {
        if (value.ready)
          yield { protocolVersion: 2, type: "message.delta", payload: { text: "ready" } };
        if (value.done) break;
      }
    } catch (error) {
      // Fixture 按 Adapter 合同确认清理后产出失败终态；清理失败继续抛错，不能伪装成功。
      await close?.();
      yield {
        protocolVersion: 2,
        type: "run.failed",
        payload: { message: error.message, code: error.code }
      };
      return;
    }
    yield { protocolVersion: 2, type: "run.completed", payload: { result: "done" } };
  }
};
