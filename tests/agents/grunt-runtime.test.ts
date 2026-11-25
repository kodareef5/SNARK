import { expect, test } from "bun:test";
import { memoryLink } from "../../grunt/link.ts";
import { Runtime } from "../../grunt/runtime.ts";
import { type Clock, Session } from "../../grunt/session.ts";
import { GameEndpoint } from "../../tools/grunt/game.ts";
import { makeWorld, type Scene } from "../../tools/grunt/scenes.ts";
import { stands } from "../../tools/grunt/play.ts";

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

test("a line with the character's name, or from its owner, reaches the Director at once; other talk comes overheard", async () => {
  const h = await harness({}, ["Ana"]);
  h.world.say("Bob", "nice weather");
  h.world.say("Bob", "Scout, come here");
  h.world.say("Ana", "follow me");
  h.world.say("Cy", "the scouting party left");
  h.run(500);
  expect(h.rt.reports.filter((r) => r.kind === "addressed").map((r) => r.text)).toEqual(['Bob (not in sight): "Scout, come here"', 'Ana (an owner, not in sight): "follow me"']);
  // The rest waits a moment, so a burst comes as one.
  expect(h.rt.reports.some((r) => r.kind === "overheard")).toBe(false);
  h.run(2500);
  expect(h.rt.reports.filter((r) => r.kind === "overheard").map((r) => r.text)).toEqual(['chat, not said to you by name:\n- Bob (not in sight) in local chat: "nice weather"\n- Cy (not in sight) in local chat: "the scouting party left"']);
});

test("overheard chat is told at most every 20 s, its own lines never, and a call for help in global is among it", async () => {
  const h = await harness({});
  h.world.say("Mia", "anyone near the red ob? need help", "global");
  h.world.say("Scout", "Scout here, happy to help anyone", "global");
  h.run(3000);
  h.world.say("Mia", "hello??", "global");
  h.run(10_000);
  const told = () => h.rt.reports.filter((r) => r.kind === "overheard" || r.kind === "addressed").map((r) => r.text);
  expect(told()).toEqual(['chat, not said to you by name:\n- Mia (not in sight) in global chat: "anyone near the red ob? need help"']);
  h.run(10_000);
  expect(told()).toEqual(['chat, not said to you by name:\n- Mia (not in sight) in global chat: "anyone near the red ob? need help"', 'chat, not said to you by name:\n- Mia (not in sight) in global chat: "hello??"']);
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
  expect(task.result?.summary).toBe("built the hut_2x2 (wood) at 0, -6, front facing south: 17 pieces (4 foundation, 7 wall, 1 doorframe, 1 door, 4 ceiling), base b:1");
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
  // A tier without a form: a wall where the window was, said so; strict, refused.
  const thatch = h.rt.start("build", { blueprint: "house_3x3", tier: "thatch", check: true });
  h.run(2_000, () => thatch.status !== "running");
  expect(thatch.result!.summary).toContain("Note: thatch has no windowframe: a wall in its place");
  const strict = h.rt.start("build", { blueprint: "house_3x3", tier: "thatch", strict: true });
  h.run(2_000, () => strict.status !== "running");
  expect(strict.result!.summary).toBe("the house_3x3 cannot be built in thatch here: thatch has no windowframe");
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

// --- Hauling, company, repair, the saddle, the tribe, speech -----------------------------------------------------

test("empty clears a harvester into the vaults in trips, keeping the character's own gear", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { stone_pick: 1, wood: 30 } }, things: [
    { type: "ankylo", x: 8, z: -4, items: { stone: 1400, flint: 300, metal: 200 } },
    { type: "vault", x: -6, z: -6, name: "Stone vault" }, { type: "vault", x: -6, z: 0, name: "Spare vault" },
  ] });
  const anky = [...h.world.things.values()].find((t) => t.type === "ankylo")!;
  const t = h.rt.start("empty", { from: anky.id, to: "Stone vault" });
  h.run(400_000, () => t.status !== "running");
  expect(t.status).toBe("done");
  expect(anky.slots).toEqual([]);
  const v = (name: string) => [...h.world.things.values()].find((x) => x.name === name)!.slots!.reduce((n, s) => n + s.count, 0);
  expect(v("Stone vault") + v("Spare vault")).toBe(1900);
  expect(h.world.count("stone_pick")).toBe(1);
  expect(h.world.count("wood")).toBe(30);
  expect(t.result!.summary).toMatch(/^emptied ankylo into Stone vault: 1400 stone, 300 flint, 200 metal in \d+ trips$/);
  expect(Number(t.result!.data!.trips)).toBeGreaterThan(2);
});

