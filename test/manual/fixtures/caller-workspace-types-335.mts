import type {
  AgentEnv,
  ContextWorkspacePayload,
  InvokeRequest
} from "../../../packages/octo-runtime-protocol/dist/index.js";
// @ts-expect-error Removed instruction type has no compatibility export.
import type { ContextInstructionEntry } from "../../../packages/octo-runtime-protocol/dist/index.js";
// @ts-expect-error Removed instruction payload has no compatibility export.
import type { ContextInstructionsPayload } from "../../../packages/octo-runtime-protocol/dist/index.js";
// @ts-expect-error Removed context instruction helper has no compatibility export.
import { contextControlInstructions } from "../../../packages/octo-runtime-protocol/dist/index.js";
// @ts-expect-error Removed first-turn instruction helper has no compatibility export.
import { initialControlInstructions } from "../../../packages/octo-runtime-protocol/dist/index.js";
// @ts-expect-error Caller owns workspace preparation; Core no longer exports an allocator.
import { prepareRunContext } from "../../../packages/octo-runtime-executor-core/dist/index.js";
// @ts-expect-error Removed allocation store has no compatibility export.
import type { WorkspaceAssignments } from "../../../packages/octo-runtime-executor-core/dist/index.js";

const workspace: ContextWorkspacePayload = { path: "/caller/prepared" };
const env: AgentEnv = {
  schema: "octo.context-envelope/v3",
  items: [{ namespace: "octo.execution", name: "workspace", payload: { ...workspace } }]
};
// @ts-expect-error Application prompts belong in ordinary inputs.
const oldEnv: AgentEnv = { ...env, controlInstructions: "" };
// @ts-expect-error Workspace modes were removed, even if accompanied by a valid path.
const oldWorkspace: ContextWorkspacePayload = { path: "/caller/prepared", mode: "fixed" };
// @ts-expect-error Internal InvokeRequest no longer exposes the removed instruction field.
const requestField: keyof InvokeRequest = "controlInstructions";
void [workspace, env, oldEnv, oldWorkspace, requestField];
