// `bun run icons`: draws the inventory pictures as a build does (tools/pack/icons.ts) and writes them to artifacts/ to
// be looked at: each picture alone, and a contact sheet of them all on a checker, each beside itself at the size a bag
// slot shows it. `bun run icons -- core:pick` draws one item. `--inventory` and `--crafting` also draw the bag with its
// hotbar, and the crafting list, with the pictures in them. Pictures are drawn afresh unless `--cached` is given.
//
//   bun run icons [-- ITEM ...] [--out DIR] [--cached] [--inventory] [--crafting]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IMAGE_ICONS, Icons } from "../client/core/assets/icons.ts";
import { HudModel, fillHotbar } from "../client/core/hud.ts";
import type { ClientSession } from "../client/core/session.ts";
import { TAB_MAKE, type CharacterScreen } from "../client/core/ui/character.ts";
import { Ui } from "../client/core/ui/ui.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { parsePack, type Pack } from "../shared/pack/pack.ts";
import { GEAR_SLOTS, HOTBAR_SLOTS, Inventory } from "../shared/sim/items.ts";
import { ICON_CACHE, assetFraming, drawIcons, iconPng, iconSheets, iconSubjects, type DrawnIcons, type TextureSource } from "./pack/icons.ts";
import { standInSession } from "./snap.ts";
import { corePack, namedTextures, rgbaOf } from "./snap/files.ts";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "./snap/font.ts";
import { encodePng } from "./snap/png.ts";
import { drawUi } from "./snap/ui.ts";
import type { InventoryScreen } from "../client/core/ui/inventory.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(flag("out") ?? "artifacts");
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");

const reg = compileContent(CORE_CONTENT).registry!;
const pack = parsePack(corePack());

/** The pack's textures in the rgba variant, each made from its asset's pictures when first wanted (tools/snap/files.ts). */
async function texturesOf(p: Pack): Promise<TextureSource> {
  const named = await namedTextures();
  return (slot) => {
    const t = p.header.textures?.[slot];
    const n = t && named.get(t.id);
    return n ? rgbaOf(n.material, n.role, n.top) : null;
  };
}

const subjects = iconSubjects(reg.defs, (id) => pack.meshIndex.has(id)).filter((s) => only.length === 0 || only.includes(s.owner) || only.includes(s.mesh));
if (subjects.length === 0) {
  console.log(only.length > 0 ? `no item of ${only.join(", ")} has a mesh to draw its picture from` : "no item has a mesh to draw its picture from");
  process.exit(1);
}
const drawn = drawIcons(pack, subjects, await texturesOf(pack), { cache: args.includes("--cached") ? ICON_CACHE : null, framing: await assetFraming() });
mkdirSync(join(out, "icons"), { recursive: true });
const size = drawn.size;
for (const s of subjects) {
  const file = join(out, "icons", `${s.owner.replace(":", "-")}.png`);
  writeFileSync(file, iconPng(size, size, drawn.pictures[drawn.index.get(s.icon)!]!));
}

/** RGBA pixels with a box of colour, text in a 5 by 7 font and pictures laid over them. */
class Page {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  constructor(width: number, height: number) {
    [this.width, this.height] = [width, height];
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  fill(x: number, y: number, w: number, h: number, rgb: readonly number[]): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++) for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) this.pixels.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], (py * this.width + px) * 4);
  }
  text(s: string, x: number, y: number, rgb: readonly number[], scale = 2): void {
    [...s].forEach((ch, i) => {
      for (let col = 0; col < GLYPH_WIDTH; col++) for (let row = 0; row < GLYPH_HEIGHT; row++) if (glyphPixel(ch.charCodeAt(0), col, row)) this.fill(x + (i * (GLYPH_WIDTH + 1) + col) * scale, y + row * scale, scale, scale, rgb);
    });
  }
  /** A picture of `side` pixels drawn at `to` pixels a side, each the mean of what it covers, over what is there. */
  put(picture: Uint8Array, side: number, x: number, y: number, to: number): void {
    for (let py = 0; py < to; py++) {
      for (let px = 0; px < to; px++) {
        let [r, g, b, a, n] = [0, 0, 0, 0, 0];
        for (let v = Math.floor((py * side) / to); v < Math.max(Math.floor((py * side) / to) + 1, Math.floor(((py + 1) * side) / to)); v++) {
          for (let u = Math.floor((px * side) / to); u < Math.max(Math.floor((px * side) / to) + 1, Math.floor(((px + 1) * side) / to)); u++) {
            const s = (v * side + u) * 4;
            const k = picture[s + 3]! / 255;
            [r, g, b, a, n] = [r + picture[s]! * k, g + picture[s + 1]! * k, b + picture[s + 2]! * k, a + k, n + 1];
          }
        }
        if (a === 0) continue;
        const o = ((y + py) * this.width + x + px) * 4;
        const cover = a / n;
        for (const [c, v] of [r, g, b].entries()) this.pixels[o + c] = this.pixels[o + c]! + (v / a - this.pixels[o + c]!) * cover;
      }
    }
  }
}

