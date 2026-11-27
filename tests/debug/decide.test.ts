// The debug bar's Decide section: the server says the decider only when the bar asks for it, the section's lines say
// what each point did since the last ask, and the Server tab lays them out inside the drawer.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { decideLines, moverText } from "../../client/core/debug/decide.ts";
import type { DebugBar } from "../../client/core/debug/debug.ts";
import { KEY_DEBUG } from "../../client/core/debug/draw.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { CAPS, COST_RING, type Ask, type Point } from "../../server/decide/decide.ts";
import { debugAnswer, serverState } from "../../server/debug.ts";
import type { Client } from "../../server/game.ts";
import { ServerLog } from "../../server/log.ts";
import type { DecideState, ServerState } from "../../shared/debug.ts";
import { answer } from "../../shared/decide/forward.ts";
import { RING_MID } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { textWidth } from "../../client/core/ui/nodes.ts";
import { fakePort } from "../fixtures/debug-port.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

/** A point whose movers each see one free heading, their own number. */
class Probe implements Point {
  readonly name: string;
  readonly cost = COST_RING;
  readonly horizon = 0;
  readonly table = tableFor(RING_MID, 8);
  readonly tables = [{ profile: RING_MID, table: this.table }];
  constructor(name: string) {
    this.name = name;
  }
  still(): boolean {
    return true;
  }
  answer(e: number, _tick: number, _rung: number, ask: Ask): number {
    this.table.clear(8);
    this.table.rows[(e % 8) * RING_MID.columns.length + RING_MID.c.run] = 1;
    return answer("choice", this.table, ask(RING_MID, this.table));
  }
  apply(): void {}
}

test("the server's state holds the decider only when it is asked for", () => {
  const h = new Harness({}, 3, 30, { dev: true, wild: false });
  const me = h.join("dee");
  h.run(500);
  const host = h.host, c = h.client(me)!, meter = new TickMeter(() => gaugesOf(host));
  const id = host.decide.add(new Probe("nav.test"));
  host.decide.set("nav.test=rule");
  const dodo = host.spawnCreature("core:dodo", host.world.ents.x[c.ent]! + 3, host.world.ents.z[c.ent]!, 1);
  host.decide.put(id, dodo, 2);
  h.server.tick();
  expect(serverState(host, meter, c).decide).toBeUndefined();
  const s = serverState(host, meter, c, Date.now(), true).decide!;
  expect(s.points.filter((p) => p.name === "nav.test")).toEqual([{ name: "nav.test", policy: "rule", put: 1, answered: 1, cut: 0, backPut: 0, backCut: 0 }]);
  expect([s.caps, s.mover]).toEqual([[...CAPS], null]);
  // A point that can describe a mover is asked of the one the survivor stands by.
  host.decide.describe = (e) => (e === dodo ? { rung: 2, held: 5 } : null);
  expect(serverState(host, meter, c, Date.now(), true).decide!.mover).toMatchObject({ e: dodo, about: { rung: 2, held: 5 } });
});

test("the debug route asks for the decider only for a form that says decide=1", async () => {
  const asked: boolean[] = [];
  const admin = { admin: true } as Client;
  const server = { log: new ServerLog(), sender: () => admin, state: (_c: Client, decide: boolean) => (asked.push(decide), { decide: decide ? {} : undefined } as unknown as ServerState) };
  const post = (fields: Record<string, string>) => {
    const form = new URLSearchParams({ token: `1:${"ab".repeat(8)}`, since: "0", ...fields }).toString();
    return debugAnswer(new Request("http://localhost/__debug", { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(form.length) } }), server);
  };
  expect((await post({})).status).toBe(200);
  expect((await post({ decide: "1" })).status).toBe(200);
  expect(asked).toEqual([false, true]);
});

const state = (put: number, cut: number, decideMs: number, ticks: number, mover: DecideState["mover"] = null): ServerState => ({
  parts: { names: ["creatures", "decide"], all: [5, decideMs], ticks, limit: 50 },
  decide: { points: [{ name: "nav.ring", policy: "rule", put, answered: put - cut, cut, backPut: 2, backCut: cut }, { name: "nav.snag", policy: "off", put: 0, answered: 0, cut: 0, backPut: 0, backCut: 0 }], caps: [64, 32, 8], overflow: 0, most: 4, backMost: 2, worst: 1.5, mover },
}) as unknown as ServerState;

