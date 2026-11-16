// Reproduce the surface self-check in software, including the old rigid-species flag regression.
// bun tools/surfaces/probe.ts [evidence-directory]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DRAW_PLAIN } from "../../client/core/render/packet.ts";
import { heldTo, probePasses, provingProbes } from "../../client/core/selfcheck.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { worldMaps, surfaceProbeView, probePixel, probeRgb } from "../../tests/fixtures/world-surfaces.ts";
import { encodePng } from "../snap/png.ts";

const folder = resolve(process.argv[2] ?? "assets/source/surfaces/evidence/continued");
mkdirSync(folder, { recursive: true });
const width = 1280, height = 577, v = surfaceProbeView(width, height), maps = worldMaps(v.pack);
const p = v.scene.build(v.cam, v.remote);
p.texUploads.push(...maps.uploads);
v.raster.render(p);
const probes = provingProbes(v.cam, v.reg, v.pack.palette, SKY_COLOR, v.hf, true, p, { width, height, sample: maps.sample });
const read = () => probes.map((b) => {
  const got = probeRgb(v, b), at = probePixel(v, b), draw = v.raster.pickDraw[at]!;
  return { name: b.name, pixel: [at % width, Math.floor(at / width)], expected: heldTo(b, ...got), got, ok: probePasses(b, ...got), pick: { kind: v.raster.pickKind[at], id: v.raster.pickId[at], draw, flags: draw < 0 ? null : p.drawFlags[draw] } };
});
const after = read();
writeFileSync(resolve(folder, "after.png"), encodePng(width, height, v.raster.color));
const creature = probes.find((b) => b.name === "creature")!, draw = v.raster.pickDraw[probePixel(v, creature)]!;
p.texUploads.length = 0;
p.drawFlags[draw]! &= ~DRAW_PLAIN;
v.raster.render(p);
const before = read();
writeFileSync(resolve(folder, "before.png"), encodePng(width, height, v.raster.color));
p.drawFlags[draw]! |= DRAW_PLAIN;
p.texDrops.push(...new Set(maps.uploads.map((u) => u.slot)));
v.raster.render(p);
const withoutAtlas = probeRgb(v, creature);
const result = { canvas: [width, height], hour: v.scene.hour, camera: [v.cam.x, v.cam.y, v.cam.z, v.cam.yaw, v.cam.pitch], creatureYaw: v.remote.yaw[1], reference: "RGBA, same source/mips as the software renderer; no GPU readback used", before: { note: "Reproduction of the previous rigid entity draw, DRAW_PLAIN cleared", probes: before }, after: { probes: after }, creatureWithoutAtlas: withoutAtlas, draws: p.drawCount, triangles: p.triangles };
writeFileSync(resolve(folder, "software-probe.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