test("organize sends each item to the box named for it or its kind, else where most of it is", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0 }, things: [
    { type: "chest", x: -4, z: -4, name: "Food box", items: { stone: 50, berries: 5 } },
    { type: "vault", x: 0, z: -6, name: "Stone vault", items: { wood: 80, meat: 6 } },
    { type: "chest", x: 4, z: -4, name: "Odds", items: { wood: 200, berries: 10, stone: 30 } },
  ] });
  const t = h.rt.start("organize", {});
  h.run(400_000, () => t.status !== "running");
  expect(t.status).toBe("done");
  const has = (name: string) => [...h.world.things.values()].find((x) => x.name === name)!.slots!.reduce((o: Record<string, number>, s) => ((o[s.item] = (o[s.item] ?? 0) + s.count), o), {});
  expect(has("Food box")).toEqual({ berries: 15, meat: 6 });
  expect(has("Stone vault")).toEqual({ stone: 80 });
  expect(has("Odds")).toEqual({ wood: 280 });
});

test("loot takes what a kill leaves; migrate moves one base's stores to another", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [
    { type: "raptor", x: 0, z: -10 },
    { type: "chest", x: 30, z: 0, name: "Old box", items: { stone: 300, flint: 50 } }, { type: "chest", x: 34, z: 2, name: "Old box 2", items: { wood: 120 } },
    { type: "vault", x: 0, z: 40, name: "New vault" },
  ] });
  const raptor = [...h.world.things.values()].find((t) => t.type === "raptor")!.id;
  const f = h.rt.start("fight", { target: raptor });
  h.run(60_000, () => f.status !== "running");
  const l = h.rt.start("loot", {});
  h.run(30_000, () => l.status !== "running");
  expect(l.result!.summary).toMatch(/^looted \d+ meat, \d+ hide from 1 body$/);
  const m = h.rt.start("migrate", { from: { x: 32, z: 1, radius: 8 }, to: ["New vault"] });
  h.run(400_000, () => m.status !== "running");
  expect(m.status).toBe("done");
  const vault = [...h.world.things.values()].find((x) => x.name === "New vault")!;
  expect(vault.slots!.reduce((o: Record<string, number>, s) => ((o[s.item] = (o[s.item] ?? 0) + s.count), o), {})).toMatchObject({ stone: 300, flint: 50, wood: 120 });
});

test("follow keeps with a walking player; escort fights the raptor that comes for her, and sees her there", async () => {
  const path: [number, number][] = [[0, -40], [0, -90]];
  const h = await harness({ me: { x: 0, z: 2, yaw: 0, items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [{ type: "player", name: "Ana", x: 0, z: -3, path, speed: 2.5, at_s: 1 }] });
  const ana = [...h.world.things.values()].find((t) => t.name === "Ana")!;
  const t = h.rt.start("escort", { target: "Ana", to: { x: 0, z: -90 }, guard: 20 });
  h.run(8_000);
  // A raptor comes out of the brush ahead of her.
  const raptor = h.world.place("creature", "raptor", 12, ana.z - 10);
  h.run(120_000, () => t.status === "done" || t.status === "blocked" || t.status === "failed");
  expect(t.status).toBe("done");
  expect(h.world.things.has(raptor)).toBe(false);
  expect(ana.left).toBeGreaterThan(70);
  expect(t.result!.summary).toBe("Ana is at 0, -90, safe; I killed 1 on the way");
});

test("repair mends what the game said was damaged, for its materials", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { piece_foundation_wood: 4, piece_wall_wood: 8, piece_door_wood: 1, piece_ceiling_wood: 4 } } });
  const b = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(60_000, () => b.status !== "running");
  const [x, z] = [h.world.me.x, h.world.me.z - 6];
  h.world.damage(x, z, 4, 4000);
  h.run(500);
  expect(h.rt.belief.damaged.size).toBeGreaterThan(4);
  const poor = h.rt.start("repair", {});
  h.run(20_000, () => poor.status !== "running");
  expect(poor.status).toBe("blocked");
  expect(h.rt.reports.at(-1)!.text).toContain("ran short");
  h.world.give("wood", 900), h.world.give("thatch", 300), h.world.give("fiber", 300);
  const ok = h.rt.start("repair", {});
  h.run(60_000, () => ok.status !== "running");
  expect(ok.status).toBe("done");
  expect(h.rt.belief.damaged.size).toBe(0);
});

