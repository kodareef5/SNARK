// Prints on a GPU, a check of tools/probe-lit.ts: the scene fixture's tube, six of them facing the eye in a row on medium
// at noon, five each in a print of its own laid all round its hide (one twice as wide as high, each turned) and one in
// none, drawn in one draw by a printed SURFACE program (print-term.ts). The pictures go to the card one a frame, as the
// game sends them; then the same frame is drawn as the governor's swatches. Each is held to the rasterizer, which lays
// the print by `printedOver`, at points on one body with no edge near, and enough of those points must be on a print.
// Both pictures of each, the GPU's and the twin's, are written under artifacts/people/prints/. Last, 40 tubes in 40 prints
// at a desktop's canvas are timed against the same crowd plain and the printed program with no print, and the times told.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_PRINTED } from "../../client/core/render/packet.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { printBytes, testPrint, TUBE_PLACE } from "../../tests/fixtures/prints.ts";
import { sceneSet, sceneWorld } from "../../tests/fixtures/sceneworld.ts";
import { TUBE } from "../../tests/fixtures/textured.ts";
import { printMean } from "../../client/core/render/print-term.ts";
import { PRINT_REGION } from "../../client/core/render/prints.ts";
import { spread } from "../probe-textured.ts";
import { encodePng } from "../snap/png.ts";
import { PICK_ENTITY, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [480, 270];
const NEAR = 3;
const SMOOTH = 3;
/** Levels of 255, as the layers check holds the surface program: 95 pixels in 100, and every 5 by 5 mean. */
const TOLERANCE = { pixelP95: 4, meanWorst: 4 };
const LEAST = { all: 200, printed: 100 };
const TUBES = 6;
const FRAMES = 30;
const OUT = resolve(import.meta.dir, "../../artifacts/people/prints");
/** The timed crowd: tubes in rows near the eye, each in a print of its own or none, its last frame drawn this many times more. */
const CROWD = 40;
const REPEATS = 300;
/** The timed crowd is drawn at a desktop's canvas, as the people bench draws it. */
const [TW, TH] = [1920, 1080];
const TIMED = ["plain-a", "printed-a", "flagged-a", "plain-b", "printed-b", "flagged-b", "plain-c", "printed-c", "flagged-c", "plain-d", "printed-d", "flagged-d"] as const;

interface Made {
  frame: number;
  color: Uint8ClampedArray;
  pickKind: Uint8Array;
  pickId: Float64Array;
  pickDraw: Int16Array;
  /** By entity: whether its instance names a print. */
  printed: Set<number>;
}
const made = new Map<string, Made>();

function shot(key: string, swatches: boolean): Shot {
  const set = sceneSet(64);
  const w = sceneWorld({}, tierOf("medium"), set);
  w.scene.viewHeight = H;
  w.scene.plainSky = true;
  w.cam.aspect = W / H;
  const prints = Array.from({ length: TUBES - 1 }, (_, k) => testPrint(k, { ...TUBE_PLACE, turn: TUBE_PLACE.turn * (k - 2) }, 256, k === 3 ? 128 : 256));
  const ids: number[] = [];
  for (let k = 0; k < TUBES; k++) ids.push(100 + w.place(TUBE, 32 + (k - (TUBES - 1) / 2) * 0.62, 22.7, { colors: [8, 7, 14, 6], yaw: 0 }));
  // A host whose pictures are made at once, from the bytes the twin and the card both take.
  w.scene.prints.host = { image: (path, side) => { const k = parseInt(/print\.([0-9a-f]{16})/.exec(path)![1]!, 16) & 0xffff; const source = printBytes(side, k); return Promise.resolve({ source, mean: [...printMean(source)] }); } };
  w.scene.prints.worn = { meshes: [w.mesh(TUBE)], of: (id) => prints[id - 100] ?? null };
  if (swatches) w.scene.assets.tier = { ...w.scene.assets.tier, prints: { ...w.scene.assets.tier.prints, swatches: true } };
  const raster = new Rasterizer(W, H, w.pack, w.hf, w.manifest);
  const s = new Shot(key, W, H, w.hf, set.files[0]!.bytes);
  s.manifest = set.manifest;
  return Object.assign(s, { world: w, raster, ids });
}

/** The timed crowd, printed or not: everything else alike, the prints all on the card by its last frame. */
async function timed(key: string, printed: boolean): Promise<Shot> {
  const set = sceneSet(64);
  const w = sceneWorld({}, tierOf("medium"), set);
  w.scene.viewHeight = TH;
  w.scene.plainSky = true;
  w.cam.aspect = TW / TH;
  const prints = Array.from({ length: CROWD }, (_, k) => testPrint(k, { ...TUBE_PLACE, turn: 0.1 * (k % 5) }));
  for (let k = 0; k < CROWD; k++) w.place(TUBE, 32 + ((k % 10) - 4.5) * 0.62, 22.6 + Math.floor(k / 10) * 0.9, { colors: [8, 7, 14, 6], yaw: 0 });
  w.scene.prints.host = { image: (path, side) => { const k = parseInt(/print\.([0-9a-f]{16})/.exec(path)![1]!, 16) & 0xffff; const source = printBytes(side, k); return Promise.resolve({ source, mean: [...printMean(source)] }); } };
  if (printed) w.scene.prints.worn = { meshes: [w.mesh(TUBE)], of: (id) => prints[id - 100] ?? null };
  const s = new Shot(key, TW, TH, w.hf, set.files[0]!.bytes);
  s.manifest = set.manifest;
  s.repeats = REPEATS;
  for (let f = 0; f < 50; f++) {
    const p = w.frame(100, false);
    // The flagged crowd is drawn by the printed program with no print in any instance: what the program costs by itself.
    if (f === 49 && key.startsWith("flagged")) for (let i = 0; i < p.transientCount; i++) p.transient[i * INSTANCE_BYTES + 14 + PRINT_REGION] = 0;
    s.add(p, f === 49);
    await new Promise((done) => setTimeout(done, 0));
  }
  return s;
}

export const printsCheck: LitCheck = {
  name: "prints on garments",

  async shots(): Promise<Shot[]> {
    const out: Shot[] = [];
    for (const [key, swatches] of [["prints", false], ["swatches", true]] as const) {
      const s = shot(key, swatches) as Shot & { world: ReturnType<typeof sceneWorld>; raster: Rasterizer };
      // The swatches are of prints the card already holds: their frames first draw them whole.
      const tier = s.world.scene.assets.tier;
      if (swatches) s.world.scene.assets.tier = { ...tier, prints: { ...tier.prints, swatches: false } };
      for (let f = 0; f < FRAMES; f++) {
        if (swatches && f === FRAMES - 10) s.world.scene.assets.tier = tier;
        const p = s.world.frame(100, false);
        s.raster.render(p);
        s.add(p, f === FRAMES - 1);
        if (f === FRAMES - 1) {
          const printed = new Set<number>();
          for (let d = 0; d < p.drawCount; d++) {
            if ((p.drawFlags[d]! & DRAW_PRINTED) === 0) continue;
            for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) if (p.transient[i * INSTANCE_BYTES + 14 + PRINT_REGION]! > 0) printed.add(p.transientIds[i]!);
          }
          made.set(key, { frame: f, color: s.raster.color.slice(), pickKind: s.raster.pickKind.slice(), pickId: s.raster.pickId.slice(), pickDraw: s.raster.pickDraw.slice(), printed });
        }
        // The page's pictures come between frames.
        await new Promise((done) => setTimeout(done, 0));
      }
      out.push(s);
    }
    for (const key of TIMED) out.push(await timed(key, !key.startsWith("plain")));
    return out;
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    mkdirSync(OUT, { recursive: true });
    for (const [key, m] of made) {
      const gpu = back.pixels(key, m.frame);
      if (!gpu) return { ok: false, lines: [`${key}: NO PICTURE`] };
      const name = key;
      writeFileSync(join(OUT, `probe-${name}-gpu.png`), encodePng(W, H, gpu));
      writeFileSync(join(OUT, `probe-${name}-twin.png`), encodePng(W, H, m.color));
      const { color, pickKind, pickId, pickDraw } = m;
      const one = (i: number): boolean => {
        if (pickKind[i] !== PICK_ENTITY) return false;
        for (let dy = -NEAR; dy <= NEAR; dy++) {
          for (let dx = -NEAR; dx <= NEAR; dx++) {
            const j = i + dy * W + dx;
            if (pickId[j] !== pickId[i] || pickDraw[j] !== pickDraw[i]) return false;
            for (let c = 0; c < 3; c++) if (Math.abs(color[j * 4 + c]! - color[(j + 1) * 4 + c]!) > SMOOTH || Math.abs(color[j * 4 + c]! - color[(j + W) * 4 + c]!) > SMOOTH) return false;
          }
        }
        return true;
      };
      const pixel: number[] = [], mean: number[] = [];
      let printed = 0;
      for (let y = NEAR + 2; y < H - NEAR - 2; y++) {
        for (let x = NEAR + 2; x < W - NEAR - 2; x++) {
          const i = y * W + x;
          if (!one(i)) continue;
          if (m.printed.has(pickId[i]!)) printed++;
          let most = 0, mostMean = 0;
          for (let c = 0; c < 3; c++) {
            most = Math.max(most, Math.abs(gpu[i * 4 + c]! - color[i * 4 + c]!));
            let sum = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += gpu[(i + dy * W + dx) * 4 + c]! - color[(i + dy * W + dx) * 4 + c]!;
            mostMean = Math.max(mostMean, Math.abs(sum / 25));
          }
          pixel.push(most);
          mean.push(mostMean);
        }
      }
      const [p, mm] = [spread(pixel), spread(mean)];
      const good = p.points >= LEAST.all && printed >= LEAST.printed && p.p95 <= TOLERANCE.pixelP95 && mm.worst <= TOLERANCE.meanWorst;
      ok &&= good;
      lines.push(`${key}: ${TUBES} tubes, ${m.printed.size} printed, against the rasterizer: ${p.points} points, ${printed} on a printed body; pixels 95 in 100 within ${p.p95}, worst ${p.worst}; 5 by 5 means worst ${mm.worst.toFixed(2)}  ${good ? "ok" : "FAIL"}`);
    }
    // The crowd's frame drawn again and again, plain, printed and flagged by turns: what the prints add to it. Wall time on
    // a shared card wanders by half a millisecond, so it is told, not judged: the people bench is the gate.
    const ms = TIMED.map((key) => back.time(`${key}/49`));
    if (ms.every((t) => t !== null)) {
      const median = (k: string): number => {
        const list = TIMED.flatMap((key, i) => (key.startsWith(k) ? [ms[i]!] : [])).sort((a, b) => a - b);
        return (list[(list.length - 1) >> 1]! + list[list.length >> 1]!) / 2;
      };
      const [plain, printed, flagged] = [median("plain"), median("printed"), median("flagged")];
      lines.push(`${CROWD} tubes in ${CROWD} prints at ${TW} by ${TH}, ${REPEATS} draws of its frame, medians of ${TIMED.length / 3}: plain ${plain.toFixed(3)} ms, printed ${printed.toFixed(3)} ms (${(printed - plain >= 0 ? "+" : "") + (printed - plain).toFixed(3)}), the printed program with no print ${flagged.toFixed(3)} ms (${(flagged - plain >= 0 ? "+" : "") + (flagged - plain).toFixed(3)}); told, not judged`);
    } else {
      ok = false;
      lines.push("the timed crowd: NO TIME");
    }
    lines.push(`pictures in ${OUT}`);
    return { ok, lines };
  },
};
