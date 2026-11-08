# Startup diagnostics

[简体中文](../../zh-CN/guides/startup-diagnostics.md) | [Documentation](../README.md)

Startup diagnostics describe a component's failed construction or initialization, before any Run, Session, Task or IPC endpoint needs to exist. They do not create a failed agent Run. After startup, execution failures remain in the execution domain.

Import `describeStartupError`, `formatStartupDiagnostic`, `STARTUP_CATALOG` and the `StartupDiagnostic` type from either `@mininglamp-oss/octo-runtime/host` or `/executor-kernel`. `ServiceInitializationError.diagnostic` directly contains the same projection; the original `cause` and `cleanup` remain available locally. Catch construction as well as `initialize()`.

```ts
import {
  createKernelService, describeStartupError, formatStartupDiagnostic
} from "@mininglamp-oss/octo-runtime/executor-kernel";

// hostPreparedHome and endpoint are selected/prepared by the host.
// The host composes Adapter objects; no agent Run is needed for startup.
try {
  const options = { home: hostPreparedHome, endpoint, adapters };
  const service = createKernelService(options);
  await service.initialize();
  // Keep service for status/close; close only resources this host owns.
} catch (error) {
  const diagnostic = describeStartupError(error, {
    component: "executor-kernel", phase: "initializing"
  });
  if (diagnostic.rootCode === "HOME_PERMISSION_DENIED" ||
      ["EACCES", "EPERM", "EROFS"].includes(diagnostic.context.systemCode ?? "")) {
    showHostPermissionHelp(diagnostic.context.path, diagnostic.context.operation);
  }
  showStartupFailure(formatStartupDiagnostic(diagnostic));
  // Inspect diagnostic.cleanup before retrying. Never parse error.message.
}
```

## Public shape and compatibility

`domain: "startup"`, `code` (outer public code), `rootCode` (known primary cause, otherwise `STARTUP_UNKNOWN`), `component`, `phase` (the existing `ServicePhase`), `summary`, `explanation`, `actions`, `retryable`, `userActionRequired`, `context`, `causes`, optional `cleanup`, and `truncated` form the public shape. No Run identifier is required. `retryable` indicates that waiting/retrying may help, not permission for an automatic retry; inspect cleanup and ownership first.

Typed context contains only observed facts: `path`, `resource`, `operation`, `configKey`, `endpoint`, `executable`, `module`, `systemCode`, `measured`, `limit`, `unit`. A known affected path appears in both text and JSON. A system errno alone does not prove which dependency is missing: spawn ENOENT can also mean the selected working directory is missing. Unknown causes require inspection rather than a guessed fix.

Existing error classes, messages, public codes, cause chains, cleanup outcomes and CLI exit-code selection remain compatible. CLI JSON keeps `error.code`, `message`, optional `cause_code` and manager metadata, and adds `error.diagnostic`; use `diagnostic.rootCode` for deep cause branching. Text prints that same diagnosis and recovery actions. Startup errors escaping the normal CLI handler use the same safe projection. There is no migration of Run/status schemas or lifecycle phases.

`HOME_UNAVAILABLE` remains documented for older consumers. The #306 Home contract retires implicit SDK location selection; it is not a requirement to set LOCALAPPDATA. SDK hosts supply an existing valid absolute Home; the CLI owns preparation of its selected Home (default `~/.octo-runtime`, explicit `--home` takes precedence). Existing data is not moved automatically. This change integrates merged #306 (#310) and #303 (#311). POSIX Kernel uses the direct Home socket endpoint; there is no legacy endpoint migration or dual-owner detection layer.

The existing #306 flat path fields remain readable on RuntimeHomeError.diagnostic; canonical JSON uses context.path/resource/operation and actions. CLI error.startup and optional error.cleanup remain compatibility projections; new consumers should use error.diagnostic. An invalid Kernel logging directory fails with LOG_DIRECTORY_MUST_BE_ABSOLUTE before Home path-budget validation. The outer SERVICE_INITIALIZATION_FAILED and CLI exit selection are unchanged.

## Readiness and safe diagnosis

Process liveness, service phase, Kernel `execution_ready` and an application's business connectivity are separate facts. A ready application can report Kernel unavailable or business disconnected; diagnostics do not change that behavior. Provider probe results do not establish login/model availability. No cloud account, LLM or network request is introduced for local diagnostic formatting.

