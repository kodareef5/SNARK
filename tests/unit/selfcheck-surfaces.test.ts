import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { SelfcheckSurfaces } from "../../client/core/selfcheck-surfaces.ts";
import { MASK_MATERIALS, SURFACE_NAMES } from "../../content/surfaces.ts";
import { probePasses, provingProbes } from "../../client/core/selfcheck.ts";
import { DRAW_PLAIN } from "../../client/core/render/packet.ts";
import { lit, srgbToLinear } from "../../client/core/render/surface.ts";
import { SKY_COLOR } from "../../shared/pack/palette.ts";
import { PICK_ENTITY, PICK_STRUCTURE, PICK_TERRAIN } from "../../tools/snap/raster.ts";
import { writeTextureFile } from "../../tools/pack/texture.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { referenceManifest, worldMaps, surfaceProbeView, probePixel, probeRgb } from "../fixtures/world-surfaces.ts";

artTest("surface twins hit the same pixels, planes and mips as the software scene at browser and small canvas sizes", () => {
  const maps = worldMaps(corePack());
  for (const [width, height, hour] of [[1280, 577, 9], [320, 180, 12]]) {
    const v = surfaceProbeView(width!, height!); v.scene.hour = hour!;
    const p = v.scene.build(v.cam, v.remote);
    p.texUploads.push(...maps.uploads);
    v.raster.render(p);
    const probes = provingProbes(v.cam, v.reg, v.pack.palette, SKY_COLOR, v.hf, true, p, { width: width!, height: height!, sample: maps.sample });
    expect(probes.map((b) => b.name)).toEqual(["sky", "plaza", "block", "slope", "creature", "body"]);
    for (const b of probes) {
      const got = probeRgb(v, b);
      expect(probePasses(b, ...got)).toBe(true);
      if (["sky", "plaza", "block", "slope"].includes(b.name)) {
        // Much tighter than the browser's lit tolerance: no compression or unknown body facing here.
        expect(Math.max(...got.map((c, k) => Math.abs(c - b.rgb[k]!)))).toBeLessThanOrEqual(1);
      }
    }
    for (const [index, kind] of [[1, PICK_TERRAIN], [2, PICK_STRUCTURE], [3, PICK_TERRAIN], [4, PICK_ENTITY]]) expect(v.raster.pickKind[probePixel(v, probes[index!]!)]).toBe(kind);
    // Without the reference the ground and the statics are left out, never held to palette light.
    expect(provingProbes(v.cam, v.reg, v.pack.palette, SKY_COLOR, v.hf, true, p, { width: width!, height: height!, sample: null }).map((b) => b.name)).toEqual(["sky", "creature", "body"]);
  }
});

artTest("a rigid species keeps its palette light with or without the finishes; removing DRAW_PLAIN reproduces the regression", () => {
  const v = surfaceProbeView(320, 180), maps = worldMaps(v.pack);
  const p = v.scene.build(v.cam, v.remote);
  p.texUploads.push(...maps.uploads); v.raster.render(p);
  const creature = provingProbes(v.cam, v.reg, v.pack.palette, SKY_COLOR, v.hf, true, p, { width: 320, height: 180, sample: maps.sample }).find((b) => b.name === "creature")!;
  const at = probePixel(v, creature), draw = v.raster.pickDraw[at]!;
  expect(v.raster.pickId[at]).toBe(v.remote.id[1]!);
  expect(p.drawFlags[draw]! & DRAW_PLAIN).toBe(DRAW_PLAIN);
  const plain = probeRgb(v, creature);
  expect(probePasses(creature, ...plain)).toBe(true);
  p.drawFlags[draw]! &= ~DRAW_PLAIN;
  p.texUploads.length = 0; v.raster.render(p);
  const surfaced = probeRgb(v, creature);
  expect(surfaced).not.toEqual(plain);
  // Drawn with a finish its colour moves by far more than the plain twin allows; a finish this close to it in hue may still pass the lit probe's tolerance.
  expect(Math.max(...surfaced.map((c, k) => Math.abs(c - plain[k]!)))).toBeGreaterThan(30);
  // This is still the creature's pixel, not terrain appearing through or in front of it.
  expect(v.raster.pickKind[at]).toBe(PICK_ENTITY);
  expect(v.raster.pickId[at]).toBe(v.remote.id[1]!);
  p.drawFlags[draw]! |= DRAW_PLAIN;
  p.texDrops.push(...new Set(maps.uploads.map((u) => u.slot))); v.raster.render(p);
  expect(probeRgb(v, creature)).toEqual(plain);
  v.scene.assets.tier = tierOf("lowpoly");
  const low = v.scene.build(v.cam, v.remote);
  const mesh = v.scene.meshOfKind[v.remote.kind[1]!]!;
  for (let d = 0; d < low.drawCount; d++) if (low.drawMesh[d] === mesh) expect(low.drawFlags[d]! & DRAW_PLAIN).toBe(0);
});

