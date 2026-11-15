// Pictures of the stones as the game draws them far off and where near hands them to far, with the software rasterizer
// the tests hold to the game's shader: a meadow of dark grass, a boulder field on a gentle rise or a scree slope on a
// steep one beyond it, and the three stone kinds of content/core.ts in patches across it (limestone, the metal rock,
// rubble), each node chosen, turned and sized by the engine's rule. Not part of the build.
//
//   bun assets/source/core/nodes/rocks/review.ts --view field --dist 400 --tier medium --out artifacts/rocks/field-400.png
//
// --view: field (the boulder field), scree (the slope), foot (one stone on dark grass --dist metres off, --kinds and
// --turn to choose it), lineup (every stone in a row --gap metres apart, and behind it the row turned a third of the way
// round). --dist: metres from the camera to the patches' middle. --tier: lowpoly, medium, high, ultra. --hour of the
// day, 10 by default. --up: the camera's height over the ground, 1.7 by default. --size WxH. --zoom N writes beside the
// picture its middle third, or --crop X,Y,W,H of it, enlarged N times. --grass N: the ground's palette colour.
//
// --only near draws every stone with the near store at its own levels (the near field the whole map, the band past
// it); --only far draws every one with the far store at its last level (the band at 1 to 2 m). --compare draws both and
// says, patch by patch, how their pixels and colours differ, which is what a player sees change as a stone passes the
// band. --band FROM,TO and --chunks N move the tier's.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { TIERS, tierOf } from "../../../../../client/core/assets/tiers.ts";
import { Camera } from "../../../../../client/core/render/camera.ts";
import { FAR_NODE_BUFFERS, NodeChanges, PULL_SLOTS, PULL_VERTICES } from "../../../../../client/core/render/farnodes.ts";
import { NODE_BUFFERS, Scene } from "../../../../../client/core/render/scene.ts";
import { RemoteSample } from "../../../../../client/core/session.ts";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz, type MapDims } from "../../../../../shared/coords.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { Heightfield } from "../../../../../shared/world/heightfield.ts";
import { NodeField, formOf, nodeForms, type NodeSource } from "../../../../../shared/world/nodes.ts";
import { StructureStore } from "../../../../../shared/world/structures.ts";
import { FakeNet } from "../../../../../tests/fixtures/assetnet.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { settle, type ProvingView } from "../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { PICK_FAR, PICK_STRUCTURE, Rasterizer } from "../../../../../tools/snap/raster.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1]! : fallback);
const view = arg("view", "field");
const tierName = arg("tier", "medium");
const [W, H] = arg("size", "1920x1080").split("x").map(Number) as [number, number];
const DIST = Number(arg("dist", "400"));
const UP = Number(arg("up", "1.7"));
const HOUR = Number(arg("hour", "10"));
if (!TIERS.some((t) => t.name === tierName)) throw new Error(`--tier takes ${TIERS.map((t) => t.name).join(", ")}`);
if (!["field", "scree", "foot", "lineup"].includes(view)) throw new Error("--view takes field, scree, foot or lineup");

// A map 2 km square. The camera stands on a flat meadow looking along +z at the patches, whose middle is at PATCH.
const DIMS: MapDims = { chunksX: 32, chunksZ: 32 };
const PATCH = { x: 1024, z: 1100 };
const FOOT = view === "foot";
const LINEUP = view === "lineup";
const CAMERA = { x: PATCH.x, z: PATCH.z - DIST };
/** Where the ground begins to rise, and how steeply: a gentle swell for the field, a scree slope of 24 degrees. */
const KNEE = PATCH.z - 70;
const RISE = view === "scree" ? Math.tan((24 * Math.PI) / 180) : view === "field" ? Math.tan((5 * Math.PI) / 180) : 0;
/** The patches' width and depth, and the gap between them: wider the farther off, so each fills about a fifth of the view. */
const SPAN = Math.max(40, 0.22 * DIST);
const GAP = Math.max(6, 0.03 * DIST);
function height(x: number, z: number): number {
  const d = z - KNEE;
  // A knee 30 m round, so the rise has no crease; a little roll so the slope is not a plane.
  const rise = d <= -15 ? 0 : d >= 15 ? (d - 0) * RISE : (((d + 15) * (d + 15)) / 60) * RISE;
  const roll = FOOT || LINEUP ? 0 : 0.8 * Math.sin(x / 37) * Math.sin(z / 29) + 0.4 * Math.sin(x / 13 + z / 17);
  return 4 + rise + roll * Math.min(1, Math.max(0, (z - CAMERA.z - 20) / 40));
}
const hf = new Heightfield(DIMS, 2, -32, 1 / 256);
hf.seaLevel = 0;
const GRASS = Number(arg("grass", "138"));
for (let j = 0; j < hf.nz; j++) {
  for (let i = 0; i < hf.nx; i++) {
    const [x, z] = [i * hf.cell, j * hf.cell];
    hf.setSample(i, j, height(x, z));
    // Dark grass, with a little sandy scrub on the slope.
    hf.tint[j * hf.nx + i] = view === "scree" && z > KNEE + 20 && Math.sin(x / 53 + z / 71) * Math.sin(z / 37 - x / 61) > 0.55 ? 131 : GRASS;
  }
}

