# Troubleshooting

[简体中文](../../zh-CN/guides/troubleshooting.md) | [Documentation](../README.md)

Record the error code and relevant `runId` and `invocationId`, then locate the problem below. A connection failure after submission does not necessarily mean the task never ran; query the original execution before retrying. Log only necessary metadata, excluding input bodies, secrets, and substituted MCP authentication headers.

## Cannot Connect to the Service

Use `octo-runtime channel-gateway logs --lines 200 --json` for service status records, or add `--follow` to watch connection and retry transitions. Ctrl+C stops following. These are Extra lifecycle, Kernel availability and connection records, excluding conversation content, session/run/message identifiers, model output, tool arguments and credentials. The command reads only `<home>/logs/extras/<extra>-status-<UTC-hour>.log`, even with Kernel offline or a broken module configuration. It reads at most 4 MiB from the latest three files; each file is capped at 100 MiB. Empty logs succeed with a stderr notice.

CLI Extras also emit these records to stdout. Native SDK hosts remain silent unless `logging.statusOutput(record)` is provided alongside an absolute `logging.directory`. File logging and bounded stdout output are best effort and cannot block recovery. Gateway retries transient offline startup and later disconnections after 5, 10, then 15 seconds, repeating at 15 seconds; Retry-After may extend the wait. Authentication failures and terminal kicks, including reason 12, require diagnosis rather than competing reconnects. IM online does not prove execution or delivery success.

| Symptom / code                             | Action                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `KERNEL_UNAVAILABLE` or connection failure | Confirm the endpoint, Kernel initialization, and matching OS account. Check `status().execution_ready` and worker state. `attachKernel` does not start the service.      |
| Worker state `recovering`                 | Kernel keeps its local listener and retries serially. After three fast attempts, each further attempt waits 15 seconds; restoring the worker environment can recover execution without a Kernel restart. |
| `WORKER_RESTART_EXHAUSTED`                 | Cleanup or ownership is unconfirmed, so automatic replacement is blocked. Inspect the old worker and ownership records before restoring the service. A replacement worker does not resume old executions. |

## Input Rejected

| Symptom / code                                 | Action                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invalid Context structure, duplicates, or size | Validate parameters with `InvokeInput.check`. Check schema, the 32-item / 64-KiB limit, and duplicate namespace/name pairs. See [Context reference](../reference/contexts.md) for field formats. |
| `CONTEXT_PLAN_MISMATCH`                        | Compare top-level workdir, model, and approval settings with Context and correct conflicting values.                                                                                             |
| `INVOKE_REQUEST_TOO_LARGE`                     | Send less text or fewer images, or use resource references readable through tools. The 32 MiB limit also counts base64, recovery images, and protocol wrapping.                                  |
| Unsupported output mode                        | Choose a mode from the [Provider support table](../reference/providers.md). Canonical-only Adapters require explicit `protocol_mode: "canonical"`.                                               |
| `CONTEXT_ENVS_UNSUPPORTED`                     | OpenClaw rejects nonempty per-invocation environment variables. Remove these settings and configure the Gateway deployment instead.                                                              |
| MCP configuration or connection failure        | Follow the [MCP troubleshooting table](mcp.md) to check connection types, field support, environment variables, duplicate service names, and authentication.                                     |

## Output or Session Recovery Failed

| Symptom / code                                             | Action                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STREAM_GAP`, `STREAM_EXPIRED`, `STREAM_CURSOR_INVALID`    | Check the original ref and last consecutive sequence number. If output is missing, expired, or the position is invalid, report that reading cannot continue. Do not invoke again to retrieve output. |
| `KERNEL_INSTANCE_CHANGED`, `RUN_IDENTITY_MISMATCH`         | The Kernel instance or execution identifiers differ from the receipt. Stop using the old ref and let the application decide whether to start a new task.                                             |
| `OPERATION_OUTCOME_UNKNOWN`, `RUN_OUTCOME_UNKNOWN`, `lost` | The operation or execution outcome is unknown and may already have taken effect. Record that state. Do not automatically retry operations that may change external systems.                          |
| Missing background after continuation/reset                | Check the saved providerSession and returned resume result. Follow [session continuation](context-and-sessions.md) to supply current background or recovery history.                                 |

## Shutdown Incomplete

When `close()` returns `complete=false`, inspect `errors` and `pendingResources` to identify unfinished invocations, application functions, or resources. Wait or report cleanup failure according to the actual operation. Do not immediately create a service using the same endpoint.

If the Agent finished but the user received no message, also check Extra delivery and application storage. Execution success does not mean the message was sent or the data saved.

Do not delete Home, identity configuration, credentials, or databases as a generic repair. See [Output and Control](../reference/output-and-control.md) for execution states and [Maintenance and Validation](../maintenance.md) for test scope.