test("from a tame raptor's back the fight is the mount's, and the reflex fights rather than runs", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: Math.PI / 2 }, things: [{ type: "raptor", x: 1.5, z: 0, tame: true }] });
  const mine = [...h.world.things.values()].find((t) => t.type === "raptor")!;
  h.world.me.mount = mine.id;
  h.run(500);
  const wild = h.world.place("creature", "raptor", 0, -17);
  h.run(60_000, () => !h.world.things.has(wild));
  expect(h.world.things.has(wild)).toBe(false);
  expect(h.rt.trace.of("decision").find((d) => d.point === "threat.respond")).toMatchObject({ choice: "fight", why: "my mount fights" });
  expect(h.rt.trace.of("decision").find((d) => d.point === "fight.weapon")).toMatchObject({ choice: "mount" });
  expect(h.world.me.health).toBe(100);
});

test("the tribe: a job another has claimed is theirs; one this character takes is said, and said done", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0 }, things: [{ type: "player", name: "Bolt", x: 5, z: 5 }] });
  h.world.say("Bolt", "on it: clear the raptors north", "group");
  h.run(1000);
  expect(h.rt.claims()).toEqual([expect.objectContaining({ job: "clear the raptors north", by: "Bolt" })]);
  const t = h.rt.start("walk_to", { x: 0, z: -10 });
  expect(h.rt.claim(t, "Clear the raptors north")).toMatchObject({ by: "Bolt" });
  expect(h.rt.claim(t, "fetch wood")).toBeNull();
  h.run(20_000, () => t.status !== "running");
  h.run(1000);
  const said = h.world.said.filter((l) => l.channel === "group").map((l) => l.text);
  expect(said).toEqual(["on it: fetch wood", "done: fetch wood"]);
  h.world.say("Bolt", "done: clear the raptors north", "group");
  h.run(1000);
  expect(h.rt.claims()).toEqual([]);
});

test("speech from an owner nearby reaches the Director as said aloud, with who and where, without the name", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0 }, things: [{ type: "player", name: "Ana", x: 0, z: 8 }] }, ["Ana"]);
  const ana = [...h.world.things.values()].find((t) => t.name === "Ana")!.id;
  h.world.speak(ana, "come with me to the river", 0.6);
  h.run(1000);
  expect(h.rt.reports.find((r) => r.kind === "addressed")!.text).toBe(`Ana (${ana}, an owner, 8 m south) said aloud (the transcription is unsure): "come with me to the river"`);
});

test("kit makes a loadout from bare hands: a pick first (flint comes from rocks only with one), then the rest", async () => {
  const trees = [[8, -10], [11, -13], [6, -15], [13, -8], [9, -18], [14, -16]].map(([x, z]) => ({ type: "tree" as const, x: x!, z: z! }));
  const rocks = [[-10, -6], [-14, -9], [-12, -14]].map(([x, z]) => ({ type: "rock" as const, x: x!, z: z! }));
  const bushes = [[-4, 7], [-6, 9], [-3, 11], [-8, 12]].map(([x, z]) => ({ type: "bush" as const, x: x!, z: z! }));
  const h = await harness({ me: { x: 0, z: 0, yaw: 0 }, things: [...trees, ...rocks, ...bushes] });
  const t = h.rt.start("kit", {});
  h.run(900_000, () => t.status !== "running");
  expect(t.result!.summary).toBe("my loadout is complete: made stone_pick, stone_hatchet, bow, 20 arrow");
  for (const [item, n] of [["stone_pick", 1], ["stone_hatchet", 1], ["bow", 1], ["arrow", 20]] as const) expect(h.world.count(item)).toBeGreaterThanOrEqual(n);
  expect(h.world.count("berries") + h.world.count("meat")).toBeGreaterThanOrEqual(10);
});

