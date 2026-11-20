import { expect, test } from "bun:test";
import { BLUEPRINTS } from "../../grunt/blueprints.ts";
import { compile } from "../../grunt/layout.ts";
import type { Action, GameMessage, Observation, Outcome } from "../../grunt/protocol.ts";
import { GameEndpoint, LIMITS } from "../../tools/grunt/game.ts";
import { stands } from "../../tools/grunt/play.ts";
import { makeWorld, type Scene } from "../../tools/grunt/scenes.ts";
import { BUILDING } from "../../tools/grunt/structures.ts";

/** A client in the same process: raw protocol messages in, every message out kept in order. */
function open(scene: Scene) {
  const world = makeWorld(scene);
  const game = new GameEndpoint(world);
  const got: GameMessage[] = [];
  const conn = game.connect((m) => void got.push(m));
  let n = 0;
  const send = (m: object) => conn.receive(JSON.stringify({ grunt: 0, ...m }));
  const act = (...actions: Action[]) => {
    const command = `c${++n}`;
    send({ type: "act", command, basis: 0, actions });
    return command;
  };
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      world.step();
      game.afterStep();
      send({ type: "ping" });
    }
  };
  const outcomes = (command: string) => got.filter((m): m is Outcome => m.type === "outcome" && m.command === command);
  const observe = (channels: object) => {
    send({ type: "observe", id: `o${++n}`, channels });
    return got.at(-1) as Observation;
  };
  send({ type: "hello", id: "h", versions: [0], client: { name: "test", version: "0" }, auth: { method: "name", name: "Scout" } });
  return { world, game, got, send, act, step, outcomes, observe };
}

test("hello is welcomed with the game's capabilities and limits; another version is refused", () => {
  const { got } = open({});
  expect(got[0]).toMatchObject({ type: "welcome", re: "h", character: { name: "Scout", alive: true }, limits: LIMITS });
  const w = makeWorld({});
  const out: GameMessage[] = [];
  new GameEndpoint(w).connect((m) => void out.push(m)).receive({ grunt: 0, type: "hello", versions: [9], client: { name: "x", version: "0" }, auth: { method: "name" } });
  expect(out[0]).toMatchObject({ type: "refused", code: "version", retry: false });
});

test("a move walks the body north for as long as it is held, and is told how far it went", () => {
  const s = open({ me: { x: 0, z: 0, yaw: 0 } });
  const c = s.act({ control: "move", forward: 1, strafe: 0, duration_ms: 1000 });
  expect(s.got.at(-1)).toMatchObject({ type: "ack", command: c, actions: [{ index: 0, accepted: true }] });
  s.step(25);
  const [o] = s.outcomes(c);
  expect(o).toMatchObject({ status: "completed" });
  expect(o!.detail!.moved_m as number).toBeCloseTo(3.5, 1);
  expect(s.world.me.z).toBeCloseTo(-3.5, 1);
  expect(s.act({ control: "move", forward: 1, strafe: 0, duration_ms: 5000 })).toBeTruthy();
  expect(s.got.at(-1)).toMatchObject({ type: "ack", actions: [{ accepted: false, code: "too_long" }] });
});

test("a tree is chopped only while it is faced and within reach, and is gone when used up", () => {
  const s = open({ me: { x: 0, z: 0, yaw: Math.PI / 2, items: { stone_hatchet: 1 }, hold: "stone_hatchet" }, things: [{ type: "tree", x: 0, z: -2 }] });
  // Facing east, the tree to the north is not in focus: swinging gets nothing.
  expect(s.observe({ focus: {} }).channels.focus).toEqual({ target: null });
  const miss = s.act({ control: "use", hand: "primary", hold_ms: 1200 });
  s.step(30);
  expect(s.outcomes(miss)[0]!.detail).toEqual({ swings: 2 });
  // Turned to face it, the swings give wood until the tree is gone (150 wood, 12 a swing with the hatchet).
  const turn = s.act({ control: "look", yaw: 0 });
  s.step(10);
  expect(s.outcomes(turn)[0]).toMatchObject({ status: "completed" });
  const tree = s.observe({ focus: {} }).channels.focus!.target!;
  expect(tree).toStartWith("n:");
  for (let i = 0; i < 12 && s.world.things.has(tree); i++) {
    s.act({ control: "use", hand: "primary", hold_ms: 2000 });
    s.step(42);
  }
  expect(s.world.things.has(tree)).toBe(false);
  expect(s.world.count("wood")).toBe(150);
  expect(s.world.count("thatch")).toBe(52);
});

