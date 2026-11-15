// A material study of the pteranodon as the game's own renderer draws it: each set on a form like the part it covers,
// near (a rider's view, half a metre off), at a metre and a half, and small, in the design's dyes and in loud, dark and
// pale ones. The renderer reads the rgba variant, which holds a 2,048 study at 1,024: the animal's own density, since
// a study is painted at twice it. Nothing is built and nothing is written outside --out.
//
//   bun tex/studies/look.ts <study folder> [--out DIR] [--sets a,b]
//
// Each set is named in the study's study.json under "sets", with "span_m" (metres one picture spans), "form" and its
// numbers (tex/studies/COMMON.md, "Forms"). Writes <out>/<set>.png, by default <study>/checks/look/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePack } from "../../../../../../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette, nearestColour } from "../../../../../../../shared/pack/palette.ts";
import { describe, type Material } from "../../../../../../../tools/art/materials.ts";
import type { MaterialSpec } from "../../../../../../../tools/art/spec.ts";
import { buildPack, type SourceLod } from "../../../../../../../tools/pack/write.ts";
import { ModelView } from "../../../../../../../tools/snap.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../../../../../../../tools/snap/font.ts";
import { rgbaOf } from "../../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../../tools/snap/png.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const study = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : null;
if (!study) throw new Error("bun tex/studies/look.ts <study folder> [--out DIR] [--sets a,b]");
const out = resolve(arg("out") ?? join(study, "checks", "look"));
mkdirSync(out, { recursive: true });

interface Form {
  /** tube: a round or flattened tube, tapering; ball: an egg; sheet: a cambered sheet, its upper or under face toward the eye; none: not drawn here (a panel or a sheet of elements). */
  form: "tube" | "ball" | "sheet" | "none";
  span_m: number;
  /** Whether it takes the animal's dyes. Undyed sets (the saddle's, the eye) are drawn once. */
  dyed?: boolean;
  /** tube: radius, flattening (height over width, 1 round), taper (the far end's radius over the near one's), length. */
  radius?: number;
  flat?: number;
  taper?: number;
  length?: number;
  /** ball: half its length, width and height. */
  radii?: [number, number, number];
  /** sheet: width and depth, camber in metres, and the face shown. */
  width?: number;
  depth?: number;
  camber?: number;
  face?: "upper" | "under";
  /** Turns the picture a quarter so that its rows run along the form instead of round it. */
  turn?: boolean;
}

const info = JSON.parse(readFileSync(join(study, "study.json"), "utf8")) as { sets: Record<string, Form> };
const only = arg("sets")?.split(",");
const palette = defaultPalette();
const hex = (h: string): number => nearestColour(palette, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));

// The design's colours (rig.py REGION_DISPLAY, ref/DESIGN.md), then three that a breeder may pick: loud, dark and pale.
const DYES: Record<string, readonly number[]> = {
  design: ["2E3134", "9C8B78", "C8662E", "2A2C2F", "56677A", "E9E4D8"].map(hex),
  loud: ["2030C0", "FFE020", "9FE01F", "FF3EA5", "FF3EA5", "9FE01F"].map(hex),
  dark: ["E6E3DC", "4A3A2E", "2D3138", "E6E3DC", "24282A", "3C3A38"].map(hex),
  pale: ["8E8B85", "D8CDB4", "E0C07E", "6E2E2A", "C9CED3", "F4F1EA"].map(hex),
};
const UNDYED = [0, 0, 0, 0, 0, 0];
const BACKGROUND = [0.84, 0.83, 0.81] as const;
// A bright sky behind a wing seen from below, as players see it most.
const SKY = [0.74, 0.82, 0.92] as const;

