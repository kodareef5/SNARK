// A character's idle and its answers to others' emotes (grunt/idle.ts), on the mock world: as its persona is, seeded so
// the same seed makes the same choices, never while it has something to do, and never a model call.

import { expect, test } from "bun:test";
import { memoryLink } from "../../grunt/link.ts";
import type { PersonaInput } from "../../grunt/persona.ts";
import { Runtime } from "../../grunt/runtime.ts";
import { type Clock, Session } from "../../grunt/session.ts";
import { GameEndpoint } from "../../tools/grunt/game.ts";
import { makeWorld, type Scene } from "../../tools/grunt/scenes.ts";
import { EMOTE_SPECS } from "../../tools/grunt/world.ts";

async function harness(scene: Scene, opts: { persona?: string | PersonaInput; seed?: number; lively?: boolean; owners?: string[] } = {}) {
  const world = makeWorld(scene);
  const game = new GameEndpoint(world);
  const timers: { every: number; next: number; fn: () => void; on: boolean }[] = [];
  const clock: Clock = {
    now: () => world.t,
    every: (ms, fn) => {
      const t = { every: ms, next: world.t + ms, fn, on: true };
      timers.push(t);
      return () => void (t.on = false);
    },
  };
  const session = new Session(memoryLink((send) => game.connect(send)), clock);
  const rt = new Runtime({ session, clock, owners: opts.owners ?? [], persona: opts.persona, seed: opts.seed ?? 7, lively: opts.lively ?? false });
  await rt.connect("Scout");
  rt.run();
  const run = (ms: number, done: () => boolean = () => false) => {
    const end = world.t + ms;
    while (world.t < end && !done()) {
      world.step();
      game.afterStep();
      for (const t of timers) {
        while (t.on && world.t >= t.next) {
          t.next += t.every;
          t.fn();
        }
      }
    }
  };
  const id = (name: string) => [...world.things.values()].find((t) => t.name === name)!.id;
  const mine = () => world.emoted.filter((e) => e.who === "Scout");
  return { world, rt, run, id, mine };
}

const tagsOf = (name: string) => EMOTE_SPECS.find((e) => e.name === name)?.tags ?? [];
const near = (extra: Record<string, unknown> = {}): Scene => ({ me: { x: 0, z: 0, yaw: 0 }, things: [{ type: "player", name: "Ana", x: 0, z: -3, ...extra }] });

test("the game's emotes reach the character with its welcome", async () => {
  const h = await harness(near());
  expect(h.rt.belief.emotes?.length).toBe(EMOTE_SPECS.length);
  expect(h.rt.belief.emotes?.find((e) => e.name === "high_five")?.pair).toBeDefined();
});

test("a wave from a player near is waved back, once in a while, however busy the idle is not", async () => {
  const h = await harness(near(), { persona: "cheerful" });
  h.world.playerEmote(h.id("Ana"), "wave");
  h.run(1500);
  expect(h.mine().length).toBe(1);
  expect(tagsOf(h.mine()[0]!.name).some((t) => t === "greeting" || t === "friendly")).toBe(true);
  // Waved at again at once: not answered twice.
  h.world.playerEmote(h.id("Ana"), "wave_big");
  h.run(1500);
  expect(h.mine().length).toBe(1);
  expect(h.rt.trace.of("answer").length).toBeGreaterThan(0);
});

test("an invite to a high five is taken by a social persona, a hug turned down by a shy one", async () => {
  const yes = await harness(near(), { persona: "cheerful" });
  yes.world.playerEmote(yes.id("Ana"), "high_five", true);
  yes.run(1500);
  expect(yes.mine().map((e) => [e.name, e.target])).toEqual([["high_five", "Ana"]]);
  // Both sides played: Ana's too.
  expect(yes.world.emoted.some((e) => e.who === "Ana" && e.name === "high_five")).toBe(true);
  const no = await harness(near(), { persona: "shy" });
  no.world.playerEmote(no.id("Ana"), "hug", true);
  no.run(1500);
  expect(no.mine()).toEqual([]);
  expect(no.rt.trace.of("answer").at(-1)).toMatchObject({ yes: false });
});