const reg = compileContent([...CORE_CONTENT]).registry!;
const forms = nodeForms(reg);
const KINDS = ["core:rock", "core:metal_rock", "core:rubble"].map((id) => reg.index.get(id)!);

function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** The foot view's stone or the lineup's, by mesh, each at the middle of its sizes, and the turn of the first row. */
const HEROES = arg("kinds", FOOT ? "core:rock_1" : [1, 2, 3, 4, 5, 6].map((k) => `core:rock_${k}`).concat([1, 2, 3].map((k) => `core:metal_rock_${k}`), [1, 2, 3].map((k) => `core:rubble_${k}`)).join(",")).split(",");
const TURN = Number(arg("turn", "30"));
const formFor = (mesh: string): number => {
  for (let f = 1; f < forms.count; f++) if (forms.mesh[f] === mesh && forms.depleted[f] !== 1) return f + Math.floor(forms.steps[forms.kind[f]!]! / 2);
  throw new Error(`no stone grows as ${mesh}`);
};
/**
 * Stones placed by hand: the foot view's one, or the lineup's, a row of every stone 5 m apart and behind it the same row
 * turned a third of the way round. Per chunk, its stones in slot order.
 */
const placed = new Map<number, { form: number; x: number; z: number; yaw: number }[]>();
const put = (form: number, x: number, z: number, turn: number): void => {
  const chunk = chunkAt(DIMS, x, z);
  if (!placed.has(chunk)) placed.set(chunk, []);
  placed.get(chunk)!.push({ form, x, z, yaw: Math.round((turn / 360) * 65536) & 0xffff });
};
if (FOOT || LINEUP) {
  HEROES.forEach((mesh, i) => {
    const across = LINEUP ? (i - (HEROES.length - 1) / 2) * Number(arg("gap", "5")) : 0;
    put(formFor(mesh), PATCH.x + across, PATCH.z, TURN);
    if (LINEUP) put(formFor(mesh), PATCH.x + across, PATCH.z + 12, TURN + 120);
  });
}

