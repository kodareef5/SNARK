import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { ChatState } from "../../client/core/ui/chat.ts";
import { TEXT_CONSOLE, TEXT_GLOBAL, TEXT_NOTICE } from "../../shared/net/protocol.ts";

test("a chat line that begins with a slash is a command: /help says the keys there and then, any other is the console's line, answered in the box", () => {
  const sent: string[] = [], said: string[] = [];
  const log: { channel: number; text: string }[] = [];
  const s = {
    serverTick: 100, state: "active", log, logVersion: 0, motdSeconds: 20, globalChat: true, tribe: { name: "" },
    text: (line: string) => (sent.push(line), 1),
    chat: (_channel: number, line: string) => (said.push(line), 1),
  };
  const session = s as unknown as ClientSession;
  const chat = new ChatState();
  const type = (line: string): void => { chat.begin(TEXT_GLOBAL, session); chat.edit(line); chat.submit(session); };
  const answer = (text: string): void => { log.push({ channel: TEXT_CONSOLE, text }); s.logVersion++; chat.absorb(session); };

  // /help alone is answered by the client: nothing is sent or said, and its lines are notices that stay a while.
  type("/help");
  expect([chat.open, sent, said]).toEqual([false, [], []]);
  expect(chat.lines.length).toBeGreaterThan(1);
  expect(chat.lines.every((l) => l.channel === TEXT_NOTICE && l.text.length > 0 && l.hold >= 10 * 30)).toBe(true);
  expect(chat.lines.some((l) => l.text.includes("/"))).toBe(true);
  const guide = chat.lines.length;

  // Any other is the console's line without the slash, and what the console answers shows in the box, a line a row.
  type("/help give");
  expect([sent, said]).toEqual([["help give"], []]);
  answer("give <item> [n]\nPut an item in your inventory. (cheat)");
  expect(chat.lines.slice(guide).map((l) => [l.channel, l.text])).toEqual([[TEXT_NOTICE, "give <item> [n]"], [TEXT_NOTICE, "Put an item in your inventory. (cheat)"]]);

  // The console's lines at any other time are the console's alone.
  s.serverTick += 10 * 30;
  answer("saved");
  expect(chat.lines.length).toBe(guide + 2);

  // A slash alone is /help; a line with no slash is talk.
  type("/");
  expect(chat.lines.length).toBe(guide * 2 + 2);
  type("hello, island");
  expect([sent, said]).toEqual([["help give"], ["hello, island"]]);
});
