import { randomUUID } from "node:crypto";
import { validateRuntimeHome } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { readJsonOptional, writeJsonAtomic, type HostProfilePaths } from "./home.js";
import type { AuthorizedTenant } from "./types.js";

export interface LocalRuntimeIdentity {
  schema_version: 1;
  profile: string;
  runtime_id: string;
  octo_space_id: string;
  credential_id?: string;
  enrolled_at?: string;
}

export function ensureLocalRuntime(
  profile: HostProfilePaths,
  tenant: AuthorizedTenant
): LocalRuntimeIdentity {
  // 路径对象可能来自先前读取；写身份前重新确认根，不能递归补建已经消失的 Home。
  validateRuntimeHome(profile.home, [
    { path: profile.identityFile, resource: "runtime-identity" },
    { path: profile.configFile, resource: "profile-configuration" }
  ]);
  const saved = readJsonOptional<LocalRuntimeIdentity>(profile.identityFile);
  if (
    saved &&
    (saved.schema_version !== 1 ||
      saved.profile !== profile.name ||
      saved.octo_space_id !== tenant.id ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(saved.runtime_id))
  ) {
    throw new Error("LOCAL_RUNTIME_IDENTITY_INVALID");
  }
  const identity = saved ?? {
    schema_version: 1,
    profile: profile.name,
    runtime_id: `runtime_${randomUUID()}`,
    octo_space_id: tenant.id
  };
  if (!saved) writeJsonAtomic(profile.identityFile, identity);
  const configuration = readJsonOptional<Record<string, unknown>>(profile.configFile);
  writeJsonAtomic(profile.configFile, {
    ...configuration,
    schema_version: 1,
    profile: profile.name,
    octo_space_id: tenant.id
  });
  return identity;
}
