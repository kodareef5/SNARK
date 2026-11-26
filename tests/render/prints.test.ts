// Prints on garments (client/core/render/prints.ts, print-term.ts, picture-layers.ts): layers handed out by key and kept
// while a draw uses them, one picture to the card a frame, a print laid where the Wardrobe page lays it, its twin in the
// rasterizer, and a frame with no print the frame it always was.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_PRINTED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { PictureLayers, PictureLoads } from "../../client/core/render/picture-layers.ts";
import { PRINT_FLOATS, printPicture, printRow, printedOver } from "../../client/core/render/print-term.ts";
import { PRINTS_A_FRAME, PRINTS_IDLE, PRINT_REGION, printLayerBytes } from "../../client/core/render/prints.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { SURFACE_ANY, surfaceFragment, surfaceVertex } from "../../client/core/render/surface.ts";
import { hashBytes } from "../../shared/hash.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import type { EditionPrint } from "../../shared/people/doc.ts";
import { fakeGl } from "../fixtures/gl.ts";
import { GL } from "../../client/core/devicegpu.ts";
import { testPrint, testPrintHost, printBytes, TUBE_PLACE } from "../fixtures/prints.ts";
import { sceneWorld } from "../fixtures/sceneworld.ts";
import { TUBE } from "../fixtures/textured.ts";

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

test("a layer any draw of the frame uses is never given to another", () => {
  const layers = new PictureLayers(1000);
  layers.resize(2);
  expect([layers.take("a", 1, 0), layers.take("b", 1, 0)]).toEqual([0, 1]);
  layers.filled(0, 3);
  layers.filled(1, 3);
  // Both used this frame: a third waits.
  expect(layers.find("a", 2)).toBe(0);
  expect(layers.find("b", 2)).toBe(1);
  expect(layers.take("c", 2, 0)).toBe(-1);
  // Next frame only "b" is used: "a", the least lately used, gives up its layer.
  expect(layers.find("b", 3)).toBe(1);
  expect(layers.take("c", 3, 0)).toBe(0);
  expect([layers.find("a", 3), layers.holds(0)]).toEqual([-1, false]);
});

test("pictures are fetched a few at once, and one no draw wants is dropped", async () => {
  const layers = new PictureLayers(15000), loads = new PictureLoads<string>(layers, 2, 30000);
  layers.resize(4);
  const asked: string[] = [], dropped: string[] = [];
  loads.host = { image: (path) => (asked.push(path), new Promise<string>(() => {})), drop: (path) => void dropped.push(path) };
  for (const k of ["a", "b", "c"]) expect(loads.want(k, `/${k}.png`, 8, 8, 1, 0)).toBe(-1);
  expect([asked, loads.fetching]).toEqual([["/a.png", "/b.png"], 2]);
  // On the next frame only "b" was wanted on the frame before: still. Two frames on, nobody wants it.
  loads.sweep(2, 16);
  expect(dropped).toEqual([]);
  loads.want("b", "/b.png", 8, 8, 2, 16);
  loads.sweep(4, 48);
  expect(new Set(dropped)).toEqual(new Set(["/a.png", "/b.png"]));
  expect(loads.fetching).toBe(0);
});

test("a picture that came for a layer since given to another is passed over", async () => {
  const layers = new PictureLayers(15000), loads = new PictureLoads<string>(layers, 3, 30000);
  layers.resize(1);
  let done: (s: string) => void = () => {};
  loads.host = { image: () => new Promise<string>((go) => (done = go)) };
  loads.want("a", "/a.png", 8, 8, 1, 0);
  done("picture a");
  await settle();
  layers.empty(0);
  layers.take("b", 3, 0);
  expect(loads.next()).toBeNull();
});

