// bun tools/snap/shadow-hunt.ts <miami.snmap> <built assets directory> <output directory> [--hours=9,12,17,17.7,22]
//   [--only=site,...] [--views=above,low] [--tier=high]
//
// A hunt for one thing with two shadows that disagree (planning/architecture/rendering.md, "What can shade a point").
// At each site, a piece of a kind of structure found on the map, it draws views at each hour asked for, and each view's
// frame in the states below, made from the same built frame by changing the frame block alone, so that each shade term
// is seen alone and with the rest:
//
// - all: as built.
// - cascades: the far map off (fFarScale made negative, which the sky's openness reads only the size of).
// - far: the far map alone (every cascade's sphere made a point, so every pixel lies past them).
// - coarse: the farthest cascade alone wherever its sphere holds a pixel, as the dithered hand-over between cascades
//   and the far parts of the view see it.
// - roofless: the map of what stands overhead off (roof.ts), and with it the light from the ground it tints.
// - unshaded: no shadow from the light that owns the cascades at all.
// - lampless (by night where a lamp lights): the street lamp's light off.
//
// It writes all the states on one sheet, `<site>/<view>-<hhmm>.png`, and "all" at full size, `<site>/<view>-<hhmm>-all.png`
// (with --full every state's),
// and prints for each view how many pixels a baked term darkens where the cascades leave the sun on (`far lit`, `roof
// lit`), how many the farthest cascade alone shows otherwise (`coarse`), and the casters the frame casts at a level
// coarser than the view draws the same mesh, which is where a shadow of big triangles beside a fine body comes from.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { type MapStatic, MapStatics, mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { tierOf, type TierName } from "../../client/core/assets/tiers.ts";
import { CAST_AT, FRAME, LAMP_AT, MAX_CASCADES, ROOF_AT, type FramePacket } from "../../client/core/render/packet.ts";
import { findChrome } from "../chrome.ts";
import { litProbe, type LitCheck } from "../probe-lit.ts";
import { Shot } from "../probe-lit/shot.ts";
import { provingView } from "../snap.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./font.ts";
import { encodePng } from "./png.ts";

const [mapPath, assets, out] = process.argv.slice(2);
if (!mapPath || !assets || !out) throw new Error("Expected Miami map, built assets directory and output directory");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const hours = (arg("hours") ?? "9,12,17,17.7,22").split(",").map(Number);
if (hours.some((h) => !Number.isFinite(h) || h < 0 || h >= 24)) throw new Error("--hours must be hours in [0,24)");
const only = arg("only")?.split(",");
const viewsOnly = arg("views")?.split(",");
const tier = (arg("tier") ?? "high") as TierName;
/** Every state's picture at full size, not "all"'s alone beside the sheet. */
const full = process.argv.includes("--full");
const map = parseMap(Bun.mmap(mapPath), true, true);
const hf = mapHeightfield(map);
const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
const files = manifest.files.map((f) => (f.format && f.format !== "rgba" ? new Uint8Array() : Bun.mmap(join(assets, f.name))));
const t = map.statics;

/** A site: the piece of a kind nearest a point (or the first on the map), and how far its views stand off, times a house's. */
interface Site { readonly name: string; readonly kind: string; readonly near?: readonly [number, number]; readonly scale?: number; readonly lift?: number }
/** The rose arcade of the shade study, and a block west of downtown round it. */
const DOWNTOWN = [7633.2, 7463.5] as const;
const SITES: readonly Site[] = [
  { name: "arcade", kind: "core:zruin_zroof8_rose", near: DOWNTOWN },
  { name: "house", kind: "core:zruin_zpitch8_clay", near: DOWNTOWN },
  { name: "tower", kind: "core:zruin_zcrown6_limestone", near: DOWNTOWN, scale: 3, lift: 0 },
  { name: "bridge", kind: "core:zzruin_floorroad3_concrete", near: DOWNTOWN, scale: 1.5 },
  { name: "pier", kind: "core:zruin_pier16_concrete", near: DOWNTOWN, scale: 1.5 },
  { name: "deck", kind: "core:zruin_zdeck_limestone", near: DOWNTOWN },
  { name: "lamp", kind: "core:zzstreet_lamp_lit", near: [6700.5, 11397.3], scale: 0.6 },
  { name: "shelter", kind: "core:zzstreet_shelter", near: DOWNTOWN, scale: 0.5 },
  { name: "billboard", kind: "core:zzstreet_billboard", near: DOWNTOWN, scale: 0.7 },
  { name: "fence", kind: "core:zzstreet_fence", near: DOWNTOWN, scale: 0.5 },
  { name: "signal", kind: "core:zzstreet_signal", near: DOWNTOWN, scale: 0.5 },
  { name: "curb", kind: "core:zzzcurb_r6", near: DOWNTOWN, scale: 0.4 },
  { name: "rubble", kind: "core:zruin_rubble_concrete", near: DOWNTOWN, scale: 0.5 },
  { name: "mound", kind: "core:zruin_mound_concrete", near: DOWNTOWN, scale: 0.6 },
  { name: "wreck", kind: "core:compact_wreck", near: DOWNTOWN, scale: 0.4 },
  { name: "hulk", kind: "core:hulk_riptide_damaged", scale: 1 },
  { name: "eye", kind: "core:zztide_eye_spar", scale: 4, lift: 0 },
  { name: "cruise", kind: "cruise:door_cabin_closed_1c0bcd020d", scale: 4 },
  { name: "yacht", kind: "koru:mast_main_0", scale: 2 },
];

