/** 当前 Bot 的展示身份查询；不替代准入、权限或出站 mention 成员核验。 */
import type { ScopedOctoBotConfig } from "../contracts.js";
import { postJson } from "./api/client.js";

export interface MessageIdentity {
  uid: string;
  name: string | null;
  type: "human" | "bot" | "unknown";
}

/** 每个 Transport 独立持有，固定 10 分钟 TTL；无定时器、不落盘、容量有界。 */
export class MessageIdentityCache {
  readonly #entries = new Map<string, { value: MessageIdentity; expiresAt: number }>();

  #key(config: ScopedOctoBotConfig, uid: string): string {
    return JSON.stringify([config.api_url, config.bot_id, config.spaceId, uid]);
  }

  get(config: ScopedOctoBotConfig, uid: string): MessageIdentity | undefined {
    const key = this.#key(config, uid);
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return { ...entry.value };
  }

  set(config: ScopedOctoBotConfig, value: MessageIdentity): void {
    if (value.name === null && value.type === "unknown") return;
    const key = this.#key(config, value.uid);
    this.#entries.delete(key);
    this.#entries.set(key, { value: { ...value }, expiresAt: Date.now() + 600_000 });
    while (this.#entries.size > 2000) this.#entries.delete(this.#entries.keys().next().value!);
  }
}

export function unknownIdentity(uid: string): MessageIdentity {
  return { uid, name: null, type: "unknown" };
}

/** 只补查缓存未命中项；失败保留已命中身份，取消仍传播，不重试或换接口。 */
export async function resolveMessageIdentities(
  config: ScopedOctoBotConfig,
  requested: string[],
  token: string,
  signal: AbortSignal,
  cache?: MessageIdentityCache,
  deadline = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
): Promise<Map<string, MessageIdentity>> {
  signal.throwIfAborted();
  const result = new Map<string, MessageIdentity>();
  const missing: string[] = [];
  for (const uid of new Set(requested)) {
    const hit = cache?.get(config, uid);
    if (hit) result.set(uid, hit);
    else if (uid && Buffer.byteLength(uid) <= 64 && missing.length < 200) missing.push(uid);
  }
  if (!missing.length) return result;
  try {
    const response = await postJson<{ users?: unknown }>(
      config.api_url,
      token,
      "/v1/bot/users/batch",
      { uids: missing },
      deadline,
      { retryOn429: false, logRateLimit: false, maxResponseBytes: 1_048_576 }
    );
    const wanted = new Set(missing);
    for (const value of (Array.isArray(response?.users) ? response.users : []) as unknown[]) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      if (typeof row.uid !== "string" || !wanted.has(row.uid)) continue;
      const identity: MessageIdentity = {
        uid: row.uid,
        name:
          typeof row.name === "string" && row.name.trim() && Array.from(row.name).length <= 256
            ? row.name
            : null,
        type:
          row.robot === true || row.robot === 1
            ? "bot"
            : row.robot === false || row.robot === 0
              ? "human"
              : "unknown"
      };
      result.set(identity.uid, identity);
      cache?.set(config, identity);
    }
  } catch {
    signal.throwIfAborted();
  }
  return result;
}