test("a print's place lays it as the Wardrobe page draws it", () => {
  const t = new Float32Array(PRINT_FLOATS * 2);
  const at = (k: number, s: number, v: number): [number, number] => {
    const o = k * PRINT_FLOATS, rx = (s - t[o]!) * t[o + 2]! - 0.5, ry = (v - t[o + 1]!) * t[o + 3]! - 0.5;
    return [t[o + 4]! * rx + t[o + 5]! * ry + 0.5, t[o + 6]! * rx + t[o + 7]! * ry + 0.5];
  };
  const place = { u: 0.2, v: 0.1, w: 0.4, h: 0.2, scale: 1, turn: 0 };
  printRow(t, 0, place, 0.5, [0, 0, 0, 0]);
  // The rectangle's middle is the picture's; its width fills the rectangle's; down the sheet is down the picture.
  expect(at(0, 0.4, 0.2).map((x) => +x.toFixed(6))).toEqual([0.5, 0.5]);
  expect(at(0, 0.5, 0.2)[0]).toBeCloseTo(0.75, 6);
  expect(at(0, 0.4, 0.25)[1]).toBeCloseTo(0.5 + 0.05 / 0.2, 6);
  // Turned a quarter counter-clockwise, the picture's right points up the sheet.
  printRow(t, 1, { ...place, turn: Math.PI / 2 }, 1, [0, 0, 0, 0]);
  const [qx, qy] = at(1, 0.4, 0.15);
  expect([+qx.toFixed(6), +qy.toFixed(6)]).toEqual([+(0.5 + 0.05 / 0.4).toFixed(6), 0.5]);
});

test("the twin lays the ink over the dyed cloth by its alpha, keeping the weave", () => {
  const side = 4, bytes = new Uint8Array(side * side * 4);
  for (let i = 0; i < 8; i++) bytes.set([255, 0, 0, 255], i * 4);
  const picture = printPicture(bytes, side), t = new Float32Array(PRINT_FLOATS);
  printRow(t, 0, { u: 0, v: 0, w: 1, h: 1, scale: 1, turn: 0 }, 1, [0.5, 0, 0, 0.5]);
  const lay = (v: number, swatch = false, base = [0.5, 0.5, 0.5]): number[] => {
    const cloth = [0.2, 0.3, 0.4];
    printedOver(cloth, base, 0.5, t, 0, picture, swatch, 0.5, v, 1e-3, 0, 0, 1e-3);
    return cloth.map((c) => +c.toFixed(4));
  };
  // The top half is red ink, the bottom none, and between them half of each.
  expect(lay(0.1)).toEqual([1, 0, 0]);
  expect(lay(0.9)).toEqual([0.2, 0.3, 0.4]);
  expect(lay(0.5)).toEqual([0.6, 0.15, 0.2]);
  // A weave darker than the material's grey darkens the ink with it; a swatch is the mean everywhere.
  expect(lay(0.1, false, [0.25, 0.25, 0.25])).toEqual([0.5, 0, 0]);
  expect(lay(0.9, true)).toEqual([0.6, 0.15, 0.2]);
  // Outside the rectangle nothing changes.
  const cloth = [0.2, 0.3, 0.4];
  printedOver(cloth, [0.5, 0.5, 0.5], 0.5, t, 0, picture, false, 0.5, 1.2, 1e-3, 0, 0, 1e-3);
  expect(cloth).toEqual([0.2, 0.3, 0.4]);
});

test("the programs that draw prints compile and link, and no other text reads a print", () => {
  const gl = fakeGl();
  for (const name of ["surfacePrinted", "surfacePrintedCut", "surfacePrintedLayer"]) {
    for (const tier of ["medium", "high", "ultra"]) {
      const text = PROGRAMS[name]!(tierOf(tier), "rgba", false, true);
      const program = gl.createProgram();
      for (const [type, source] of [[GL.VERTEX_SHADER, text.vertex], [GL.FRAGMENT_SHADER, text.fragment]] as const) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source.replace("\n", "\n" + text.defines));
        gl.compileShader(shader);
        expect(gl.getShaderInfoLog(shader) ?? "").toBe("");
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      expect(gl.getProgramInfoLog(program) ?? "").toBe("");
      expect(text.samplers.uPrints).toBe(31);
      expect(text.defines).toContain(`#define PRINT_LAYERS ${tierOf(tier).prints.layers}`);
    }
  }
  for (const v of [SURFACE_ANY, { ...SURFACE_ANY, layered: true }, { ...SURFACE_ANY, dyed: false }]) {
    expect(surfaceFragment("rgba", "", v)).not.toContain("Print");
    expect(surfaceVertex(v)).not.toContain("vPrint");
  }
});

