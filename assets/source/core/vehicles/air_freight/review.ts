// Renders the air freight machines' review sheets from their built packs, with the game's software renderer.
//   bun assets/source/core/vehicles/air_freight/review.ts            every sheet
//   bun assets/source/core/vehicles/air_freight/review.ts trailer    one of trailer, carrier, drone, lift
// Each sheet is written to ref/review/<name>.png in this folder, beside one picture a shot.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AIR_CARRIER_ART as C, AIR_TRAILER_ART as T, SURVEY_DRONE_ART as D } from "../../../../../content/vehicles/air-freight-art.ts";
import { buildRig, type Rig } from "../../../../../shared/anim/rigs.ts";
import { solve } from "../../../../../shared/anim/skeleton.ts";
import { quatAxis, quatMul } from "../../../../../shared/math/quat.ts";
import { parsePack, type Pack } from "../../../../../shared/pack/pack.ts";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { materialsOf } from "../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../tools/snap/files.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../../../../../tools/snap/font.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";
import { PICK_SKY } from "../../../../../tools/snap/raster.ts";

type V3 = readonly [number, number, number];
const W = 640, H = 400;
const SKY: V3 = [0.74, 0.77, 0.8];
const GROUND: V3 = [0.36, 0.35, 0.33];
const assets = await findAssets();

interface Machine { id: string; pack: Pack; mesh: number; rig: Rig; view: ModelView }
const machines = new Map<string, Machine>();
function machine(id: string): Machine {
  const known = machines.get(id);
  if (known) return known;
  const asset = assets.find((a) => a.id === id)!;
  const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
  const mesh = pack.meshIndex.get(id)!;
  const rig = buildRig(pack.header.rigs[pack.header.meshes[mesh]!.rig!]!, pack.clips)!;
  const materials = materialsOf(asset);
  const view = new ModelView(pack, W * 2, H * 2, SKY);
  (pack.header.textures ?? []).forEach((t, slot) => {
    const tex = rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null);
    view.texture(slot, tex.role, tex.pictures);
  });
  const m = { id, pack, mesh, rig, view };
  machines.set(id, m);
  return m;
}

/** How each machine is posed: angles in radians, `gone` the bays whose drones have left, `legs` 0 down to 1 cranked up. */
interface Pose { roof?: number; side?: number; legs?: number; gone?: number[]; clamps?: number; rotor?: number; gimbal?: [number, number] }

function pose(m: Machine, p: Pose): void {
  const { rig } = m;
  rig.a.rest();
  const bone = (name: string): number => rig.names.indexOf(name);
  const turn = (name: string, x: number, y: number, z: number, angle: number): void => {
    if (bone(name) >= 0) quatAxis(rig.a.rot, bone(name) * 4, x, y, z, angle);
  };
  turn("roof", 0, 0, 1, (p.roof ?? 0) * T.roof.open);
  turn("side", 0, 0, 1, (p.side ?? 0) * T.side.open);
  for (const name of ["clamp_front_left", "clamp_rear_left"]) turn(name, 0, 0, 1, (p.clamps ?? 0) * C.clampOpen);
  for (const name of ["clamp_front_right", "clamp_rear_right"]) turn(name, 0, 0, 1, -(p.clamps ?? 0) * C.clampOpen);
  turn("rotor_front", 0, 1, 0, p.rotor ?? 0);
  turn("rotor_rear", 0, 1, 0, -(p.rotor ?? 0));
  for (const [k, imp] of D.impellers.entries()) turn(imp.bone, 0, 1, 0, (p.rotor ?? 0) * imp.turn + k);
  if (p.gimbal) {
    const g = bone("gimbal");
    if (g >= 0) {
      const a = new Float32Array(4), b = new Float32Array(4);
      quatAxis(a, 0, 0, 1, 0, p.gimbal[0]);
      quatAxis(b, 0, 1, 0, 0, p.gimbal[1]);
      quatMul(rig.a.rot, g * 4, a, 0, b, 0);
    }
  }
  solve(rig, rig.a, rig.solved);
  // A launched drone's bay is scaled to nothing in the game; here it is moved far out of the picture.
  for (const n of p.gone ?? []) if (bone(`bay_${n}`) >= 0) rig.solved.pos[bone(`bay_${n}`) * 3 + 1] = -1e4;
  if (bone("legs") >= 0) rig.solved.pos[bone("legs") * 3 + 1]! += (p.legs ?? 0) * T.legs.lift;
}

