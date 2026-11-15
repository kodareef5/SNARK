// The stations as the game draws them: the software rasterizer drawing what a client on a graphics tier draws, on the
// proving ground's grass, and their inventory pictures as a build draws them. Each shot is written under ref/game/ as
// <shot>_<tier>.png (the ones kept are JPEG copies):
//
//   placed   the five stations out, in a row, as a survivor who set each one down stands to see them
//   lit      the forge, the fabricator and the preserving bin out and lit, side by side
//   near     the mortar, the bin and the forge lit, close, from where a survivor opens them
//   far      the row from 25 m
//   icons    each station's picture as tools/pack/icons.ts draws it (128 px, and as a slot shows it, 64 px)
//
//   bun assets/source/core/structures/stations/snap.ts [shot ...] [--tier high] [--source DIR] [--name SUFFIX]
//
// A station is set down as a survivor sets one down, facing away from them (yaw 0, the camera on the -Z side), so its
// front faces the camera. A station whose structure content does not have yet is drawn in a borrowed structure kind
// pointed at its mesh; one whose mesh is not in the pack (`--source` the main checkout, for the grey boxes) is left out,
// or drawn as its grey box where content has one.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../../../../client/core/assets/tiers.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { SOURCE } from "../../../../../tools/art/source.ts";
import { IconPainter, assetFraming } from "../../../../../tools/pack/icons.ts";
import { provingView, settle, type ProvingView } from "../../../../../tools/snap.ts";
import { corePack, gameFiles, namedTextures, rgbaOf } from "../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../tools/snap/png.ts";

const [W, H] = [1600, 900];
/** A patch of grass beyond the plaza (the dodo's, the eggs' and the weapons' snaps stand there too). */
const [CX, CZ] = [160, 360];
const SHOTS = ["placed", "lit", "near", "far", "icons"] as const;
type Shot = (typeof SHOTS)[number];

const args = process.argv.slice(2);
const value = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const valued = new Set(["--tier", "--source", "--name"].flatMap((f) => (args.includes(f) ? [args.indexOf(f) + 1] : [])));
const asked = args.filter((a, i) => !a.startsWith("--") && !valued.has(i));
const shots = asked.length > 0 ? (asked as Shot[]) : [...SHOTS];
const tier = value("tier") ?? "high";
const source = resolve(value("source") ?? SOURCE);
const suffix = value("name") ? `_${value("name")}` : "";
const OUT = join(import.meta.dir, "ref", "game");
mkdirSync(OUT, { recursive: true });

/** Each station: its mesh, its box's half height (model.py's BOXES), the palette colour its structure would have. */
const STATIONS = {
  mortar: { mesh: "core:mortar", half: 0.25, color: 4 },
  smithy: { mesh: "core:smithy", half: 0.55, color: 3 },
  forge: { mesh: "core:forge", half: 0.85, color: 5 },
  forge_lit: { mesh: "core:forge_lit", half: 0.85, color: 8 },
  fabricator: { mesh: "core:fabricator", half: 0.65, color: 11 },
  fabricator_lit: { mesh: "core:fabricator_lit", half: 0.65, color: 8 },
  bin: { mesh: "core:preserving_bin", half: 0.6, color: 3 },
  bin_lit: { mesh: "core:preserving_bin_lit", half: 0.6, color: 8 },
} as const;
type Name = keyof typeof STATIONS;
/** Structure kinds of the core content, each drawn as one of the stations' meshes. */
const BORROWED = ["core:storage_box", "core:storage_large", "core:vault", "core:campfire", "core:campfire_lit", "core:sleeping_bag", "core:bed", "core:bunk_bed"];

function aim(view: ProvingView, x: number, up: number, z: number, tx: number, at: number, tz: number, fov: number): void {
  const cam = view.cam;
  cam.x = CX + x;
  cam.z = CZ + z;
  cam.y = view.hf.heightAt(cam.x, cam.z) + up;
  const ty = view.hf.heightAt(CX + tx, CZ + tz) + at;
  const [dx, dy, dz] = [CX + tx - cam.x, ty - cam.y, CZ + tz - cam.z];
  cam.yaw = Math.atan2(dx, dz);
  cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  cam.fovY = fov;
}