test("the section says each point's counts since the last ask, and the mover", () => {
  const first = decideLines(state(10, 2, 3, 30), null);
  expect(first[0]!.text).toStartWith("0.10 ms a tick since the start, worst 1.5 ms · caps 64 / 32 / 8");
  expect(first[1]!.text).toBe("nav.ring rule · put 10, 2 background · answered 8 · cut 2, 2 background");
  expect(first[2]).toEqual({ text: "nav.snag off", tone: 1 });
  const next = decideLines(state(25, 2, 6, 60, { e: 7, metres: 3.2, about: { rung: 2, held: 5 } }), state(10, 2, 3, 30));
  expect(next[0]!.text).toStartWith("0.10 ms a tick since the last ask");
  expect(next[1]!.text).toBe("nav.ring rule · put 15, 0 background · answered 15 · cut 0");
  expect(next.at(-1)!.text).toBe("mover 7, 3.2 m off: rung 2, held 5");
  expect(moverText(null)).toBe("No mover near you that the decider can describe.");
  // A tick's cut over what the background gave up is a warning.
  expect(decideLines(state(10, 3, 3, 30), null)[1]!.tone).toBe(0);
  expect(decideLines({ ...state(10, 3, 3, 30), decide: { ...state(10, 3, 3, 30).decide!, points: [{ name: "a", policy: "rule", put: 4, answered: 1, cut: 3, backPut: 0, backCut: 0 }] } }, null)[1]!.tone).toBe(2);
});

test("the Server tab asks for the decider while shown and lays it out in the drawer", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), port = fakePort();
  const app = new App(h.join("dee", { latencyMs: 20 }, { manual: true }), h.reg, parsePack(corePackBytes()));
  app.debugPort = async () => port;
  let W = 1280, H = 720;
  const run = (ms: number): void => h.run(ms, (now) => {
    const p = app.frame(now, W, H);
    if (p) app.drawn(p, 2, W, H, 0, 1);
  });
  // A tenth of a second at a time, letting what the port answers come in between, as a browser does.
  const play = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 100) {
      run(Math.min(100, ms - t));
      await Bun.sleep(0);
    }
  };
  run(600);
  app.session.text("enablecheats");
  app.ui.settings.debug = true;
  for (let i = 0; i < 400 && !app.ui.debug?.port; i++) {
    run(20);
    await Bun.sleep(2);
  }
  const bar = app.ui.debug as DebugBar;
  const server = bar.tabs.findIndex((t) => t.name === "Server");
  const asked = () => port.posted.filter((p) => p.path === "__debug").map((p) => p.fields.get("decide") ?? "");
  bar.show(0);
  await play(5000);
  expect(asked().length).toBeGreaterThan(0);
  expect(asked().every((d) => d === "")).toBe(true);
  bar.show(server);
  await play(1500);
  expect(asked().at(-1)).toBe("1");
  // The answer, as a server with a busy decider gives it, laid out at the windows players have.
  const s = serverState(h.host, new TickMeter(() => gaugesOf(h.host)), h.server.clients.find((c) => c !== null)!, Date.now(), true);
  s.decide = state(10, 2, 3, 30, { e: 7, metres: 3.2, about: { rung: 2, held: 5 } }).decide!;
  bar.answer({ lines: [], next: 0, server: s });
  for (const [w, ht] of [[1280, 720], [1920, 1080], [844, 390], [390, 844]] as const) {
    W = w;
    H = ht;
    bar.show(server);
    run(40);
    const f = app.ui.frame, ours = f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_DEBUG && n.key < KEY_DEBUG + 4000), drawer = ours[0]!;
    const texts = ours.map((n) => n.text);
    if (ht >= 720) expect(texts, `${w}x${ht}`).toContain("DECIDE");
    for (const n of ours.slice(1).filter((n) => n.y < drawer.y + drawer.h - 0.5)) {
      expect(n.x >= -0.01 && n.x + n.w <= f.width + 0.01 && n.y >= drawer.y - 0.01 && n.y + n.h <= drawer.y + drawer.h + 0.5, `${w}x${ht}: "${n.text}" at ${n.x},${n.y} ${n.w}x${n.h}`).toBe(true);
      if (n.text && n.kind === 1) expect(textWidth(n.text, n.style)).toBeLessThanOrEqual(n.w + 0.01);
    }
  }
  // Shut, the drawer asks for no decider.
  bar.open = false;
  const before = asked().length;
  await play(5000);
  expect(asked().length).toBeGreaterThan(before);
  expect(asked().slice(before).every((d) => d === "")).toBe(true);
});
