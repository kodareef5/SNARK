// What the client draws, held still while the way it finds its meshes changes underneath.
import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { SADDLE, WORN, saddledFrozenPack } from "../fixtures/saddles.ts";

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
 * built. The pack's art is frozen, so the frames change when code or content does and not when art does. With
 * `saddled`, the pack holds the raptor's box saddle (tests/fixtures/saddles.ts) and the raptor wears it.
 */
function scene(saddled = false) {
  const pack = saddled ? saddledFrozenPack("worn") : frozenPack();
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
  if (saddled) {
    const raptor = [...h.host.records.byPid.values()].find((r) => r.kind === h.reg.index.get("core:raptor"))!;
    raptor.saddle = h.reg.index.get(SADDLE)!;
    h.host.refreshBody(raptor);
  }
  h.run(400, frame);
  return { h, app, bob, pack };
}

/** Three hundred frames of the scene, hashed, and the meshes they drew by id. */
function frames(saddled = false) {
  const { h, app, pack } = scene(saddled);
  let hash = 2166136261;
  let most = 0;
  const meshes = new Set<number>();
  for (let f = 0; f < 300; f++) {
    h.run(1000 / 60, (now) => {
      const p = app.frame(now, 1280, 720)!;
      hash = fold(hash, p);
      most = Math.max(most, p.drawCount);
      for (let i = 0; i < p.drawCount; i++) meshes.add(p.drawMesh[i]!);
    });
  }
  return { hash: hash.toString(16), most, drawn: new Set([...meshes].map((m) => pack.header.meshes[m]!.id)) };
}