/** Where each site's piece stands, and its ground: the eye's collision stands far over its deck, which is where it is seen from. */
const found = new Map<string, { x: number; z: number; ground: number }>();
for (const s of SITES.filter((s) => !only || only.includes(s.name))) {
  let best = -1, far = Infinity;
  for (let i = 0; i < t.kind.length; i++) {
    if (t.kinds[t.kind[i]!] !== s.kind) continue;
    const d = s.near ? Math.hypot(t.x[i]! - s.near[0], t.z[i]! - s.near[1]) : 0;
    if (d < far) {
      best = i;
      far = d;
    }
    if (!s.near) break;
  }
  if (best < 0) {
    console.log(`${s.name}: no ${s.kind} on this map`);
    continue;
  }
  const eye = s.name === "eye" ? map.tideEyes.reduce((a, e) => (Math.hypot(e.x - t.x[best]!, e.z - t.z[best]!) < Math.hypot(a.x - t.x[best]!, a.z - t.z[best]!) ? e : a), map.tideEyes[0]!) : null;
  const x = eye ? eye.x : t.x[best]!, z = eye ? eye.z : t.z[best]!;
  found.set(s.name, { x, z, ground: hf.heightAt(x, z) });
  console.log(`${s.name}: ${s.kind} at ${x.toFixed(1)}, ${z.toFixed(1)}, ground ${hf.heightAt(x, z).toFixed(1)}`);
}

/** The views, in the world's axes from the site's ground, times its scale: from over the south, and low from the south west. */
interface View { readonly name: string; readonly eye: readonly [number, number, number]; readonly at: readonly [number, number, number] }
const VIEWS: readonly View[] = [
  { name: "above", eye: [0, 26, -30], at: [0, 1, 4] },
  { name: "low", eye: [-14, 1.7, -16], at: [0, 2, 0] },
];

const width = 1280, height = 720;
const rows: MapStatic[] = [];
for (let i = 0; i < t.kind.length; i++) {
  for (const f of found.values()) {
    if (Math.hypot(t.x[i]! - f.x, t.z[i]! - f.z) >= 320) continue;
    rows.push({ kind: t.kinds[t.kind[i]!]!, x: t.x[i]!, y: t.y[i]!, z: t.z[i]!, yaw: t.yaw[i]! });
    break;
  }
}
const v = provingView(width, height, {}, { manifest, files }, { ...map, statics: MapStatics.of(map.dims, rows) }, undefined, 0, true);
const { cam, scene, remote } = v;
scene.assets.tier = tierOf(tier);
scene.viewHeight = height;
cam.fovY = (57 * Math.PI) / 180;
remote.count = 0;

/** Each state: its name, and what it does to a copy of the built frame block, with the frame's cascades. */
interface State { readonly name: string; edit(f: Float32Array, cascades: number): void; readonly lamp?: boolean }
const STATES: readonly State[] = [
  { name: "all", edit: () => {} },
  { name: "cascades", edit: (f) => void (f[FRAME.farScale] = -Math.abs(f[FRAME.farScale]!)) },
  { name: "far", edit: (f) => { for (let i = 0; i < MAX_CASCADES; i++) f[FRAME.spheres + i * 4 + 3] = 1e-6; } },
  { name: "coarse", edit: (f, n) => { for (let i = 0; i < n - 1; i++) f[FRAME.spheres + i * 4 + 3] = 1e-6; } },
  { name: "roofless", edit: (f) => void (f[ROOF_AT + 3] = 0) },
  { name: "unshaded", edit: (f) => void (f[CAST_AT + 3] = 0) },
  { name: "lampless", edit: (f) => void (f[LAMP_AT + 3] = 0), lamp: true },
];

const hhmm = (h: number): string => String(Math.floor(h)).padStart(2, "0") + String(Math.round((h % 1) * 60)).padStart(2, "0");
const ready = (): boolean => !!scene.farShadow?.whole;

