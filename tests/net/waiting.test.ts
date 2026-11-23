// Riding out a restart, the part with no page in it (client/core/waiting.ts): what an answer from ready.json means to
// a page that waits, how often it asks, and that it goes back in once and only when a server will take it.

import { expect, test } from "bun:test";
import { restartLine } from "../../client/core/hud/restart.ts";
import { TRIES_MOST, backAddress, clockText, pace, readComeback, readReady, spread, verdict, waitKey, waitLine, waitOut, type Comeback, type WaitPort } from "../../client/core/waiting.ts";
import type { Ready } from "../../shared/ready.ts";

const left: Comeback = { name: "Ada", password: "", spectate: false, started: 1000, map: "core:miami", why: "restart", at: 50_000, tries: 0 };
const old: Ready = { started: 1000, wire: 7, page: 7, map: "core:miami" };
const fresh: Ready = { started: 2000, wire: 8, page: 8, map: "core:miami" };

test("a page that was told of a stop waits for another start of its own world whose page is built", () => {
  expect(verdict(left, null)).toBe("wait");
  // The server that said "go" answers for a moment yet: it is the one being left.
  expect(verdict(left, old)).toBe("wait");
  expect(verdict(left, fresh)).toBe("enter");
  // Started again, but the client on its disk is the old one, or one half built: its hello would be refused.
  expect(verdict(left, { ...fresh, page: 7 })).toBe("unbuilt");
  // A build that does not say its version cannot be told from the right one.
  expect(verdict(left, { ...fresh, page: null })).toBe("enter");
  // Behind a front, another world may answer for this one while it is down.
  expect(verdict(left, { ...fresh, map: "core:proving" })).toBe("wait");
  expect(verdict({ ...left, map: "" }, { ...fresh, map: "core:proving" })).toBe("enter");
  // A restart with no update is a new start all the same.
  expect(verdict(left, { ...old, started: 1001 })).toBe("enter");
});

test("a page that lost its server with no word comes back to the same start, but not for ever", () => {
  const lost: Comeback = { ...left, why: "lost" };
  expect([verdict(lost, null), verdict(lost, old), verdict(lost, fresh)]).toEqual(["wait", "enter", "enter"]);
  // The line keeps dropping: after a few tries in a row the page says so and stops trying.
  expect(verdict({ ...lost, tries: TRIES_MOST }, old)).toBe("stuck");
  // A new start is another matter, however many tries came before it.
  expect(verdict({ ...lost, tries: TRIES_MOST }, fresh)).toBe("enter");
  // A page that never learned its start takes any answer for a new one.
  expect(verdict({ ...lost, started: 0, map: "" }, old)).toBe("enter");
});

test("the record of who to bring back is read strictly, and names no more than it needs", () => {
  const text = JSON.stringify({ ...left, password: "opensesame" });
  expect(readComeback(text)).toEqual({ ...left, password: "opensesame" });
  expect(Object.keys(readComeback(text)!).sort()).toEqual(["at", "map", "name", "password", "spectate", "started", "tries", "why"]);
  for (const bad of [null, "", "{", "null", JSON.stringify({ ...left, name: "<b>" }), JSON.stringify({ ...left, why: "bored" }), JSON.stringify({ ...left, password: 5 })]) expect(readComeback(bad)).toBeNull();
  expect(readComeback(JSON.stringify({ name: "Ada", password: "", why: "lost", started: "soon", tries: -3 }))).toEqual({ name: "Ada", password: "", spectate: false, started: 0, map: "", why: "lost", at: 0, tries: 0 });
  // One record a world, whichever of its pages reads it.
  expect([waitKey("/miami/play.html"), waitKey("/miami/wait.html"), waitKey("/miami/"), waitKey("/play.html")]).toEqual(["snark.wait./miami/", "snark.wait./miami/", "snark.wait./miami/", "snark.wait./"]);
  // The way back names the survivor and nothing else: no password is ever in an address.
  expect([backAddress(left), backAddress({ ...left, name: "Ada Lovelace", spectate: true, password: "opensesame" })]).toEqual(["play.html?name=Ada", "play.html?name=Ada%20Lovelace&spectate=1"]);
  expect([readReady(fresh), readReady({ ...fresh, page: undefined }), readReady({ started: "x" }), readReady(null), readReady("<html>")]).toEqual([fresh, { ...fresh, page: null }, null, null, null]);
});

