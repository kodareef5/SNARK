// A password typed as a command is sent as typed, shown masked, and kept nowhere the page could show it again.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { ChatState } from "../../client/core/ui/chat.ts";
import { ConsoleState } from "../../client/core/ui/console.ts";
import { SECRET_COMMANDS, maskSecret } from "../../shared/console.ts";
import { TEXT_CONSOLE, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

/** Types each line into a fresh console: what it sent, printed and remembered, and what Up brings back. */
function typed(...lines: string[]): { sent: string[]; lines: readonly string[]; history: readonly string[]; up: string } {
  const c = new ConsoleState();
  const sent: string[] = [];
  for (const line of lines) {
    c.edit(line);
    c.submit((l) => sent.push(l));
  }
  c.recall(-1);
  return { sent, lines: c.lines, history: c.history, up: c.input };
}

test("a password typed at the console is echoed masked and is not in its history", () => {
  expect(typed("enablecheats hunter2")).toEqual({ sent: ["enablecheats hunter2"], lines: ["> enablecheats ****"], history: [], up: "" });
  expect(typed('EnableCheats "hunter 2"').lines).toEqual(["> EnableCheats ****"]);
  expect(typed("claimpassword hunter2").lines).toEqual(["> claimpassword ****"]);
});

test("a password given through cheat or admincheat is masked and not remembered", () => {
  const got = typed("who", "cheat enablecheats hunter2", "admincheat enablecheats hunter2", "/enablecheats hunter2");
  expect(got.sent).toEqual(["who", "cheat enablecheats hunter2", "admincheat enablecheats hunter2", "/enablecheats hunter2"]);
  expect(got.lines).toEqual(["> who", "> cheat enablecheats ****", "> admincheat enablecheats ****", "> /enablecheats ****"]);
  expect([got.history, got.up]).toEqual([["who"], "who"]);
});

test("a password typed as a slash command in the chat box is sent and shown nowhere", () => {
  const sent: string[] = [];
  const log: { channel: number; text: string }[] = [];
  const s = { serverTick: 100, state: "active", log, logVersion: 0, motdSeconds: 20, globalChat: true, tribe: { name: "" }, text: (line: string) => (sent.push(line), 1), chat: () => 1 };
  const session = s as unknown as ClientSession;
  const chat = new ChatState();
  for (const line of ["/enablecheats hunter2", "/cheat enablecheats hunter2"]) {
    chat.begin(TEXT_GLOBAL, session);
    chat.edit(line);
    chat.submit(session);
  }
  log.push({ channel: TEXT_CONSOLE, text: "cheats enabled" });
  s.logVersion++;
  chat.absorb(session);
  expect(sent).toEqual(["enablecheats hunter2", "cheat enablecheats hunter2"]);
  expect([chat.input, chat.lines.map((l) => l.text)]).toEqual(["", ["cheats enabled"]]);
});

test("a line that is no secret is echoed and remembered as before", () => {
  const got = typed("settime 6:30", "enablecheats", "cheat fly", "setting ServerAdminPassword");
  expect(got.lines).toEqual(["> settime 6:30", "> enablecheats", "> cheat fly", "> setting ServerAdminPassword"]);
  expect(got.history).toEqual(["settime 6:30", "enablecheats", "cheat fly", "setting ServerAdminPassword"]);
  expect([maskSecret("cheat"), maskSecret("enablecheatsx hunter2"), maskSecret("say enablecheats hunter2")]).toEqual([null, null, null]);
});

test("every command the server keeps secret is masked on the client", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const secret = [...h.host.console.commands.values()].filter((c) => c.secret).map((c) => c.name.toLowerCase());
  h.host.shutdown();
  expect(secret.length).toBeGreaterThan(0);
  for (const name of secret) expect(SECRET_COMMANDS).toContain(name);
});
