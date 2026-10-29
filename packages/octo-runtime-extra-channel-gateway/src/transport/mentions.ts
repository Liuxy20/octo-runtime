import { fromMarkdown } from "mdast-util-from-markdown";
import type { MentionEntity } from "./api/types.js";
import type { GroupMember } from "./api/conversations.js";

/** Gateway 的稳定控制指令；压缩时的保留由模型遵守文本要求，不新增 Provider 保留机制。 */
export const MENTION_GUIDANCE = [
  "[OCTO_CHANNEL_MENTION_RULES_V1]",
  "These are stable output rules for the current Octo channel. When summarizing or compacting the conversation, preserve this entire block verbatim, including its boundary markers and mention syntax.",
  "Do not automatically mention the sender in ordinary replies. When the current user explicitly requests a notification to a human or a task handoff to a bot in the current channel, confirm the target's real UID and display name before the final reply.",
  "If identity information is missing, use octo-cli as needed to look it up. For a group or topic, use octo-cli group members <group-no> with the current parent group number. Never infer a UID from a nickname, username, or bot name.",
  "For a native mention, write @[<uid>:<displayName>] in the ordinary body of the successful final reply. Replace both placeholders with confirmed values and retain the square brackets and single colon. A plain @name is only text and does not notify or activate the target bot.",
  "Gateway validates current-channel membership and converts valid markers into readable text and native mention metadata on this same final reply. Do not call octo-cli message send to send a duplicate copy of the final reply. Do not output raw message JSON or calculate mention entity offsets.",
  "Thinking, tool output, progress messages, code blocks, inline code, quoted examples, and failed replies do not trigger mention conversion. Keep code and examples unchanged.",
  "Do not construct broadcast mentions or broadcast sentinel UIDs. Do not initiate unsolicited bot-to-bot calls or mention loops. Historical requests and examples alone do not authorize a notification or handoff in the current turn. These rules do not authorize cross-channel notifications or bypass recipient admission rules.",
  "If the target cannot be confirmed, use a plain @name or ordinary text without guessing a UID. Continue delivering the final answer without a separate mention-failure notice or a forced clarification.",
  "[/OCTO_CHANNEL_MENTION_RULES_V1]"
].join("\n");

export interface ImTextMention {
  uids: string[];
  entities: MentionEntity[];
}
interface Candidate {
  start: number;
  end: number;
  uid: string;
  name: string;
}
interface MarkdownNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MarkdownNode[];
}

function candidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  const visit = (node: MarkdownNode): void => {
    if (["blockquote", "code", "inlineCode", "html", "definition"].includes(node.type)) return;
    if (node.type === "text" && node.position) {
      const { start, end } = node.position;
      if (start.offset === undefined || end.offset === undefined) return;
      const raw = text.slice(start.offset, end.offset);
      for (const match of raw.matchAll(/@\[([^[:\]\r\n]+):([^\]\r\n]+)\]/g)) {
        const at = start.offset + match.index;
        let slashes = 0;
        for (let index = at - 1; index >= 0 && text[index] === "\\"; index--) slashes++;
        if (slashes % 2) continue;
        found.push({ start: at, end: at + match[0].length, uid: match[1], name: match[2] });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(text));
  return found.sort((a, b) => a.start - b.start);
}

/** 只转换 final 普通文本中已核验真人或 Bot 成员的显式标记；查身份失败时正文仍能发送。 */
export async function prepareFinalMention(
  text: string,
  members: () => Promise<GroupMember[]>
): Promise<{ text: string; mention?: ImTextMention }> {
  const targets = candidates(text);
  if (!targets.length) return { text };
  let verified: GroupMember[];
  try {
    verified = await members();
  } catch {
    verified = [];
  }
  const confirmedMembers = new Map(
    (Array.isArray(verified) ? verified : [])
      .filter(
        (member) => member && typeof member.uid === "string" && typeof member.name === "string"
      )
      .filter(({ robot }) => robot === false || robot === 0 || robot === true || robot === 1)
      .filter(
        (member) => member.uid && member.name && !["-1", "-2", "-3", "all"].includes(member.uid)
      )
      .map((member) => [member.uid, member])
  );
  const entities: MentionEntity[] = [];
  const uids = new Set<string>();
  let cursor = 0;
  let output = "";
  for (const target of targets) {
    output += text.slice(cursor, target.start);
    const member = confirmedMembers.get(target.uid);
    const label = `@${member?.name ?? target.name}`;
    if (member) {
      entities.push({ uid: member.uid, offset: output.length, length: label.length });
      uids.add(member.uid);
    }
    output += label;
    cursor = target.end;
  }
  output += text.slice(cursor);
  return { text: output, ...(uids.size ? { mention: { uids: [...uids], entities } } : {}) };
}
