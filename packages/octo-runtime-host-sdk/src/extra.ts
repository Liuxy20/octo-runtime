import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { extraRegistration, type ExtraDescriptor } from "./extra-config.js";
import type { ChannelDependencies } from "./context-loader.js";
import {
  assertRuntimeLogging,
  type RuntimeLoggingOptions
} from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { JsonObject } from "./extras.js";
import { createContextLoader } from "./context-loader.js";
import { DependencyPool } from "./dependencies.js";
import { processChannel } from "./process-channel.js";
import { ComponentStartError, deadline, launchNode, type CleanupResult } from "./launch.js";

export interface ExtraLaunchOptions {
  logging?: RuntimeLoggingOptions;
  declaration: ExtraDescriptor;
  endpoint: string;
  controlEndpoint?: string;
  entrypoint?: string;
  dependencies?: ChannelDependencies;
  dependencyModule?: { entrypoint: string; exportName: string };
  signal?: AbortSignal;
}
export interface OwnedExtra {
  readonly name: string;
  readonly ownership: "owned";
  readonly exited: Promise<void>;
  status(): Promise<JsonObject>;
  stop(): Promise<CleanupResult>;
}
const owners = new Map<string, { failed: boolean }>();
export async function startExtra(options: ExtraLaunchOptions): Promise<OwnedExtra> {
  assertRuntimeLogging(options.logging);
  extraRegistration(options.declaration);
  const name = options.declaration.name;
  if (owners.has(name))
    throw new Error(owners.get(name)!.failed ? "EXTRA_DISPOSE_FAILED" : "EXTRA_ALREADY_LOADED");
  if (owners.size >= 64) throw new Error("EXTRA_CAPACITY_EXHAUSTED");
  const settings = options.declaration.config.context_loading as JsonObject | undefined;
  createContextLoader(undefined, settings, new AbortController().signal);
  const owner = { failed: false };
  owners.set(name, owner);
  const instance = randomUUID(),
    epoch = randomUUID();
  const pool = new DependencyPool(
    typeof settings?.max_in_flight === "number" ? settings.max_in_flight : 8
  );
  let unbind: (() => void) | undefined;
  const { dependencies, entrypoint, signal, ...configuration } = options;
  let child: Awaited<ReturnType<typeof launchNode>>;
  try {
    child = await launchNode(
      entrypoint ?? fileURLToPath(new URL("./extra-entry.js", import.meta.url)),
      { ...configuration, instance, epoch, proxy: !!dependencies?.loadContexts },
      (process) => {
        if (dependencies?.loadContexts)
          unbind = pool.bind(processChannel(process), instance, epoch, dependencies);
        process.once("disconnect", () => unbind?.());
      },
      signal
    );
  } catch (error) {
    unbind?.();
    owner.failed = error instanceof ComponentStartError && !error.cleanup.complete;
    try {
      await deadline(pool.close(), 5000, "EXTRA_DISPOSE_FAILED");
      if (!owner.failed) owners.delete(name);
    } catch {
      owner.failed = true;
      if (error instanceof ComponentStartError) {
        error.cleanup.complete = false;
        error.cleanup.errors.push({ code: "DEPENDENCY_CLEANUP_INCOMPLETE", component: name });
        error.cleanup.pendingResources.push("loadContexts");
      }
    }
    throw error;
  }
  let closing: Promise<CleanupResult> | undefined;
  return {
    name,
    ownership: "owned",
    exited: child.exited,
    async status() {
      const id = randomUUID();
      let off = () => {};
      let onExit = () => {};
      const pending = new Promise<JsonObject>((resolve, reject) => {
        off = child.channel.on((message) => {
          const value = message as { type?: string; request_id?: string; status?: JsonObject };
          if (value.type === "component.status" && value.request_id === id) {
            off();
            resolve(value.status ?? {});
          }
        });
        onExit = () => {
          off();
          reject(new Error("EXTRA_EXITED"));
        };
        child.child.once("exit", onExit);
      });
      void pending.catch(() => undefined);
      try {
        if (child.child.exitCode !== null || child.child.signalCode !== null)
          throw new Error("EXTRA_EXITED");
        child.channel.send({ type: "component.status", request_id: id });
        return await deadline(pending, 5000, "EXTRA_STATUS_TIMEOUT");
      } finally {
        off();
        child.child.off("exit", onExit);
      }
    },
    stop() {
      return (closing ??= (async () => {
        unbind?.();
        const dependenciesClosed = deadline(pool.close(), 5000, "EXTRA_DISPOSE_FAILED").then(
          () => true,
          () => false
        );
        const result = await child.stop();
        if (!(await dependenciesClosed)) {
          result.errors.push({ code: "DEPENDENCY_CLEANUP_INCOMPLETE", component: name });
          result.pendingResources.push("loadContexts");
          result.complete = false;
        }
        if (result.complete) owners.delete(name);
        else owner.failed = true;
        return result;
      })());
    }
  };
}