test("a rigid species and prop sharing a mesh get separate lit policies and still batch together on low poly", () => {
  const v = surfaceProbeView(16, 9), r = v.remote;
  const prop = v.reg.index.get("core:cache")!, mesh = v.scene.meshOfKind[r.kind[1]!]!;
  r.kind[0] = prop;
  v.scene.meshOfKind[prop] = mesh;
  const p = v.scene.build(v.cam, r);
  const draws = Array.from({ length: p.drawCount }, (_, d) => d).filter((d) => p.drawMesh[d] === mesh);
  expect(draws.map((d) => [p.drawFlags[d]! & DRAW_PLAIN, p.drawInstances[d], p.transientIds[p.drawFirst[d]!]])).toEqual([[0, 1, r.id[0]], [DRAW_PLAIN, 1, r.id[1]]]);
  v.scene.assets.tier = tierOf("lowpoly");
  const low = v.scene.build(v.cam, r);
  const batch = Array.from({ length: low.drawCount }, (_, d) => d).filter((d) => low.drawMesh[d] === mesh);
  expect(batch.map((d) => [low.drawFlags[d]! & DRAW_PLAIN, low.drawInstances[d]])).toEqual([[0, 2]]);
});

test("fully rough palette light is identical when its unused reflected-sky lookup is skipped", () => {
  const v = surfaceProbeView(16, 9), p = v.scene.build(v.cam, v.remote);
  const a = new Float64Array(3), b = new Float64Array(3);
  for (const normal of [[0, 1, 0], [0, 0, -1], [1, 0, 0]]) {
    lit(a, [0.3, 0.4, 0.1], [1, 1, 0], normal, [0, 0, -1], p.frame, [0, 0, 0]);
    lit(b, [0.3, 0.4, 0.1], [1, 1, 0], normal, [0, 0, -1], p.frame, [17, 2, 9]);
    expect(a).toEqual(b);
  }
});

test("self-check fetches independent RGBA maps, keeps GPU arrivals separate and reports a missing reference", () => {
  const { manifest, materials } = referenceManifest(corePack());
  const roles = ["base", "normal", "mro"] as const;
  const encoded = writeTextureFile("rgba", roles.map((role) => ({ role, block: 1, pictures: Array.from({ length: 7 }, (_, k) => new Uint8Array(4 ** k * (role === "normal" ? 2 : 4)).fill(128)) })));
  manifest.files.push({ name: "reference", bytes: encoded.bytes.length, role: "tex", format: "rgba" });
  for (const material of materials) roles.forEach((role, k) => { manifest.textures![material[role]] = { id: `${material.id}/${role}`, role, top: 64, in: { rgba: { file: 1, ...encoded.placed[k]! } } }; });
  const port = new FakeNet([new Uint8Array(0), encoded.bytes], { keep: true });
  const reference = new SelfcheckSurfaces(manifest, port);
  expect(port.log).toHaveLength(0); // Creating it for a low-poly check fetches nothing.
  reference.start(); reference.start();
  // Each finish's three maps, and each mask's packed map: the weathering's and the road's two.
  expect(port.log).toHaveLength(SURFACE_NAMES.length * 3 + MASK_MATERIALS.length);
  reference.request({ slot: 42, file: 1, parts: [{ offset: 0, length: 16, hash: "" }], priority: 1, fresh: false });
  port.advance(1);
  const arrivals: Parameters<SelfcheckSurfaces["take"]>[0] = [];
  expect(reference.take(arrivals)).toBe(1); expect(arrivals[0]!.slot).toBe(42);
  expect(reference.done).toBe(true); expect(reference.error).toBeNull();
  const value = new Float64Array(4);
  reference.sample!(0, 15, 0.12, 0.12, -5, value);
  expect(value[0]).toBeCloseTo(srgbToLinear(128 / 255), 6);
  reference.sample!(1, 15, 0.12, 0.12, -5, value);
  expect(value[1]).toBeCloseTo(128 / 255, 6);
  const brokenPort = new FakeNet([new Uint8Array(0), new Uint8Array(0)]);
  const broken = new SelfcheckSurfaces(manifest, brokenPort);
  broken.start(); brokenPort.advance(1); broken.take([]);
  expect(broken.done).toBe(true); expect(broken.error).toContain("failed");
  const missing = new SelfcheckSurfaces({ ...manifest, materials: [] }, port);
  missing.start(); expect(missing.done).toBe(true); expect(missing.error).toContain("no RGBA maps"); expect(missing.sample).toBeNull();
  // No reference is ever inferred from a GPU pixel or silently replaced with palette lighting.
  expect(broken.sample).toBeNull();
});
