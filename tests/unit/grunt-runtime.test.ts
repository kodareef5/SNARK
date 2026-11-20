import { expect, test } from "bun:test";
import { memoryLink } from "../../grunt/link.ts";
import { Runtime } from "../../grunt/runtime.ts";
import { type Clock, Session } from "../../grunt/session.ts";
import { GameEndpoint } from "../../tools/grunt/game.ts";
import { makeWorld, type Scene } from "../../tools/grunt/scenes.ts";

/** grunt's runtime and the mock world in one process, in lockstep: the runtime's clock is the world's. */
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
  const session = new Session(memoryLink((send) => game.connect(send)), clock);
  const rt = new Runtime({ session, clock, owners });
  await rt.connect("Scout");
  rt.run();
  /** Steps the world until `ms` have passed or `done()` holds. */
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
  return { world, rt, run };
}

const grove: Scene = {
  me: { x: 0, z: 0, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" },
  things: [{ type: "tree", x: 2, z: -6 }, { type: "tree", x: -3, z: -9 }, { type: "tree", x: 4, z: -12 }],
};

test("harvest finds the trees, walks to each, faces it and swings until it is gone, then stops when none is near", async () => {
  const h = await harness(grove);
  const task = h.rt.start("harvest", { kind: "tree" });
  h.run(120_000, () => task.status !== "running");
  expect(task.status).toBe("done");
  expect([...h.world.things.values()].filter((t) => t.type === "tree")).toEqual([]);
  expect(h.world.count("wood")).toBe(450);
  expect(task.progress.targets).toBe(3);
  expect(task.result!.summary).toContain("450 wood");
  // Each tree was chosen (nearest first), and taken with one action: the game's harvest assist swings.
  const targets = h.rt.trace.of("decision").filter((d) => d.point === "harvest.target").map((d) => d.choice);
  expect(targets.length).toBe(3);
  const acts = h.rt.trace.of("act").flatMap((r) => r.actions as { control: string }[]);
  expect(acts.filter((a) => a.control === "assist").length).toBe(3);
  expect(acts.some((a) => a.control === "use")).toBe(false);
  expect(h.rt.reports.at(-1)).toMatchObject({ kind: "task", data: { skill: "harvest", status: "done" } });
});

test("harvest stops at a count of wood, and is blocked when the trees run out first", async () => {
  const h = await harness(grove);
  const some = h.rt.start("harvest", { kind: "tree", count: 60 });
  h.run(60_000, () => some.status !== "running");
  expect(some.status).toBe("done");
  expect(h.world.count("wood")).toBeGreaterThanOrEqual(60);
  expect(h.world.count("wood")).toBeLessThan(100);
  const more = h.rt.start("harvest", { kind: "tree", count: 2000 });
  h.run(120_000, () => more.status !== "running");
  expect(more.status).toBe("blocked");
  expect(more.result!.summary).toMatch(/no trees left that I know of; .*short of \d+ wood/);
});

test("a raptor that comes hunting puts the harvest aside: the character runs, lives, and goes back to the trees", async () => {
  const h = await harness(grove);
  const task = h.rt.start("harvest", { kind: "tree" });
  h.run(3000);
  // A raptor comes out of the brush 16 m off, mid-harvest, and hunts.
  h.world.place("creature", "raptor", h.world.me.x + 16, h.world.me.z);
  h.run(90_000, () => h.rt.trace.of("task").some((r) => r.status === "resumed"));
  const changes = h.rt.trace.of("task").map((r) => `${r.skill}:${r.status}`);
  expect(changes).toContain("harvest:suspended");
  expect(changes).toContain("flee:started");
  expect(changes.at(-1)).toBe("harvest:resumed");
  expect(h.world.me.alive).toBe(true);
  expect(task.status).toBe("running");
  expect(h.rt.reports.some((r) => r.kind === "danger" && r.text.includes("raptor"))).toBe(true);
  expect(h.rt.trace.of("decision").find((d) => d.point === "arbiter.interrupt")!).toMatchObject({ choice: "interrupt", policy: "rules" });
});

test("a raptor seen by the grove from the start blocks the harvest for the Director, and its death lets it go on", async () => {
  const h = await harness({ ...grove, things: [...grove.things!, { type: "raptor", x: 6, z: -22 }] });
  const task = h.rt.start("harvest", { kind: "tree" });
  h.run(2000, () => task.status !== "running");
  expect(task.status).toBe("blocked");
  expect(task.result!.summary).toContain("near the raptor");
  const raptor = [...h.world.things.values()].find((t) => t.type === "raptor")!;
  const fight = h.rt.start("fight", { target: raptor.id });
  h.run(60_000, () => fight.status !== "running");
  expect(h.world.things.has(raptor.id)).toBe(false);
  expect(h.rt.reports.find((r) => r.kind === "clear")!.text).toContain(`harvest ${task.id} goes on by itself`);
  h.run(300_000, () => task.status === "done");
  expect(task.status).toBe("done");
  expect([...h.world.things.values()].some((t) => t.type === "tree")).toBe(false);
});

test("a line with the character's name, or from its owner, reaches the Director; other talk does not", async () => {
  const h = await harness({}, ["Ana"]);
  h.world.say("Bob", "nice weather");
  h.world.say("Bob", "Scout, come here");
  h.world.say("Ana", "follow me");
  h.run(500);
  expect(h.rt.reports.filter((r) => r.kind === "addressed").map((r) => r.text)).toEqual(['Bob (not in sight): "Scout, come here"', 'Ana (an owner, not in sight): "follow me"']);
});

test("craft makes what the inventory screen offers, and says what is missing otherwise", async () => {
  const h = await harness({ me: { items: { wood: 100, thatch: 25, fiber: 20 } } });
  const ok = h.rt.start("craft", { item: "piece_foundation_wood", count: 1 });
  h.run(8000, () => ok.status !== "running");
  expect(ok).toMatchObject({ status: "done" });
  h.run(1000);
  const no = h.rt.start("craft", { item: "piece_foundation_wood", count: 2 });
  h.run(1000, () => no.status !== "running");
  expect(no.status).toBe("blocked");
  expect(no.result!.summary).toContain("I can make 0 piece_foundation_wood, not 2");
});

test("a raptor that keeps coming back is fought with the hatchet on the third time, and the trees are finished", async () => {
  const h = await harness(grove);
  const task = h.rt.start("harvest", { kind: "tree" });
  h.run(3000);
  h.world.place("creature", "raptor", h.world.me.x + 16, h.world.me.z);
  h.run(300_000, () => task.status !== "running" && task.status !== "suspended");
  expect(task.status).toBe("done");
  expect(h.world.me.alive).toBe(true);
  expect([...h.world.things.values()].some((t) => t.type === "raptor" || t.type === "tree")).toBe(false);
  const respond = h.rt.trace.of("decision").filter((d) => d.point === "threat.respond").map((d) => d.choice);
  expect(respond).toContain("flee");
  expect(respond.at(-1)).toBe("fight");
  // It never went back to work out of breath.
  expect(h.rt.reports.some((r) => r.kind === "critical")).toBe(false);
});

const HUT_PIECES = { piece_foundation_wood: 4, piece_wall_wood: 8, piece_door_wood: 1, piece_ceiling_wood: 4 };

test("build puts up a library layout from the pieces in the bag through the helper: one check, then sections, no aiming", async () => {
  const { stands } = await import("../../tools/grunt/play.ts");
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: HUT_PIECES } });
  const task = h.rt.start("build", { blueprint: "hut_2x2", section: 10 });
  h.run(120_000, () => task.status !== "running");
  expect(task.result?.summary).toBe("built the hut_2x2 (wood) at 0, -6, front facing south: 17 pieces");
  expect(stands(h.world, "hut_2x2")).toBe(true);
  const acts = h.rt.trace.of("act").flatMap((r) => r.actions as { control: string; op?: string }[]);
  expect(acts.filter((x) => x.control === "plan").map((x) => x.op)).toEqual(["check", "build", "build"]);
  expect(acts.some((x) => x.control === "use")).toBe(false);
  // Built in front of the character, the front facing back to where it stood.
  expect(h.world.structures.bases.size).toBe(1);
});