/** A crowd of `n` tubes in rows of ten facing the camera, tube `k` in print `k` or none, on `tier`. */
function crowd(n: number, printed: boolean, tier = "medium") {
  const w = sceneWorld({}, tierOf(tier));
  const host = testPrintHost();
  w.scene.prints.host = host;
  const prints: EditionPrint[] = Array.from({ length: n }, (_, k) => testPrint(k, TUBE_PLACE));
  for (let k = 0; k < n; k++) w.place(TUBE, 32 + ((k % 10) - Math.min(n, 10) / 2 + 0.5) * 1.3, 24 + Math.floor(k / 10) * 1.5, { colors: [8, 7, 14, 6], yaw: 0 });
  if (printed) w.scene.prints.worn = { meshes: [w.mesh(TUBE)], of: (id) => prints[id - 100] ?? null };
  return { ...w, host, prints };
}

/** A packet's draws as the shell is told them, in any order, less their print flag and their instances' third region. */
function drawsOf(p: FramePacket): string {
  const rows: string[] = [];
  for (let d = 0; d < p.drawCount; d++) rows.push([p.drawMesh[d], p.drawLod[d], p.drawSlot[d], p.drawBuffer[d], p.drawFirst[d], p.drawInstances[d], p.drawFlags[d]! & ~DRAW_PRINTED, p.drawFirstIndex[d], p.drawIndexCount[d]].join());
  return rows.sort().join(";");
}

function hashOf(p: FramePacket): number {
  let h = hashBytes(new Uint8Array(p.drawFlags.buffer, 0, p.drawCount * 4));
  h = hashBytes(new Uint8Array(p.transient.buffer, 0, p.transientCount * INSTANCE_BYTES), h);
  return hashBytes(new TextEncoder().encode(drawsOf(p)), h);
}

test("a frame with no print worn is the frame drawn before prints, hash for hash", async () => {
  const plain = crowd(6, false), none = crowd(6, false);
  // The second wears prints of nobody: its packets are the first's.
  none.scene.prints.worn = { meshes: [none.mesh(TUBE)], of: () => null };
  for (let f = 0; f < 30; f++) {
    const a = plain.frame(100, false), b = none.frame(100, false);
    expect(hashOf(b)).toBe(hashOf(a));
    expect([b.printLayers, b.printUploads]).toEqual([0, 0]);
    await settle();
  }
  expect(none.host.asked).toEqual([]);
});

test("forty tubes in forty prints are the draws of forty plain, one picture to the card a frame", async () => {
  const plain = crowd(40, false), dressed = crowd(40, true);
  let most = 0, put = 0, printedDraws = 0;
  for (let f = 0; f < 80; f++) {
    const a = plain.frame(100, false), b = dressed.frame(100, false);
    expect(drawsOf(b)).toBe(drawsOf(a));
    most = Math.max(most, b.printUploads);
    put += b.printUploads;
    if (f === 79) for (let d = 0; d < b.drawCount; d++) if ((b.drawFlags[d]! & DRAW_PRINTED) !== 0) printedDraws++;
    await settle();
  }
  // Medium's array holds 32 layers: 32 of the 40 prints, one a frame.
  expect([most, put, dressed.scene.prints.held]).toEqual([PRINTS_A_FRAME, 32, 32]);
  expect(dressed.host.asked.length).toBe(32);
  expect(printedDraws).toBeGreaterThan(0);
  // Each printed draw of the tube is all its wearers', each instance naming its own layer, or none.
  const p = dressed.frame(100, false), layers = new Set<number>();
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawMesh[d] !== dressed.mesh(TUBE) || (p.drawFlags[d]! & DRAW_TEXTURED) === 0 || p.drawBuffer[d] !== TRANSIENT_BUFFER) continue;
    expect(p.drawFlags[d]! & DRAW_PRINTED).toBe(DRAW_PRINTED);
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) layers.add(p.transient[i * INSTANCE_BYTES + 14 + PRINT_REGION]!);
  }
  expect(layers.size).toBeGreaterThan(20);
  expect(Math.max(...layers)).toBeLessThanOrEqual(32);
});

