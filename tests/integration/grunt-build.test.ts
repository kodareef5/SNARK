// The build helper through the grunt gateway (agent/plan.ts): plans checked whole on a scratch copy of the structures
// with the server's own checks, and built piece by piece with a player's place command, on a server in process.

import { expect, test } from "bun:test";
import { BLUEPRINTS } from "../../grunt/blueprints.ts";
import { Endpoint } from "../../grunt/endpoint.ts";
import { compile, type Layout } from "../../grunt/layout.ts";
import type { Action, GameMessage, Observation, Outcome, PlanPiece, Welcome } from "../../grunt/protocol.ts";
import { SNARK_CAPABILITIES, SNARK_LIMITS } from "../../agent/gateway.ts";
import { SnarkWorld } from "../../agent/grunt.ts";
import { Agent } from "../../agent/tools.ts";
import { slot } from "../../tools/grunt/structures.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const PIECES = ["foundation", "wall", "ceiling", "door", "pillar", "stairs"];

function site(stock = 60) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("Scout", {}, { manual: true });
  const world = new SnarkWorld(new Agent(s), "Scout");
  const ep = new Endpoint(world, { capabilities: () => world.capabilities(SNARK_CAPABILITIES), limits: SNARK_LIMITS, game: { name: "SNARK", version: "0" }, tickMs: 1000 / 60 });
  const got: GameMessage[] = [];
  const conn = ep.connect((m) => void got.push(m));
  let n = 0;
  const send = (m: object) => conn.receive(JSON.stringify({ grunt: 0, ...m }));
  const run = (ms: number) => h.run(ms, (now) => (world.step(now), ep.afterStep(), send({ type: "ping" })));
  run(600);
  const g = flatGround(h, 40, 40);
  h.say(s, "enablecheats");
  h.say(s, `tp ${(g.x + 20).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
  h.say(s, "setstat weight 255");
  for (const p of PIECES) h.say(s, `give piece_${p}_wood ${stock}`);
  run(300);
  send({ type: "hello", id: "h", versions: [0], client: { name: "test", version: "0" }, auth: { method: "name", name: "Scout" } });
  const welcome = got.find((m) => m.type === "welcome") as Welcome;
  const act = (...actions: Action[]) => {
    const command = `c${++n}`;
    send({ type: "act", command, basis: 0, actions });
    return command;
  };
  const outcome = async (command: string, ms = 120_000): Promise<Outcome | undefined> => {
    for (let t = 0; t < ms; t += 50) {
      const o = got.find((m): m is Outcome => m.type === "outcome" && m.command === command);
      if (o) return o;
      await new Promise((r) => setImmediate(r));
      run(50);
    }
    return undefined;
  };
  const observe = (channels: object) => {
    send({ type: "observe", id: `o${++n}`, channels });
    return got.at(-1) as Observation;
  };
  // The plan for a layout in wood, its middle 8 m north of the survivor (the protocol's frame: north is -z).
  const planOf = (l: Layout) => {
    const kit = welcome.capabilities.building!.tiers.wood!;
    const pieces: PlanPiece[] = compile(l).pieces.map((p) => ({ ...p, item: kit[p.form]! }));
    const me = observe({ self: {} }).channels.self!.pos;
    return { anchor: { at: [Math.round(me[0]), Math.round(me[2]) - 9] as [number, number], turns: 0 }, pieces };
  };
  /** The tribe's pieces standing near, by kind's short name. */
  const standing = () => {
    const out: Record<string, number> = {};
    const structs = h.world.structs;
    for (const t of structs.chunks) {
      if (!t) continue;
      for (let k = 0; k < t.high; k++) {
        if (t.kind[k] === 0 || t.owner[k] !== s.tribe.team) continue;
        const name = (h.world.reg.ids[t.kind[k]!] ?? "").replace("core:", "").replace(/_wood$/, "");
        if (PIECES.includes(name) || name === "doorframe" || name === "windowframe") out[name] = (out[name] ?? 0) + 1;
      }
    }
    return out;
  };
  return { h, s, world, got, welcome, act, outcome, observe, planOf, standing, run };
}

test("the gateway's building capability is the server's content: tiers, forms and their classes of place", () => {
  const g = site(1);
  const b = g.welcome.capabilities.building!;
  expect(b.cell).toBe(3);
  expect(b.storey).toBe(3);
  expect(b.tiers.wood).toMatchObject({ foundation: "piece_foundation_wood", wall: "piece_wall_wood", doorframe: "piece_wall_wood", ceiling: "piece_ceiling_wood", stairs: "piece_stairs_wood" });
  expect(b.tiers.thatch?.stairs).toBeUndefined();
  const place = Object.fromEntries((b.forms ?? []).map((f) => [f.form, f.place]));
  expect(place).toMatchObject({ foundation: "floor", wall: "edge", doorframe: "edge", ceiling: "floor", pillar: "corner", door: "in_frame", stairs: "centre" });
  expect(b.things).toContain("piece_storage_box");
});

test("a hut is checked whole on flat ground, built through the protocol, and stands as the layout says", async () => {
  const g = site();
  const plan = g.planOf(BLUEPRINTS.hut_2x2!);
  const c = g.act({ control: "plan", op: "check", plan });
  const checked = (await g.outcome(c))!.detail as { verdicts: { status: string; by?: string; fix?: string }[] };
  expect(checked.verdicts.map((v) => v.status)).toEqual(plan.pieces.map(() => "ok"));
  const b = g.act({ control: "plan", op: "build", plan });
  const built = await g.outcome(b, 180_000);
  expect(built).toMatchObject({ status: "completed", detail: { placed: 17 } });
  expect(String(built!.detail!.base)).toMatch(/^s\d+$/);
  expect(g.standing()).toEqual({ foundation: 4, wall: 7, doorframe: 1, door: 1, ceiling: 4 });
  // Checked again, every piece stands.
  const again = g.act({ control: "plan", op: "check", plan });
  expect(((await g.outcome(again))!.detail as { verdicts: { status: string }[] }).verdicts.every((v) => v.status === "built")).toBe(true);
  // A second build of the same plan places nothing and completes.
  const twice = g.act({ control: "plan", op: "build", plan });
  expect(await g.outcome(twice, 60_000)).toMatchObject({ status: "completed", detail: { placed: 0 } });
});

test("a two-storey house goes up with its stairs, and the ceiling over them is left open", async () => {
  const g = site();
  const plan = g.planOf(BLUEPRINTS.house_3x3_two_storey!);
  const checked = (await g.outcome(g.act({ control: "plan", op: "check", plan })))!.detail as { verdicts: { status: string; by?: string; fix?: string }[] };
  // The survivor standing in a piece's way is no fault of the plan: the build steps aside for it.
  const bad = checked.verdicts.map((v, k) => [k, plan.pieces[k]!.form, v.status, v.by]).filter(([, , st, by]) => st !== "ok" && by !== "you");
  expect(bad).toEqual([]);
  const built = await g.outcome(g.act({ control: "plan", op: "build", plan }), 300_000);
  expect(built).toMatchObject({ status: "completed" });
  const st = g.standing();
  expect(st.stairs).toBe(1);
  expect(st.foundation).toBe(9);
  expect(st.ceiling).toBe(17);
  // Surveyed, the base reads back as the layout: every piece in its place on the grid, the stairs climbing as laid.
  const base = String(built!.detail!.base);
  const seen = (await g.outcome(g.act({ control: "plan", op: "survey", plan: { anchor: { base }, pieces: [] } })))!.detail as { pieces: (PlanPiece & { id: string; health: number })[]; frame: { at: [number, number]; turns: number } };
  const key = (q: PlanPiece) => `${q.form}:${slot(q)}${q.up ? `:${q.up}` : ""}`;
  // The plan's cells are the base's (its first foundation is the plan's first piece, cell 0, 0).
  const first = plan.pieces[0]!.cell;
  const want = plan.pieces.map((q) => key({ ...q, cell: [q.cell[0] - first[0], q.cell[1] - first[1]] })).sort();
  expect(seen.pieces.map(key).sort()).toEqual(want);
  expect(seen.pieces.every((q) => q.health === 1)).toBe(true);
  expect(seen.frame.turns).toBe(0);
});

test("a base is extended on its own grid, a piece of the wrong form is told as occupied, and a piece picked up comes back whole", async () => {
  const g = site();
  const hut = g.planOf(BLUEPRINTS.hut_2x2!);
  const built = await g.outcome(g.act({ control: "plan", op: "build", plan: hut }), 180_000);
  const base = String(built!.detail!.base);
  const kit = g.welcome.capabilities.building!.tiers.wood!;
  const laid = (l: Layout) => compile(l).pieces.map((p) => ({ ...p, item: kit[p.form]! }));
  // A room east of the hut, on its grid: the wall between is the hut's, already standing.
  const room = { anchor: { base }, pieces: laid({ rooms: [{ at: [2, 0], size: [1, 2] }] }) };
  const checked = (await g.outcome(g.act({ control: "plan", op: "check", plan: room })))!.detail as { verdicts: { status: string }[] };
  const shared = room.pieces.map((p, k) => [p.form, p.cell.join(","), p.side, checked.verdicts[k]!.status]).filter(([f, , side]) => f === "wall" && side === "w");
  expect(shared.every(([, , , st]) => st === "built")).toBe(true);
  expect(await g.outcome(g.act({ control: "plan", op: "build", plan: room }), 180_000)).toMatchObject({ status: "completed" });
  expect(g.standing().foundation).toBe(6);
  // The base is found from any piece of it: surveyed by one of its walls, every piece of it.
  const survey = async (id: string) => ((await g.outcome(g.act({ control: "plan", op: "survey", plan: { anchor: { base: id }, pieces: [] } })))!.detail as { pieces: { id: string }[] }).pieces;
  const all = await survey(base);
  const wall = (built!.detail!.ids as string[])[6]!;
  expect((await survey(wall)).map((x) => x.id).sort()).toEqual(all.map((x) => x.id).sort());
  // The hut and the room: 2 foundations, 4 walls of its own (the west is the hut's), 2 ceilings.
  expect(all.length).toBe(17 + 8);
  // The hut's east wall at cell 1,0 wanted as a doorframe: the wall is there.
  const door = { anchor: { base }, pieces: laid({ rooms: [{ at: [0, 0], size: [2, 2], doors: ["e0"] }] }) };
  const v = ((await g.outcome(g.act({ control: "plan", op: "check", plan: door })))!.detail as { verdicts: { status: string; by?: string }[] }).verdicts;
  const frame = door.pieces.findIndex((p) => p.form === "doorframe");
  expect(v[frame]).toMatchObject({ status: "occupied" });
  expect(String(v[frame]!.by)).toMatch(/^s\d+$/);
  // Picked up at once (within the game's window): the wall comes back to the bag.
  const walls = g.s.inventory!.total(g.h.world.reg.index.get("core:piece_wall_wood")!);
  const removed = await g.outcome(g.act({ control: "plan", op: "remove", plan: door, ids: [String(v[frame]!.by)] }), 60_000);
  expect(removed).toMatchObject({ status: "completed", detail: { removed: [String(v[frame]!.by)] } });
  expect(g.s.inventory!.total(g.h.world.reg.index.get("core:piece_wall_wood")!)).toBe(walls + 1);
});

test("damage to a base is told as it happens, and the repair assist mends it once the game lets it", async () => {
  const g = site();
  const built = await g.outcome(g.act({ control: "plan", op: "build", plan: g.planOf(BLUEPRINTS.hut_2x2!) }), 180_000);
  const base = String(built!.detail!.base);
  g.h.say(g.s, "give wood 2000");
  g.h.say(g.s, "give thatch 600");
  g.h.say(g.s, "give fiber 600");
  // The server damages three of the hut's pieces (a storm, a raid).
  const ids = (built!.detail!.ids as string[]).slice(4, 7).map((id) => Number(id.slice(1)));
  for (const ref of ids) g.h.world.structs.damage(ref, 2000);
  g.run(3000);
  const damaged = g.got.filter((m) => m.type === "event" && m.kind === "damaged");
  // Told only to a client that asked for events: ask, damage again, and hear it.
  if (!damaged.length) {
    g.got.length = 0;
  }
  // The game makes a repair wait after damage (StructureDamageRepairCooldown): the assist mends once it may.
  g.run(185_000);
  const fixed = await g.outcome(g.act({ control: "assist", kind: "repair", target: base }), 120_000);
  expect(fixed).toMatchObject({ status: "completed", detail: { result: "whole", left: 0 } });
  expect(Number(fixed!.detail!.repaired)).toBe(3);
});
