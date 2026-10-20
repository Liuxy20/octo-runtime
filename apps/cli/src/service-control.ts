import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { componentServiceId } from "@mininglamp-oss/octo-runtime-host-sdk";
import {
  createServiceBackend,
  type ServiceBackend,
  type ServiceSpec
} from "@mininglamp-oss/octo-runtime-cross-service";
export interface ServiceControlOptions {
  backend?: ServiceBackend;
  nodeExecutable?: string;
  systemHome?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  cliEntrypoint?: string;
}
export function resolveServiceControl(options: ServiceControlOptions = {}) {
  const backend =
    options.backend ??
    createServiceBackend({
      platform: options.platform,
      environment: options.environment,
      homeDirectory: options.systemHome ?? homedir()
    });
  return {
    backend,
    spec(home: string, component: string, enabled = false, args: string[] = []): ServiceSpec {
      const id = componentServiceId(home, component, options.platform);
      return {
        id,
        description: `Octo Runtime ${component}`,
        command: resolve(options.nodeExecutable ?? process.execPath),
        args: [
          resolve(options.cliEntrypoint ?? fileURLToPath(new URL("./index.js", import.meta.url))),
          component,
          "run",
          "--home",
          resolve(home),
          ...args
        ],
        workingDirectory: resolve(home),
        ...((options.platform ?? process.platform) !== "win32"
          ? {
              environment: {
                PATH: (options.environment ?? process.env).PATH ?? "/usr/local/bin:/usr/bin:/bin"
              }
            }
          : {}),
        enabled,
        restart: { policy: "on-failure", delaySeconds: 5, maxBurst: 3 },
        timeoutStopSeconds: 10,
        names: { launchdLabel: id, systemdUnit: `${id}.service`, windowsTaskName: `\\${id}` }
      };
    }
  };
}