test("it asks often at first and then less, says what it found, and spreads the going back in", () => {
  expect([pace(0), pace(59_999), pace(60_000), pace(599_999), pace(600_000), pace(86_400_000)]).toEqual([2000, 2000, 5000, 5000, 15_000, 15_000]);
  expect([spread(0), spread(0.5), spread(0.9999), spread(7), spread(-1)]).toEqual([0, 1500, 2997, 2997, 0]);
  expect([clockText(0), clockText(7_400), clockText(760_000), clockText(-5)]).toEqual(["0:00", "0:07", "12:40", "0:00"]);
  expect(waitLine(left, "wait", 80_000)).toBe("The server is restarting for an update. Stay here: you will be brought back (1:20).");
  expect(waitLine({ ...left, why: "lost" }, "wait", 5000)).toBe("The server went away. Waiting for it to come back (0:05).");
  expect(waitLine(left, "unbuilt", 65_000)).toBe("The server is up and its new page is being built (1:05).");
  expect([waitLine(left, "enter", 0), waitLine(left, "stuck", 0)]).toEqual(["The server is back. Returning to the game.", "The connection keeps dropping. Reload this page to try again."]);
  // The game page's own line while the stop is counted down.
  expect([restartLine(0, 5000), restartLine(65_000, 20_000), restartLine(1000, 5000)]).toEqual(["", "The server restarts in 0:45 for an update. Stay on this page: you will be brought back.", "The server restarts in 0:00 for an update. Stay on this page: you will be brought back."]);
});

/** A page with a clock of its own: each asking takes the next of `answers`, and what was set for later runs in order. */
function page(answers: (Ready | null)[]) {
  let now = left.at;
  const said: string[] = [], asked: number[] = [], later: { at: number; run: () => void }[] = [];
  let entered = -1;
  const port: WaitPort = {
    now: () => now,
    ask: () => (asked.push(now), Promise.resolve(answers.length > 1 ? answers.shift()! : answers[0]!)),
    later: (run, ms) => void later.push({ at: now + ms, run }),
    random: () => 0.5,
    say: (line) => void said.push(line),
    enter: () => void (entered = now),
  };
  /** Runs what is due, in order, until nothing is left or `most` have run. */
  const run = async (most: number): Promise<void> => {
    for (let n = 0; n < most; n++) {
      await Promise.resolve();
      await Promise.resolve();
      const next = later.sort((a, b) => a.at - b.at).shift();
      if (!next) return;
      now = next.at;
      next.run();
    }
  };
  return { port, run, said, asked, entered: () => entered, pending: () => later.length };
}

test("waiting out a restart: nothing answers, then the old start, then a new one half built, then it goes in once", async () => {
  const p = page([null, null, old, { ...fresh, page: 7 }, fresh]);
  waitOut(left, p.port);
  expect(p.said[0]).toBe("The server is restarting for an update. Stay here: you will be brought back (0:00).");
  await p.run(20);
  // Asked every two seconds, and in on the fifth answer after the spread.
  expect(p.asked.map((t) => t - left.at)).toEqual([0, 2000, 4000, 6000, 8000]);
  expect(p.entered() - left.at).toBe(9500);
  expect(p.pending()).toBe(0);
  expect(p.said.slice(-3)).toEqual(["The server is restarting for an update. Stay here: you will be brought back (0:04).", "The server is up and its new page is being built (0:06).", "The server is back. Returning to the game."]);

  // A line that keeps dropping stops the asking, and the page is never entered.
  const stuck = page([old]);
  waitOut({ ...left, why: "lost", tries: TRIES_MOST }, stuck.port);
  await stuck.run(20);
  expect([stuck.asked.length, stuck.entered(), stuck.pending(), stuck.said.at(-1)]).toEqual([1, -1, 0, "The connection keeps dropping. Reload this page to try again."]);

  // With no server at all it goes on asking, less often as the minutes pass, and never gives up.
  const down = page([null]);
  waitOut(left, down.port);
  await down.run(200);
  expect(down.entered()).toBe(-1);
  expect(down.asked.length).toBeGreaterThan(100);
  const gaps = down.asked.slice(1).map((t, i) => t - down.asked[i]!);
  expect([...new Set(gaps)]).toEqual([2000, 5000, 15_000]);
});