/** A camera at `eye` looking at `at`, as ModelView's orbit takes it. */
function look(eye: V3, at: V3, fov: number) {
  const d = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]] as const;
  const dist = Math.hypot(...d);
  return { around: (Math.atan2(d[0], d[2]) * 180) / Math.PI, above: (Math.asin(d[1] / dist) * 180) / Math.PI, centre: at, radius: dist * 0.9, perspective: { distance: dist, fovY: fov } };
}
type Camera = ReturnType<typeof look> | { around: number; above: number; centre: V3; radius: number; perspective?: undefined };

interface Layer { id: string; pose: Pose; at?: V3 }

/** Draws each layer from one camera and keeps the nearest surface at each pixel; the ground and sky fill the rest. */
function picture(cam: Camera, layers: Layer[], ground = 0): Uint8Array {
  const color = new Uint8Array(W * 2 * H * 2 * 4);
  const depth = new Float32Array(W * 2 * H * 2).fill(Infinity);
  let last: ModelView | null = null;
  for (const layer of layers) {
    const m = machine(layer.id);
    pose(m, layer.pose);
    const at = layer.at ?? [0, 0, 0];
    const centre: V3 = [cam.centre[0] - at[0], cam.centre[1] - at[1], cam.centre[2] - at[2]];
    m.view.draw({ ...cam, centre, mesh: m.mesh, level: 0, rig: m.rig, colors: [], textured: true, floor: cam.perspective ? ground - at[1] : undefined });
    const r = m.view.raster;
    for (let i = 0; i < depth.length; i++) {
      if (r.pickKind[i] === PICK_SKY || r.depth[i]! >= depth[i]!) continue;
      depth[i] = r.depth[i]!;
      color.set(r.color.subarray(i * 4, i * 4 + 4), i * 4);
    }
    last = m.view;
  }
  // Sky above the horizon, a ground with a faint grid below it.
  const ray = [0, 0, 0];
  const cam0 = last!.cam;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] !== Infinity) continue;
    cam0.ray(((i % (W * 2)) + 0.5) / (W * 2), (Math.floor(i / (W * 2)) + 0.5) / (H * 2), ray);
    let c: V3 = SKY;
    const height = cam0.y - (ground - (layers[layers.length - 1]!.at?.[1] ?? 0));
    if (ray[1]! < 0 && height > 0) {
      const t = height / -ray[1]!;
      const gx = cam0.x + ray[0]! * t, gz = cam0.z + ray[2]! * t;
      const line = Math.min(Math.abs(gx - Math.round(gx)), Math.abs(gz - Math.round(gz))) < 0.012 * Math.max(1, t / 6);
      const fade = Math.min(1, t / 60);
      c = [0, 1, 2].map((k) => GROUND[k]! * (line ? 0.86 : 1) * (1 - fade) + SKY[k]! * fade) as unknown as V3;
    } else if (ray[1]! < 0) c = GROUND;
    color.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4);
  }
  // Two by two pixels make one.
  const out = new Uint8Array(W * H * 4);
  const stride = W * 2 * 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let ch = 0; ch < 4; ch++) {
    const p = 2 * y * stride + 8 * x + ch;
    out[(y * W + x) * 4 + ch] = Math.round((color[p]! + color[p + 4]! + color[p + stride]! + color[p + stride + 4]!) / 4);
  }
  return out;
}

