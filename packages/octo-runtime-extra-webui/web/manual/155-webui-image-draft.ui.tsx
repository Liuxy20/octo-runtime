import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { App } from "../src/App";

let root: Root, host: HTMLDivElement;
let posted: Record<string, unknown>[];
let rejectSend: (reason?: unknown) => void;
let resolveSend: (value: Response) => void;
let patches: Record<string, unknown>[];
let sessions: Record<string, unknown>[];
let createSession: (() => Promise<Response>) | undefined;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const project = "C:/isolated-webui-project";
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  posted = [];
  patches = [];
  createSession = undefined;
  const session = {
    id: "a0000000-0000-4000-8000-000000000000",
    projectPath: project,
    title: "test",
    revision: 0,
    adapter: "codex",
    model: "",
    effort: "medium",
    messages: [],
    updatedAt: 1
  };
  sessions = [
    session,
    { ...session, id: "b0000000-0000-4000-8000-000000000000", title: "other session" }
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/bootstrap")
        return json({ token: crypto.randomUUID(), defaultProjectPath: project });
      if (path === "/api/adapters") return json([{ providerType: "codex", available: true }]);
      if (path === "/api/sessions" && options?.method === "POST")
        return createSession ? createSession() : json(session, 201);
      if (path === "/api/sessions") return json(sessions);
      if (path === "/api/invoke") {
        posted.push(JSON.parse(String(options?.body)));
        return new Promise<Response>((resolve, reject) => {
          resolveSend = resolve;
          rejectSend = reject;
        });
      }
      if (options?.method === "PATCH") {
        const patch = JSON.parse(String(options.body));
        patches.push(patch);
        return json({ ...patch, revision: 1 });
      }
      return json(sessions.find((value) => path.endsWith(String(value.id))) ?? session);
    })
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}
function png(name: string, size = 68) {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const value = new File([bytes], name, { type: "image/png" });
  // happy-dom 的 File 使用自身 Blob；保留真实字节读取。
  Object.defineProperty(value, "arrayBuffer", {
    configurable: true,
    value: async () => bytes.buffer
  });
  return value;
}
function dispatchAdd(files: File[], paste = false) {
  const target = host.querySelector(paste ? "textarea" : 'input[type="file"]')!;
  const event = new Event(paste ? "paste" : "change", { bubbles: true, cancelable: true });
  if (paste) Object.defineProperty(event, "clipboardData", { value: { files } });
  else Object.defineProperty(target, "files", { configurable: true, value: files });
  target.dispatchEvent(event);
}
async function finishRead() {
  for (let attempt = 0; attempt < 30 && host.querySelector('[role="status"]'); attempt++)
    await settle();
}
async function add(files: File[], paste = false, wait = true) {
  await act(async () => dispatchAdd(files, paste));
  await settle();
  if (wait) await finishRead();
}
async function edit(text: string) {
  await act(async () => {
    const target = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      target,
      text
    );
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send() {
  await act(async () =>
    (host.querySelector('[aria-label="发送消息"]') as HTMLButtonElement).click()
  );
  await settle();
}
const previews = () => host.querySelectorAll(".composer-image").length;
const text = () => host.querySelector<HTMLTextAreaElement>("textarea")!.value;
const complete = () =>
  new Response('data: {"type":"run.completed","payload":{}}\n\n', {
    headers: { "Content-Type": "text/event-stream" }
  });
async function open(title: string) {
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>(".webui-session button")]
      .find((button) => button.textContent === title)!
      .click()
  );
  await settle();
}
async function newConversation() {
  await act(async () => host.querySelector<HTMLButtonElement>(".webui-new")!.click());
}

