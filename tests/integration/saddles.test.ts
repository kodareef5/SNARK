// A saddle drawn on its creature as every client sees it (D491): put on and taken off by its owner through the game's
// own commands, named by the creature's gear on the wire, and drawn by each client from it.
import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_SKINNED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_FEED, CMD_MOVE, CMD_OPEN, CMD_ORDER, ORDER_UNSADDLE, RESULT_OK } from "../../shared/net/protocol.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { Harness } from "../fixtures/net.ts";
import { RAPTOR, SADDLE, WORN, saddledFrozenPack } from "../fixtures/saddles.ts";

/** The meshes drawn on each body in a frame, by its entity, with the first bone of each. */
function drawn(p: FramePacket, meshes: readonly { id: string }[]): Map<number, string[]> {
  const u16 = new Uint16Array(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength >> 1);
  const out = new Map<number, string[]>();
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const list = out.get(p.transientIds[i]!) ?? out.set(p.transientIds[i]!, []).get(p.transientIds[i]!)!;
      const one = `${meshes[p.drawMesh[d]!]!.id} on ${u16[i * 10 + 6]}`;
      if (!list.includes(one)) list.push(one);
    }
  }
  return out;
}

test("a raptor its tribe saddles is drawn with the saddle by every client, one that joins after too, and by its rider's own while ridden; unsaddled, by none", () => {
  const pack = saddledFrozenPack("worn");
  const meshes = pack.header.meshes;
  const h = new Harness({}, 1, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const ada = app.session;
  let own: FramePacket | null = null;
  const run = (ms: number): void => h.run(ms, (now) => void (own = app.frame(now, 640, 360)));
  const bob = h.join("bob");
  run(800);
  const ents = h.world.ents;
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const a = h.ent(ada);
  const saddle = h.reg.index.get(SADDLE)!;
  // Her own raptor stands three metres before her, and she looks at it.
  const e = h.host.spawnCreature(RAPTOR, ents.x[a]!, ents.z[a]! + 3, 1);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.taming.give(rec, me, 1);
  h.host.creatures.mind.stay(e, 0xffffffff);
  app.controls.yaw = 0;
  app.controls.pitch = -0.3;
  run(400);

  /** What a client that is not riding draws of the raptor, from a camera six metres behind it. */
  const scenes = new Map<ClientSession, Scene>();
  const remote = new RemoteSample();
  const sees = (s: ClientSession): string[] => {
    const scene = scenes.get(s) ?? scenes.set(s, new Scene(s.world!, h.reg, pack)).get(s)!;
    scene.assets.tier = tierOf("medium");
    s.sampleRemote(remote);
    const cam = new Camera();
    [cam.x, cam.y, cam.z, cam.pitch] = [ents.x[e]!, ents.y[e]! + 2, ents.z[e]! - 6, -0.2];
    return drawn(scene.build(cam, remote), meshes).get(e) ?? [];
  };
  const body = (list: string[]): string => list.find((m) => m.startsWith(`${RAPTOR} on`))!.split(" on ")[1]!;
  const withSaddle = (list: string[]): string[] => [`${RAPTOR} on ${body(list)}`, `${WORN} on ${body(list)}`];
  expect([sees(bob), drawn(own!, meshes).get(e)].map((l) => l!.length)).toEqual([1, 1]);
  // Wild or tame, a creature with no saddle has no gear on the wire.
  expect(ents.gears.get(e)).toBeUndefined();

  // She puts the saddle on it from its inventory, as a player does.
  h.host.items.mint(me, saddle, 1);
  run(200);
  ada.command(CMD_OPEN, (w: BitWriter) => w.u32(e));
  run(200);
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(ada.inventory!.item.indexOf(saddle)), w.bits(BOX_OPEN, 1), w.varint(0), w.u16(0), w.u16(saddle)));
  run(150);
  ada.command(CMD_FEED, (w: BitWriter) => (w.varint(0), w.u16(saddle)));
  run(300);
  ada.command(CMD_CLOSE);
  run(300);
  expect([rec.saddle, [...ents.gears.get(e)!]]).toEqual([saddle, [0, saddle, 0, 0, 0, 0]]);
  // Each client draws it on the raptor's own bones: hers, Bob's, and Carol's, who joins after it was put on.
  const carol = h.join("carol");
  run(1200);
  for (const list of [drawn(own!, meshes).get(e)!, sees(bob), sees(carol)]) expect(list).toEqual(withSaddle(list));

  // Riding it, her own client draws the raptor as the body it predicts, and draws it saddled, as the others do.
  expect(h.host.riding.mount(h.client(ada)!, e)).toBe(RESULT_OK);
  run(600);
  expect([ada.driving, h.client(ada)!.drive]).toEqual([e, e]);
  for (const list of [drawn(own!, meshes).get(e)!, sees(bob), sees(carol)]) expect(list).toEqual(withSaddle(list));
  // Off it, she takes the saddle off, and nobody draws it.
  h.host.riding.dismount(h.client(ada)!);
  run(400);
  expect(ada.driving).toBe(-1);
  ada.command(CMD_ORDER, (w: BitWriter) => (w.u32(e), w.u8(ORDER_UNSADDLE)));
  run(400);
  expect([rec.saddle, ents.gears.get(e)![GEAR_WORN]]).toEqual([0, 0]);
  for (const list of [drawn(own!, meshes).get(e)!, sees(bob), sees(carol)]) expect(list).toEqual([`${RAPTOR} on ${body(list)}`]);
  // Each client's copy of its gear says so.
  for (const s of [bob, carol]) {
    s.sampleRemote(remote);
    const i = Array.from(remote.id.subarray(0, remote.count)).indexOf(e);
    expect(remote.gear[i * GEAR_COUNT + GEAR_WORN]).toBe(0);
  }
  h.host.shutdown();
});