function label(img: Uint8Array, width: number, x0: number, y0: number, text: string): void {
  const s = 2;
  const w = text.length * (GLYPH_WIDTH + 1) * s + 8;
  for (let y = y0; y < y0 + GLYPH_HEIGHT * s + 8; y++) for (let x = x0; x < x0 + w; x++) img.set([16, 18, 20, 255], (y * width + x) * 4);
  [...text].forEach((ch, k) => {
    for (let row = 0; row < GLYPH_HEIGHT; row++) for (let col = 0; col < GLYPH_WIDTH; col++) {
      if (!glyphPixel(ch.toUpperCase().charCodeAt(0), col, row)) continue;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) img.set([235, 235, 230, 255], ((y0 + 4 + row * s + dy) * width + x0 + 4 + (k * (GLYPH_WIDTH + 1) + col) * s + dx) * 4);
    }
  });
}

interface Shot { name: string; cam: Camera; layers: Layer[]; ground?: number }
const orbit = (around: number, above: number, centre: V3, radius: number): Camera => ({ around, above, centre, radius });

const deck = T.deck;
const lifted = { legs: 1 };
const sheets: Record<string, Shot[]> = {
  trailer: [
    { name: "front three quarter, parked", cam: orbit(38, 14, [0, 1.5, 0], 4.0), layers: [{ id: T.id, pose: {} }] },
    { name: "rear three quarter", cam: orbit(218, 14, [0, 1.5, 0], 4.0), layers: [{ id: T.id, pose: lifted }] },
    { name: "side, left", cam: orbit(90, 4, [0, 1.7, 0], 3.6), layers: [{ id: T.id, pose: {} }] },
    { name: "side, right", cam: orbit(-90, 4, [0, 1.7, 0], 3.6), layers: [{ id: T.id, pose: {} }] },
    { name: "open, one bay empty, roadside", cam: look([5.6, 1.7, -1.5], [0, 2.1, 0.2], 1.05), layers: [{ id: T.id, pose: { roof: 1, side: 1, gone: [3] } }] },
    { name: "open from above", cam: orbit(64, 38, [0.4, 2.2, 0], 4.4), layers: [{ id: T.id, pose: { roof: 1, side: 1, gone: [3] } }] },
    { name: "open, into the bays", cam: look([2.9, 3.3, -1.2], [-0.2, 2.2, -0.9], 0.85), layers: [{ id: T.id, pose: { roof: 1, side: 1, gone: [3] } }] },
    { name: "cab mirror, driver eye, closed", cam: look([1.9, 2.4, 7.4], [0.6, 1.8, -1.5], 0.9), layers: [{ id: T.id, pose: lifted }] },
    { name: "cab mirror, driver eye, open", cam: look([1.9, 2.4, 7.4], [0.6, 1.8, -1.5], 0.9), layers: [{ id: T.id, pose: { ...lifted, roof: 1, side: 1, gone: [3] } }] },
    { name: "roadside, kingpin and legs", cam: look([-3.2, 1.7, 5.6], [-0.2, 0.9, 2.6], 1.0), layers: [{ id: T.id, pose: {} }] },
    { name: "roadside, axles and lights", cam: look([-3.4, 1.7, -6.6], [-0.2, 1.1, -3.2], 1.0), layers: [{ id: T.id, pose: {} }] },
    { name: "jaw seat, front left", cam: look([2.6, 3.4, 4.9], [1.17, deck + 1.6, 3.5], 0.7), layers: [{ id: T.id, pose: {} }] },
    { name: "kingpin and coupler, low", cam: look([-1.6, 0.55, 6.2], [0, 1.15, 3.6], 0.8), layers: [{ id: T.id, pose: lifted }] },
  ],
  carrier: [
    { name: "front three quarter", cam: orbit(38, 16, [0, 1.6, 0], 5.8), layers: [{ id: C.id, pose: { rotor: 0.3 } }] },
    { name: "rear three quarter", cam: orbit(218, 16, [0, 1.6, 0], 5.8), layers: [{ id: C.id, pose: { rotor: 0.3 } }] },
    { name: "side", cam: orbit(90, 3, [0, 1.6, 0], 5.2), layers: [{ id: C.id, pose: { rotor: 0.3 } }] },
    { name: "jaws open", cam: orbit(20, 8, [0, 1.2, 0], 5.0), layers: [{ id: C.id, pose: { clamps: 1, rotor: 0.3 } }] },
    { name: "rotor head, front", cam: look([2.6, 4.4, 6.4], [0, 2.7, 3.84], 0.75), layers: [{ id: C.id, pose: { rotor: 0.3 } }] },
    { name: "clamp, front left", cam: look([3.4, 1.2, 5.6], [1.3, 0.8, 3.52], 0.75), layers: [{ id: C.id, pose: {} }] },
  ],
  lift: [
    { name: "carrying, jaws closed", cam: orbit(40, 12, [0, -0.6, 0], 6.2), layers: [{ id: C.id, pose: { rotor: 0.3 } }, { id: T.id, pose: lifted, at: C.load }] },
    { name: "carrying, from below", cam: orbit(130, -10, [0, -0.6, 0], 6.2), layers: [{ id: C.id, pose: { rotor: 0.3 } }, { id: T.id, pose: lifted, at: C.load }] },
    { name: "jaws open, released", cam: orbit(40, 12, [0, -0.6, 0], 6.2), layers: [{ id: C.id, pose: { rotor: 0.3, clamps: 1 } }, { id: T.id, pose: lifted, at: C.load }] },
    { name: "jaw on casting, close", cam: look([3.0, 0.9, 5.4], [1.2, 0.2, 3.52], 0.6), layers: [{ id: C.id, pose: {} }, { id: T.id, pose: lifted, at: C.load }] },
    { name: "front clamps, jaws closed", cam: look([0.4, 0.2, 8.6], [0, 0.35, 3.5], 0.62), layers: [{ id: C.id, pose: {} }, { id: T.id, pose: lifted, at: C.load }] },
    { name: "front clamps, jaws open", cam: look([0.4, 0.2, 8.6], [0, 0.35, 3.5], 0.62), layers: [{ id: C.id, pose: { clamps: 1 } }, { id: T.id, pose: lifted, at: C.load }] },
  ],
  drone: [
    { name: "front three quarter", cam: orbit(36, 18, [0, 0.15, 0.02], 0.55), layers: [{ id: D.id, pose: { rotor: 0.2 } }] },
    { name: "rear three quarter", cam: orbit(216, 20, [0, 0.15, 0], 0.55), layers: [{ id: D.id, pose: { rotor: 0.2 } }] },
    { name: "side", cam: orbit(90, 2, [0, 0.15, 0], 0.5), layers: [{ id: D.id, pose: { rotor: 0.2 } }] },
    { name: "top", cam: orbit(10, 70, [0, 0.15, 0], 0.55), layers: [{ id: D.id, pose: { rotor: 0.2 } }] },
    { name: "nose camera, close", cam: look([0.3, 0.14, 1.05], [0, 0.11, 0.48], 0.5), layers: [{ id: D.id, pose: { gimbal: [0.25, 0.15] } }] },
    { name: "below, payload", cam: orbit(150, -28, [0, 0.1, 0], 0.55), layers: [{ id: D.id, pose: {} }] },
  ],
};

const folder = join(import.meta.dir, "ref", "review");
mkdirSync(folder, { recursive: true });
const only = process.argv.slice(2);
for (const [sheet, shots] of Object.entries(sheets)) {
  if (only.length > 0 && !only.includes(sheet)) continue;
  const cols = 2, rows = Math.ceil(shots.length / cols);
  const page = new Uint8Array(cols * W * rows * H * 4);
  shots.forEach((shot, k) => {
    const img = picture(shot.cam, shot.layers, shot.ground ?? (sheet === "lift" ? C.load[1] : 0));
    label(img, W, 6, 6, shot.name);
    writeFileSync(join(folder, `${sheet}-${k + 1}.png`), encodePng(W, H, img));
    const ox = (k % cols) * W, oy = Math.floor(k / cols) * H;
    for (let y = 0; y < H; y++) page.set(img.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * cols * W + ox) * 4);
  });
  writeFileSync(join(folder, `${sheet}.png`), encodePng(cols * W, rows * H, page));
  console.log(join(folder, `${sheet}.png`));
}