/** Every picture on a checker, so its clear ground shows, beside itself as small as a bag slot and a hotbar slot draw it. */
function contactSheet(d: DrawnIcons): Page {
  const cols = Math.min(6, subjects.length);
  const [cellW, cellH, pad] = [size + 96, size + 34, 10];
  const page = new Page(pad + cols * (cellW + pad), 44 + Math.ceil(subjects.length / cols) * (cellH + pad));
  page.fill(0, 0, page.width, page.height, [242, 243, 245]);
  page.text(`${subjects.length} inventory pictures, ${size} px; beside each, as a bag slot (38 px) and a hotbar slot (30 px) show it`, pad, 14, [28, 32, 38]);
  subjects.forEach((s, i) => {
    const [x, y] = [pad + (i % cols) * (cellW + pad), 44 + Math.floor(i / cols) * (cellH + pad)];
    for (let cy = 0; cy < size; cy += 16) for (let cx = 0; cx < size; cx += 16) page.fill(x + cx, y + cy, 16, 16, ((cx + cy) / 16) % 2 ? [200, 204, 210] : [232, 234, 238]);
    const picture = d.pictures[d.index.get(s.icon)!]!;
    page.put(picture, size, x, y, size);
    page.fill(x + size + 8, y, 42, 42, [43, 48, 56]);
    page.put(picture, size, x + size + 10, y + 2, 38);
    page.fill(x + size + 8, y + 50, 34, 34, [43, 48, 56]);
    page.put(picture, size, x + size + 10, y + 52, 30);
    page.text(s.owner.slice(s.owner.indexOf(":") + 1), x, y + size + 8, [28, 32, 38]);
    page.text(s.mesh, x, y + size + 24, [110, 116, 126], 1);
  });
  return page;
}

const sheet = contactSheet(drawn);
writeFileSync(join(out, "icons.png"), encodePng(sheet.width, sheet.height, sheet.pixels));
const ms = drawn.report.drawn > 0 ? drawn.report.ms / drawn.report.drawn : 0;
console.log(`${join(out, "icons.png")}\n${drawn.report.items} items, ${drawn.report.pictures} pictures, ${drawn.report.drawn} drawn${drawn.report.drawn > 0 ? ` at ${ms.toFixed(0)} ms each` : ""}; each alone in ${join(out, "icons")}`);

/** A survivor's stand-in, to draw a screen without a server. */
function standIn(inv: Inventory | null): ClientSession {
  const session = standInSession(reg);
  session.inventory = inv;
  session.held = 0;
  session.ownKind = reg.index.get("core:survivor") ?? 0;
  session.progress.level = 30;
  session.progress.xp = 12000;
  session.progress.engramPoints = 4;
  session.progress.engrams = reg.defs.flatMap((d, k) => d?.type === "engram" ? [k] : []);
  return session;
}

/** A screen as a page of `ui` draws it, 1280 by 720, with the pictures' sheets filled in. */
function screen(name: string, setup: (ui: Ui, hud: HudModel) => ClientSession): void {
  const ui = new Ui();
  const { sheets, icons } = iconSheets(drawn, 0);
  const files = sheets.map((_, k) => ({ name: `core.icons.${k}.png`, bytes: 0, role: "icon" as const }));
  new Icons({ files, icons }, reg.defs, "assets", (k) => new Uint8ClampedArray(sheets[k]!.rgba)).install(ui.frame);
  ui.registry = reg;
  ui.palette = pack.palette;
  const hud = new HudModel();
  const session = setup(ui, hud);
  ui.build(1280 / 720, hud, session);
  const [w, h] = [1280, 720];
  const page = new Page(w, h);
  for (let y = 0; y < h; y++) page.fill(0, y, w, 1, [46 + (y * 30) / h, 70 + (y * 24) / h, 64 + (y * 10) / h]);
  drawUi(page.pixels, w, h, ui.frame);
  const file = join(out, `icons-${name}.png`);
  writeFileSync(file, encodePng(w, h, page.pixels));
  console.log(`${file}  ${ui.frame.count} nodes, ${countImages(ui)} of them pictures`);
}

const countImages = (ui: Ui): number => ui.frame.nodes.slice(0, ui.frame.count).filter((n) => n.image >= IMAGE_ICONS).length;

/** Items with a picture first, then some without, which keep their swatch. */
function stocked(): Inventory {
  const inv = new Inventory(40 + GEAR_SLOTS, 40);
  const id = (s: string): number => reg.index.get(s)!;
  subjects.forEach((s, i) => inv.set(i, id(s.owner), 1, 0, 0, 0));
  ["core:stone", "core:fiber", "core:berry", "core:meat", "core:waterskin"].forEach((s, i) => reg.index.has(s) && inv.set(subjects.length + i, id(s), [100, 180, 24, 3, 1][i]!, 0, 0, 0));
  subjects.slice(0, HOTBAR_SLOTS - 2).forEach((s, i) => inv.set(inv.hotbar + i, id(s.owner), 1, 0, 0, 0));
  if (reg.index.has("core:stone")) inv.set(inv.hotbar + HOTBAR_SLOTS - 1, id("core:stone"), 60, 0, 0, 0);
  return inv;
}

if (args.includes("--inventory")) {
  screen("inventory", (ui, hud) => {
    const inv = stocked();
    fillHotbar(hud, inv, 0, reg, pack.palette);
    ui.screen<InventoryScreen>("inventory").open = true;
    return standIn(inv);
  });
}
if (args.includes("--crafting")) {
  screen("crafting", (ui, hud) => {
    const inv = stocked();
    fillHotbar(hud, inv, 0, reg, pack.palette);
    ui.screen<CharacterScreen>("character").open = true;
    ui.screen<CharacterScreen>("character").tab = TAB_MAKE;
    return standIn(inv);
  });
}