Cause traversal is bounded to 16 objects and six nested levels and supports aggregate/cyclic errors. Primary failure precedes cleanup causes; pending resources remain visible. Raw messages/stacks, environment, config, stderr, credentials and arbitrary properties are excluded. Dynamic values use the same deterministic sanitizer for text and JSON (control characters, URL credentials/query/fragment and recognizable credential assignments are removed). For untrusted serialized data use `restoreStartupDiagnostic` before rendering; explanations/actions are rebuilt from the catalog, not accepted from the record.

The CLI writes one bounded safe recent-failure record per component under `<home>/logs/startup-<component>.json`, alongside the existing controlled lifecycle logs. Background start/restart reads only a matching component and current-attempt timestamp, then rebuilds the whitelist; legacy code-only logs remain supported. A failed diagnostic write cannot replace the original startup error. Home/IPC path validation failures are returned directly and do not create logs or a replacement Home. The record does not perform recovery and contains no raw exception or business configuration.

Nested causes retain their observed component/phase and cleanup facts. A complete outer cleanup does not erase an incomplete inner cleanup.

## Catalog

The English summary and recovery column below mirror the shared `STARTUP_CATALOG`. Per-attempt context specializes the explanation/action for a selected executable, directory or configuration key. Missing paths, wrong resource types, access denial and length limits retain distinct codes. A code not in the catalog retains its stable identifier, reports an unknown meaning and requests controlled inspection.

