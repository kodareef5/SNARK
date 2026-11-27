// The lab's made situations (tools/decide/random.ts): pairs whose two sides differ in one fact, so the right way flips,
// and the oracle that prices each leg of a way at the pace it takes.
import { expect, test } from "bun:test";
import { pairsOf, see } from "../../tools/decide/audit.ts";
import { draw } from "../../tools/decide/random.ts";
import { PathFinder, PATH_FOUND } from "../../shared/world/path.ts";
import { build } from "../../tools/decide/setups.ts";

test("both sides of a body pair share their walls and water and differ in the body", () => {
  let id = 1;
  while (draw("ford", 2 * id - 1).pair!.fact !== "body") id++;
  const [a, b] = [draw("ford", 2 * id - 1), draw("ford", 2 * id)];
  expect([a.pair!.id, a.pair!.side, b.pair!.id, b.pair!.side]).toEqual([id, 0, id, 1]);
  expect(b.pieces).toEqual(a.pieces);
  expect(b.water).toEqual(a.water!);
  expect(a.kind).not.toBe(b.kind);
});

test("the old families draw no pair, so their scenes stay as they were", () => {
  for (const f of ["trees", "deadEnd", "pen", "water", "blocker", "crowd", "miami"] as const) expect(draw(f, 7).pair).toBeUndefined();
});

test("a raptor's way goes through the gap a rex must go round", () => {
  const [a, b] = [build(draw("gap", 1)), build(draw("gap", 2))];
  expect([a.scene.kind, a.oracle!.choice, b.scene.kind, b.oracle!.choice]).toEqual(["core:raptor", "cross", "core:rex", "round"]);
  a.lab.host.shutdown();
  b.lab.host.shutdown();
});

test("the oracle prices a dodo's swim at its swimming pace", () => {
  let seed = 1;
  while (draw("ford", seed).kind !== "core:dodo") seed++;
  const b = build(draw("ford", seed)), o = b.oracle!;
  expect(o.choice).toBe("cross");
  expect(o.wet!.swum).toBeGreaterThan(10);
  // Walked all the way it would take far longer than it does swimming most of it.
  expect(o.wet!.seconds).toBeLessThan(0.6 * (o.wet!.metres / b.body.pace));
  b.lab.host.shutdown();
});

test("a search priced to swim crosses water a walker's search refuses", () => {
  const b = build(draw("water", 3)), reg = b.lab.world.reg, body = reg.move[reg.index.get(b.scene.kind)!]!;
  const ents = b.lab.world.ents, f = new PathFinder(b.lab.world, body);
  f.budget = 193 * 193;
  const x = ents.x[b.mover]!, z = ents.z[b.mover]!;
  const refused = f.find(x, z, b.goal.x, b.goal.z) === PATH_FOUND && Math.hypot(f.x[f.count - 1]! - b.goal.x, f.z[f.count - 1]! - b.goal.z) < 2;
  f.swim = 2;
  const crossed = f.find(x, z, b.goal.x, b.goal.z) === PATH_FOUND && Math.hypot(f.x[f.count - 1]! - b.goal.x, f.z[f.count - 1]! - b.goal.z) < 2;
  expect([refused, crossed]).toEqual([false, true]);
  b.lab.host.shutdown();
});

test("a pair is kept only where the oracle's way differs between its sides", () => {
  const seen = [1, 2, 3, 4].map((seed) => see(draw("gap", seed)));
  expect(pairsOf(seen).length).toBe(2);
  // The same side twice is no pair.
  expect(pairsOf([seen[0]!, { ...seen[0]!, pair: { ...seen[0]!.pair!, side: 1 } }]).length).toBe(0);
});