/** Three patches across the view, 90 m wide and as deep, a stone to about 30 square metres in each. */
const PER = 64;
const source: NodeSource = {
  perChunk: PER,
  at(chunk, index, out) {
    out.kind = 0;
    if (FOOT || LINEUP) {
      const p = placed.get(chunk)?.[index];
      if (!p) return;
      [out.kind, out.form, out.x, out.z, out.yaw] = [forms.kind[p.form]!, p.form, p.x, p.z, p.yaw];
      out.y = hf.heightAt(out.x, out.z);
      return;
    }
    const h = mix(5, chunk, index);
    const g = mix(h, index, chunk);
    const x = (chunkCx(DIMS, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
    const z = (chunkCz(DIMS, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
    const across = x - PATCH.x;
    if (Math.abs(across) > SPAN * 1.5 + GAP || Math.abs(z - PATCH.z) > SPAN / 2) return;
    const patch = across < -SPAN / 2 ? 0 : across < SPAN / 2 ? 1 : 2;
    // A gap between the patches, and a stone in two of the slots, or every slot of the scree.
    if (Math.abs(Math.abs(across) - SPAN / 2) < GAP / 2 || (view !== "scree" && (g & 1) !== 0)) return;
    out.kind = KINDS[patch]!;
    out.form = formOf(forms, out.kind, mix(g, chunk, 7));
    [out.x, out.y, out.z] = [x, hf.heightAt(x, z), z];
    out.yaw = (g >>> 8) & 0xffff;
  },
};

interface Drawn {
  raster: Rasterizer;
  /** Per pixel, 1 where a stone is drawn. */
  node: Uint8Array;
  line: string;
}

async function draw(only: string): Promise<Drawn> {
  const files = await gameFiles(SOURCE);
  const port = new FakeNet(files.files, {});
  const pack = parsePack(files.files[0]!);
  const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const nodes = new NodeField(DIMS, reg, source);
  const tier = tierOf(tierName);
  const held = only === "near" ? 32 : Number(arg("chunks", String(tier.nodes.chunks)));
  const band = (only === "near" ? [10000, 10001] : only === "far" ? [1, 2] : args.includes("--band") ? arg("band", "").split(",").map(Number) : tier.nodes.band) as [number, number];
  nodes.retain(chunkAt(DIMS, CAMERA.x, CAMERA.z), held, 1, () => false);
  const farNodes = { nodes: source, held: (c: number) => nodes.isLoaded(c), gone: () => undefined, changes: new NodeChanges(DIMS) };
  const scene = new Scene({ dims: DIMS, hf, structs, nodes: nodes.store, farNodes }, reg, pack, { manifest: files.manifest, port });
  scene.assets.tier = { ...tier, nodes: { chunks: held, band } };
  if (scene.nodesFar) scene.nodesFar.makes = Infinity;
  scene.viewHeight = H;
  scene.hour = HOUR;
  const cam = new Camera();
  cam.aspect = W / H;
  cam.x = CAMERA.x;
  cam.z = CAMERA.z;
  cam.y = hf.heightAt(CAMERA.x, CAMERA.z) + UP;
  cam.yaw = 0;
  // Looking at the patches' middle, a little above the ground there.
  const target = FOOT ? hf.heightAt(PATCH.x, PATCH.z) + 0.5 : hf.heightAt(PATCH.x, PATCH.z + (LINEUP ? 6 : 0)) + 1;
  cam.pitch = Math.atan2(target - cam.y, PATCH.z - CAMERA.z) + (FOOT ? -0.12 : 0);
  const raster = new Rasterizer(W, H, pack, hf, files.manifest);
  const remote = new RemoteSample();
  const proving = { reg, hf, structs, nodes, pack, scene, cam, remote, raster, port, render: () => scene.build(cam, remote) } as unknown as ProvingView;
  const frames = settle(proving, 20000);
  const p = scene.packet;
  // A stone's pixel: a near node's, or a far draw's (whose pick names its draw, not its node).
  const node = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const id = raster.pickId[i]!;
    if ((raster.pickKind[i] === PICK_STRUCTURE && id >= NODE_BUFFERS * 65536 && id < 2 * NODE_BUFFERS * 65536) || raster.pickKind[i] === PICK_FAR) node[i] = 1;
  }
  // The far draws and the triangles they send (a row's level padded to its draw's run), and the stones' reach.
  let [farDraws, farTris] = [0, 0];
  for (let d = 0; d < p.drawCount; d++) {
    const buffer = p.drawBuffer[d]!;
    if (buffer < FAR_NODE_BUFFERS || buffer >= FAR_NODE_BUFFERS * 2) continue;
    farDraws++;
    farTris += (p.drawInstances[d]! * (PULL_VERTICES << (p.drawSlot[d]! - PULL_SLOTS))) / 3;
  }
  const reach = KINDS.map((k) => Math.round(scene.nodesFar?.reachOf(k) ?? 0)).join(", ");
  const line = `${tierName}${only ? ` (${only} only)` : ""}: ${frames} frames, draws ${p.drawCount} (far ${farDraws}, sending ${Math.round(farTris)} triangles), triangles ${p.triangles}; far reach of limestone, metal rock and rubble ${reach} m`;
  return { raster, node, line };
}

/** Which patch a column of the picture looks at: 0, 1 or 2 left to right, from where their borders stand on screen. */
function patchOf(x: number): number {
  // The view looks along +z, with +x to its left.
  const fl = 1 / Math.tan(1.2217 / 2);
  const across = (-(x - W / 2) / (fl * (H / 2))) * (PATCH.z - CAMERA.z);
  return across < -SPAN / 2 ? 0 : across < SPAN / 2 ? 1 : 2;
}

interface Patch {
  n: number;
  rgb: number[];
  /** Luminance of each pixel, to find its lit and shaded quarters. */
  light: number[];
}

/** Per patch: the stones' pixels, the sum of their colours and their lightness. */
function patches(d: Drawn): Patch[] {
  const out: Patch[] = [0, 1, 2].map(() => ({ n: 0, rgb: [0, 0, 0], light: [] }));
  for (let i = 0; i < W * H; i++) {
    if (!d.node[i]) continue;
    const s = out[patchOf(i % W)]!;
    s.n++;
    for (let c = 0; c < 3; c++) s.rgb[c]! += d.raster.color[i * 4 + c]!;
    s.light.push(0.2126 * d.raster.color[i * 4]! + 0.7152 * d.raster.color[i * 4 + 1]! + 0.0722 * d.raster.color[i * 4 + 2]!);
  }
  return out;
}

function said(s: Patch): string {
  const light = [...s.light].sort((a, b) => a - b);
  const q = (f: number): string => (light[Math.floor(f * (light.length - 1))] ?? 0).toFixed(0);
  return `${s.n} px, mean ${s.rgb.map((v) => (v / Math.max(1, s.n)).toFixed(0)).join(",")}, lightness quarters ${q(0.25)}/${q(0.5)}/${q(0.75)}`;
}

/** The middle third of a picture enlarged `zoom` times, nearest pixel. */
function enlarged(color: Uint8ClampedArray, zoom: number): { w: number; h: number; px: Uint8ClampedArray } {
  // --crop X,Y,W,H takes another part of it.
  const [x0, y0, cw, ch] = args.includes("--crop") ? arg("crop", "").split(",").map(Number) as [number, number, number, number] : [Math.floor(W / 3), Math.floor(H / 3), Math.floor(W / 3), Math.floor(H / 3)];
  const out = new Uint8ClampedArray(cw * zoom * ch * zoom * 4);
  for (let y = 0; y < ch * zoom; y++) {
    for (let x = 0; x < cw * zoom; x++) {
      const from = ((y0 + Math.floor(y / zoom)) * W + x0 + Math.floor(x / zoom)) * 4;
      out.set(color.subarray(from, from + 4), (y * cw * zoom + x) * 4);
    }
  }
  return { w: cw * zoom, h: ch * zoom, px: out };
}

const out = resolve(arg("out", `artifacts/rocks/${view}-${DIST}-${tierName}.png`));
mkdirSync(dirname(out), { recursive: true });
const zoom = Number(arg("zoom", "0"));
const write = (file: string, d: Drawn): void => {
  writeFileSync(file, encodePng(W, H, d.raster.color));
  if (zoom > 0) {
    const e = enlarged(d.raster.color, zoom);
    writeFileSync(file.replace(/\.png$/, "-zoom.png"), encodePng(e.w, e.h, e.px));
  }
};
if (args.includes("--compare")) {
  const near = await draw("near");
  const far = await draw("far");
  write(out.replace(/\.png$/, "-near.png"), near);
  write(out.replace(/\.png$/, "-far.png"), far);
  console.log(near.line);
  console.log(far.line);
  // Patch by patch: its stones' pixels and colour near and far; and of the pixels either draws a stone in, how many change.
  const [a, b] = [patches(near), patches(far)];
  ["limestone", "metal rock", "rubble"].forEach((name, k) => {
    console.log(`${name}: near ${said(a[k]!)}; far ${said(b[k]!)}; pixels ${((b[k]!.n / Math.max(1, a[k]!.n) - 1) * 100).toFixed(1)}%`);
  });
  let [either, changed] = [0, 0];
  for (let i = 0; i < W * H; i++) {
    if (!near.node[i] && !far.node[i]) continue;
    either++;
    let most = 0;
    for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(near.raster.color[i * 4 + c]! - far.raster.color[i * 4 + c]!));
    if (most > 24) changed++;
  }
  console.log(`of ${either} pixels a stone is drawn in near or far, ${changed} (${((changed / Math.max(1, either)) * 100).toFixed(1)}%) change by more than 24 in a channel`);
} else {
  const d = await draw(arg("only", ""));
  write(out, d);
  console.log(d.line);
  const s = patches(d);
  ["limestone", "metal rock", "rubble"].forEach((name, k) => console.log(`${name}: ${said(s[k]!)}`));
}
