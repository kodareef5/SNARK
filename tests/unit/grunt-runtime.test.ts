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
  expect(h.world.count("wood")).toBe(90);
  expect(task.progress.targets).toBe(3);
  expect(task.result!.summary).toContain("90 wood");
  // Each swing was a decision, and the targets were chosen nearest first.
  const targets = h.rt.trace.of("decision").filter((d) => d.point === "harvest.target").map((d) => d.choice);
  expect(targets.length).toBe(3);
  expect(h.rt.trace.of("decision").some((d) => d.point === "harvest.next")).toBe(true);
  expect(h.rt.reports.at(-1)).toMatchObject({ kind: "task", data: { skill: "harvest", status: "done" } });
});

test("harvest stops at a count of wood, and is blocked when the trees run out first", async () => {
  const h = await harness(grove);
  const some = h.rt.start("harvest", { kind: "tree", count: 20 });
  h.run(60_000, () => some.status !== "running");
  expect(some.status).toBe("done");
  expect(h.world.count("wood")).toBeGreaterThanOrEqual(20);
  expect(h.world.count("wood")).toBeLessThan(30);
  const more = h.rt.start("harvest", { kind: "tree", count: 500 });
  h.run(120_000, () => more.status !== "running");
  expect(more.status).toBe("blocked");
  expect(more.result!.summary).toMatch(/no trees left that I know of; .*short of \d+ wood/);
});

test("a raptor that comes hunting puts the harvest aside: the character runs, lives, and goes back to the trees", async () => {
  const h = await harness({ ...grove, things: [...grove.things!, { type: "raptor", x: 20, z: -14 }] });
  const task = h.rt.start("harvest", { kind: "tree" });
  h.run(90_000, () => h.rt.trace.of("task").some((r) => r.status === "resumed"));
  const changes = h.rt.trace.of("task").map((r) => `${r.skill}:${r.status}`);
  expect(changes).toContain("harvest:suspended");
  expect(changes).toContain("flee:started");
  expect(changes).toContain("flee:done");
  expect(changes.at(-1)).toBe("harvest:resumed");
  expect(h.world.me.alive).toBe(true);
  expect(task.status).toBe("running");
  expect(h.rt.reports.some((r) => r.kind === "danger" && r.text.includes("raptor"))).toBe(true);
  const why = h.rt.trace.of("decision").find((d) => d.point === "arbiter.interrupt")!;
  expect(why).toMatchObject({ choice: "interrupt", policy: "rules" });
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
  const h = await harness({ me: { items: { wood: 40, thatch: 10, fiber: 6 } } });
  const ok = h.rt.start("craft", { item: "wood_foundation", count: 1 });
  h.run(5000, () => ok.status !== "running");
  expect(ok).toMatchObject({ status: "done" });
  h.run(1000);
  const no = h.rt.start("craft", { item: "wood_foundation", count: 2 });
  h.run(1000, () => no.status !== "running");
  expect(no.status).toBe("blocked");
  expect(no.result!.summary).toContain("I can make 0 wood_foundation, not 2");
});

test("when it can no longer outrun the raptor it fights with the hatchet, then rests and finishes the trees", async () => {
  const h = await harness({ ...grove, things: [...grove.things!, { type: "raptor", x: 20, z: -14 }] });
  const task = h.rt.start("harvest", { kind: "tree" });
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

test("build lays a 2x2 hut from the pieces in the bag: each piece placed from outside, by the preview, in support order", async () => {
  const { check } = await import("../../tools/grunt/play.ts");
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { wood_foundation: 4, wood_wall: 7, wood_doorframe: 1, wood_door: 1, wood_ceiling: 4 } } });
  const task = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(300_000, () => task.status !== "running");
  expect(task.result?.summary).toBe("built the hut_2x2: 17 pieces");
  expect(check({ hut_2x2: true }, h.world)).toBe(true);
  expect(h.rt.trace.of("decision").filter((d) => d.point === "build.spot").every((d) => d.choice === "place")).toBe(true);
});

test("build crafts the pieces it lacks from materials first, and says what is short when it cannot", async () => {
  const { check } = await import("../../tools/grunt/play.ts");
  const h = await harness({ me: { x: 0, z: 0, yaw: 0, items: { wood: 400, thatch: 100, fiber: 60 } } });
  const task = h.rt.start("build", { blueprint: "hut_2x2" });
  h.run(400_000, () => task.status !== "running");
  expect(task.status).toBe("done");
  expect(check({ hut_2x2: true }, h.world)).toBe(true);
  const poor = await harness({ me: { items: { wood: 30, thatch: 10, fiber: 10 } } });
  const t2 = poor.rt.start("build", { blueprint: "hut_2x2" });
  poor.run(10_000, () => t2.status !== "running");
  expect(t2.status).toBe("blocked");
  expect(t2.result!.summary).toBe("the hut_2x2 takes 297 wood, 73 thatch, 40 fiber in all; I'm short of 267 more wood, 63 more thatch, 30 more fiber");
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
  expect(h.world.count("wood")).toBe(60);
});

test("a speaker in sight is told with its id, distance and direction, so the Director can go to it", async () => {
  const h = await harness({ things: [{ type: "player", x: 8, z: 6, name: "Ana" }] }, ["Ana"]);
  h.run(500);
  h.world.say("Ana", "Scout, come here please");
  h.run(500);
  expect(h.rt.reports.find((r) => r.kind === "addressed")!.text).toMatch(/^Ana \(e:\d+, an owner, 10 m south-east\): "Scout, come here please"$/);
});
