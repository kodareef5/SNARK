// A chat line in coloured runs, from the server's formatter through the wire to the rows of the chat box.

import { expect, test } from "bun:test";
import { KEY_CHAT_ROW, ChatState } from "../../client/core/ui/chat.ts";
import { UiFrame, wrapRuns, wrapText, type UiNode } from "../../client/core/ui/nodes.ts";
import { S_CHAT } from "../../client/core/ui/style.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { TextRun } from "../../shared/net/chat.ts";
import { TEXT_GLOBAL, TEXT_LOCAL, TEXT_MOTD, TEXT_NOTICE, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

const BLUE = 0x30c0ff;
const RED = 0xff3030;

/** The chat box's rows as built at `width` canvas units wide. */
function rows(chat: ChatState, width = 400): UiNode[] {
  const f = new UiFrame();
  f.begin(width / 720);
  f.width = width;
  chat.build(f, 0, 720, 0);
  const out: UiNode[] = [];
  for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CHAT_ROW && f.nodes[i]!.key < KEY_CHAT_ROW + 8) out.push({ ...f.nodes[i]! });
  return out;
}

test("a run's ink stays with each piece of it when its line wraps", () => {
  const runs: TextRun[] = [{ text: "ada", ink: RED }, { text: ": " }, { text: "a long line that will not fit on one row of the box at all", ink: BLUE }];
  const texts: string[] = [];
  const all = runs.map((r) => r.text).join("");
  wrapText(all, 160, S_CHAT, texts);
  const out: TextRun[][] = [];
  wrapRuns(runs, 160, S_CHAT, out);
  expect(texts.length).toBeGreaterThan(1);
  expect(out.map((row) => row.map((r) => r.text).join(""))).toEqual(texts);
  expect(out[0]!.slice(0, 2)).toEqual([{ text: "ada", ink: RED }, { text: ": " }]);
  for (const row of out.slice(1)) expect(row.every((r) => r.ink === BLUE)).toBe(true);
});

test("a chat line with no coloured run shows as the same rows as a plain line, its channel's prefix the first run", () => {
  const words = "bob: over here, by the tall rock past the river; bring the spare hatchet and some berries";
  const plain = new ChatState();
  const runs = new ChatState();
  plain.begin(TEXT_GLOBAL, null);
  runs.begin(TEXT_GLOBAL, null);
  for (const channel of [TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE]) {
    plain.print(channel, words, 0);
    runs.print(channel, words, 0, undefined, [{ text: "bob" }, { text: words.slice(3) }]);
  }
  const before = rows(plain), after = rows(runs);
  expect(after.map((n) => [n.text, n.style])).toEqual(before.map((n) => [n.text, n.style]));
  expect(before.every((n) => n.runs === null)).toBe(true);
  expect(after.every((n) => n.runs !== null && n.runs.every((r) => r.ink === undefined))).toBe(true);
  expect(after.find((n) => n.text.startsWith("[Local] "))!.runs![0]).toEqual({ text: "[Local] " });
  // Built again with nothing new, each row keeps the same runs.
  const again = rows(runs);
  expect(again.every((n, i) => n.runs === after[i]!.runs)).toBe(true);
});

test("a line coloured by the server's formatter reaches the chat box in its inks, across two rows", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  h.host.chat.format = (speaker, _channel, text) => [{ text: typeof speaker === "string" ? speaker : speaker.name, ink: RED }, { text: `: ${text}`, ink: BLUE }];
  const from = bob.logVersion;
  ada.chat(TEXT_GLOBAL, "meet at the old radio tower before the storm comes in, and bring rope");
  h.run(300);
  const line = bob.log.at(-1)!;
  expect(bob.logVersion - from).toBe(1);
  expect(line.runs).toEqual([{ text: "ada", ink: RED }, { text: ": meet at the old radio tower before the storm comes in, and bring rope", ink: BLUE }]);
  const chat = new ChatState();
  chat.absorb(bob);
  const preview = rows(chat, 260);
  expect(preview.map((n) => n.text).join(" ")).toBe(line.text);
  expect(preview.flatMap((n) => n.runs!).slice(1).every((r) => r.ink === BLUE)).toBe(true);
  chat.begin(TEXT_GLOBAL, bob);
  const shown = rows(chat, 260);
  expect(shown.length).toBe(2);
  expect(shown[0]!.runs![0]).toEqual({ text: "ada", ink: RED });
  expect(shown.flatMap((n) => n.runs!).slice(1).every((r) => r.ink === BLUE)).toBe(true);
  expect(shown.map((n) => n.text).join(" ")).toBe(line.text);
});

test("a notice and the message of the day still arrive as plain text", () => {
  const rules = loadConfig({ gus: "[SessionSettings]\nSessionName=The Proving Ground\n[MessageOfTheDay]\nMessage=Welcome\n" }).rules;
  const h = new Harness({}, 1, 60, { dev: true, config: rules });
  const ada = h.join("ada");
  h.run(600);
  ada.chat(TEXT_TRIBE, "anyone?");
  h.run(300);
  const motd = ada.log.filter((l) => l.channel === TEXT_MOTD);
  const notices = ada.log.filter((l) => l.channel === TEXT_NOTICE);
  expect(motd.map((l) => l.text)).toEqual(["The Proving Ground", "Welcome"]);
  expect(notices.map((l) => l.text)).toContain("You are not in a tribe.");
  expect([...motd, ...notices].every((l) => l.runs === undefined)).toBe(true);
  const chat = new ChatState();
  chat.absorb(ada);
  expect(rows(chat).every((n) => n.runs === null)).toBe(true);
});