test("crafting takes the recipe's materials and time, and is refused without them", () => {
  const s = open({ me: { items: { wood: 100, thatch: 25, fiber: 20 } } });
  const c = s.act({ control: "craft", item: "piece_foundation_wood", count: 1 });
  s.step(60);
  expect(s.outcomes(c)).toEqual([]);
  s.step(50);
  expect(s.outcomes(c)[0]).toMatchObject({ status: "completed", detail: { made: "piece_foundation_wood" } });
  expect(s.world.count("piece_foundation_wood")).toBe(1);
  expect(s.world.count("wood")).toBe(20);
  const inv = s.observe({ inventory: {} }).channels.inventory!;
  expect(inv.craftable.find((r) => r.item === "piece_foundation_wood")!.can).toBe(0);
  s.act({ control: "craft", item: "piece_foundation_wood", count: 1 });
  expect(s.got.at(-1)).toMatchObject({ type: "ack", actions: [{ accepted: false, code: "missing_items" }] });
});

test("the build helper checks a plan whole, then places it from the bag at its pace, never aimed", () => {
  const s = open({ me: { x: 0, z: 9, yaw: 0, items: { piece_foundation_wood: 4, piece_wall_wood: 8, piece_door_wood: 1, piece_ceiling_wood: 3 } }, things: [{ type: "tree", x: 3, z: 3 }] });
  const tree = [...s.world.things.values()].find((t) => t.type === "tree")!.id;
  const kit = BUILDING.tiers.wood!;
  const pieces = compile(BLUEPRINTS.hut_2x2!).pieces.map((p) => ({ ...p, item: kit[p.form]! }));
  const plan = { anchor: { at: [0, 0] as [number, number] }, pieces };
  const check = (pl: typeof plan) => {
    const c = s.act({ control: "plan", op: "check", plan: pl });
    s.step(1);
    return s.outcomes(c)[0]!.detail as { verdicts: { status: string; by?: string }[]; need: Record<string, number>; have: Record<string, number> };
  };
  // The tree stands on cell 1, 1: the fourth foundation.
  const first = check(plan);
  expect(first.verdicts[3]).toEqual({ status: "blocked", by: tree });
  // Its two outer walls stand on nothing else: they cannot stand either.
  expect(first.verdicts.map((v) => v.status).filter((v) => v !== "ok")).toEqual(["blocked", "no_support", "no_support"]);
  expect(first.need).toEqual({ piece_foundation_wood: 4, piece_wall_wood: 8, piece_door_wood: 1, piece_ceiling_wood: 4 });
  // A ceiling with nothing under it, a door with no frame: neither stands.
  expect(check({ ...plan, pieces: [pieces.find((p) => p.form === "ceiling")!, pieces.find((p) => p.form === "door")!] }).verdicts.map((v) => v.status)).toEqual(["no_support", "no_support"]);
  s.world.things.delete(tree);
  const c = s.act({ control: "plan", op: "build", plan });
  s.step(20);
  const early = [...s.world.things.values()].filter((t) => t.piece).length;
  expect(early).toBeGreaterThanOrEqual(2);
  expect(early).toBeLessThanOrEqual(3);
  s.step(400);
  // One ceiling short: it stops there, saying so, with the rest standing.
  expect(s.outcomes(c)[0]).toMatchObject({ status: "failed", code: "missing_items", detail: { at: 16, placed: 16, reason: "missing_items", item: "piece_ceiling_wood" } });
  const base = (s.outcomes(c)[0]!.detail as { base: string }).base;
  s.world.give("piece_ceiling_wood", 1);
  const again = s.act({ control: "plan", op: "build", plan: { anchor: { base }, pieces }, from: 16 });
  s.step(20);
  expect(s.outcomes(again)[0]).toMatchObject({ status: "completed", detail: { placed: 1 } });
  expect(check({ anchor: { base } as never, pieces }).verdicts.every((v) => v.status === "built")).toBe(true);
  expect(stands(s.world, "hut_2x2")).toBe(true);
  // The walls are walls: the character cannot walk through the back of the hut.
  s.world.me.x = 1.5;
  s.world.me.z = -4;
  const walk = s.act({ control: "move", forward: -1, strafe: 0, duration_ms: 2000 });
  s.step(45);
  expect(s.outcomes(walk)[0]).toMatchObject({ status: "completed" });
  expect(s.world.me.z).toBeLessThan(-1.9);
});

test("a quiet client is let go of, and a repeated command is answered, never run again", () => {
  const s = open({});
  const c = s.act({ control: "move", forward: 1, strafe: 0, duration_ms: 2000 });
  s.world.step(35); // 1.75 s with no word: past the 1.5 s leash, before the 2 s move would end
  s.game.afterStep();
  expect(s.outcomes(c)[0]).toMatchObject({ status: "interrupted", by: "disconnected" });
  const z = s.world.me.z;
  s.send({ type: "act", command: c, basis: 0, actions: [{ control: "move", forward: 1, strafe: 0, duration_ms: 1000 }] });
  expect(s.got.at(-1)).toMatchObject({ type: "ack", duplicate: true });
  s.step(10);
  expect(s.world.me.z).toBe(z);
});
