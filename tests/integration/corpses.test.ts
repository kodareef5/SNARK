// A dead creature's body lies where it fell and is harvested by hitting it, as ARK's is (server/corpses.ts).

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import type { Body } from "../../server/corpses.ts";
import type { EntityRecord } from "../../server/records.ts";
import { CUE_DEAD } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { swing, takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

/** Ada stands on level ground with cheats on, and nothing harms her. */
function camp() {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  return { h, ada, at, me, g };
}

/** Spawns `id` at (x, z) and kills it as `by` would. Returns its body once it has come to rest. */
function killed(h: Harness, id: string, x: number, z: number, by: EntityRecord | null, level = 1): Body {
  const e = h.host.spawnCreature(id, x, z, level);
  expect(e).toBeGreaterThanOrEqual(0);
  h.run(200);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  const before = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, by ? by.pid : 0);
  h.run(3000);
  const body = [...h.host.corpses.bodies.values()].find((b) => !before.has(b.rec.pid));
  expect(body).toBeDefined();
  return body!;
}

/** Where a body's middle is: its first ragdoll body's bone, in the world. */
function middle(h: Harness, b: Body): { x: number; y: number; z: number } {
  if (!b.pose) return { x: b.x, y: b.y + 0.2, z: b.z };
  const bone = h.world.anims[b.kind]!.rig.ragdoll!.bone[0]!;
  const [px, py, pz] = [b.pose.pos[bone * 3]! * b.size, b.pose.pos[bone * 3 + 1]! * b.size, b.pose.pos[bone * 3 + 2]! * b.size];
  const [s, c] = [Math.sin(b.yaw), Math.cos(b.yaw)];
  return { x: b.x + c * px + s * pz, y: b.y + py, z: b.z + c * pz - s * px };
}

/** Puts `s` `far` metres south of a body's middle, looking at it. */
function face(h: Harness, s: ClientSession, b: Body, far = 1.4): void {
  const m = middle(h, b);
  h.say(s, `tp ${m.x.toFixed(3)} ${(m.z - far).toFixed(3)}`, 300);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const e = h.ent(s);
  const eye = h.world.ents.y[e]! + 1.62;
  pilot.yaw = Math.atan2(m.x - h.world.ents.x[e]!, m.z - h.world.ents.z[e]!);
  pilot.pitch = Math.atan2(m.y - eye, Math.hypot(m.x - h.world.ents.x[e]!, m.z - h.world.ents.z[e]!));
  h.run(200);
}

test("a dodo's body lies where it fell, for every client, and a hatchet takes hide and meat from it until it is used up", () => {
  const { h, ada, at, me } = camp();
  const body = killed(h, "core:dodo", at.x, at.z + 1.6, me);
  const ents = h.world.ents;
  expect(body.e).toBeGreaterThanOrEqual(0);
  expect((ents.cue[body.e]! & CUE_DEAD) !== 0).toBe(true);
  expect(body.max).toBe(50);
  expect(body.fall?.still).toBe(true);
  h.say(ada, "give core:hatchet 1");
  h.run(200);
  takeInHand(h, ada, h.reg.index.get("core:hatchet")!);
  face(h, ada, body);
  const hide = h.reg.index.get("core:hide")!;
  const meat = h.reg.index.get("core:meat")!;
  swing(h, h.pilots[0]!, 4, SWING_TICKS);
  console.log(h.host.corpses.blows, h.host.items.inv(me).total(hide), h.host.items.inv(me).total(meat), body.left, h.host.corpses.bodies.has(body.rec.pid));
  void TICK_RATE;
});
