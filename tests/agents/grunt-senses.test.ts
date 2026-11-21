// The gateway's senses beyond the near ground (agent/map.ts, agent/focus.ts): the map screen's picture for hundreds of
// metres, in the protocol's frame and true to the server's ground; and what the crosshair is on, by the ray the server
// casts, named in the gateway's ids with what the use key would do.

import { expect, test } from "bun:test";
import { Endpoint } from "../../grunt/endpoint.ts";
import type { Action, GameMessage, Observation, Outcome } from "../../grunt/protocol.ts";
import { focusOf } from "../../agent/focus.ts";
import { SNARK_CAPABILITIES, SNARK_LIMITS } from "../../agent/gateway.ts";
import { SnarkWorld } from "../../agent/grunt.ts";
import { Agent } from "../../agent/tools.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { GROUND_CLASS } from "../../shared/world/vehicle-surface.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

function gateway() {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("Scout", {}, { manual: true });
  const agent = new Agent(s);
  const world = new SnarkWorld(agent, "Scout");
  const ep = new Endpoint(world, { capabilities: () => world.capabilities(SNARK_CAPABILITIES), limits: SNARK_LIMITS, game: { name: "SNARK", version: "0" }, tickMs: 1000 / 60 });
  const got: GameMessage[] = [];
  const conn = ep.connect((m) => void got.push(m));
  let n = 0;
  const send = (m: object) => conn.receive(JSON.stringify({ grunt: 0, ...m }));
  const run = (ms: number) => h.run(ms, (now) => (world.step(now), ep.afterStep(), send({ type: "ping" })));
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
  run(500);
  send({ type: "hello", id: "h", versions: [0], client: { name: "test", version: "0" }, auth: { method: "name", name: "Scout" } });
  return { h, s, agent, world, got, send, run, act, outcome, observe };
}

/** The look (the controller's yaw and pitch, radians) from the survivor's eye to SNARK's (x, y, z). */
function lookAt(g: ReturnType<typeof gateway>, x: number, y: number, z: number): [number, number] {
  const s = g.s, move = s.registry.move[s.bodyKind]!;
  const [dx, dy, dz] = [x - s.own.x, y - (s.own.y + stanceEye(move, s.own.stance)), z - s.own.z];
  return [Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))];
}

