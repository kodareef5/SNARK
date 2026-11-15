// What the client draws, held still while the way it finds its meshes changes underneath.
import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";
import { frozenPack } from "../fixtures/pack.ts";

/** Everything of a frame packet that names a mesh, a level, an instance or a bone. */
function fold(hash: number, p: FramePacket): number {
  const mix = (v: number): void => {
    hash = Math.imul(hash ^ (v >>> 0), 16777619) >>> 0;
  };
  mix(p.drawCount);
  for (let i = 0; i < p.drawCount; i++) {
    mix(p.drawMesh[i]!);
    mix(p.drawLod[i]!);
    mix(p.drawBuffer[i]!);
    mix(p.drawFirst[i]!);
    mix(p.drawInstances[i]!);
    mix(p.drawFlags[i]!);
  }
  mix(p.transientCount);
  for (let i = 0; i < p.transientCount * 20; i++) mix(p.transient[i]!);
  mix(p.boneCount);
  mix(p.triangles);
  mix(p.tileCount);
  return hash;
}

/**
 * A survivor watching, ten metres off: a dressed and armed survivor, a bare dummy, creatures of every kind, and things
 * built. The pack's art is frozen, so the frames change when code or content does and not when art does.
 */
function scene() {
  const pack = frozenPack();
  const h = new Harness({}, 1, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const bob = h.join("bob");
  const frame = (now: number): void => void app.frame(now, 1280, 720);
  h.run(800, frame);
  const e = h.world.ents;
  const ada = h.ent(app.session);
  // The console takes a line a third of a second. Each thing is set down in front of him, so he turns between them.
  for (const line of ["enablecheats", `tp ${e.x[ada]!.toFixed(2)} ${(e.z[ada]! + 10).toFixed(2)}`, "armor hide", "kit rifle", "dummy", "spawn raptor 5", "spawn parasaur 5", "spawn grazer 3", "place wall_metal", "place storage_box", "place campfire"]) {
    h.say(bob, line, 500);
    h.pilots[1]!.yaw += 0.6;
  }
  const inv = bob.inventory!;
  const rifle = h.reg.index.get("core:rifle")!;
  bob.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(rifle)), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(rifle)));
  h.run(200, frame);
  bob.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(400, frame);
  return { h, app, bob, pack };
}

test("three hundred frames of a busy scene draw what they drew before", () => {
  const { h, app, pack } = scene();
  let hash = 2166136261;
  let frames = 0;
  let most = 0;
  const meshes = new Set<number>();
  for (; frames < 300; frames++) {
    h.run(1000 / 60, (now) => {
      const p = app.frame(now, 1280, 720)!;
      hash = fold(hash, p);
      most = Math.max(most, p.drawCount);
      for (let i = 0; i < p.drawCount; i++) meshes.add(p.drawMesh[i]!);
    });
  }
  // Bodies in parts, armor, a held weapon, creatures, a dummy, structures and nodes: a scene that uses the pack widely.
  const drawn = new Set([...meshes].map((m) => pack.header.meshes[m]!.id));
  const missing = ["core:human_m/head", "core:human_m/armor/hide/torso", "core:rifle", "core:mannequin/torso", "core:raptor", "core:parasaur", "core:grazer", "core:wall_metal", "core:storage_box", "core:campfire", "core:tree"].filter((id) => !drawn.has(id));
  expect(missing).toEqual([]);
  expect(most).toBeGreaterThan(30);
  // It was 367ac8c0 while a draw recorded the level asked for. It records the level drawn, which for a far mesh with one
  // level is 0 and not 1 or 2. Nothing else of these frames changed. It was e47bd0b0 while the wall built was a wooden
  // one, which the wood tier's art redraws; the metal wall in its place still draws as its grey box. It was 6ede278
  // before the dodo's grey box joined the pack, which numbers the meshes after it one on. It was 1e566e48 before nodes
  // were drawn at their sizes: their draws carry DRAW_SIZED, seven more kinds' grey boxes number the meshes after the
  // tree's on, and nodes stand on their bases. The drawing changes alone left it 1e566e48. It was eac4fa58 until three more
  // kinds' grey boxes numbered the meshes after them on.
  expect(hash.toString(16)).toBe("dfac0bb4");
});