test("upkeep looks after a base in one go: repairs with materials fetched from the vault, empties the harvester, stashes", async () => {
  const h = await harness({
    me: { x: 0, z: 0, yaw: 0, items: { stone_pick: 1 } },
    bases: [{ blueprint: "hut_2x2", x: 0, z: -12 }],
    things: [{ type: "vault", name: "Stone vault", x: 10, z: -4, items: { wood: 900, thatch: 300, fiber: 300 } }, { type: "ankylo", name: "Bumper", x: -9, z: -3, items: { stone: 800, flint: 200 } }],
  });
  h.run(500);
  h.world.damage(0, -12, 5, 3000);
  h.run(1500);
  const t = h.rt.start("upkeep", {});
  h.run(600_000, () => t.status !== "running");
  expect(t.status).toBe("done");
  expect(h.world.wholeStructures()).toBe(true);
  expect([...h.world.things.values()].find((x) => x.name === "Bumper")!.slots).toEqual([]);
  expect(t.result!.summary).toMatch(/^looked after the base: repaired 17 pieces of b:1 for .*; emptied Bumper into the stores: 800 stone, 200 flint/);
});

const BUILDER = { wood: 20000, thatch: 6000, fiber: 6000, stone: 6000, flint: 600 };

test("pieces the game is still to grow stand on the mock: a fenced compound with a gate, a watchtower with a ladder, hatch and sloped roof", async () => {
  for (const name of ["fenced_compound", "watchtower", "two_room_house", "starter_base"]) {
    const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: BUILDER } });
    const t = h.rt.start("build", { blueprint: name });
    h.run(1_500_000, () => t.status !== "running");
    expect(t.status).toBe("done");
    expect(stands(h.world, name)).toBe(true);
  }
});

test("a base is extended on its own grid, converged to a new layout by swapping a wall, captured, and dismantled with a refund", async () => {
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: BUILDER } });
  const hut = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(600_000, () => hut.status !== "running");
  const base = String(hut.result!.data!.base);
  // A room on the hut's east side, the hut named by its door (all a player sees of it): on its grid, the wall between
  // the hut's.
  const door = [...h.world.things.values()].find((t) => t.piece?.base === base && t.piece.form === "door")!.id;
  const room = h.rt.start("build", { layout: { rooms: [{ at: [0, 0], size: [1, 2] }] }, base: door, side: "e" });
  h.run(600_000, () => room.status !== "running");
  expect(room.status).toBe("done");
  const foundations = () => [...h.world.things.values()].filter((t) => t.piece?.base === base && t.piece.form === "foundation").length;
  expect(foundations()).toBe(6);
  // A door through the hut's east wall: without replace, the wall is in the way; with it, swapped.
  const through = { rooms: [{ at: [0, 0], size: [2, 2], doors: ["s0", "e0"] }] };
  const no = h.rt.start("build", { layout: through, base });
  h.run(600_000, () => no.status !== "running");
  expect(no.status).toBe("blocked");
  expect(no.result!.summary).toContain("occupied");
  const yes = h.rt.start("build", { layout: through, base, replace: true });
  h.run(600_000, () => yes.status !== "running");
  expect(yes.status).toBe("done");
  expect(yes.result!.summary).toContain("swapped 1 piece");
  // Captured, and built again elsewhere from the capture.
  const cap = h.rt.start("capture", { base, name: "my_house" });
  h.run(10_000, () => cap.status !== "running");
  expect(cap.status).toBe("done");
  const copy = h.rt.start("build", { blueprint: "my_house", x: 40, z: 0 });
  h.run(1_500_000, () => copy.status !== "running");
  expect(copy.status).toBe("done");
  const other = String(copy.result!.data!.base);
  expect(other).not.toBe(base);
  const count = (b: string) => [...h.world.things.values()].filter((t) => t.piece?.base === b).length;
  expect(count(other)).toBe(count(base));
  // Taken down at once: every piece back whole.
  const walls = h.world.count("piece_wall_wood");
  const down = h.rt.start("dismantle", { base: other });
  h.run(60_000, () => down.status !== "running");
  expect(down.status).toBe("done");
  expect(count(other)).toBe(0);
  expect(h.world.count("piece_wall_wood")).toBeGreaterThan(walls);
});