| Code | Meaning | Supported recovery | Retry may help |
| --- | --- | --- | --- |
| `STARTUP_UNKNOWN` | The startup cause is unknown. | Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known. | user action |
| `LOG_DIRECTORY_MUST_BE_ABSOLUTE` | The logging directory must be absolute. | Pass an absolute directory in logging.directory, then retry startup through the host. | user action |
| `SERVICE_INITIALIZATION_FAILED` | Component initialization failed. | Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known. | user action |
| `KERNEL_START_CLEANUP_INCOMPLETE` | Kernel startup rollback is incomplete. | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | user action |
| `KERNEL_CLEANUP_INCOMPLETE` | Kernel resources have not all been released. | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | user action |
| `HOME_UNAVAILABLE` | Runtime Home is unavailable. | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | user action |
| `HOME_INVALID` | Runtime Home must be a valid absolute directory path. | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | user action |
| `HOME_UNSUPPORTED` | This Runtime Home path or platform is unsupported. | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | user action |
| `HOME_NOT_FOUND` | The required Runtime Home resource does not exist. | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | user action |
| `HOME_NOT_DIRECTORY` | The required directory has the wrong resource type. | The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically. | user action |
| `HOME_PERMISSION_DENIED` | Access to the Runtime Home resource was denied. | Check permissions for the reported resource and operation under the host account, then retry. Do not reset identities or replace Home to bypass the error. | user action |
| `HOME_PATH_TOO_LONG` | The Runtime resource exceeds a path limit. | The host must select and prepare a shorter supported path within the reported limit, then retry. Existing data is not moved automatically. | user action |
| `HOME_LIMIT_UNAVAILABLE` | Filesystem path limits could not be determined. | Make the operating system getconf utility available to query PATH_MAX/NAME_MAX, then retry with the same prepared Home. | user action |
| `HOME_UNUSABLE` | The Runtime Home resource could not be used. | Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known. | user action |
| `IPC_ENDPOINT_INVALID` | The IPC endpoint is invalid. | Pass a valid local IPC endpoint through the host's endpoint option, then retry. | user action |
| `IPC_ENDPOINT_UNSUPPORTED` | The IPC transport platform is unsupported. | Use a supported platform and local IPC transport. | user action |
| `IPC_ENDPOINT_TOO_LONG` | The IPC endpoint exceeds the transport limit. | Select a shorter Home or endpoint within the reported transport limit, then retry. Existing data is not moved automatically. | user action |
| `ENDPOINT_IN_USE` | The IPC endpoint already has an owner. | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | user action |
| `EADDRINUSE` | The IPC endpoint is already in use. | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | user action |
| `ENDPOINT_PATH_INVALID` | The endpoint path contains a different resource type. | Inspect the reported endpoint and correct the host's endpoint selection. Do not delete an unrelated file. | user action |
| `ENDPOINT_OWNER_INVALID` | The endpoint ownership record is invalid. | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | user action |
| `ENDPOINT_UNVERIFIABLE` | Endpoint ownership could not be verified. | Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record. | user action |
| `ENDPOINT_RECOVERY_IN_PROGRESS` | Endpoint recovery is in progress. | Wait for the owning recovery operation to finish, inspect status, then retry. | yes |
| `ENOENT` | A required startup resource was not found. | Correct the reported resource selection or prepare the required dependency, then retry. | user action |
| `ENOTDIR` | A required directory has the wrong resource type. | Correct the reported directory path to an existing directory, then retry. | user action |
| `EISDIR` | A required file is a directory. | Correct the selected file path to the intended regular file, then retry. | user action |
| `EACCES` | The startup operation was denied access. | Check the host account's permissions for the reported resource and operation, then retry. | user action |
| `EPERM` | The operating system denied the startup operation. | Check the host account's permissions and the reported resource, then retry. | user action |
| `EROFS` | The startup operation requires a writable filesystem. | Use an accessible writable resource for the reported operation, then retry. | user action |
| `ENAMETOOLONG` | The startup resource name exceeds a system limit. | Select a shorter supported path or endpoint, then retry. | user action |
| `ECONNREFUSED` | The component is not accepting IPC connections. | Inspect the target component's lifecycle and logs, start it through its host, then retry. | yes |
| `SETUP_IN_PROGRESS` | A component lifecycle operation is in progress. | Wait for that operation to finish, then retry. | yes |
| `SERVICE_INITIALIZATION_CANCELLED` | Component initialization was cancelled. | Check the host cancellation request and cleanup outcome before starting again. | yes |
| `KERNEL_CONFIGURATION_INVALID` | Kernel construction inputs are invalid. | Pass endpoint and an adapters array to createKernelService. Compose Adapter objects in the host; retired worker/manifest/env options are unsupported. | user action |
| `ERR_MODULE_NOT_FOUND` | A selected module or one of its dependencies was not found. | Check the selected module and its installed dependency graph in the host; correct the declaration or install the required package, then retry. | user action |
| `MODULE_NOT_FOUND` | A selected module or one of its dependencies was not found. | Check the selected module and its installed dependency graph in the host; correct the declaration or install the required package, then retry. | user action |
| `MANIFEST_INVALID` | The CLI module manifest is invalid. | Check the selected manifest.json: version must be 1 and adapters must be valid arrays without duplicate keys. | user action |
| `LOCAL_STATE_INVALID` | The local state could not be read. | Inspect the reported file and system cause. Preserve existing identities and configuration; correct the file or access through the host. | user action |
| `WRITE_FAILED` | A local state update failed. | Inspect the reported path, operation and system cause; correct access before retrying the host operation. | user action |
| `COMPONENT_UNAVAILABLE` | The component did not become ready. | Inspect component status and controlled lifecycle logs. Process liveness alone does not establish Kernel execution readiness or application connectivity. | yes |
| `SERVICE_PROCESS_EXITED` | The service process exited unexpectedly. | Inspect this startup attempt's controlled diagnostic and lifecycle logs before restarting. | user action |
| `SERVICE_NOT_INSTALLED` | The component service is not installed. | Run this component's install command, then start it. | user action |
| `NOT_INSTALLED` | The component service is not installed. | Run this component's install command, then start it. | user action |
| `SERVICE_DISABLED` | The component service is disabled. | Run this component's install --autostart=true command, then start it. | user action |
| `MANAGER_UNAVAILABLE` | The native service manager is unavailable. | Run doctor and inspect the current user's native service manager. | user action |
| `ORPHAN_CLEANUP_INCOMPLETE` | Previous Kernel resource cleanup is incomplete. | CLI users: run doctor with the same --home. After confirming all owned orphan tools have stopped, run executor-kernel recover --acknowledge-orphan-cleanup with that Home, then start again. SDK hosts must use the corresponding inspect/acknowledge API; do not remove ownership records. | user action |
| `ORPHAN_RECORD_UNSUPPORTED` | The stored Kernel ownership format is unsupported. | Preserve the ownership evidence. Stop and clean up using the version and host that created it before upgrading; do not acknowledge or delete an unknown record. | user action |

The catalog does not prescribe a new public code for every failure or turn business connectivity errors into component startup errors. In particular, removed execution workers are not restored.