test("the map is the server's ground for hundreds of metres, in the protocol's frame", () => {
  const g = gateway();
  const m = g.observe({ map: { cell: 8, radius: 400 } }).channels.map!;
  expect(m.known).toBe("full");
  expect(m.cell).toBe(8);
  expect(m.size[0]).toBeLessThanOrEqual(201);
  expect(m.rows.length).toBe(m.size[1]);
  const hf = g.h.world.hf, reg = g.h.world.reg;
  const deep = reg.move[g.s.bodyKind]!.height * 0.7;
  // Each letter, at the middle of its cell, against the server's own heightfield (SNARK's x and z are the negatives).
  const letter = (px: number, pz: number) => m.rows[Math.floor((pz - m.origin[1]) / m.cell)]?.[Math.floor((px - m.origin[0]) / m.cell)];
  expect(".=").toContain(letter(-g.s.own.x, -g.s.own.z)!);
  let checked = 0, water = 0, roads = 0;
  for (let row = 0; row < m.rows.length; row += 3) {
    for (let col = 0; col < m.rows[row]!.length; col += 3) {
      const [x, z] = [-(m.origin[0] + (col + 0.5) * m.cell), -(m.origin[1] + (row + 0.5) * m.cell)];
      if (x < 8 || z < 8 || x > hf.sizeX - 8 || z > hf.sizeZ - 8) continue;
      // Wholly deep around the middle: the map says deep; wholly dry and flat with no road: walkable or built.
      const depths = [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 0]].map(([dx, dz]) => hf.waterAt(x + dx!, z + dz!) - hf.heightAt(x + dx!, z + dz!));
      const k = m.rows[row]![col]!;
      if (depths.every((d) => d > deep + 0.2)) (expect(k).toBe("~"), water++);
      if (k === "~") expect(Math.max(...depths)).toBeGreaterThan(0.15);
      if (k === "=") {
        const classes = [[-2, -2], [2, -2], [-2, 2], [2, 2]].map(([dx, dz]) => hf.groundClassAt(x + dx!, z + dz!));
        expect(classes.some((c) => c === GROUND_CLASS.ASPHALT || c === GROUND_CLASS.PAVING)).toBe(true);
        roads++;
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(200);
  // The proving ground has a sea and roads; a map with neither would test little.
  expect(water + roads).toBeGreaterThan(0);
});

test("the crosshair names what it is on: a tree to harvest, a box set down to open, nothing in the sky", async () => {
  const g = gateway();
  const flat = flatGround(g.h, 20, 20);
  g.h.say(g.s, "enablecheats");
  g.h.say(g.s, `tp ${(flat.x + 10).toFixed(3)} ${(flat.z + 10).toFixed(3)}`);
  g.h.say(g.s, "give piece_storage_box 1");
  g.run(600);
  // A box set down 3 m north of the survivor (the protocol's north is -z).
  const me = g.observe({ self: {} }).channels.self!.pos;
  const placed = await g.outcome(g.act({ control: "plan", op: "build", plan: { anchor: { at: [me[0], me[2] - 3], turns: 0 }, pieces: [{ form: "thing", item: "piece_storage_box", cell: [0, 0], level: 0 }] } }));
  expect(placed).toMatchObject({ status: "completed", detail: { placed: 1 } });
  const id = (placed!.detail!.ids as string[])[0]!;
  const ref = Number(id.slice(1));
  const t = g.h.world.structs.chunks[Math.floor(ref / 65536)]!;
  const [bx, by, bz] = [t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]!];
  // Walked off to place it, perhaps: back beside it.
  g.h.say(g.s, `tp ${(bx).toFixed(3)} ${(bz - 2.2).toFixed(3)}`);
  g.run(600);
  const [yaw, pitch] = lookAt(g, bx, by + 0.3, bz);
  const box = focusOf(g.s, g.agent.remote, yaw, pitch);
  expect(box.target).toBe(id);
  expect(box.distance!).toBeLessThan(3.5);
  expect(box.verbs).toContain("open");
  expect(box.verbs).toContain("repair");
  // Straight up: the sky.
  expect(focusOf(g.s, g.agent.remote, yaw, Math.PI / 2 - 0.01).target).toBeNull();
  // The nearest tree in view, looked at from where it stands.
  const ents = g.observe({ entities: { radius: 96, max: 60 } }).channels.entities!.items;
  const tree = ents.find((e) => e.type === "tree");
  expect(tree).toBeDefined();
  g.h.say(g.s, `tp ${(-tree!.pos[0]).toFixed(3)} ${(-tree!.pos[2] - 2.5).toFixed(3)}`);
  g.run(600);
  const [ty, tp] = lookAt(g, -tree!.pos[0], g.s.own.y + 1.4, -tree!.pos[2]);
  const f = focusOf(g.s, g.agent.remote, ty, tp);
  expect(f.target).toBe(tree!.id);
  expect(f.verbs).toContain("harvest");
  // Through the protocol, the channel is the controller's own look.
  const seen = g.observe({ focus: {} }).channels.focus!;
  expect(seen).toHaveProperty("target");
});

test("the map names the obelisks and landmarks a player's map shows, in the protocol's frame", () => {
  const g = gateway();
  const w = g.s.world!;
  // The map file's places, as agent/join.ts hands them to the session.
  (w as { tideEyes?: unknown }).tideEyes = [{ name: "Wynwood", color: "red", form: "sextant", x: 7672, y: 5, z: 8576, yaw: 0, radius: 70 }];
  (w as { landmarks?: unknown }).landmarks = [{ name: "koru", x: 6710.4, y: 2, z: 5112.6, yaw: 0 }];
  const m = g.observe({ map: { cell: 8, radius: 400 } }).channels.map!;
  expect(m.places!.map(({ name, kind, x, z }) => ({ name, kind, x, z }))).toEqual([
    { name: "red obelisk", kind: "obelisk", x: -7672, z: -8576 },
    { name: "koru", kind: "landmark", x: -6710, z: -5113 },
  ]);
  expect(m.places![0]!.about).toContain("Wynwood");
});