/** Puts the camera at a view of a site. */
function look(s: Site, view: View): void {
  const f = found.get(s.name)!, k = s.scale ?? 1, lift = s.lift ?? 1;
  cam.x = f.x + view.eye[0] * k;
  cam.z = f.z + view.eye[2] * k;
  cam.y = f.ground + Math.max(view.eye[1] * (view.eye[1] > 3 ? k : lift), 1.7);
  const ax = f.x + view.at[0] * k, az = f.z + view.at[2] * k, ay = f.ground + view.at[1] * k;
  cam.yaw = Math.atan2(ax - cam.x, az - cam.z);
  cam.pitch = Math.atan2(ay - cam.y, Math.hypot(ax - cam.x, az - cam.z));
  v.nodes.retain(Math.floor(cam.z / 64) * map.dims.chunksX + Math.floor(cam.x / 64), 64, 3, () => false);
}

/**
 * The casters of a frame cast at a level two or more coarser than the finest the view draws of the same mesh, by mesh:
 * how many casters, its levels drawn and cast, and their triangles.
 */
function coarseCasters(p: FramePacket): string[] {
  const drawn = new Map<number, number>();
  for (let d = 0; d < p.drawCount; d++) drawn.set(p.drawMesh[d]!, Math.min(drawn.get(p.drawMesh[d]!) ?? 99, p.drawLod[d]!));
  const by = new Map<number, { n: number; cast: Set<number> }>();
  for (let e = 0; e < p.casterCount; e++) {
    const mesh = p.casterMesh[e]!, view = drawn.get(mesh);
    if (view === undefined || p.casterLod[e]! < view + 2) continue;
    const row = by.get(mesh) ?? { n: 0, cast: new Set<number>() };
    row.n++;
    row.cast.add(p.casterLod[e]!);
    by.set(mesh, row);
  }
  return [...by].map(([mesh, row]) => {
    const m = manifest.meshes[mesh]!, tris = (l: number): number => m.levels[l]?.tris ?? 0;
    return `${m.id} drawn ${drawn.get(mesh)} (${tris(drawn.get(mesh)!)} tris) cast ${[...row.cast].join(",")} (${[...row.cast].map(tris).join(",")} tris) in ${row.n}`;
  });
}

/** A picture a quarter its size, a label over its corner, into `sheet` at (x0, y0). */
function place(sheet: Uint8Array, sw: number, picture: Uint8Array, x0: number, y0: number, label: string): void {
  const w = width / 2, h = height / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const at = (yy: number, xx: number): number => picture[((2 * y + yy) * width + 2 * x + xx) * 4 + c]!;
        sheet[((y0 + y) * sw + x0 + x) * 4 + c] = c === 3 ? 255 : (at(0, 0) + at(0, 1) + at(1, 0) + at(1, 1)) >> 2;
      }
    }
  }
  for (let i = 0; i < label.length; i++) {
    for (let row = -1; row <= GLYPH_HEIGHT; row++) {
      for (let col = -1; col <= GLYPH_WIDTH; col++) {
        const on = row >= 0 && col >= 0 && row < GLYPH_HEIGHT && col < GLYPH_WIDTH && glyphPixel(label.toUpperCase().charCodeAt(i), col, row);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) sheet.set(on ? [255, 255, 255, 255] : [0, 0, 0, 255], ((y0 + 6 + (row + 1) * 2 + dy) * sw + x0 + 6 + (i * (GLYPH_WIDTH + 1) + col + 1) * 2 + dx) * 4);
      }
    }
  }
}

const luma = (p: Uint8Array, i: number): number => 0.2126 * p[i * 4]! + 0.7152 * p[i * 4 + 1]! + 0.0722 * p[i * 4 + 2]!;

