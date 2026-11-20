// Bots together on a server in process: grunt runtimes, each through its own gateway connection (agent/gateway.ts,
// agent/grunt.ts), as SNARK survivors. One asks another for a high five; the other's idle (grunt/idle.ts) hears the
// game's invite and answers; the server stands them face to face and both play it from one tick. A third, playful,
// joins a dance it sees, in step.

import { expect, test } from "bun:test";
import { Endpoint } from "../../grunt/endpoint.ts";
import { memoryLink } from "../../grunt/link.ts";
import type { PersonaInput } from "../../grunt/persona.ts";
import { Runtime } from "../../grunt/runtime.ts";
import { type Clock, Session } from "../../grunt/session.ts";
import { SNARK_CAPABILITIES, SNARK_LIMITS } from "../../agent/gateway.ts";
import { SnarkWorld } from "../../agent/grunt.ts";
import { Agent } from "../../agent/tools.ts";
import { EMOTE_NUMBER } from "../../shared/anim/emotes.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

async function bots(names: string[], personas: Record<string, string | PersonaInput>) {
  const h = new Harness({}, 1, 60, { dev: true });
  const g = flatGround(h, 30, 30);
  const each = names.map((name, k) => {
    const s = h.join(name, {}, { manual: true });
    const world = new SnarkWorld(new Agent(s), name);
    const ep = new Endpoint(world, { capabilities: () => world.capabilities(SNARK_CAPABILITIES), limits: SNARK_LIMITS, game: { name: "SNARK", version: "0" }, tickMs: 1000 / 60 });
    return { name, s, world, ep, k };
  });
  const timers: { every: number; next: number; fn: () => void; on: boolean }[] = [];
  let now = 0;
  const clock: Clock = {
    now: () => now,
    every: (ms, fn) => {
      const t = { every: ms, next: now + ms, fn, on: true };
      timers.push(t);
      return () => void (t.on = false);
    },
  };
  const run = (ms: number) =>
    h.run(ms, (t) => {
      for (const b of each) b.world.step(t), b.ep.afterStep();
      now = each[0]!.world.t;
      for (const tm of timers) {
        while (tm.on && now >= tm.next) {
          tm.next += tm.every;
          tm.fn();
        }
      }
    });
  run(800);
  // Side by side on open ground, two metres apart.
  for (const b of each) {
    h.say(b.s, "enablecheats");
    h.say(b.s, `tp ${(g.x + 10 + b.k * 2).toFixed(3)} ${(g.z + 15).toFixed(3)}`);
  }
  run(500);
  const rts = new Map<string, Runtime>();
  for (const b of each) {
    const session = new Session(memoryLink((send) => b.ep.connect(send)), clock);
    const rt = new Runtime({ session, clock, persona: personas[b.name], seed: 3 + b.k });
    await rt.connect(b.name);
    rt.run();
    rts.set(b.name, rt);
  }
  run(600);
  const ent = (name: string) => h.ent(each.find((b) => b.name === name)!.s);
  const word = (name: string) => {
    const st = new AnimState();
    st.unpackEmote(h.world.ents.emote[ent(name)]!);
    return st;
  };
  return { h, run, rts, ent, word };
}

test("one bot asks another for a high five: the other's idle answers the game's invite, and both play it from one tick", async () => {
  const b = await bots(["Ana", "Bo"], { Ana: "cheerful", Bo: "cheerful" });
  const ana = b.rts.get("Ana")!;
  const ask = ana.start("emote", { name: "high_five", target: `e${b.ent("Bo")}` });
  for (let k = 0; k < 40 && b.word("Bo").emote === 0; k++) b.run(100);
  expect(ask.status).not.toBe("failed");
  const [a, o] = [b.word("Ana"), b.word("Bo")];
  expect(a.emote).toBe(EMOTE_NUMBER.get("high_five")!);
  expect(o.emote).toBe(EMOTE_NUMBER.get("high_five")!);
  expect(a.emoteStart).toBe(o.emoteStart);
  // Bo's runtime heard the invite as the protocol's event, and its idle said yes.
  expect(b.rts.get("Bo")!.belief.events.some((e) => e.kind === "invited")).toBe(true);
  expect(b.rts.get("Bo")!.trace.of("answer").at(-1)).toMatchObject({ yes: true });
});

test("a playful bot joins a dance it sees, in step with the dancer", async () => {
  const b = await bots(["Ana", "Cy"], { Ana: "stoic", Cy: { name: "dancer", traits: { playful: 1 } } });
  b.rts.get("Ana")!.start("emote", { name: "disco", seconds: 20 });
  for (let k = 0; k < 40 && b.word("Cy").emote === 0; k++) b.run(100);
  expect(b.word("Ana").emote).toBe(EMOTE_NUMBER.get("disco")!);
  expect(b.word("Cy").emote).toBe(EMOTE_NUMBER.get("disco")!);
  expect(b.word("Cy").emoteStart).toBe(b.word("Ana").emoteStart);
});