test("build crafts the pieces it lacks from materials first, and says what is short when it cannot", async () => {
  const { stands } = await import("../../tools/grunt/play.ts");
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { wood: 900, thatch: 227, fiber: 160 } } });
  const task = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(400_000, () => task.status !== "running");
  expect(task.status).toBe("done");
  expect(stands(h.world, "hut_2x2", "wood")).toBe(true);
  const poor = await harness({ me: { items: { wood: 30, thatch: 10, fiber: 10 } } });
  const t2 = poor.rt.start("build", { blueprint: "hut_2x2" });
  poor.run(10_000, () => t2.status !== "running");
  expect(t2.status).toBe("blocked");
  expect(t2.result!.summary).toBe("the hut_2x2 takes 900 wood, 227 thatch, 160 fiber to craft its 17 missing pieces; I'm short of 870 more wood, 217 more thatch, 150 more fiber");
  // Only checking: where it would go and what it takes, nothing built.
  const look = poor.rt.start("build", { blueprint: "house_3x3", tier: "stone", check: true });
  poor.run(5_000, () => look.status !== "running");
  expect(look.result!.summary).toMatch(/^the house_3x3 \(stone\) fits at .*: 31 pieces \(9 foundation, 9 ceiling, 10 wall, 1 doorframe, 2 windowframe, 1 door\)|^the house_3x3 \(stone\) fits at/);
  expect(poor.world.structures.bases.size).toBe(0);
});

