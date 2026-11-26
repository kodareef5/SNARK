// Pictures of each armour piece worn alone on its body in the poses where skin comes through it most: the body's skin
// drawn where it is drawn with the piece (other slots, less the zones the piece's covers hide), the piece over it in its
// flat colours. Each piece gets the whole body and a close view round its worst point. The poses come from a cloth-fit
// run (`bun tools/art/cloth-fit.ts --json FILE`), so a pack before and after a change can be drawn in the same poses.
//
//   bun tools/art/armor-snap.ts --fits FILE [--pack FILE] [--set cloth,hide,meridian] [--out FILE] [--label TEXT]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { HUMAN_BONES, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { SKIN_ZONE_SLOT } from "../../shared/anim/skin-zones.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette, REGION_BASE } from "../../shared/pack/palette.ts";
import { encodePng } from "../pack/image.ts";
import { unpackMeshes, type SourceMesh } from "../pack/write.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";
import { humanAnim, motionSet, type PieceFit } from "./cloth-fit.ts";
import { draw, pose, type Frame } from "./garment-snap.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const BODIES = join(ROOT, "assets/source/core/humans/human-bodies/human-bodies.snpk");
const SKIN: readonly [number, number, number] = [0.85, 0.45, 0.32];
/** The piece's colour regions: main, second, trim. */
/** Skin a piece carries of its own, drawn apart from the body's. */
const ARMOR_SKIN: readonly [number, number, number] = [0.85, 0.75, 0.35];
const DYE: readonly (readonly [number, number, number])[] = [[0.16, 0.3, 0.42], [0.42, 0.36, 0.2], [0.55, 0.55, 0.5]];
const W = 220, H = 330;

const linear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));

function text(sheet: Uint8Array, width: number, x0: number, y0: number, s: string): void {
  for (let i = 0; i < s.length; i++) for (let r = 0; r < GLYPH_HEIGHT; r++) for (let c = 0; c < GLYPH_WIDTH; c++) {
    if (!glyphPixel(s.toUpperCase().charCodeAt(i), c, r)) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = x0 + i * (GLYPH_WIDTH + 1) * 2 + c * 2 + dx, y = y0 + r * 2 + dy;
      if (x >= width) continue;
      for (let a = 0; a < 3; a++) sheet[(y * width + x) * 3 + a] = 20;
    }
  }
}

export interface ArmorSnapOptions {
  fits: readonly PieceFit[];
  pack?: Uint8Array;
  sets?: readonly string[];
  out: string;
  label?: string;
  /** Every piece in this pose, looking at this point of the body at rest, in place of its worst. */
  pose?: string;
  at?: readonly number[];
}

