import assert from "node:assert/strict";
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type {
  GatewayDependencies,
  ImSessionStore,
  ImSessionBinding,
  ImSessionOccurrence,
  ImGapMetadata,
  ImRulesContext
} from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

/** 仅用于展示合同的宿主内存后端；没有磁盘持久性，不是 SDK 的数据库实现。 */
export class SampleSessionBackend {
  readonly bindings = new Map<string, ImSessionBinding>();
  readonly occurrences = new Map<string, ImSessionOccurrence>();
  readonly controls = new Set<string>();
}

/** 每个 Bot 独立句柄，共享后端由宿主拥有；生产宿主另行实现容量和保留策略。 */
export class SampleSessionStore implements ImSessionStore {
  #closed = false;
  closes = 0;
  constructor(
    readonly backend: SampleSessionBackend,
    readonly scope: string
  ) {}
  #key(key: string): string {
    if (this.#closed) throw new Error("HOST_STORE_CLOSED");
    return JSON.stringify([this.scope, key]);
  }
  read(key: string): ImSessionBinding | undefined {
    return structuredClone(this.backend.bindings.get(this.#key(key)));
  }
  save(key: string, binding: ImSessionBinding): void {
    this.backend.bindings.set(this.#key(key), structuredClone(binding));
  }
  reset(key: string, controlId: string): ImSessionBinding {
    const control = JSON.stringify([this.#key(key), controlId]);
    if (this.backend.controls.has(control)) {
      const current = this.read(key);
      if (!current) throw new Error("HOST_SESSION_EXPIRED");
      return current;
    }
    const next = { generation: (this.read(key)?.generation ?? 1) + 1 };
    this.save(key, next);
    this.backend.controls.add(control);
    return next;
  }
  occurrence(key: string, id: string): ImSessionOccurrence | undefined {
    return structuredClone(this.backend.occurrences.get(JSON.stringify([this.#key(key), id])));
  }
  remember(key: string, id: string, value: ImSessionOccurrence): void {
    this.backend.occurrences.set(JSON.stringify([this.#key(key), id]), structuredClone(value));
  }
  patchGap(
    key: string,
    identity: { sessionId: string; generation: number },
    update: (current: ImGapMetadata | undefined) => ImGapMetadata
  ): boolean {
    const binding = this.read(key);
    if (!binding || binding.id !== identity.sessionId || binding.generation !== identity.generation)
      return false;
    const revision = binding.gap?.revision ?? 0;
    binding.gap = update(binding.gap);
    binding.gap.revision = revision + 1;
    this.save(key, binding);
    return true;
  }
  invalidateRules(matches: (key: string) => boolean): void {
    for (const [stored, binding] of this.backend.bindings) {
      const [scope, key]: [string, string] = JSON.parse(stored);
      if (scope !== this.scope || !binding.id || !matches(key)) continue;
      this.save(key, {
        ...binding,
        rulesContext: { revision: (binding.rulesContext?.revision ?? 0) + 1 }
      });
    }
  }
  patchRules(
    key: string,
    identity: { sessionId: string; generation: number },
    update: (current: ImRulesContext | undefined) => ImRulesContext | undefined
  ): boolean {
    const binding = this.read(key);
    if (!binding || binding.id !== identity.sessionId || binding.generation !== identity.generation)
      return false;
    const next = update(binding.rulesContext);
    if (!next) return false;
    this.save(key, { ...binding, rulesContext: next });
    return true;
  }
  close(): void {
    this.#closed = true;
    this.closes++;
  }
}

/** 由 host.mts 的真实 Kernel/worker 启动代码调用；可直接运行发行验证器复现。 */
export async function verifyGatewayStore(endpoint: string): Promise<void> {
  const backend = new SampleSessionBackend();
  const handles: SampleSessionStore[] = [];
  const config: JsonObject = {
    bots: [
      {
        bot_id: "public-host-store",
        api_url: "https://im-test.deepminer.com.cn/api",
        organization: "fixture-org",
        assistant: "fixture-assistant",
        adapter: { adapter_type: "release-fixture" }
      }
    ]
  };
  const dependencies: GatewayDependencies = {
    createSessionStore(bot) {
      const scope = JSON.stringify([bot.organization, bot.assistant, bot.bot_id]);
      const store = new SampleSessionStore(backend, scope);
      handles.push(store);
      return store;
    }
  };
  const extra = createExtraService({ endpoint, module: gateway, config, dependencies });
  try {
    await extra.initialize();
    const status = await extra.status();
    assert.equal(status.pid, process.pid);
    assert.deepEqual(status.plugin.errors, []);
    assert.equal(handles.length, 1);
    const store = handles[0]!;
    // 本例不提供 IM 凭据、不建立 IM 连接；接口实际消息消费由仓库 Gateway 测试验证。
    store.save("chat", {
      id: "logical",
      generation: 1,
      providerSession: { adapterType: "fixture", sessionId: "provider" }
    });
    assert.equal(store.read("chat")?.id, "logical");
    store.remember("chat", "message", { text: "example", sessionId: "logical", runId: "run" });
    assert.equal(store.occurrence("chat", "message")?.runId, "run");
    const identity = { sessionId: "logical", generation: 1 };
    assert.equal(
      store.patchGap("chat", identity, () => ({
        processEpoch: "epoch",
        revision: 0,
        localOutputSeqs: []
      })),
      true
    );
    assert.equal(
      store.patchRules("chat", identity, () => ({ revision: 0 })),
      true
    );
    store.invalidateRules((key) => key === "chat");
    assert.equal(store.read("chat")?.rulesContext?.revision, 1);
    assert.equal(store.reset("chat", "reset").generation, 2);
    assert.equal(store.reset("chat", "reset").generation, 2);
    assert.equal(
      store.patchRules("chat", identity, () => ({ revision: 0 })),
      false
    );
  } finally {
    const cleanup = await extra.close();
    assert.equal(cleanup.complete, true, JSON.stringify(cleanup));
  }
  assert.equal(handles[0]?.closes, 1);
  assert.equal(backend.bindings.size, 1, "Gateway does not close the host backend");
  const reopened = new SampleSessionStore(backend, handles[0]!.scope);
  assert.equal(reopened.read("chat")?.generation, 2);
  reopened.close();
  const memory = createExtraService({ endpoint, module: gateway, config, dependencies: {} });
  try {
    await memory.initialize();
    assert.deepEqual((await memory.status()).plugin.errors, []);
    assert.equal(handles.length, 1, "omitting the factory preserves the default Memory path");
  } finally {
    assert.equal((await memory.close()).complete, true);
  }
}