/** A check a site: its views at each hour in each state, judged by the pictures. */
function siteCheck(s: Site): LitCheck {
  const shot = new Shot(`hunt-${s.name}`, width, height, hf, files[0]!);
  shot.manifest = manifest;
  shot.shadows = true;
  const taken: { name: string; states: string[]; casters: string[]; cascades: number }[] = [];
  return {
    name: `Shadow hunt: ${s.name}`,
    shots() {
      scene.resetUploads();
      for (const view of VIEWS.filter((w) => !viewsOnly || viewsOnly.includes(w.name))) {
        for (const hour of hours) {
          scene.hour = hour;
          look(s, view);
          let still = 0, why = "";
          for (let frame = 0; frame < 3000 && still < 30; frame++) {
            scene.now += 1000 / 60;
            v.port!.advance(scene.now);
            const p = scene.build(cam, remote);
            const loading = p.uploads.length + p.drops.length + p.assetUploads.length + p.assetDrops.length + p.texUploads.length + p.texDrops.length;
            const load = scene.assets.residency;
            why = `${loading} uploads, ${load.flying} flying, ${load.waiting} waiting, ready ${ready()}, reflection ${p.frame[FRAME.reflection + 3]}`;
            // The street's reflection is not waited for: from over the street it may never be made, and it holds no shade.
            still = !loading && !load.flying && !load.waiting && ready() ? still + 1 : 0;
            if (still >= 30) break;
            p.drawCount = p.tileCount = p.casterCount = 0;
            shot.add(p);
          }
          // A view that will not settle is drawn as it stands, and said so.
          if (still < 30) {
            console.log(`${s.name} ${view.name}-${hhmm(hour)} did not settle: ${why}`);
            scene.now += 1000 / 60;
            scene.build(cam, remote);
          }
          const p = scene.packet, built = Float32Array.from(p.frame), lamp = built[LAMP_AT + 3]! > 0;
          const states = STATES.filter((st) => !st.lamp || lamp);
          for (const st of states) {
            p.frame.set(built);
            st.edit(p.frame, p.cascadeCount);
            shot.add(p, true);
          }
          p.frame.set(built);
          taken.push({ name: `${view.name}-${hhmm(hour)}`, states: states.map((st) => st.name), casters: coarseCasters(p), cascades: p.cascadeCount });
          if (process.argv.includes("--dry")) console.log(`${s.name} ${view.name}-${hhmm(hour)}: ${p.drawCount} draws, ${p.casterCount} casters, lamp ${lamp}, ${taken.at(-1)!.casters.length} meshes cast coarse${taken.at(-1)!.casters.map((c) => "\n  " + c).join("")}`);
        }
      }
      return [shot];
    },
    judge(back) {
      const lines: string[] = [];
      mkdirSync(join(out, s.name), { recursive: true });
      let k = 0;
      for (const view of taken) {
        const got = new Map<string, Uint8Array>();
        for (const st of view.states) {
          const picture = back.pixels(shot.key, shot.read[k++]!)!;
          got.set(st, picture);
          if (st === "all" || full) writeFileSync(join(out, s.name, `${view.name}-${st}.png`), encodePng(width, height, picture));
        }
        const sw = (width / 2) * 3, sh = (height / 2) * Math.ceil(view.states.length / 3);
        const sheet = new Uint8Array(sw * sh * 4);
        view.states.forEach((st, i) => place(sheet, sw, got.get(st)!, (i % 3) * (width / 2), Math.floor(i / 3) * (height / 2), st));
        writeFileSync(join(out, s.name, `${view.name}.png`), encodePng(sw, sh, sheet));
        const all = got.get("all")!, cascades = got.get("cascades")!, unshaded = got.get("unshaded")!, roofless = got.get("roofless")!, coarse = got.get("coarse")!;
        let farLit = 0, roofLit = 0, roofAll = 0, farAll = 0, coarseOff = 0, shaded = 0;
        for (let i = 0; i < width * height; i++) {
          const c = luma(unshaded, i) - luma(cascades, i), f = luma(cascades, i) - luma(all, i), r = luma(roofless, i) - luma(all, i);
          if (c > 6) shaded++;
          if (f > 8) farAll++;
          if (r > 8) roofAll++;
          if (f > 8 && c < 3) farLit++;
          if (r > 8 && c < 3) roofLit++;
          if (Math.abs(luma(coarse, i) - luma(all, i)) > 16) coarseOff++;
        }
        const share = (n: number): string => `${((100 * n) / (width * height)).toFixed(2)}%`;
        lines.push(`${s.name} ${view.name}: cascades ${view.cascades}, cascade shade ${share(shaded)}, far ${share(farAll)} (far lit ${share(farLit)}), roof ${share(roofAll)} (roof lit ${share(roofLit)}), coarse differs ${share(coarseOff)}`);
        for (const c of view.casters) lines.push(`  coarse caster: ${c}`);
      }
      return { ok: k > 0, lines };
    },
  };
}

const checks = SITES.filter((s) => found.has(s.name)).map(siteCheck);
// With --dry the frames are built and the casters listed, and nothing is drawn.
if (process.argv.includes("--dry")) {
  for (const c of checks) {
    const shots = await c.shots();
    console.log(`${c.name}: ${shots.reduce((n, s) => n + s.frames.length, 0)} frames, ${shots.reduce((n, s) => n + s.read.length, 0)} pictures`);
  }
  process.exit(0);
}
const chrome = findChrome();
if (!chrome) throw new Error("Chrome is required for the hunt");
const passed = await litProbe(chrome, checks);
process.exit(passed ? 0 : 1);
