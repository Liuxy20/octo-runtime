import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { inferContentType } from "../transport/api/files.js";
import type { ImArtifactPolicy } from "./artifact-policy.js";

interface Span {
  start: number;
  end: number;
}
interface Node {
  type: string;
  url?: string;
  identifier?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
}
interface Target extends Span {
  url: string;
}
interface Token extends Span {
  type: string;
}

function span(node: Node): Span | undefined {
  const start = node.position?.start.offset,
    end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

/** AST 决定哪些引用有效，parser token 提供精确地址区间，避免重序列化破坏原 Markdown。 */
function references(text: string): {
  targets: Target[];
  fileTargets: Set<string>;
  edits: (urls: Map<string, string>) => Target[];
} {
  const tokens: Token[] = [];
  const tree = fromMarkdown(text, {
    mdastExtensions: [
      {
        beforeEnter(token) {
          if (
            [
              "resourceDestinationString",
              "definitionDestinationString",
              "label",
              "definitionTitle"
            ].includes(token.type)
          )
            tokens.push({ type: token.type, start: token.start.offset, end: token.end.offset });
        }
      }
    ]
  });
  const definitions = new Map<string, { node: Node; blocked: boolean }>();
  const uses: { node: Node; blocked: boolean }[] = [];
  const inline: Node[] = [];
  const visit = (node: Node, blocked = false): void => {
    blocked ||= ["blockquote", "code", "inlineCode", "html"].includes(node.type);
    if (node.type === "definition" && node.identifier && !definitions.has(node.identifier))
      definitions.set(node.identifier, { node, blocked });
    if (["linkReference", "imageReference"].includes(node.type)) uses.push({ node, blocked });
    if (!blocked && ["link", "image"].includes(node.type)) inline.push(node);
    for (const child of node.children ?? []) visit(child, blocked);
  };
  visit(tree);
  const within = (node: Node, type: string): Token | undefined => {
    const range = span(node);
    return (
      range &&
      tokens
        .filter(
          (token) => token.type === type && token.start >= range.start && token.end <= range.end
        )
        .at(-1)
    );
  };
  const targets: Target[] = [];
  const fileTargets = new Set<string>();
  for (const node of inline) {
    const destination = within(node, "resourceDestinationString");
    if (destination && node.url) {
      targets.push({ ...destination, url: node.url });
      if (node.type === "link") fileTargets.add(node.url);
    }
  }
  const expansions: { range: Span; label: Span; title?: Span; url: string }[] = [];
  const expansionDestinations = new Set<string>();
  const used = new Set<string>();
  for (const use of uses) {
    if (use.blocked || !use.node.identifier) continue;
    const definition = definitions.get(use.node.identifier);
    if (!definition?.node.url) continue;
    const destination = within(definition.node, "definitionDestinationString");
    if (!destination) continue;
    if (use.node.type === "linkReference") fileTargets.add(definition.node.url);
    const protectedExample =
      definition.blocked ||
      uses.some((other) => other.blocked && other.node.identifier === use.node.identifier);
    if (protectedExample) {
      const range = span(use.node),
        label = tokens.find((token) => token.type === "label" && token.start === range?.start);
      if (range && label) {
        expansions.push({
          range,
          label,
          title: within(definition.node, "definitionTitle"),
          url: definition.node.url
        });
        expansionDestinations.add(`${destination.start}:${destination.end}`);
        targets.push({ ...destination, url: definition.node.url });
      }
    } else if (!used.has(use.node.identifier)) {
      targets.push({ ...destination, url: definition.node.url });
      used.add(use.node.identifier);
    }
  }
  return {
    targets,
    fileTargets,
    edits: (urls) => {
      let edits: Target[] = targets
        .filter((target) => !expansionDestinations.has(`${target.start}:${target.end}`))
        .flatMap((target) => {
          const url = urls.get(target.url);
          return url ? [{ ...target, url }] : [];
        });
      // 内层图片先替换，再将已替换的 label 合入外层引用，避免区间重叠破坏 Markdown。
      for (const entry of expansions.sort(
        (a, b) => a.range.end - a.range.start - (b.range.end - b.range.start)
      )) {
        const url = urls.get(entry.url);
        if (!url) continue;
        let label = text.slice(entry.label.start, entry.label.end);
        const nested = edits.filter(
          (edit) => edit.start >= entry.label.start && edit.end <= entry.label.end
        );
        for (const edit of nested.sort((a, b) => b.start - a.start))
          label =
            label.slice(0, edit.start - entry.label.start) +
            edit.url +
            label.slice(edit.end - entry.label.start);
        edits = edits.filter(
          (edit) => edit.start < entry.range.start || edit.end > entry.range.end
        );
        edits.push({
          ...entry.range,
          url: `${label}(<${url}>${entry.title ? ` ${text.slice(entry.title.start, entry.title.end)}` : ""})`
        });
      }
      return edits;
    }
  };
}

function localPath(target: string, workspace?: string): string | undefined {
  if (/^file:/i.test(target)) {
    try {
      return fileURLToPath(target);
    } catch {
      throw new Error("path-unavailable");
    }
  }
  // 其他操作系统的盘符/UNC 也是本地引用，不能当作外部 URL 跳过或在本机错误拼接。
  if (/^[a-z]:[\\/]/i.test(target) || target.startsWith("\\\\")) {
    if (process.platform !== "win32") throw new Error("path-unavailable");
    return target;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#"))
    return undefined;
  const clean = target.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    throw new Error("invalid-path");
  }
  if (!decoded || decoded.includes("\0") || decoded.startsWith("~"))
    throw new Error("invalid-path");
  if (path.isAbsolute(decoded)) return decoded;
  if (!workspace) throw new Error("workspace-unavailable");
  return path.resolve(workspace, decoded);
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function failureName(target: string): string {
  const name = target.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0] || "file";
  return name.replace(/[\r\n`[\]<>]/g, "_").slice(0, 120);
}

export type ArtifactUpload = (
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal: AbortSignal
) => Promise<string>;

/** 已核验并上传的文件元数据；不向发送层暴露本机路径。 */
export interface ArtifactFile {
  url: string;
  name: string;
  size: number;
  extension: string;
}

export interface PreparedArtifacts {
  text: string;
  files: ArtifactFile[];
}

/** 只交付成功 final 的显式引用；失败不改变生成终态，缓存由 transport 的 final effect 闭包持有。 */
export async function prepareArtifacts(
  text: string,
  policy: ImArtifactPolicy,
  ownerSignal: AbortSignal,
  upload: ArtifactUpload
): Promise<PreparedArtifacts> {
  if (policy.mode === "tools") return { text, files: [] };
  ownerSignal.throwIfAborted();
  const parsed = references(text);
  const signal = AbortSignal.any([ownerSignal, AbortSignal.timeout(policy.timeoutMs)]);
  const urls = new Map<string, string>();
  const files = new Map<string, Promise<ArtifactFile>>();
  const cards = new Map<string, ArtifactFile>();
  const failures: string[] = [];
  let total = 0;
  let count = 0;
  let roots: string[] | undefined;
  for (const target of new Set(parsed.targets.map((entry) => entry.url))) {
    try {
      const file = localPath(target, policy.workspace);
      if (file === undefined) continue;
      signal.throwIfAborted();
      if (!policy.local) throw new Error("remote-file-unavailable");
      if (!roots) roots = await Promise.all(policy.roots.map((root) => realpath(root)));
      const resolved = await realpath(file).catch(() => {
        throw new Error("file-unavailable");
      });
      if (!roots.some((root) => contained(root, resolved))) throw new Error("directory-policy");
      let result = files.get(resolved);
      if (!result) {
        if (++count > policy.maxFiles) throw new Error("file-count-limit");
        result = (async () => {
          let handle: FileHandle | undefined;
          try {
            const entry = await lstat(resolved);
            if (!entry.isFile()) throw new Error("not-regular-file");
            handle = await open(
              resolved,
              constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
            );
            const stat = await handle.stat();
            if (
              !stat.isFile() ||
              stat.dev !== entry.dev ||
              stat.ino !== entry.ino ||
              (await realpath(file)) !== resolved
            )
              throw new Error("file-changed");
            if (stat.size > policy.maxFileBytes) throw new Error("file-size-limit");
            if (total + stat.size > policy.maxTotalBytes) throw new Error("total-size-limit");
            const mime = inferContentType(resolved);
            if (policy.mimeTypes && !policy.mimeTypes.includes(mime))
              throw new Error("type-policy");
            total += stat.size;
            signal.throwIfAborted();
            // 同一描述符读取且预分配有界容量，文件增长也不能绕过已核验的字节预算。
            const bytes = Buffer.alloc(stat.size);
            let offset = 0;
            while (offset < bytes.length) {
              signal.throwIfAborted();
              const read = await handle.read(
                bytes,
                offset,
                Math.min(64 << 10, bytes.length - offset),
                offset
              );
              if (!read.bytesRead) throw new Error("file-changed");
              offset += read.bytesRead;
            }
            const after = await handle.stat();
            if (
              after.size !== stat.size ||
              after.mtimeMs !== stat.mtimeMs ||
              after.ctimeMs !== stat.ctimeMs
            )
              throw new Error("file-changed");
            signal.throwIfAborted();
            const name = path.basename(resolved);
            return {
              url: await upload(bytes, name, mime, signal),
              name,
              size: bytes.length,
              extension: path.extname(name).slice(1).toLowerCase()
            };
          } finally {
            await handle?.close();
          }
        })();
        files.set(resolved, result);
      }
      const artifact = await result;
      if (parsed.fileTargets.has(target)) cards.set(resolved, artifact);
      // 对最终 Markdown 只写安全地址字节；不让云地址中的括号、空格或实体改变原文结构。
      urls.set(
        target,
        artifact.url
          .replace(
            /[\s()<>"\\]/g,
            (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
          )
          .replace(/&/g, "&amp;")
      );
    } catch (error) {
      ownerSignal.throwIfAborted();
      const reason = signal.aborted
        ? "delivery-timeout"
        : error instanceof Error && /^[a-z-]+$/.test(error.message)
          ? error.message
          : "upload-failed";
      failures.push(`${failureName(target)} (${reason})`);
    }
  }
  ownerSignal.throwIfAborted();
  let output = text;
  const edits = parsed.edits(urls);
  // 同一定义可能被多个 reference 使用，重复区间只替换一次。
  for (const edit of [
    ...new Map(edits.map((entry) => [`${entry.start}:${entry.end}`, entry])).values()
  ].sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.url + output.slice(edit.end);
  if (failures.length)
    output += `\n\nAttachment delivery failed: ${failures.join("; ")}. These local references are unavailable to channel recipients; generation was not rerun.`;
  return { text: output, files: [...cards.values()] };
}
