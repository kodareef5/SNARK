import type { AdminChatLine } from "../../shared/admin.ts";
import { chatChannels, chatRows } from "../core/admin/chat.ts";

export function addChatChannels(select: HTMLSelectElement): void {
  for (const [channel, label] of Object.entries(chatChannels)) select.add(new Option(label, channel));
}

/** Updates the chat panel while keeping the list in place between messages. */
export function chatPanel(list: HTMLElement, state: HTMLElement) {
  let snapshot = "";
  return ({ lines, note }: { lines: readonly (AdminChatLine & { world?: string })[]; note: string }): void => {
    const next = JSON.stringify(lines);
    if (snapshot !== next) list.innerHTML = chatRows(lines);
    snapshot = next;
    state.textContent = note;
    state.hidden = !note;
  };
}
