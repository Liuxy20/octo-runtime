/** 启动诊断的唯一文案/恢复建议目录；不含 Run 控制码，不触发修复或网络请求。 */
export interface StartupCatalogEntry {
  readonly summary: string;
  readonly action: string;
  readonly retryable: boolean;
  readonly configKey?: string;
}

const entry = (
  summary: string,
  action: string,
  retryable = false,
  configKey?: string
): StartupCatalogEntry =>
  Object.freeze({ summary, action, retryable, ...(configKey ? { configKey } : {}) });
const homeAction =
  "The SDK host must select and prepare an existing accessible absolute Runtime Home, then retry. CLI users can select their intended Home with --home. Existing data is not moved automatically.";
const endpointAction =
  "Inspect the endpoint owner and component status. Stop the owning service through its host before retrying; do not remove an active endpoint or ownership record.";
const inspectAction =
  "Inspect the component configuration and controlled lifecycle logs in the host. Capture the diagnostic codes and safe resource context before retrying; the cause is not yet known.";

export const STARTUP_CATALOG: Readonly<Record<string, StartupCatalogEntry>> = Object.freeze({
  STARTUP_UNKNOWN: entry("The startup cause is unknown.", inspectAction),
  LOG_DIRECTORY_MUST_BE_ABSOLUTE: entry(
    "The logging directory must be absolute.",
    "Pass an absolute directory in logging.directory, then retry startup through the host.",
    false,
    "logging.directory"
  ),
  LOG_STATUS_OUTPUT_INVALID: entry(
    "The logging status output callback is invalid.",
    "Provide a function in logging.statusOutput or omit that optional callback, then retry construction.",
    false,
    "logging.statusOutput"
  ),
  SERVICE_INITIALIZATION_FAILED: entry("Component initialization failed.", inspectAction),
  KERNEL_START_CLEANUP_INCOMPLETE: entry("Kernel startup rollback is incomplete.", endpointAction),
  KERNEL_CLEANUP_INCOMPLETE: entry("Kernel resources have not all been released.", endpointAction),
  HOME_UNAVAILABLE: entry("Runtime Home is unavailable.", homeAction),
  HOME_INVALID: entry("Runtime Home must be a valid absolute directory path.", homeAction),
  HOME_UNSUPPORTED: entry("This Runtime Home path or platform is unsupported.", homeAction),
  HOME_NOT_FOUND: entry("The required Runtime Home resource does not exist.", homeAction),
  HOME_NOT_DIRECTORY: entry("The required directory has the wrong resource type.", homeAction),
  HOME_PERMISSION_DENIED: entry(
    "Access to the Runtime Home resource was denied.",
    "Check permissions for the reported resource and operation under the host account, then retry. Do not reset identities or replace Home to bypass the error."
  ),
  HOME_PATH_TOO_LONG: entry(
    "The Runtime resource exceeds a path limit.",
    "The host must select and prepare a shorter supported path within the reported limit, then retry. Existing data is not moved automatically."
  ),
  HOME_LIMIT_UNAVAILABLE: entry(
    "Filesystem path limits could not be determined.",
    "Make the operating system getconf utility available to query PATH_MAX/NAME_MAX, then retry with the same prepared Home."
  ),
  HOME_UNUSABLE: entry("The Runtime Home resource could not be used.", inspectAction),
  IPC_ENDPOINT_INVALID: entry(
    "The IPC endpoint is invalid.",
    "Pass a valid local IPC endpoint through the host's endpoint option, then retry."
  ),
  IPC_ENDPOINT_UNSUPPORTED: entry(
    "The IPC transport platform is unsupported.",
    "Use a supported platform and local IPC transport."
  ),
  IPC_ENDPOINT_TOO_LONG: entry(
    "The IPC endpoint exceeds the transport limit.",
    "Select a shorter Home or endpoint within the reported transport limit, then retry. Existing data is not moved automatically."
  ),
  ENDPOINT_IN_USE: entry("The IPC endpoint already has an owner.", endpointAction),
  EADDRINUSE: entry("The IPC endpoint is already in use.", endpointAction),
  ENDPOINT_PATH_INVALID: entry(
    "The endpoint path contains a different resource type.",
    "Inspect the reported endpoint and correct the host's endpoint selection. Do not delete an unrelated file."
  ),
  ENDPOINT_OWNER_INVALID: entry("The endpoint ownership record is invalid.", endpointAction),
  ENDPOINT_UNVERIFIABLE: entry("Endpoint ownership could not be verified.", endpointAction),
  ENDPOINT_RECOVERY_IN_PROGRESS: entry(
    "Endpoint recovery is in progress.",
    "Wait for the owning recovery operation to finish, inspect status, then retry.",
    true
  ),
  ENOENT: entry(
    "A required startup resource was not found.",
    "Correct the reported resource selection or prepare the required dependency, then retry."
  ),
  ENOTDIR: entry(
    "A required directory has the wrong resource type.",
    "Correct the reported directory path to an existing directory, then retry."
  ),
  EISDIR: entry(
    "A required file is a directory.",
    "Correct the selected file path to the intended regular file, then retry."
  ),
  IM_CONTEXT_LOADING_CONFIG_INVALID: entry(
    "The Extra context-loading configuration is invalid.",
    "Set context_loading.timeout_ms to an integer from 1 to 30000 and max_in_flight to an integer from 1 to 32; remove unsupported keys, then retry Extra initialization.",
    false,
    "context_loading"
  ),
  EACCES: entry(
    "The startup operation was denied access.",
    "Check the host account's permissions for the reported resource and operation, then retry."
  ),
  EPERM: entry(
    "The operating system denied the startup operation.",
    "Check the host account's permissions and the reported resource, then retry."
  ),
  EROFS: entry(
    "The startup operation requires a writable filesystem.",
    "Use an accessible writable resource for the reported operation, then retry."
  ),
  ENAMETOOLONG: entry(
    "The startup resource name exceeds a system limit.",
    "Select a shorter supported path or endpoint, then retry."
  ),
  ECONNREFUSED: entry(
    "The component is not accepting IPC connections.",
    "Inspect the target component's lifecycle and logs, start it through its host, then retry.",
    true
  ),
  SETUP_IN_PROGRESS: entry(
    "A component lifecycle operation is in progress.",
    "Wait for that operation to finish, then retry.",
    true
  ),
  SERVICE_INITIALIZATION_CANCELLED: entry(
    "Component initialization was cancelled.",
    "Check the host cancellation request and cleanup outcome before starting again.",
    true
  ),
  KERNEL_CONFIGURATION_INVALID: entry(
    "Kernel construction inputs are invalid.",
    "Pass endpoint and an adapters array to createKernelService. Compose Adapter objects in the host; retired worker/manifest/env options are unsupported."
  ),
  ERR_MODULE_NOT_FOUND: entry(
    "A selected module or one of its dependencies was not found.",
    "Check the selected module and its installed dependency graph in the host; correct the declaration or install the required package, then retry."
  ),
  MODULE_NOT_FOUND: entry(
    "A selected module or one of its dependencies was not found.",
    "Check the selected module and its installed dependency graph in the host; correct the declaration or install the required package, then retry."
  ),
  EXTRA_MODULE_REQUIRED: entry(
    "The Extra module selection is missing.",
    "Supply the module field in the host's Extra declaration before loading it.",
    false,
    "module"
  ),
  EXTRA_CONFIG_OBJECT_REQUIRED: entry(
    "The Extra configuration must be an object.",
    "Provide a JSON object in the Extra config field, then retry initialization.",
    false,
    "config"
  ),
  EXTRA_CONFIG_JSON_REQUIRED: entry(
    "The Extra configuration contains a non-JSON value.",
    "Pass only finite JSON values in config; supply functions separately through dependencies.",
    false,
    "config"
  ),
  EXTRA_CONFIG_PERMISSIONS_INVALID: entry(
    "The Extra configuration file failed its file or access checks.",
    "Inspect the reported configuration file's type, identity and permissions under the host account; use a protected regular file, then retry."
  ),
  MANIFEST_INVALID: entry(
    "The CLI module manifest is invalid.",
    "Check the selected manifest.json: version must be 1 and adapters/extras must be valid arrays without duplicate keys."
  ),
  EXTRA_NOT_REGISTERED: entry(
    "The Extra has no saved CLI declaration.",
    "Save this component's declaration with its configure or extraset command, then start it."
  ),
  EXTRA_MODULE_LOAD_FAILED: entry(
    "The selected Extra module could not be loaded.",
    "Check the selected module, package installation and ESM exports; correct the declaration or reinstall the dependency, then retry."
  ),
  EXTRA_INITIALIZER_REQUIRED: entry(
    "The Extra did not return an initializer.",
    "Provide an Extra factory that synchronously returns its initialization function."
  ),
  EXTRA_NAME_MISMATCH: entry(
    "The Extra module name differs from its declaration.",
    "Make the selected module's exported name match its catalog entry."
  ),
  EXTRA_ALREADY_LOADED: entry(
    "This Extra already has an active owner.",
    "Close the existing Extra through its host before constructing another instance."
  ),
  EXTRA_DISPOSE_FAILED: entry(
    "The previous Extra still has unconfirmed resources.",
    "Inspect the previous cleanup result and pending resources. Complete the owning host's cleanup before retrying."
  ),
  LOCAL_STATE_INVALID: entry(
    "The local state could not be read.",
    "Inspect the reported file and system cause. Preserve existing identities and configuration; correct the file or access through the host."
  ),
  WRITE_FAILED: entry(
    "A local state update failed.",
    "Inspect the reported path, operation and system cause; correct access before retrying the host operation."
  ),
  COMPONENT_UNAVAILABLE: entry(
    "The component did not become ready.",
    "Inspect component status and controlled lifecycle logs. Process liveness alone does not establish Kernel execution readiness or Extra business connectivity.",
    true
  ),
  SERVICE_PROCESS_EXITED: entry(
    "The service process exited unexpectedly.",
    "Inspect this startup attempt's controlled diagnostic and lifecycle logs before restarting."
  ),
  SERVICE_NOT_INSTALLED: entry(
    "The component service is not installed.",
    "Run this component's install command, then start it."
  ),
  NOT_INSTALLED: entry(
    "The component service is not installed.",
    "Run this component's install command, then start it."
  ),
  SERVICE_DISABLED: entry(
    "The component service is disabled.",
    "Run this component's install --autostart=true command, then start it."
  ),
  MANAGER_UNAVAILABLE: entry(
    "The native service manager is unavailable.",
    "Run doctor and inspect the current user's native service manager."
  ),
  ORPHAN_CLEANUP_INCOMPLETE: entry(
    "Previous Kernel resource cleanup is incomplete.",
    "CLI users: run doctor with the same --home. After confirming all owned orphan tools have stopped, run executor-kernel recover --acknowledge-orphan-cleanup with that Home, then start again. SDK hosts must use the corresponding inspect/acknowledge API; do not remove ownership records."
  ),
  ORPHAN_RECORD_UNSUPPORTED: entry(
    "The stored Kernel ownership format is unsupported.",
    "Preserve the ownership evidence. Stop and clean up using the version and host that created it before upgrading; do not acknowledge or delete an unknown record."
  )
});