test("the array is made at the tier's size when a print is wanted, reserved, and let go when none is", async () => {
  const w = crowd(2, true), plain = crowd(2, false);
  const reserved = (): number => w.scene.assets.residency.reserved - plain.scene.assets.residency.reserved;
  let p = w.frame(100, false);
  plain.frame(100, false);
  // The first frame wants the prints; the next makes the array.
  p = w.frame(100, false);
  plain.frame(100, false);
  expect([p.printSide, p.printLayers]).toEqual([256, 32]);
  expect(reserved()).toBe(32 * printLayerBytes(256));
  w.scene.prints.worn = null;
  for (let t = 0; t <= PRINTS_IDLE * 1000; t += 1000) {
    p = w.frame(1000, false);
    plain.frame(1000, false);
  }
  p = w.frame(100, false);
  plain.frame(100, false);
  expect([p.printSide, p.printLayers, reserved()]).toEqual([0, 0, 0]);
});

test("low poly makes no array, and the governor's step draws swatches and uploads nothing", async () => {
  const low = crowd(3, true, "lowpoly");
  for (let f = 0; f < 5; f++) {
    const p = low.frame(100, false);
    expect([p.printLayers, p.printUploads]).toEqual([0, 0]);
    await settle();
  }
  expect(low.host.asked).toEqual([]);
  const w = crowd(3, true);
  w.scene.assets.tier = { ...w.scene.assets.tier, prints: { ...w.scene.assets.tier.prints, swatches: true } };
  for (let f = 0; f < 10; f++) {
    const p = w.frame(100, false);
    expect([p.printSwatches, p.printUploads]).toEqual([true, 0]);
    await settle();
  }
});

test("the rasterizer draws a tube's print where it lies", async () => {
  const plain = crowd(1, false), dressed = crowd(1, true);
  for (let f = 0; f < 30; f++) {
    plain.frame(100);
    dressed.frame(100);
    await settle();
  }
  const a = plain.raster.color, b = dressed.raster.color;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 30) changed++;
  expect(dressed.scene.prints.held).toBe(1);
  expect(changed).toBeGreaterThan(40);
  // The picture as the card holds it has its own mean at its last level.
  const pic = printPicture(printBytes(16), 16);
  expect(pic.levels.length).toBe(5);
});

test("a wearer at a flat level carries its print's swatch, the palette colour nearest its picture", async () => {
  const w = crowd(1, true);
  for (let f = 0; f < 6; f++) {
    w.frame(100, false);
    await settle();
  }
  const swatch = w.scene.prints.byteOf(w.prints[0]!, true), layer = w.scene.prints.byteOf(w.prints[0]!, false) - 1;
  expect(layer).toBeGreaterThanOrEqual(0);
  expect(w.scene.prints.swatch(layer)).toBe(swatch);
  // Print 0 is a red disc, a white quarter and a dark bar: its swatch is a warm colour.
  const [r, g, b] = [w.pack.palette[swatch * 4]!, w.pack.palette[swatch * 4 + 1]!, w.pack.palette[swatch * 4 + 2]!];
  expect(swatch).toBeGreaterThan(0);
  expect(r).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(b);
});

test("a print whose picture failed is not asked for again until the wait is over", async () => {
  const w = crowd(1, true);
  w.host.fail.add("/media/print.00000000ab000000.png");
  for (let f = 0; f < 10; f++) {
    w.frame(100, false);
    await settle();
  }
  expect(w.host.asked.length).toBe(1);
  expect(w.scene.prints.held).toBe(0);
  w.host.fail.clear();
  for (let t = 0; t < 31_000; t += 1000) {
    w.frame(1000, false);
    await settle();
  }
  expect(w.host.asked.length).toBe(2);
  expect(w.scene.prints.held).toBe(1);
});