/** A form as one level with texture coordinates in metres over the span, so one picture covers `span_m`. */
function formLod(f: Form): SourceLod {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const span = f.span_m;
  const uv = (along: number, across: number): void => void (f.turn ? uvs.push(across / span, along / span) : uvs.push(along / span, across / span));
  const grid = (n: number, m: number, at: (i: number, j: number) => [number[], number[], number, number]): void => {
    for (let j = 0; j <= m; j++) {
      for (let i = 0; i <= n; i++) {
        const [p, nrm, a, b] = at(i, j);
        positions.push(...p);
        normals.push(...nrm);
        uv(a, b);
      }
    }
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
  };
  const unit = (v: number[]): number[] => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return v.map((c) => c / l);
  };
  if (f.form === "tube") {
    // Along z from -length/2 to +length/2, the near end the wider; flattened in y.
    const r0 = f.radius ?? 0.05;
    const flat = f.flat ?? 1;
    const taper = f.taper ?? 1;
    const length = f.length ?? 2;
    const n = 160;
    const m = 96;
    // Arc length round the cross-section, measured, so the picture is not stretched where the tube is flattened.
    const arc: number[] = [0];
    for (let i = 1; i <= n; i++) {
      const a0 = ((i - 1) / n) * Math.PI * 2;
      const a1 = (i / n) * Math.PI * 2;
      arc.push(arc[i - 1]! + Math.hypot(Math.sin(a1) - Math.sin(a0), flat * (Math.cos(a1) - Math.cos(a0))));
    }
    grid(n, m, (i, j) => {
      const t = j / m;
      const r = r0 * (1 + (taper - 1) * t);
      const a = (i / n) * Math.PI * 2;
      const z = -length / 2 + length * t;
      const p = [Math.sin(a) * r, Math.cos(a) * r * flat, z];
      const nrm = unit([Math.sin(a) * flat, Math.cos(a), -(taper - 1) * r0 * flat / length]);
      return [p, nrm, z, arc[i]! * r];
    });
    // Wound so the outside faces out.
    for (let k = 0; k < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2]!, indices[k + 1]!];
  } else if (f.form === "ball") {
    const [rx, ry, rz] = f.radii ?? [0.2, 0.18, 0.3];
    const n = 160;
    const m = 120;
    // Rings along z; texture along the meridian and round each ring by arc length at the waist, pinched only at the ends.
    let meridian = 0;
    let last: number[] | null = null;
    const along: number[] = [];
    for (let j = 0; j <= m; j++) {
      const t = -Math.cos((j / m) * Math.PI);
      const p = [0, ry * Math.sqrt(1 - t * t), rz * t];
      if (last) meridian += Math.hypot(p[1]! - last[1]!, p[2]! - last[2]!);
      along.push(meridian);
      last = p;
    }
    grid(n, m, (i, j) => {
      const t = -Math.cos((j / m) * Math.PI);
      const s = Math.sqrt(Math.max(0, 1 - t * t));
      const a = (i / n) * Math.PI * 2;
      const p = [Math.sin(a) * rx * s, Math.cos(a) * ry * s, rz * t];
      const nrm = unit([p[0]! / (rx * rx), p[1]! / (ry * ry), p[2]! / (rz * rz)]);
      return [p, nrm, along[j]!, (a / (Math.PI * 2)) * Math.PI * (rx + ry)];
    });
    for (let k = 0; k < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2]!, indices[k + 1]!];
  } else {
    // In x and z, bulging up by `camber` at its middle; the under face looks down.
    const w = f.width ?? 1.6;
    const d = f.depth ?? 0.9;
    const c = f.camber ?? 0.06;
    const under = f.face === "under";
    const n = 96;
    const m = 64;
    grid(n, m, (i, j) => {
      const x = -w / 2 + (w * i) / n;
      const z = -d / 2 + (d * j) / m;
      const y = c * (1 - (2 * z / d) ** 2) * (1 - 0.3 * (2 * x / w) ** 2);
      const dy = [(-0.6 * c * (1 - (2 * z / d) ** 2) * 2 * x) / (w * w) * 2, (-8 * c * z) / (d * d) * (1 - 0.3 * (2 * x / w) ** 2)];
      const nrm = unit([-dy[0]!, 1, -dy[1]!]);
      return [[x, y, z], under ? nrm.map((v) => -v) : nrm, under ? -x : x, z];
    });
    if (under) for (let k = 0; k < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2]!, indices[k + 1]!];
  }
  const count = positions.length / 3;
  return {
    positions: Float32Array.from(positions), colors: new Uint8Array(count).fill(REGION_BASE + 5), indices: Uint32Array.from(indices),
    uvs: Float32Array.from(uvs), normals: Float32Array.from(normals), sections: new Uint8Array(indices.length / 3),
  };
}