/** One sheet a set: a row a sex, for each piece the whole body and a close view, in that piece's worst pose. */
export function snapArmor(o: ArmorSnapOptions): string[] {
  const pack = parsePack(o.pack ?? new Uint8Array(readFileSync(BODIES)));
  const meshes = unpackMeshes(pack);
  const reg = compileContent(CORE_CONTENT).registry!;
  const palette = defaultPalette();
  const anim = humanAnim();
  const bones = new Float32Array(HUMAN_BONES * BONE_FLOATS);
  const sets = o.sets ?? ["cloth", "hide", "meridian"];
  const written: string[] = [];
  for (const set of sets) {
    const cols = SLOT_NAMES.length * 2, rows = 2, width = W * cols, top = 24;
    const sheet = new Uint8Array(width * (H * rows + top) * 3).fill(255);
    text(sheet, width, 8, 6, `${set} ${o.label ?? ""}`);
    ["m", "f"].forEach((sex, row) => {
      const id = `core:human_${sex}`;
      const rig = pack.header.rigs.find((r) => r.id === `human_${sex}`)!;
      const rest = Float32Array.from(rig.rest);
      const motion = motionSet(anim, rest);
      const body = SLOT_NAMES.map((name) => meshes.find((m) => m.id === `${id}/${name}`)).filter((m): m is SourceMesh => !!m);
      SLOT_NAMES.forEach((slot, s) => {
        const piece = meshes.find((m) => m.id === `${id}/armor/${set}/${slot}`);
        if (!piece) return;
        const fit = o.fits.find((f) => f.piece === piece.id);
        const worst = o.pose ? { depth: 0, pose: o.pose, zone: "", at: o.at ?? [0, 1, 0] } : fit && fit.through.depth > 0 ? fit.through : null;
        const named = motion.find((m) => m.name === worst?.pose) ?? motion[0]!;
        writeBones(bones, 0, named.solved, rest, null, 0, 0, 0, 0);
        const item = reg.defs.findIndex((d) => d?.type === "item" && d.wear?.set === set && d.wear.slot === slot);
        const hidden = item < 0 ? 0 : reg.wearZones[item]!;
        const open = s === SLOT_HEAD && set !== "meridian";
        // The posed place of the worst point and the way its skin faces: the body's vertex nearest it at rest.
        let near = [0, 1.0, 0], facing = [0, 0, 1], best = Infinity;
        const posedBody = body.map((mesh) => {
          const lod = mesh.lods[0]!;
          const posed = pose(lod, bones);
          if (worst) for (let v = 0; v < lod.positions.length / 3; v++) {
            const d = (lod.positions[v * 3]! - worst.at[0]!) ** 2 + (lod.positions[v * 3 + 1]! - worst.at[1]!) ** 2 + (lod.positions[v * 3 + 2]! - worst.at[2]!) ** 2;
            if (d < best) [best, near, facing] = [d, [...posed.p.subarray(v * 3, v * 3 + 3)], [...posed.n.subarray(v * 3, v * 3 + 3)]];
          }
          return { mesh, lod, ...posed };
        });
        const lod = piece.lods[0]!;
        const pp = pose(lod, bones);
        for (const k of [0, 1]) {
          const f: Frame = { width: W, height: H, rgb: new Float32Array(W * H * 3).fill(0.93), depth: new Float32Array(W * H).fill(-Infinity) };
          // The close view turns the body about the worst point so its skin faces the camera.
          const yaw = k === 1 ? Math.atan2(facing[0]!, facing[2]!) : 0, c = Math.cos(yaw), sn = Math.sin(yaw);
          const turn = (q: Float64Array, about: readonly number[]): Float64Array => {
            if (k === 0) return q;
            const out = new Float64Array(q.length);
            for (let v = 0; v < q.length; v += 3) {
              const x = q[v]! - about[0]!, z = q[v + 2]! - about[2]!;
              [out[v], out[v + 1], out[v + 2]] = [about[0]! + x * c - z * sn, q[v + 1]!, about[2]! + x * sn + z * c];
            }
            return out;
          };
          const zero = [0, 0, 0];
          const centre = k === 0 ? [0, 0.9] : [near[0]!, near[1]!], scale = H / (k === 0 ? 2.1 : 0.32);
          for (const { mesh, lod: bl, p, n } of posedBody) {
            const slotOf = SLOT_NAMES.indexOf(mesh.id.split("/").at(-1)!);
            const keep = (t: number): boolean => {
              const z = bl.zones?.[t] ?? 0;
              if ((hidden >>> z) & 1) return false;
              return SKIN_ZONE_SLOT[z] !== s || (open && slotOf === SLOT_HEAD);
            };
            draw(f, turn(p, near), turn(n, zero), bl.indices, keep, false, centre, scale, (t, _b, col) => {
              const isSkin = /skin/.test(mesh.materials?.[bl.sections?.[t] ?? 0]?.id ?? "skin");
              [col[0], col[1], col[2]] = isSkin ? SKIN : [0.12, 0.1, 0.09];
            });
          }
          draw(f, turn(pp.p, near), turn(pp.n, zero), lod.indices, () => true, false, centre, scale, (t, _b, col) => {
            const i = lod.colors[lod.indices[t * 3]!]!;
            if (i >= REGION_BASE) {
              const r = i - REGION_BASE;
              const d = r === 0 ? ARMOR_SKIN : DYE[r === 5 ? 2 : r === 4 ? 1 : 0]!;
              [col[0], col[1], col[2]] = d;
            } else for (let a = 0; a < 3; a++) col[a] = linear(palette[i * 4 + a]! / 255);
          });
          const col = s * 2 + k;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let a = 0; a < 3; a++) {
            const l = f.rgb[(y * W + x) * 3 + a]!;
            sheet[((top + row * H + y) * width + col * W + x) * 3 + a] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.min(1, l), 1 / 2.4) - 0.055));
          }
          const label = k === 0 ? `${sex} ${slot}` : worst ? `${(worst.depth * 1000).toFixed(1)}mm ${worst.pose}` : "none";
          text(sheet, width, col * W + 4, top + row * H + 4, label.slice(0, 17));
        }
      });
    });
    const file = o.out.replace(/\.png$/, "") + `-${set}.png`;
    writeFileSync(file, encodePng({ width, height: H * rows + top, channels: 3, depth: 8, data: sheet }));
    written.push(file);
  }
  return written;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const files = snapArmor({
    fits: JSON.parse(readFileSync(arg("fits")!, "utf8")) as PieceFit[],
    pack: arg("pack") ? new Uint8Array(readFileSync(arg("pack")!)) : undefined,
    sets: arg("set")?.split(","),
    out: arg("out") ?? join(ROOT, "var/armor-fit/sheet.png"),
    label: arg("label"),
    pose: arg("pose"),
    at: arg("at")?.split(",").map(Number),
  });
  for (const f of files) console.log(f);
}