test("a site with trees on it moves to the nearest ground that fits; a tier without a form is refused", async () => {
  const { stands } = await import("../../tools/grunt/play.ts");
  const trees = [[-3, -6], [0, -6], [3, -6], [-3, -9], [0, -9], [3, -9]].map(([x, z]) => ({ type: "tree" as const, x: x!, z: z! }));
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: HUT_PIECES }, things: trees });
  const task = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(120_000, () => task.status !== "running");
  expect(task.status).toBe("done");
  expect(stands(h.world, "hut_2x2")).toBe(true);
  expect([...h.world.things.values()].filter((t) => t.type === "tree").length).toBe(6);
  const thatch = h.rt.start("build", { blueprint: "house_3x3", tier: "thatch" });
  h.run(2_000, () => thatch.status !== "running");
  expect(thatch.result!.summary).toBe("thatch has no windowframe: build it in wood or stone, or leave them out");
});

test("a build stopped by something in the way says which piece and why, and goes on from there when taken up again", async () => {
  const { stands } = await import("../../tools/grunt/play.ts");
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { piece_foundation_wood: 9, piece_wall_wood: 13, piece_door_wood: 1, piece_ceiling_wood: 9 } } });
  const task = h.rt.start("build", { blueprint: "house_3x3" });
  h.run(1_500);
  // A rock rolls onto the last foundation's cell before it goes down.
  const base = [...h.world.things.values()].find((t) => t.piece)!;
  const b = h.world.structures.bases.get(base.piece!.base)!;
  const rock = h.world.place("resource", "rock", b.x + 6, b.z + 6);
  h.run(30_000, () => task.status !== "running");
  expect(task.status).toBe("blocked");
  expect(task.result!.summary).toBe(`the house_3x3 stopped at piece 8 of 31: the foundation at cell 2,2 storey 0: blocked (${rock})`);
  // The message says how to clear it.
  expect(h.rt.reports.at(-1)!.text).toContain(`Options: harvest it away (game_do harvest {"target": "${rock}", "only": true}), then game_do {"resume": "${task.id}"}`);
  // Taken up again with the rock still there: still blocked, by the same rock, not a broken layout.
  h.rt.retake(task.id);
  h.run(5_000, () => task.status !== "running");
  expect(task.status).toBe("blocked");
  expect(task.result!.summary).toBe(`the house_3x3 can't go on: the foundation at cell 2,2 storey 0: blocked (${rock})`);
  // Cleared with the suggested call (a pick for the rock), and taken up again: it goes on from there.
  h.world.give("stone_pick", 1);
  const clear = h.rt.start("harvest", { target: rock, only: true });
  h.run(120_000, () => clear.status !== "running");
  expect(clear.result!.summary).toStartWith(`the rock ${rock} is gone`);
  h.rt.retake(task.id);
  h.run(60_000, () => task.status !== "running");
  expect(task.status).toBe("done");
  expect(stands(h.world, "house_3x3")).toBe(true);
});

test("a blocked task taken up again keeps its place and progress: the harvest goes back to its own grove", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [{ type: "tree", x: 2, z: -6 }, { type: "tree", x: -3, z: -9 }] });
  const task = h.rt.start("harvest", { kind: "tree", count: 30 });
  h.run(60_000, () => task.status !== "running");
  expect(task.status).toBe("done");
  const away = h.rt.start("walk_to", { x: 0, z: 60 });
  h.run(60_000, () => away.status !== "running");
  h.rt.tasks[0]!.status = "blocked"; // as a danger would have left it
  h.rt.tasks[0]!.args = { kind: "tree" };
  const again = h.rt.retake(task.id);
  h.run(120_000, () => again.status !== "running");
  expect(again.status).toBe("done");
  expect([...h.world.things.values()].some((t) => t.type === "tree")).toBe(false);
  expect(h.world.count("wood")).toBe(300);
});

