// A password typed as a command is sent as typed, shown masked, and kept nowhere the page could show it again. One the
// server sends is shown once in the console alone, and is gone when the console closes.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { ChatState } from "../../client/core/ui/chat.ts";
import { ConsoleState, KEY_CONSOLE_DONE } from "../../client/core/ui/console.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { Ui } from "../../client/core/ui/ui.ts";
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

const SECRET = "ABCD-EFGH-JKLM-NPQR";

test("a secret from the server is shown once in the console and is gone when it closes", () => {
  const s = { log: [], logVersion: 0, secret: SECRET };
  const session = s as unknown as ClientSession;
  const c = new ConsoleState();
  c.print("> claimpassword");
  c.absorb(session);
  c.absorb(session);
  expect(c.open).toBe(true);
  expect(c.lines).toEqual(["> claimpassword", `Your password, shown this once: ${SECRET}`]);
  c.open = false;
  c.absorb(session);
  expect([c.lines, s.secret]).toEqual([["> claimpassword", "A password was shown here. It is not shown again."], ""]);
  c.open = true;
  c.absorb(session);
  expect(JSON.stringify(c)).not.toContain(SECRET);
});

test("a second secret takes the first one's place in the console", () => {
  const s = { log: [], logVersion: 0, secret: SECRET };
  const c = new ConsoleState();
  c.absorb(s as unknown as ClientSession);
  s.secret = "BCDE-FGHJ-KLMN-PQRS";
  c.absorb(s as unknown as ClientSession);
  expect(c.lines).toEqual(["A password was shown here. It is not shown again.", "Your password, shown this once: BCDE-FGHJ-KLMN-PQRS"]);
  expect(JSON.stringify(c)).not.toContain(SECRET);
});

test("a claimed password never enters the session's log or the chat box", () => {
  const h = new Harness({}, 1, 60, { log: () => {} });
  try {
    const ada = h.join("ada");
    h.run(500);
    h.host.exec("Permissions.Add ada Admins");
    const chat = new ChatState();
    const con = new ConsoleState();
    chat.begin(TEXT_GLOBAL, ada);
    chat.edit("/claimpassword");
    chat.submit(ada);
    h.run(300);
    chat.absorb(ada);
    con.absorb(ada);
    const first = ada.secret;
    expect(first).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    // The console opens for it, and the chat box shows the answer alone.
    expect([con.open, con.lines.at(0), con.lines.at(-1)]).toEqual([true, `Your password, shown this once: ${first}`, "The password above is yours, shown this once. enablecheats takes it in game, and the admin pages take it with your name or ID."]);
    expect(chat.lines.map((l) => l.text).some((t) => t.startsWith("The password above is yours"))).toBe(true);
    // Typed at the console, the current password is masked, and the new one takes the old one's place.
    con.edit(`claimpassword ${first}`);
    con.submit((line) => ada.text(line));
    h.run(300);
    con.absorb(ada);
    const second = ada.secret;
    expect(second).not.toBe(first);
    expect(con.lines.filter((l) => l.includes(first))).toEqual([]);
    con.open = false;
    con.absorb(ada);
    chat.absorb(ada);
    const kept = [JSON.stringify(ada.log), JSON.stringify(chat), JSON.stringify(con), ada.secret];
    for (const text of kept) for (const secret of [first, second]) expect(text).not.toContain(secret);
  } finally {
    h.host.shutdown();
  }
});

test("the console that opened for a secret has a button that closes it", () => {
  const ui = new Ui();
  const s = { log: [], logVersion: 0, secret: SECRET };
  ui.console.absorb(s as unknown as ClientSession);
  const f = new UiFrame();
  f.begin(16 / 9);
  ui.console.build(f);
  expect([f.find(KEY_CONSOLE_DONE)?.text, f.find(KEY_CONSOLE_DONE)?.interactive]).toEqual(["Hide the password", true]);
  ui.pointer(0, KEY_CONSOLE_DONE, 0, 0, 0, null);
  ui.console.absorb(s as unknown as ClientSession);
  expect([ui.console.open, s.secret, ui.console.lines]).toEqual([false, "", ["A password was shown here. It is not shown again."]]);
  ui.console.open = true;
  f.begin(16 / 9);
  ui.console.build(f);
  expect(f.find(KEY_CONSOLE_DONE)).toBeNull();
});
