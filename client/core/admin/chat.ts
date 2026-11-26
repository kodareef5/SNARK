import type { AdminChatChannel, AdminChatLine } from "../../../shared/admin.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "../../../shared/net/protocol.ts";
import { esc } from "./format.ts";

export const chatChannels: Record<AdminChatChannel, string> = {
  [TEXT_GLOBAL]: "Global",
  [TEXT_LOCAL]: "Local",
  [TEXT_TRIBE]: "Tribe",
};

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function chatRows(entries: readonly (AdminChatLine & { world?: string })[]): string {
  return entries.map(({ at, channel, speaker, text, tags, world }) => {
    const date = new Date(at);
    const channelLabel = world ? `${esc(world)} · ${chatChannels[channel]}` : chatChannels[channel];
    return `<li><div class="chat-meta"><time datetime="${date.toISOString()}" title="${esc(date.toLocaleString())}">${esc(clock.format(at))}</time> · ${channelLabel}</div>${tags?.length ? `${tags.map((t) => `[${esc(t)}]`).join(" ")} ` : ""}<strong>${esc(speaker)}</strong> ${esc(text)}</li>`;
  }).join("");
}

export function inChannel(line: AdminChatLine, channel: string): boolean {
  return !channel || String(line.channel) === channel;
}

/** The world dashboard's chat feed. A slow reply cannot replace newer messages. */
export class RecentChat {
  private messages: AdminChatLine[] | null = null;
  private read = 0;

  async refresh(get: () => Promise<unknown>): Promise<void> {
    const read = ++this.read;
    const messages = await get().catch(() => null) as AdminChatLine[] | null;
    if (this.read === read) this.messages = messages;
  }

  view(channel: string): { lines: AdminChatLine[]; note: string } {
    const lines = this.messages?.filter((line) => inChannel(line, channel)).reverse() ?? [];
    const note = this.messages === null ? "Chat is unavailable." : lines.length ? "" : "No recent messages in this channel.";
    return { lines, note };
  }
}