test("a speaker in sight is told with its id, distance and direction, so the Director can go to it", async () => {
  const h = await harness({ things: [{ type: "player", x: 8, z: 6, name: "Ana" }] }, ["Ana"]);
  h.run(500);
  h.world.say("Ana", "Scout, come here please");
  h.run(500);
  expect(h.rt.reports.find((r) => r.kind === "addressed")!.text).toMatch(/^Ana \(e:\d+, an owner, 10 m south-east\): "Scout, come here please"$/);
});

// --- Combat through the attack assist ---------------------------------------------------------------------------

test("fight takes a raptor down through the attack assist: one action, the win remembered", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [{ type: "raptor", x: 0, z: -12 }] });
  const raptor = [...h.world.things.values()].find((t) => t.type === "raptor")!.id;
  const t = h.rt.start("fight", { target: raptor });
  h.run(60_000, () => t.status !== "running");
  expect(t.status).toBe("done");
  expect(t.result!.summary).toMatch(/^the fight is over; 1 killed, 6 hits from 6 swings and 0 arrows; I lost \d+ health$/);
  const acts = h.rt.trace.of("act").flatMap((r) => r.actions as { control: string }[]);
  expect(acts.filter((a) => a.control === "assist").length).toBe(1);
  expect(h.rt.fights.at(-1)).toMatchObject({ foe: "raptor", won: true });
});

test("with a bow, the reflex shoots a hunting raptor from range rather than running, and goes back to work", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { bow: 1, arrow: 20 } }, things: [{ type: "tree", x: 2, z: -6 }, { type: "tree", x: -3, z: -9 }] });
  const task = h.rt.start("harvest", { kind: "tree" });
  h.run(2000);
  const raptor = h.world.place("creature", "raptor", h.world.me.x + 17, h.world.me.z + 4);
  h.run(60_000, () => !h.world.things.has(raptor));
  expect(h.world.things.has(raptor)).toBe(false);
  const respond = h.rt.trace.of("decision").filter((d) => d.point === "threat.respond");
  expect(respond[0]).toMatchObject({ choice: "fight", why: "I can shoot it from range" });
  expect(h.world.me.health).toBeGreaterThan(60);
  h.run(120_000, () => task.status === "done");
  expect(task.status).toBe("done");
});

test("fight all clears a pack of three raptors with a bow, one at a time, keeping its range", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { bow: 1, arrow: 40, stone_hatchet: 1 } }, things: [{ type: "raptor", x: -6, z: -38 }, { type: "raptor", x: 0, z: -42 }, { type: "raptor", x: 6, z: -38 }] });
  const t = h.rt.start("fight", { all: true });
  h.run(240_000, () => t.status !== "running");
  expect(t.status).toBe("done");
  expect([...h.world.things.values()].some((x) => x.type === "raptor")).toBe(false);
  expect(h.world.me.alive).toBe(true);
  expect(t.result!.summary).toStartWith("none is left; 3 killed");
  expect(h.rt.trace.of("decision").filter((d) => d.point === "fight.next").length).toBe(3);
});

test("a pack hunting a character with only a hatchet: the reflex runs", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" } });
  for (const dx of [-3, 0, 3]) h.world.place("creature", "raptor", dx, -17);
  h.run(1000);
  const respond = h.rt.trace.of("decision").filter((d) => d.point === "threat.respond");
  expect(respond[0]).toMatchObject({ choice: "flee", why: "too many to fight hand to hand" });
  expect(h.rt.summary().near).toContainEqual(expect.objectContaining({ type: "raptor", fight: "3 together: a losing fight in melee: run, or fight them from range (what players know; you have not fought one)" }));
});

test("travel flies a tek suit over a wall when it has the element for it, and walks round when it has not", async () => {
  const wall = { bounds: [-650, -400, 650, 60] as [number, number, number, number], features: [{ type: "cliff" as const, from: [-650, -150] as [number, number], to: [540, -150] as [number, number], width: 8, height: 30 }] };
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { tek_suit: 1, element: 40 } }, terrain: wall });
  const t = h.rt.start("travel", { x: 0, z: -300 });
  h.run(120_000, () => t.status !== "running");
  expect(t.result!.summary).toMatch(/^I'm at 0, -300 by the tek suit/);
  expect(h.rt.reports.some((r) => r.text.startsWith("going the tek suit"))).toBe(true);
  expect(h.world.count("element")).toBeLessThan(40);
  expect(h.world.me.y).toBeLessThan(1);
  const poor = await harness({ me: { x: 0, z: 0, yaw: 0, items: { tek_suit: 1, element: 3 } }, terrain: wall });
  const w = poor.rt.start("travel", { x: 0, z: -300 });
  poor.run(2_000);
  expect(w.progress.way).toBe("walk");
});