test("an owner's invite is always taken, even by one who would turn a stranger down", async () => {
  const h = await harness(near(), { persona: "shy", owners: ["Ana"] });
  h.world.playerEmote(h.id("Ana"), "hug", true);
  h.run(1500);
  expect(h.mine().map((e) => e.name)).toEqual(["hug"]);
});

test("a playful one joins a dance near it, in step", async () => {
  const h = await harness(near(), { persona: { name: "dancer", traits: { playful: 1 } } });
  h.world.playerEmote(h.id("Ana"), "disco");
  h.run(1500);
  expect(h.mine().map((e) => e.name)).toEqual(["disco"]);
  expect(h.world.me.emote?.name).toBe("disco");
});

test("lively, a menacing one meets a stranger with something scary, and a cheerful one alone dances", async () => {
  const spooky = await harness(near({ x: 0, z: -9 }), { persona: "spooky", lively: true, seed: 3 });
  spooky.run(120_000, () => spooky.mine().length > 0 || spooky.rt.tasks.some((t) => t.by === "idle"));
  const idle = spooky.rt.trace.of("idle");
  expect(idle.length).toBeGreaterThan(0);
  expect(String(idle[0]!.why)).toContain("menacing");
  const cheer = await harness({ me: { x: 0, z: 0, yaw: 0 } }, { persona: "cheerful", lively: true, seed: 5 });
  cheer.run(240_000, () => cheer.mine().length >= 2);
  expect(cheer.mine().length).toBeGreaterThan(0);
  expect(cheer.mine().some((e) => tagsOf(e.name).some((t) => ["dance", "fun", "silly", "exercise", "showoff"].includes(t)))).toBe(true);
});

test("the same seed makes the same choices", async () => {
  const picks = async () => {
    const h = await harness({ me: { x: 0, z: 0, yaw: 0 } }, { persona: "showoff", lively: true, seed: 11 });
    h.run(240_000);
    return h.rt.trace.of("idle").map((r) => [r.why, r.tags ?? r.routine]);
  };
  const a = await picks();
  expect(a.length).toBeGreaterThan(1);
  expect(await picks()).toEqual(a);
});

test("nothing idles while a task has the body, and answers wait for it", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0 }, things: [{ type: "player", name: "Ana", x: 0, z: -3 }] }, { persona: "cheerful", lively: true });
  const task = h.rt.start("walk_to", { x: 0, z: 200 });
  h.world.playerEmote(h.id("Ana"), "wave");
  h.run(30_000, () => task.status !== "running");
  expect(h.mine()).toEqual([]);
  expect(h.rt.trace.of("idle")).toEqual([]);
});

test("a routine plays its emotes in order; the Director's emote asks a player for a pair, who answers", async () => {
  const h = await harness(near({ accepts: true }), { persona: "stoic" });
  const lap = h.rt.start("perform", { routine: "victory_lap" });
  h.run(60_000, () => lap.status !== "running");
  expect(lap.status).toBe("done");
  expect(h.mine().map((e) => e.name)).toEqual(["fist_pump", "victory_jump", "side_shuffle"]);
  const ask = h.rt.start("emote", { name: "high_five", target: h.id("Ana") });
  h.run(5000, () => ask.status !== "running");
  expect(ask.result?.summary).toContain("asked");
  h.run(3000);
  expect(h.mine().at(-1)).toMatchObject({ name: "high_five", target: "Ana" });
  expect(h.world.emoted.some((e) => e.who === "Ana" && e.name === "high_five")).toBe(true);
  // A pair with nobody named is refused with a reason.
  const alone = h.rt.start("emote", { name: "hug" });
  h.run(1000, () => alone.status !== "running");
  expect(alone.result?.summary).toContain("for two");
});