it.each([4, 5])("actual picker enforces %d image boundary", async (count) => {
  await add(Array.from({ length: count }, (_, i) => png(`${i}.png`)));
  expect(previews()).toBe(count === 4 ? 4 : 0);
  if (count === 5) expect(host.textContent).toContain("最多添加 4 张图片");
});
it.each([2 * 1024 * 1024, 2 * 1024 * 1024 + 1])(
  "actual picker enforces %d byte boundary",
  async (size) => {
    await add([png("boundary.png", size)]);
    expect(previews()).toBe(size === 2 * 1024 * 1024 ? 1 : 0);
  }
);
it("accepts four 2 MiB images at the total boundary", async () => {
  await add(Array.from({ length: 4 }, (_, i) => png(`${i}.png`, 2 * 1024 * 1024)));
  expect(previews()).toBe(4);
  await send();
  for (let attempt = 0; attempt < 30 && !posted.length; attempt++) await settle();
  expect(posted).toHaveLength(1);
  await act(async () => resolveSend(complete()));
  expect(previews()).toBe(0);
}, 15000);
it.each([false, true])(
  "existing images plus selection/paste (%s) stay within count",
  async (paste) => {
    await add([png("a.png"), png("b.png"), png("c.png")]);
    await add([png("d.png"), png("e.png")], paste);
    expect(previews()).toBe(3);
    await add([png("d.png")], paste);
    expect(previews()).toBe(4);
  }
);
it("concurrent selection and paste cannot exceed the budget", async () => {
  await act(async () => {
    dispatchAdd([png("a.png"), png("b.png"), png("c.png")]);
    dispatchAdd([png("d.png"), png("e.png")], true);
  });
  await finishRead();
  expect(previews()).toBe(3);
  expect(host.textContent).toContain("最多添加 4 张图片");
});
it("a failed atomic batch keeps earlier previews and does not accept partial data", async () => {
  await add([png("keep.png")]);
  const bad = png("bad.png");
  Object.defineProperty(bad, "arrayBuffer", { value: async () => new Uint8Array(68).buffer });
  await add([png("good.png"), bad], true);
  expect(previews()).toBe(1);
  expect(host.textContent).toContain("图片内容与格式不符");
});
it("rejects unsupported MIME and zero bytes", async () => {
  await add([new File(["GIF89a"], "a.gif", { type: "image/gif" })]);
  expect(previews()).toBe(0);
  await add([new File([], "zero.png", { type: "image/png" })]);
  expect(previews()).toBe(0);
});
it.each(["image/jpeg", "image/webp"])("accepts supported %s signature", async (mime) => {
  const bytes = new Uint8Array(68);
  bytes.set(mime === "image/jpeg" ? [255, 216, 255] : [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  const file = new File([bytes], "valid", { type: mime });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  await add([file], true);
  expect(previews()).toBe(1);
});
it.each(["reject", "throw"])(
  "%s before acceptance keeps text, images and storage without checkpoint ghosts",
  async (failure) => {
    await edit("keep this draft");
    await add([png("keep.png")]);
    await send();
    expect(posted).toHaveLength(1);
    expect(text()).toBe("keep this draft");
    expect(previews()).toBe(1);
    await act(async () =>
      failure === "reject"
        ? resolveSend(json({ error: "WEBUI_INVOKE_INVALID" }, 400))
        : rejectSend(new Error("network unavailable"))
    );
    expect(text()).toBe("keep this draft");
    expect(previews()).toBe(1);
    expect(patches).toHaveLength(0);
    expect(sessionStorage.getItem(`octo-runtime-webui.draft:${project}`)).toBe("keep this draft");
    expect(host.querySelectorAll(".exec-process")).toHaveLength(0);
  }
);
it("send revalidates actual data before creating a session or clearing input", async () => {
  await edit("local validation");
  await add([png("keep.png")]);
  vi.spyOn(webcrypto.subtle, "digest").mockResolvedValueOnce(new Uint8Array(32).buffer);
  await send();
  expect(posted).toHaveLength(0);
  expect(patches).toHaveLength(0);
  expect(text()).toBe("local validation");
  expect(previews()).toBe(1);
  expect(host.textContent).toContain("图片内容校验失败");
});
it("successful acceptance clears exactly once and persists one user/assistant pair", async () => {
  await edit("accepted once");
  await add([png("sent.png")]);
  await act(async () => {
    const button = host.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!;
    button.click();
    button.click();
  });
  await settle();
  expect(posted).toHaveLength(1);
  await act(async () => resolveSend(complete()));
  await settle();
  expect(text()).toBe("");
  expect(previews()).toBe(0);
  expect(posted).toHaveLength(1);
  expect(patches.at(-1)!.messages).toHaveLength(2);
  expect(sessionStorage.getItem(`octo-runtime-webui.draft:${sessions[0].id}`)).toBe("");
  expect(sessionStorage.getItem(`octo-runtime-webui.draft:${project}`)).toBeNull();
});
it.each(["sse-error", "no-body", "eof", "run-failed"])(
  "accepted %s never restores or replays the sent turn",
  async (failure) => {
    await edit("already accepted");
    await add([png("sent.png")]);
    await send();
    const response =
      failure === "no-body"
        ? new Response(null)
        : new Response(
            failure === "eof"
              ? ""
              : failure === "run-failed"
                ? 'data: {"type":"run.failed","payload":{"error":{"message":"provider failed"}}}\n\n'
                : 'event: error\ndata: {"error":"HOST_INVOKE_FAILED"}\n\n'
          );
    await act(async () => resolveSend(response));
    await settle();
    expect(text()).toBe("");
    expect(previews()).toBe(0);
    expect(posted).toHaveLength(1);
    expect(patches.at(-1)!.messages).toHaveLength(2);
  }
);
it("new edits and pasted attachments survive acceptance of an older snapshot", async () => {
  await edit("old text");
  await add([png("old.png")]);
  await send();
  await edit("new text");
  await add([png("new.png")], true);
  await act(async () => resolveSend(complete()));
  await settle();
  expect(text()).toBe("new text");
  expect(previews()).toBe(1);
  expect(host.querySelector<HTMLImageElement>(".composer-image img")!.alt).toBe("new.png");
  expect((posted[0].inputs as { text?: string }[])[0].text).toBe("old text");
  expect(posted).toHaveLength(1);
});
it("rejection preserves newer edits without restoring the old snapshot", async () => {
  await edit("old text");
  await add([png("old.png")]);
  await send();
  await edit("new text");
  await act(async () => resolveSend(json({ error: "WEBUI_SESSION_BUSY" }, 409)));
  expect(text()).toBe("new text");
  expect(previews()).toBe(1);
});
it("slow file reads block partial send and remain with their original draft after switching", async () => {
  let release!: (value: ArrayBuffer) => void;
  const file = png("slow.png");
  const bytes = await file.arrayBuffer();
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        release = resolve;
      })
  });
  await edit("original draft");
  await add([file], false, false);
  await send();
  expect(posted).toHaveLength(0);
  await open("other session");
  await edit("other draft");
  await act(async () => release(bytes));
  await settle();
  expect(previews()).toBe(0);
  expect(text()).toBe("other draft");
  await newConversation();
  expect(text()).toBe("original draft");
  expect(previews()).toBe(1);
});
it.each([false, true])(
  "switching while a send is pending (accepted %s) keeps both drafts and original request",
  async (accepted) => {
    await open("test");
    await edit("original draft");
    await add([png("original.png")]);
    await send();
    await open("other session");
    await edit("other draft");
    await add([png("other.png")]);
    await act(async () =>
      resolveSend(accepted ? complete() : json({ error: "WEBUI_SESSION_BUSY" }, 409))
    );
    await settle();
    expect(text()).toBe("other draft");
    expect(previews()).toBe(1);
    expect(posted[0].sessionId).toBe(sessions[0].id);
    await open("test");
    expect(text()).toBe(accepted ? "" : "original draft");
    expect(previews()).toBe(accepted ? 0 : 1);
    expect(posted).toHaveLength(1);
  }
);
it("slow new-session creation does not take over another selected session", async () => {
  let release!: (response: Response) => void;
  createSession = () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  await edit("new-session draft");
  await add([png("new-session.png")]);
  await send();
  await open("other session");
  await edit("other remains");
  await act(async () => release(json(sessions[0], 201)));
  await settle();
  expect(posted[0].sessionId).toBe(sessions[0].id);
  await act(async () => resolveSend(complete()));
  await settle();
  expect(text()).toBe("other remains");
  expect(location.hash).toContain(String(sessions[1].id));
});

