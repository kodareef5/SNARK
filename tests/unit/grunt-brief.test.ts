import { expect, test } from "bun:test";
import { brief, type Situation } from "../../grunt/brief.ts";
import { memoryLink } from "../../grunt/link.ts";
import { Runtime } from "../../grunt/runtime.ts";
import { type Clock, Session } from "../../grunt/session.ts";
import { GameEndpoint } from "../../tools/grunt/game.ts";
import { makeWorld, type Scene } from "../../tools/grunt/scenes.ts";

async function harness(scene: Scene, owners: string[] = []) {
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
  const rt = new Runtime({ session: new Session(memoryLink((send) => game.connect(send)), clock), clock, owners });
  await rt.connect("Scout");
  rt.run();
  const run = (ms: number, done: () => boolean = () => false) => {
    const end = world.t + ms;
    while (world.t < end && !done()) {
      world.step();
      game.afterStep();
      for (const t of timers) while (t.on && world.t >= t.next) (t.next += t.every), t.fn();
    }
  };
  const situation = (over: Partial<Situation> = {}): Situation => ({ rt, goals: [{ id: "g1", text: "build a hut", status: "active", at: 0 }], lastSaid: -Infinity, ...over });
  return { world, rt, run, situation };
}

test("calm, the brief is the goal, the body and what it is doing, and nothing else", async () => {
  const h = await harness({ me: { items: { stone_hatchet: 1 } } });
  h.run(300);
  const b = brief(h.situation());
  expect(b.cards).toEqual(["goal", "self", "doing", "idle"]);
  expect(b.text).toContain('g1: "build a hut"');
  expect(b.text).toContain("Doing: nothing: you are idle.");
});

test("a build short of materials gets an exact plan: how many trees and bushes, the calls, then resume", async () => {
  const h = await harness({ me: { items: { stone_hatchet: 1 } }, things: [{ type: "tree", x: 5, z: -5 }, { type: "bush", x: -4, z: 3 }] });
  const t = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(2000, () => t.status !== "running");
  expect(t.status).toBe("blocked");
  const b = brief(h.situation());
  expect(b.cards).toContain("materials");
  expect(b.text).toContain('1. game_do harvest {"kind": "tree", "count": 300} (about 10 trees: wood and thatch come together; you know of 1)');
  expect(b.text).toContain('2. game_do harvest {"kind": "bush", "count": 40} (about 4 bushes; you know of 1)');
  expect(b.text).toContain(`3. game_do {"resume": "${t.id}"} to build`);
  expect(b.text).toContain("You know of too few");
});

test("a line said to the character stays in the brief until the character says something", async () => {
  const h = await harness({ things: [{ type: "player", x: 6, z: 4, name: "Ana" }] }, ["Ana"]);
  h.run(300);
  h.world.say("Ana", "Scout, come here");
  h.run(300);
  const asked = brief(h.situation());
  expect(asked.cards).toContain("unanswered");
  expect(asked.text).toMatch(/Ana \(e:\d+, an owner, 7 m south-east\): "Scout, come here"/);
  expect(brief(h.situation({ lastSaid: h.rt.belief.now })).cards).not.toContain("unanswered");
});

test("a failed call is in the brief with the skill's real parameters", async () => {
  const h = await harness({});
  h.run(200);
  const b = brief(h.situation({ lastError: { tool: "game_do", args: { skill: "harvest", args: { id: "n:2" } }, message: "harvest takes kind, target, count, radius, not id" } }));
  expect(b.cards).toContain("tool-error");
  expect(b.text).toContain('Your last game_do failed: harvest takes kind, target, count, radius, not id. harvest takes: {"kind":"tree | rock | bush"');
});

test("the brief keeps to its budget, dropping the least relevant first", async () => {
  const h = await harness({});
  h.run(200);
  const b = brief(h.situation({ lastError: { tool: "game_do", args: {}, message: "x".repeat(300) } }), undefined, 200);
  expect(b.cards).toContain("goal");
  expect(b.cards).not.toContain("idle");
});

test("while a task runs and nothing is wrong, there is no brief: the frame alone is not sent", async () => {
  const h = await harness({ me: { items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [{ type: "tree", x: 2, z: -6 }] });
  h.rt.start("harvest", { kind: "tree" });
  h.run(1500);
  expect(h.rt.current?.skill).toBe("harvest");
  expect(brief(h.situation())).toEqual({ text: "", cards: [] });
});

test("the recurring-threat card is there while the threat is, and gone once it is dead", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [{ type: "tree", x: 2, z: -12 }, { type: "raptor", x: 2, z: -18 }] });
  const t = h.rt.start("harvest", { kind: "tree" });
  h.run(3000, () => t.status === "blocked");
  expect(t.status).toBe("blocked");
  expect(brief(h.situation()).cards).toContain("recurring-threat");
  const raptor = [...h.world.things.values()].find((x) => x.type === "raptor")!;
  const fight = h.rt.start("fight", { target: raptor.id });
  h.run(60_000, () => fight.status !== "running");
  expect(h.world.things.has(raptor.id)).toBe(false);
  expect(brief(h.situation()).cards).not.toContain("recurring-threat");
});