/** Sets the stations down along x at the given offsets, facing away from a camera at -Z. */
function row(view: ProvingView, set: readonly [Name, number, number][]): void {
  const { reg, structs, hf, scene } = view;
  const table = scene.assets.table;
  let borrowed = 0;
  for (const [name, x, z] of set) {
    const s = STATIONS[name];
    let kind = reg.index.get(s.mesh);
    if (kind === undefined) {
      if (table.find(s.mesh) < 0) continue;
      kind = reg.index.get(BORROWED[borrowed++]!)!;
      scene.meshOfKind[kind] = table.find(s.mesh);
      scene.colorOfKind[kind] = s.color;
    }
    const [px, pz] = [CX + x, CZ + z];
    structs.add(kind, px, hf.heightAt(px, pz) + s.half, pz, 0, 0, 1);
  }
}

if (shots.some((s) => s !== "icons")) {
  const files = await gameFiles(source);
  for (const shot of shots) {
    if (shot === "icons") continue;
    const t0 = performance.now();
    const view = provingView(W, H, {}, files);
    view.scene.assets.tier = tierOf(tier);
    view.scene.viewHeight = H;
    view.remote.count = 0;
    if (shot === "placed" || shot === "far") {
      row(view, [["mortar", 3.1, 0], ["bin", 2.0, 0], ["smithy", 0.5, 0], ["forge", -1.4, 0], ["fabricator", -3.3, 0]]);
      if (shot === "placed") aim(view, 0.4, 1.62, -6.0, 0.0, 0.5, 0, 0.75);
      else aim(view, 0.4, 1.62, -25, 0.0, 0.6, 0, 0.3);
    } else if (shot === "lit") {
      row(view, [["bin", 4.0, 0], ["bin_lit", 3.0, 0], ["forge", 1.4, 0], ["forge_lit", 0.0, 0], ["fabricator", -1.9, 0], ["fabricator_lit", -3.9, 0]]);
      aim(view, 0.0, 1.62, -7.0, 0.0, 0.6, 0, 0.8);
    } else {
      row(view, [["mortar", 1.2, 0], ["bin_lit", 0.2, 0.2], ["forge_lit", -1.2, 0.4]]);
      aim(view, 0.0, 1.62, -2.8, 0.0, 0.35, 0.2, 0.85);
    }
    settle(view);
    const out = join(OUT, `${shot}_${tier}${suffix}.png`);
    writeFileSync(out, encodePng(W, H, view.raster.color));
    console.log(`${out}  ${(performance.now() - t0).toFixed(0)} ms`);
  }
}

if (shots.includes("icons")) {
  // Each mesh's picture as a build draws it, from its own pack (so the stations content does not have yet are drawn
  // too), on a checker, at 128 px and halved as a bag slot shows it.
  const pack = parsePack(corePack());
  const named = await namedTextures();
  const painter = new IconPainter(pack, (slot) => {
    const t = pack.header.textures?.[slot];
    const n = t && named.get(t.id);
    return n ? rgbaOf(n.material, n.role, n.top) : null;
  });
  const names = (Object.keys(STATIONS) as Name[]).filter((n) => pack.meshIndex.has(STATIONS[n].mesh));
  const framing = await assetFraming();
  const size = painter.size;
  const [cw, ch] = [size + size / 2 + 24, size + 16];
  const page = new Uint8Array(cw * names.length * ch * 4);
  const pw = cw * names.length;
  for (let y = 0; y < ch; y++) for (let x = 0; x < pw; x++) page.set(((x >> 3) + (y >> 3)) % 2 ? [92, 96, 104, 255] : [72, 76, 84, 255], (y * pw + x) * 4);
  names.forEach((n, k) => {
    const s = STATIONS[n];
    const picture = painter.draw(pack.meshIndex.get(s.mesh)!, [s.color, 0, 0, 0, 0, 0], framing.get(s.mesh) ?? null);
    const put = (x0: number, y0: number, scale: number): void => {
      const side = size / scale;
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          let [r, g, b, a] = [0, 0, 0, 0];
          for (let q = 0; q < scale * scale; q++) {
            const o = ((y * scale + Math.floor(q / scale)) * size + x * scale + (q % scale)) * 4;
            const w = picture[o + 3]! / 255;
            [r, g, b, a] = [r + picture[o]! * w, g + picture[o + 1]! * w, b + picture[o + 2]! * w, a + w];
          }
          if (a === 0) continue;
          const at = ((y0 + y) * pw + x0 + x) * 4;
          const cover = a / (scale * scale);
          for (let c = 0; c < 3; c++) page[at + c] = Math.round(page[at + c]! * (1 - cover) + ([r, g, b][c]! / a) * cover);
        }
      }
    };
    put(k * cw + 8, 8, 1);
    put(k * cw + size + 16, 8, 2);
  });
  const out = join(OUT, `icons${suffix}.png`);
  writeFileSync(out, encodePng(pw, ch, page));
  console.log(out);
}
