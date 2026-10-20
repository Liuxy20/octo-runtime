import net from "node:net";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachKernel,
  readAdapterConfigurations
} from "@mininglamp-oss/octo-runtime-executor-kernel";
import {
  componentEndpoint,
  startOwnedKernel,
  startExtra,
  type OwnedExtra,
  type OwnedKernel
} from "@mininglamp-oss/octo-runtime-host-sdk";
import { getExtra, readExtra, setExtra } from "./extras.js";
import { cliVersionInfo, helpText } from "./help.js";
import {
  defaultRuntimeHome,
  runtimePaths,
  withSetupLock,
  readJsonFile,
  type RuntimeHomeConfiguration,
  type ProfileConfiguration
} from "./state.js";
import { resolveServiceControl, type ServiceControlOptions } from "./service-control.js";
import { initializeCliOpenClaw, syncCliOpenClawToolEnvironment } from "./openclaw.js";
import { readExtraDirectory } from "@mininglamp-oss/octo-runtime-host-sdk";

export interface CliDependencies extends ServiceControlOptions {
  env?: NodeJS.ProcessEnv;
  input?: NodeJS.ReadableStream;
  output?: (line: string) => void;
  errorOutput?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}
const components = ["executor-kernel", "channel-gateway"] as const;
type Component = (typeof components)[number];
export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output = dependencies.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  try {
    const { flags, positional } = parse(args);
    if (flags.version || positional[0] === "version") {
      output(cliVersionInfo);
      return 0;
    }
    if (flags.help || !positional.length || positional[0] === "help") {
      output(helpText());
      return 0;
    }
    const home = resolve(flags.home ?? defaultRuntimeHome(dependencies.env, dependencies.platform));
    const root = await readJsonFile<RuntimeHomeConfiguration>(
      runtimePaths(home, "default").rootConfig
    );
    const profile = flags.profile ?? root?.default_profile ?? "default";
    const paths = runtimePaths(home, profile, dependencies.platform);
    const endpoint = componentEndpoint(home, "executor-kernel", dependencies.platform);
    const service = resolveServiceControl(dependencies);
    const input = dependencies.input ?? process.stdin;
    const publish = (value: unknown) =>
      output(typeof value === "string" ? value : JSON.stringify(value));
    if (["extraset", "extraget"].includes(positional[0]) && flags.profile)
      throw new Error("INVALID_ARGUMENTS");
    if (positional[0] === "extraset" && positional.length === 2) {
      publish(await setExtra(paths, positional[1], input));
      return 0;
    }
    if (positional[0] === "extraget" && positional.length === 2) {
      publish(await getExtra(paths, positional[1]));
      (dependencies.errorOutput ?? ((line: string) => process.stderr.write(`${line}\n`)))(
        `Config file: ${join(home, "extras", positional[1], "config.json")}`
      );
      return 0;
    }
    if (positional[0] === "playboard" && positional.length === 1) {
      const { runPlayboard } = await import("./playboard.js");
      return runPlayboard({
        home,
        profile,
        manifest: flags.manifest,
        input,
        output: dependencies.output
      });
    }
    if (positional[0] === "adapter" && positional[1] === "list" && positional.length === 2) {
      const client = attachKernel({ endpoint });
      try {
        publish(await client.list());
      } finally {
        client.close();
      }
      return 0;
    }
    if (positional[0] === "adapter" && positional[1] === "probe" && positional.length === 3) {
      const client = attachKernel({ endpoint });
      try {
        const adapter = (await client.list()).find((value) => value.type === positional[2]);
        if (!adapter) throw new Error("ADAPTER_NOT_FOUND");
        publish(adapter);
      } finally {
        client.close();
      }
      return 0;
    }
    if (positional[0] === "doctor" && positional.length === 1) {
      const manager = await service.backend.probe();
      const checks = await Promise.all(
        components.map(async (component) => ({
          component,
          service: await service.backend.inspect(service.spec(home, component)),
          runtime: await componentStatus(home, component, dependencies.platform).catch(() => ({
            available: false
          }))
        }))
      );
      publish({ manager, checks });
      return 0;
    }
    if (positional[0] === "status" && positional.length === 1) {
      const status = await Promise.all(
        components.map(async (component) => {
          const spec = service.spec(home, component);
          const native = await service.backend.inspect(spec);
          const runtime = await componentStatus(home, component, dependencies.platform).catch(
            () => ({ available: false })
          );
          return [component, { service: native, runtime }];
        })
      );
      publish(Object.fromEntries(status));
      return 0;
    }
    const component = positional[0] as Component,
      action = positional[1];
    if (
      !components.includes(component) ||
      positional.length !== 2 ||
      !["uninstall", "install", "start", "restart", "stop", "run"].includes(action)
    )
      throw new Error("INVALID_ARGUMENTS");
    if (flags.autostart !== undefined && action !== "install") throw new Error("INVALID_ARGUMENTS");
    if (action === "run") {
      await mkdir(home, { recursive: true, mode: 0o700 });
      let handle: OwnedKernel | OwnedExtra;
      if (component === "executor-kernel") {
        await initializeCliOpenClaw(paths.profileRoot, dependencies.env ?? process.env);
        await syncCliOpenClawToolEnvironment(
          paths.profileRoot,
          await readExtraDirectory(join(home, "extras"))
        );
        const config = await readJsonFile<ProfileConfiguration>(paths.profileConfig);
        handle = await startOwnedKernel({
          endpoint,
          stateDirectory: join(home, "run"),
          workerEntrypoint: fileURLToPath(
            import.meta.resolve("@mininglamp-oss/octo-runtime-executor-kernel/runner")
          ),
          manifest: flags.manifest
            ? resolve(flags.manifest)
            : fileURLToPath(new URL("./default_adapters.json", import.meta.url)),
          adapterConfigurations: readAdapterConfigurations(paths.profileRoot, config?.adapters),
          env: {
            ...(dependencies.env ?? process.env),
            OCTO_RUNTIME_HOME: home,
            OCTO_RUNTIME_LOGS_DIRECTORY: join(home, "logs")
          }
        });
      } else {
        handle = await startExtra({
          logging: { directory: join(home, "logs") },
          declaration: await readExtra(paths, component),
          endpoint,
          controlEndpoint: componentEndpoint(home, component, dependencies.platform)
        });
      }
      publish({ component, state: "ready" });
      return new Promise<number>((resolve) => {
        let stopped = false;
        const detach = () => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
        };
        const stop = () => {
          if (stopped) return;
          stopped = true;
          detach();
          void handle.stop().then(
            (result) => resolve(result.complete ? 0 : 5),
            () => resolve(5)
          );
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        void handle.exited
          .then(async () => {
            if (stopped) return;
            stopped = true;
            detach();
            await handle.stop();
            resolve(1);
          })
          .catch(() => resolve(5));
      });
    }
    const serviceArgs = [
      ...(flags.profile ? ["--profile", profile] : []),
      ...(flags.manifest ? ["--manifest", resolve(flags.manifest)] : [])
    ];
    let spec = service.spec(home, component, false, serviceArgs);
    if (action === "install") {
      await withSetupLock(
        { ...paths, setupLock: join(home, "run", `${component}.setup.lock`) },
        async () => {
          const before = await service.backend.inspect(spec);
          spec = {
            ...spec,
            enabled:
              flags.autostart === undefined
                ? before.state !== "not_installed" && before.enabled
                : flags.autostart === "true"
          };
          await mkdir(home, { recursive: true, mode: 0o700 });
          await service.backend.install(spec);
        }
      );
    } else {
      const before = await service.backend.inspect(spec);
      if (["start", "restart"].includes(action) && before.state === "not_installed")
        throw new Error("SERVICE_NOT_INSTALLED");
      if (action === "uninstall") await service.backend.uninstall(spec);
      if (action === "stop") await service.backend.stop(spec);
      if (action === "start") await service.backend.start(spec);
      if (action === "restart") await service.backend.restart(spec);
      if (action === "start" || action === "restart") {
        const end = Date.now() + 30_000;
        while (true) {
          try {
            await componentStatus(home, component, dependencies.platform, true);
            break;
          } catch {
            if (Date.now() >= end) throw new Error("COMPONENT_UNAVAILABLE");
            await (dependencies.sleep ?? sleep)(100);
          }
        }
      }
    }
    publish({ component, action, service: await service.backend.inspect(spec) });
    return 0;
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "COMMAND_FAILED";
    output(JSON.stringify({ error: { code } }));
    return code === "SERVICE_NOT_INSTALLED"
      ? 3
      : /INVALID|REQUIRED/.test(code)
        ? 2
        : /INCOMPLETE/.test(code)
          ? 5
          : /UNAVAILABLE/.test(code)
            ? 4
            : 1;
  }
}
async function componentStatus(
  home: string,
  component: Component,
  platform?: NodeJS.Platform,
  requireReady = false
): Promise<unknown> {
  const endpoint = componentEndpoint(home, component, platform);
  if (component === "executor-kernel") {
    const client = attachKernel({ endpoint });
    try {
      const status = await client.status();
      if (requireReady && !status.execution_ready) throw new Error("COMPONENT_UNAVAILABLE");
      return status;
    } finally {
      client.close();
    }
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let bytes = "";
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("COMPONENT_UNAVAILABLE"));
    });
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "status" })}\n`)
    );
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.toString("utf8");
      if (bytes.length > 65536) {
        socket.destroy();
        reject(new Error("INVALID_RESPONSE"));
        return;
      }
      if (bytes.includes("\n")) {
        try {
          resolve((JSON.parse(bytes) as { result: unknown }).result);
        } catch {
          reject(new Error("INVALID_RESPONSE"));
        }
        socket.destroy();
      }
    });
    socket.once("end", () => {
      if (!bytes.includes("\n")) reject(new Error("COMPONENT_UNAVAILABLE"));
    });
  });
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function parse(args: string[]) {
  const flags: Record<string, string> = {},
    positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] === "-h" ? "--help" : args[i] === "-v" ? "--version" : args[i];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (
      !match ||
      !["home", "profile", "manifest", "json", "help", "version", "autostart"].includes(match[1]) ||
      Object.hasOwn(flags, match[1])
    )
      throw new Error("INVALID_ARGUMENTS");
    const key = match[1];
    flags[key] = ["json", "help", "version"].includes(key) ? "true" : (match[2] ?? args[++i]);
    if (
      !flags[key] ||
      flags[key].startsWith("--") ||
      (key === "autostart" && !["true", "false"].includes(flags[key]))
    )
      throw new Error("INVALID_ARGUMENTS");
  }
  return { flags, positional };
}
