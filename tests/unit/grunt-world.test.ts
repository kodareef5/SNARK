import { expect, test } from "bun:test";
import type { Action, GameMessage, Observation, Outcome } from "../../grunt/protocol.ts";
import { GameEndpoint, LIMITS } from "../../tools/grunt/game.ts";
import { makeWorld, type Scene } from "../../tools/grunt/scenes.ts";
import { yawTo } from "../../tools/grunt/world.ts";

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
  // Turned to face it, the swings give wood until the tree is gone (30 wood, 3 a swing with the hatchet).
  const turn = s.act({ control: "look", yaw: 0 });
  s.step(10);
  expect(s.outcomes(turn)[0]).toMatchObject({ status: "completed" });
  const tree = s.observe({ focus: {} }).channels.focus!.target!;
  expect(tree).toStartWith("n:");
  for (let i = 0; i < 6 && s.world.things.has(tree); i++) {
    s.act({ control: "use", hand: "primary", hold_ms: 2000 });
    s.step(42);
  }
  expect(s.world.things.has(tree)).toBe(false);
  expect(s.world.count("wood")).toBe(30);
  expect(s.world.count("thatch")).toBe(10);
});

test("crafting takes the recipe's materials and time, and is refused without them", () => {
  const s = open({ me: { items: { wood: 40, thatch: 10, fiber: 6 } } });
  const c = s.act({ control: "craft", item: "wood_foundation", count: 1 });
  s.step(10);
  expect(s.outcomes(c)).toEqual([]);
  s.step(25);
  expect(s.outcomes(c)[0]).toMatchObject({ status: "completed", detail: { made: "wood_foundation" } });
  expect(s.world.count("wood_foundation")).toBe(1);
  expect(s.world.count("wood")).toBe(15);
  const inv = s.observe({ inventory: {} }).channels.inventory!;
  expect(inv.craftable.find((r) => r.item === "wood_foundation")!.can).toBe(0);
  s.act({ control: "craft", item: "wood_foundation", count: 1 });
  expect(s.got.at(-1)).toMatchObject({ type: "ack", actions: [{ accepted: false, code: "missing_items" }] });
});

test("pieces snap as a player's preview does: foundations side by side, a wall on an edge, a ceiling over walls", () => {
  const s = open({ me: { x: 0, z: 5, yaw: 0, items: { wood_foundation: 2, wood_wall: 1, wood_ceiling: 1 } } });
  const hold = (item: string) => {
    s.act({ control: "select", slot: s.world.me.slots.findIndex((x) => x.item === item) });
  };
  const place = () => {
    const c = s.act({ control: "use", hand: "primary" });
    s.step(8);
    return s.outcomes(c)[0]!;
  };
  hold("wood_foundation");
  expect(s.observe({ focus: {} }).channels.focus!.placement).toMatchObject({ piece: "wood_foundation", pos: [0, 0, 3], snapped: null, valid: true });
  expect(place().detail!.placed).toStartWith("s:");
  // Back up and look at the cell north of the first: the preview snaps to it.
  s.world.me.z = 2;
  expect(s.observe({ focus: {} }).channels.focus!.placement).toMatchObject({ pos: [0, 0, 0], snapped: { where: "north" }, valid: true });
  place();
  hold("wood_ceiling");
  expect(s.observe({ focus: {} }).channels.focus!.placement).toMatchObject({ valid: false, reason: "no_support" });
  expect(place()).toMatchObject({ status: "failed", code: "blocked", detail: { reason: "no_support" } });
  hold("wood_wall");
  s.world.me.yaw = yawTo(0, 2, 1.5, 3);
  expect(s.observe({ focus: {} }).channels.focus!.placement).toMatchObject({ valid: true, snapped: { where: "east" } });
  place();
  hold("wood_ceiling");
  s.world.me.yaw = 0;
  s.world.me.z = 6;
  expect(s.observe({ focus: {} }).channels.focus!.placement).toMatchObject({ pos: [0, 3, 3], valid: true });
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