// Where each form is looked at from, by its distance on the game's 1,080-row screen with its 70 degree field of view:
// [label, metres off, degrees around, degrees above, background]. The picture holds what that screen shows of it.
type Shot = [label: string, distance: number, around: number, above: number, background: readonly number[]];
function shots(f: Form): Shot[] {
  if (f.form === "sheet") {
    const under = f.face === "under";
    const above = under ? -55 : 55;
    const bg = under ? SKY : BACKGROUND;
    return [["0.5 m", 0.5, 25, above, bg], ["0.5 m, other light", 0.5, 160, above + (under ? 25 : -25), bg], ["1.5 m", 1.5, 30, above, bg], ["5 m", 5, 30, above, bg]];
  }
  if (f.form === "ball") return [["0.5 m", 0.5, 60, 25, BACKGROUND], ["0.5 m, other light", 0.5, 200, 5, BACKGROUND], ["1.5 m", 1.5, 50, 20, BACKGROUND], ["5 m", 5, 50, 20, BACKGROUND]];
  return [["0.5 m", 0.5, 70, 25, BACKGROUND], ["0.5 m, other light", 0.5, 250, -15, BACKGROUND], ["1.5 m", 1.5, 60, 20, BACKGROUND], ["5 m", 5, 60, 20, BACKGROUND]];
}

const CELL = 420;
const SCREEN_ROWS = 1080;
const FOV = (70 * Math.PI) / 180;
const PAD = 10;
const LABEL = 18;

/** Writes `text` into an RGBA picture `w` wide at x, y, scale 2. */
function text(img: Uint8Array, w: number, x: number, y: number, s: string, shade = 40): void {
  for (let k = 0; k < s.length; k++) {
    for (let col = 0; col < GLYPH_WIDTH; col++) {
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        if (!glyphPixel(s.charCodeAt(k), col, row)) continue;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const at = ((y + row * 2 + dy) * w + x + (k * (GLYPH_WIDTH + 1) + col) * 2 + dx) * 4;
          if (at >= 0 && at + 3 < img.length) img.set([shade, shade, shade, 255], at);
        }
      }
    }
  }
}

for (const [name, f] of Object.entries(info.sets)) {
  if ((only && !only.includes(name)) || f.form === "none") continue;
  const file = (layer: string): string | undefined => (existsSync(join(study, `${name}_${layer}.png`)) ? `${name}_${layer}.png` : undefined);
  if (!file("base")) {
    console.log(`${name}: no ${name}_base.png yet`);
    continue;
  }
  const spec: MaterialSpec = { base: file("base"), normal: file("normal"), packed: file("packed"), regions: file("regions"), tiles: f.span_m };
  const material: Material = { name, id: `look:${name}`, spec, dir: study };
  const described = describe(material, 2048, palette);
  for (const fault of described.faults) console.log(`${name}: ${fault}`);
  const lod = formLod(f);
  const pack = parsePack(buildPack([{ id: "look:form", lods: [lod], flat: 1, materials: [{ ...described.material, span: f.span_m }], textures: described.textures }], palette));
  const textures = (pack.header.textures ?? []).map((t) => rgbaOf(material, t.role, t.top, null));
  const rows = f.dyed === false || !spec.regions ? [["as painted", UNDYED]] as const : Object.entries(DYES);
  const columns = shots(f);
  const w = PAD + columns.length * (CELL + PAD);
  const h = PAD + LABEL + rows.length * (CELL + PAD + LABEL);
  const sheet = new Uint8Array(w * h * 4).fill(232);
  text(sheet, w, PAD, PAD, `${name}: one picture to ${f.span_m} m, ${f.form}`);
  rows.forEach(([dyes, colors], r) => {
    const y0 = PAD + LABEL + r * (CELL + PAD + LABEL);
    columns.forEach(([label, distance, around, above, bg], c) => {
      const x0 = PAD + c * (CELL + PAD);
      text(sheet, w, x0, y0, `${dyes}, ${label}`);
      const view = new ModelView(pack, CELL, CELL, bg as [number, number, number]);
      textures.forEach((t, slot) => view.texture(slot, t.role, t.pictures));
      const radius = CELL / 2 / (SCREEN_ROWS / (2 * Math.tan(FOV / 2) * distance));
      view.draw({ mesh: 0, level: 0, around, above, centre: [0, 0, 0], radius, rig: null, colors, textured: true });
      const src = view.raster.color;
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) sheet.set(src.subarray((y * CELL + x) * 4, (y * CELL + x) * 4 + 3), ((y0 + LABEL + y) * w + x0 + x) * 4);
    });
  });
  const path = join(out, `${name}.png`);
  writeFileSync(path, encodePng(w, h, sheet));
  console.log(path);
}
