// The grunt gateway (agent/gateway.ts, agent/grunt.ts): a survivor on a real server, in process, played through the grunt
// protocol: welcomed, seen in the protocol's frame (x east, z south), walked, set to harvest by the assist, heard in chat.

import { expect, test } from "bun:test";
import { Endpoint } from "../../grunt/endpoint.ts";
import type { Action, GameMessage, Observation, Outcome, Welcome } from "../../grunt/protocol.ts";
import { SNARK_CAPABILITIES, SNARK_LIMITS } from "../../agent/gateway.ts";
import { SnarkWorld } from "../../agent/grunt.ts";
import { Agent } from "../../agent/tools.ts";
import { Harness } from "../fixtures/net.ts";

function gateway() {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("Scout", {}, { manual: true });
  const world = new SnarkWorld(new Agent(s), "Scout");
  const ep = new Endpoint(world, { capabilities: () => SNARK_CAPABILITIES, limits: SNARK_LIMITS, game: { name: "SNARK", version: "0" }, tickMs: 1000 / 60 });
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
  const outcome = async (command: string, ms = 60_000): Promise<Outcome | undefined> => {
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
  return { h, s, world, got, send, run, act, outcome, observe };
}

test("a survivor is welcomed through the gateway and seen in the protocol's frame", () => {
  const g = gateway();
  g.send({ type: "hello", id: "h", versions: [0], client: { name: "test", version: "0" }, auth: { method: "name", name: "Scout" } });
  const w = g.got.find((m) => m.type === "welcome") as Welcome;
  expect(w.character).toMatchObject({ name: "Scout", alive: true });
  expect(w.character.id).toMatch(/^e\d+$/);
  expect(w.frame).toEqual({ units: "m", up: "+y", east: "+x", south: "+z" });
  const c = g.observe({ self: {}, entities: { radius: 96 }, terrain: { radius: 16, cell: 2 }, inventory: {} }).channels;
  // SNARK's x grows west and z north: the protocol's are the negatives.
  expect(c.self!.pos[0]).toBeCloseTo(-g.s.own.x, 3);
  expect(c.self!.pos[2]).toBeCloseTo(-g.s.own.z, 3);
  expect(c.terrain!.rows.length).toBe(17);
  expect(c.terrain!.rows.join("")).toContain("@");
  expect(c.entities!.items.length).toBeGreaterThan(0);
  expect(Array.isArray(c.inventory!.craftable)).toBe(true);
});

test("a move goes the way the protocol's yaw says, and the assist harvests a resource to its end", async () => {
  const g = gateway();
  g.send({ type: "hello", id: "h", versions: [0], client: { name: "test", version: "0" }, auth: { method: "name", name: "Scout" } });
  const before = g.observe({ self: {} }).channels.self!;
  const m = g.act({ control: "move", forward: 1, strafe: 0, duration_ms: 1000 });
  expect(await g.outcome(m, 3000)).toMatchObject({ status: "completed" });
  const after = g.observe({ self: {} }).channels.self!;
  const [dx, dz] = [after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]];
  expect(Math.hypot(dx, dz)).toBeGreaterThan(1.5);
  // Yaw 0 faces north (-z), rising toward the east (+x): forward is (sin yaw, -cos yaw).
  expect(Math.abs(Math.atan2(dx, -dz) - before.yaw)).toBeLessThan(0.2);
  const near = g.observe({ entities: { radius: 96, max: 40 } }).channels.entities!.items.filter((e) => e.kind === "resource");
  const target = near.find((e) => e.type === "bush") ?? near[0]!;
  expect(["tree", "rock", "bush"]).toContain(target.type);
  const h = g.act({ control: "assist", kind: "harvest", target: target.id });
  const o = await g.outcome(h, 90_000);
  expect(o).toMatchObject({ status: "completed", detail: { result: "gone" } });
  expect(Object.values((o!.detail!.gained ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  expect(g.observe({ inventory: {} }).channels.inventory!.slots.length).toBeGreaterThan(0);
});
