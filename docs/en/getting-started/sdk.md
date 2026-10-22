# Your First SDK Invocation

[简体中文](../../zh-CN/getting-started/sdk.md) | [Documentation](../README.md)

This page shows how to call Kernel from a Node.js application. Use Node.js 24.x or 26.x (LTS) and install/authenticate your chosen Provider, such as Codex, on the execution machine.

Install the SDK in your application:

```sh
npm install @mininglamp-oss/octo-runtime
```

Then either connect to an existing Kernel or create one in your application. Installing the npm package does not start services or install Provider CLIs.

Use a release matching this documentation's architecture. See [CLI installation](cli.md) for the current npm release status, source-build alternative, and Kernel startup commands, and [Harness setup](../guides/harnesses.md) for Provider installation and sign-in.

## Connect to an Existing Kernel

Obtain the service's actual endpoint: a socket path on macOS/Linux or a Named Pipe address on Windows. `attachKernel(endpoint)` creates a client that connects when used; Kernel must already be running.

See [attach.mts](../../examples/attach.mts) for complete code using public SDK APIs. Both supported Node.js majors can run this `.mts` file directly without compiling TypeScript first.

From a built source checkout (`pnpm install`, then `pnpm build`):

```sh
node docs/examples/attach.mts /absolute/path/to/kernel.sock codex
```

Replace the socket path with your endpoint, or use a Named Pipe address on Windows. `codex` selects the Adapter for this invocation.

The example sends a greeting request, prints the Agent's final reply text, and waits for execution to finish. It cancels any interaction that requires a user reply; see [Output and Control](../reference/output-and-control.md) for application interaction handling. Connection or execution failures exit with an error. At the end, it closes the client connection while leaving Kernel running.

The invocation API itself is:

```ts
for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
  await consume(event);
}
```

Here, `client` is the connected Kernel client, `input` contains this invocation's parameters, and `consume` handles each event in your application. See [Inputs and Contexts](../concepts/inputs-and-contexts.md) for input structure and [invokeOnce](../../examples/invoke.mts) for complete error and final-status handling.

`invoke` returns an async iterator and submits the request when reading starts. Read until execution ends. Using `break` only stops receiving output; it does not cancel execution.

## Create Kernel in Your Application

To start the service from your application, use `createKernelService(options)` with at least:

- `endpoint`: the socket path or Named Pipe address to listen on.
- `workerEntrypoint`: the absolute path to the worker's JavaScript entry file.

Optionally set `stateDirectory` to store service state. The shared [service.mts](../../examples/service.mts) provides `runOwnedInvocation(options, input, consume)` to demonstrate initialization, one invocation, shutdown, and reporting execution and cleanup errors. A long-lived application normally initializes once and closes the service on exit.

Kernel runs the worker in a separate process. Its entry file registers the application's selected Adapters, for example:

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { selectedAdapter } from "./selected-adapter.js";
serveWorker([selectedAdapter]);
```

`selected-adapter.js` is a placeholder module that your application supplies, exporting `selectedAdapter` with the `HostedAdapter` type. The SDK does not include that example path. Your application chooses and packages its Adapters. SDK integration uses native imports without a manifest or an external Node service launcher. The bundled Runtime CLI owns its separate worker and manifest mechanism; see [Adapter and Extra Loading](../concepts/module-loading.md).

After creating the service, await `initialize()` before using `kernel.client`. On exit, close the application's Extras and wait for result consumption, delivery, and storage operations to finish before closing its Kernel and database. Check the cleanup result's `complete` field. If it is `false`, handle the reported pending resources.

## Verify Without a Real Provider

From the repository root:

```sh
pnpm build
pnpm docs:check
```

`docs:check` checks example types, documentation links, and JSON, then runs a local Kernel invocation with a test Adapter. That Adapter returns fixed output, so no real Provider installation or login is needed. See [Maintenance and Validation](../maintenance.md) for the complete scope.

Next: [Inputs and Contexts](../concepts/inputs-and-contexts.md), [Output and Control](../reference/output-and-control.md).