it("storage write failure during navigation cannot send a different conversation's draft", async () => {
  await open("test");
  await edit("first conversation");
  await add([png("first.png")]);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  await open("other session");
  expect(text()).toBe("");
  expect(previews()).toBe(0);
  await edit("second conversation");
  await send();
  expect(posted[0].sessionId).toBe(sessions[1].id);
  expect(posted[0].inputs).toEqual([{ type: "text", text: "second conversation" }]);
  await act(async () => resolveSend(json({ error: "WEBUI_SESSION_BUSY" }, 409)));
  await open("test");
  expect(text()).toBe("first conversation");
  expect(previews()).toBe(1);
});

it("returning to the sending session shows the accepted turn before the first SSE event", async () => {
  await open("test");
  await edit("accepted before first event");
  await send();
  await open("other session");
  await open("test");
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller;
    }
  });
  await act(async () => resolveSend(new Response(body)));
  await settle();
  expect(text()).toBe("");
  expect(host.textContent).toContain("accepted before first event");
  expect(posted).toHaveLength(1);
  await act(async () => {
    stream.enqueue(new TextEncoder().encode('data: {"type":"run.completed","payload":{}}\n\n'));
    stream.close();
  });
});

it("adding only a new image preserves that image and clears the already sent text", async () => {
  await edit("sent text");
  await add([png("sent.png")]);
  await send();
  await add([png("next.png")], true);
  await act(async () => resolveSend(complete()));
  await settle();
  expect(text()).toBe("");
  expect(previews()).toBe(1);
  expect(host.querySelector<HTMLImageElement>(".composer-image img")!.alt).toBe("next.png");
  expect(posted).toHaveLength(1);
});