test("three hundred frames of a busy scene draw what they drew before", () => {
  const { hash, most, drawn } = frames();
  // Bodies in parts, armor, a held weapon, creatures, a dummy, structures and nodes: a scene that uses the pack widely.
  const missing = ["core:human_m/head", "core:human_m/armor/hide/torso", "core:rifle", "core:mannequin/torso", "core:raptor", "core:parasaur", "core:grazer", "core:wall_metal", "core:storage_box", "core:campfire", "core:tree"].filter((id) => !drawn.has(id));
  expect(missing).toEqual([]);
  expect(most).toBeGreaterThan(30);
  // It was 367ac8c0 while a draw recorded the level asked for. It records the level drawn, which for a far mesh with one
  // level is 0 and not 1 or 2. Nothing else of these frames changed. It was e47bd0b0 while the wall built was a wooden
  // one, which the wood tier's art redraws; the metal wall in its place still draws as its grey box. It was 6ede278
  // before the dodo's grey box joined the pack, which numbers the meshes after it one on. It was 1e566e48 before nodes
  // were drawn at their sizes: their draws carry DRAW_SIZED, seven more kinds' grey boxes number the meshes after the
  // tree's on, and nodes stand on their bases. The drawing changes alone left it 1e566e48. It was eac4fa58 until three more
  // kinds' grey boxes numbered the meshes after them on, and dfac0bb4 until the dodo was drawn as its model: its grey box
  // left the pack, and its model is not among the frozen art. It was 17efe7fc before medium split the view into two depth
  // ranges (D252), which orders the draws by step and lists one across the split twice; with the split at 0 it is that again.
  // It was f589aaf4 until medium listed sun shadow casters (D267), and is that again with medium's shadows off. With them on
  // every frame's draws, triangles and tiles in view are what they were; the tiles only shadows need are counted, and a
  // body's instances are ordered by the cascades they cast into. It was 38466578 until two changes that each, alone, was
  // shown to leave the rest of these frames as they were: medium drew the proving ground's trees, rocks and bushes past
  // the near node field (D259; alone 2138be4c, and 38466578 again with medium's node reaches at 0), and medium drew the
  // sea seen from above with WATER, past the map to the end of the view (D270; alone 60ea88d4, and 38466578 again with a
  // plain sky, which draws the sea as it was). Together they give 5a53ee48, which this was until the elder oak became a kind
  // of its own, its grey box numbering the meshes after it on and its slots taking some of the proving ground's bare ground
  // (90f764f0 alone), and a banyan whose footing fails grew a strangler fig in its place. It was 6dad72dc until the stone
  // kinds took a footing and 100 of the proving ground's slots grew nothing where the ground falls away under a stone's
  // base; the stones' sizes and variants alone leave it 6dad72dc, and the footing alone gives 62da330. It was 62da330 until
  // two changes: far nodes were drawn as rows of an atlas, every mesh of a tile in one draw (DRAW_PULLED; alone, with the
  // hand-over band past the near field, c446a790), and the near store handed its nodes to the far store over a band of
  // 152 to 184 m (hand.ts), drawing none past it and fading those in it, which the far store draws from the band on to a
  // reach cut to keep the ring it covers as large (farnodes.ts farReach). It was c56e26fc until the common tree grew at 0.85
  // to 1.15 of its models, not 0.4 to 0.75: 98 more instances a frame and 3,136 more triangles, in the same 122 draws. The
  // sizes alone give it, and its four young variants and the elders' boxes alone leave it c56e26fc. It was 9a45f2b0 until
  // the pack held four meshes more, the wooden club, the slingshot and its stone (9df72448 with those alone) and the grey
  // box of feces lying (b504d298 with that alone), and wild creatures wandered at their walking speed, not at 90/127 of
  // it, so the scene's raptor, parasaur and grazer walk further between frames (ebea25a9 with that alone). It was 47b0fc09
  // until the pack held the mortar and pestle's grey box (content/items/stations.ts); without it and sparkpowder it is that again.
  // It was afc8210d until the pack held the smoke and poison clouds' boxes, which are never drawn (render/clouds.ts); without
  // the two grenades, their clouds and the poison's buff (content/items/explosives.ts) it is that again.
  // It was fff88e25 until the pack held the obelisk's and its terminal's grey boxes (content/terminals.ts), which number the
  // meshes after them on; without them, and the proving ground's obelisk, it is that again.
  // It was e8a95911 until the pack held the sleeping bag's and the bunk bed's grey boxes; without those two it is that again.
  // It was 949f9aed until the pteranodon's grey box (content/creatures/pteranodon.ts) numbered the meshes after it on;
  // without the pteranodon and its beach entry it is that again.
  // It was 98e00881 until the oil rock's, crystal's, obsidian rock's and clam's grey boxes (content/items/nodes.ts) numbered
  // the meshes after them on (43a2ef65 with that alone) and the proving ground listed eleven of them off the plaza's west
  // and east edges; without those four kinds it is that again.
  // It was f63e1c05 until the smithy's and the fabricator's grey boxes (content/items/stations.ts, S2) numbered the meshes
  // after them on; without the two stations, their pieces and polymer's and electronics' recipes it is that again.
  // It was e689ff39 until the vehicles' three road pieces' grey boxes (content/vehicles/roads.ts) numbered the meshes after them on; without the roads it is that again.
  // It was 16e3f3c1 until the preserving bin's grey box (content/items/stations.ts, S3) numbered the meshes after it on;
  // without the bin, its lit kind, its piece and its engram it is that again.
  // It was 52c8cbd9 until the refining forge's grey boxes (content/items/stations.ts, S1) numbered the meshes after them on;
  // without the forge, its item and engram and the two recipes fired at it it is that again.
  // Koru's bounded static meshes renumber the pack. Removing only those meshes restores e73ea001 exactly.
  // The sail control adds one grey-box mesh; removing only core:koru_sail_control restores d802fd91.
  // Cruise static meshes renumber the frozen pack; excluding only those restores 71fd49c1.
  // See planning/evidence/cruise-mesh-number-proof.json for all four independently restored pins.
  expect(hash).toBe("a36b5221");

  // The same scene with the raptor's box saddle in the pack and on the raptor (FL5), drawn on its bones wherever it is
  // seen. The saddle's mesh numbers the meshes after it on, so the pack that holds it is the frozen one with it added:
  // without it, and the saddle, the scene gives the hash above.
  const saddled = frames(true);
  expect([...saddled.drawn].filter((id) => !drawn.has(id))).toEqual([WORN]);
  // It was bf22a69 until the four resource nodes and their grey boxes, as above; without those four kinds it is that again.
  // It was e968ac75 until the smithy's and the fabricator's grey boxes (S2), as above; without them it is that again.
  // It was 7d2d1185 until the vehicles' three road pieces' grey boxes (content/vehicles/roads.ts) numbered the meshes after them on; without the roads it is that again.
  // It was e48a2ec9 until the preserving bin's grey box (S3), as above; without the bin it is that again.
  // It was 32d21d3d until the refining forge's grey boxes (S1), as above; without the forge it is that again.
  // The same Koru mesh-number change; excluding those meshes restores c7cb77a9.
  // Removing only the new sail-control mesh also restores the saddled scene's d4e844a9 exactly.
  // The same cruise mesh-number change; excluding only cruise meshes restores f8aeaf69.
  expect(saddled.hash).toBe("f36d65a9");
});
