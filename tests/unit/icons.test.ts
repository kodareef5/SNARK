// Inventory pictures: drawn headless from a mesh, laid out in sheets the manifest lists, and shown in the bag, the hotbar
// and the crafting list where an item has one, its swatch where it has none. Only a code-made pick is drawn here: every
// real picture is drawn by `bun run build` and looked at with `bun run icons`.

import { expect, test } from "bun:test";
import { IMAGE_ICONS, Icons } from "../../client/core/assets/icons.ts";
import { Binding } from "../../client/core/assets/bind.ts";
import { AssetTable } from "../../client/core/assets/table.ts";
import { HudModel, fillHotbar } from "../../client/core/hud.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_CHAR_ENGRAM_PICTURE, KEY_CHAR_RECIPE_PICTURE, KEY_CHAR_TAB, TAB_ENGRAMS, TAB_MAKE, engramOrder } from "../../client/core/ui/character.ts";
import { KEY_HOTBAR } from "../../client/core/ui/hud.ts";
import { KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { K_IMAGE, K_PANEL } from "../../client/core/ui/nodes.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import type { EngramDef, ItemDef } from "../../shared/content/defs.ts";
import { ICONS_A_SHEET, ICON_SIZE } from "../../shared/pack/icons.ts";
import { MANIFEST_VERSION, describePack, parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS, Inventory } from "../../shared/sim/items.ts";
import { IconPainter, buildIcons, framingOf, iconSubjects, type IconFraming } from "../../tools/pack/icons.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { standInSession } from "../../tools/snap.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const bytes = buildPack(weaponMeshes().filter((m) => m.id === "core:pick"), defaultPalette());
const pack = parsePack(bytes);
const manifest = describePack(pack, { name: "core.boot.snpk", bytes: bytes.length });
// The only mesh is the pick's, so of the core items only the pick has a picture.
const built = buildIcons(pack, reg.defs, manifest, [bytes], { cache: null });
const sheet = built.files[0]!;

test("a code-made pick is drawn on a clear ground, filling its picture and centred, its length along the diagonal", () => {
  const n = 32;
  const picture = new IconPainter(pack, () => null, n).draw(0, [15, 0, 0, 0, 0, 0]);
  const alpha = (x: number, y: number): number => picture[(y * n + x) * 4 + 3]!;
  let [x0, x1, y0, y1, edge] = [n, -1, n, -1, 0];
  const quarter = [0, 0, 0, 0];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = alpha(x, y);
      if (a === 0) continue;
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
      if (a < 255) edge++;
      quarter[(y < n / 2 ? 0 : 2) + (x < n / 2 ? 0 : 1)]! += a;
    }
  }
  // A clear ground with a margin all round, what it holds filling most of the longer way and centred to a pixel.
  expect([x0 >= 1, y0 >= 1, x1 <= n - 2, y1 <= n - 2]).toEqual([true, true, true, true]);
  expect(Math.max(x1 - x0, y1 - y0) + 1).toBeGreaterThanOrEqual(n * 0.8);
  expect(Math.abs((x0 + x1) / 2 - (n - 1) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs((y0 + y1) / 2 - (n - 1) / 2)).toBeLessThanOrEqual(1);
  // Edges are smoothed by the larger picture it is shrunk from.
  expect(edge).toBeGreaterThan(10);
  // The shaft runs from the bottom left to the top right, and the head is at the top right.
  const [topLeft, topRight, bottomLeft, bottomRight] = quarter as [number, number, number, number];
  expect(topRight + bottomLeft).toBeGreaterThan(1.5 * (topLeft + bottomRight));
  expect(topRight).toBeGreaterThan(bottomLeft);
  // It is lit: not all one colour.
  const shades = new Set<number>();
  for (let p = 0; p < n * n; p++) if (picture[p * 4 + 3] === 255) shades.add(picture[p * 4]! * 65536 + picture[p * 4 + 1]! * 256 + picture[p * 4 + 2]!);
  expect(shades.size).toBeGreaterThan(3);
});

test("a framing's shift, with its zoom, shows one end of a long thing and lets the rest run off the picture", () => {
  // A stick 60 cm long from its grip, as a spear's shaft is held: its far end goes to the top right.
  const lod = boxMesh([0.01, 0.01, 0.3], 15);
  for (let v = 2; v < lod.positions.length; v += 3) lod.positions[v]! += 0.3;
  const n = 32;
  const painter = new IconPainter(parsePack(buildPack([{ id: "t:stick", lods: [lod] }], defaultPalette())), () => null, n);
  /** Which sides of the picture what it holds reaches: left, right, top, bottom. */
  const reaches = (framing: IconFraming | null): boolean[] => {
    const picture = painter.draw(0, [15, 0, 0, 0, 0, 0], framing);
    const covered = (x: number, y: number): boolean => picture[(y * n + x) * 4 + 3]! > 0;
    const any = (f: (k: number) => boolean): boolean => Array.from({ length: n }, (_, k) => f(k)).some((v) => v);
    return [any((y) => covered(0, y)), any((y) => covered(n - 1, y)), any((x) => covered(x, 0)), any((x) => covered(x, n - 1))];
  };
  // Whole, it reaches no side. Zoomed toward its far end, that end is whole and the rest runs off below, the picture's
  // middle a little above the stick; the other way, the grip's end is whole and the rest runs off above.
  const view = framingOf({ around: 1.08, above: 0.42 });
  expect(reaches(null)).toEqual([false, false, false, false]);
  expect(reaches({ ...view, zoom: 3, shift: [0.6, 0.7] })).toEqual([false, false, false, true]);
  expect(reaches({ ...view, zoom: 3, shift: [-0.6, -0.7] })).toEqual([false, false, true, false]);
});

test("an item is drawn from its own dropped mesh, else its own held mesh, and never from the bag that stands in", () => {
  const subjects = (meshes: string[]): string[] => iconSubjects(reg.defs, (id) => meshes.includes(id)).map((s) => `${s.icon} ${s.mesh}`);
  expect(subjects(["core:pick", "core:bag"])).toEqual(["core:pick/icon core:pick"]);
  expect(subjects(["core:pick", "core:pick/dropped", "core:stone/dropped"]).sort()).toEqual(["core:pick/icon core:pick/dropped", "core:stone/icon core:stone/dropped"]);
});

test("a structure's item with no mesh of its own is drawn as the first structure it places stands, in that structure's colour", () => {
  const subjects = (meshes: string[]): string[] => iconSubjects(reg.defs, (id) => meshes.includes(id)).map((s) => `${s.icon} ${s.mesh} ${s.colors[0]}`);
  const mortar = reg.defs.find((d) => d?.id === "core:mortar") as { color: number };
  // The mortar's grey box or modelled mesh, which share its id; its own preview where it has one, and its own dropped
  // mesh before either. The bag a dropped stack stands in is still nobody's picture.
  expect(subjects(["core:mortar"])).toEqual([`core:piece_mortar/icon core:mortar ${mortar.color}`]);
  expect(subjects(["core:mortar", "core:piece_mortar/preview"])).toEqual([`core:piece_mortar/icon core:piece_mortar/preview ${mortar.color}`]);
  expect(subjects(["core:mortar", "core:piece_mortar/dropped"])[0]!.split(" ")[1]).toBe("core:piece_mortar/dropped");
  expect(subjects(["core:bag"])).toEqual([]);
  // A lit pair's item places the unlit kind, so it is pictured out.
  const campfire = reg.defs.find((d) => d?.type === "item" && d.places?.includes("core:campfire"));
  expect(subjects(["core:campfire", "core:campfire_lit"])).toEqual([`${campfire!.id}/icon core:campfire ${(reg.defs.find((d) => d?.id === "core:campfire") as { color: number }).color}`]);
});

test("a vehicle assembly is pictured from its authored deployment model and livery", () => {
  const subjects = (meshes: string[]) => iconSubjects(reg.defs, id => meshes.includes(id));
  expect(subjects(["core:helicopter"])).toEqual([{ icon: "core:helicopter_assembly/icon", owner: "core:helicopter_assembly", mesh: "core:helicopter", colors: [103, 86, 101, 0, 0, 0] }]);
  expect(subjects(["core:helicopter", "core:helicopter_assembly/dropped"])[0]!.mesh).toBe("core:helicopter_assembly/dropped");
  expect(subjects(["core:bag"])).toEqual([]);
});

test("a sheet of pictures is a file of the manifest, which still reads version 3 and refuses a picture outside its sheet", () => {
  expect(MANIFEST_VERSION).toBe(4);
  expect([sheet.role, [...sheet.bytes.subarray(0, 8)]]).toEqual(["icon", [137, 80, 78, 71, 13, 10, 26, 10]]);
  // One picture, alone on its sheet: one cell across and down.
  const m = parseManifest(JSON.stringify(manifest));
  expect(m.icons).toEqual({ size: ICON_SIZE, sheets: [{ file: 1, columns: 1, rows: 1 }], cells: { "core:pick/icon": 0 } });
  expect(m.files[1]).toEqual({ name: "core.icons.0.png", bytes: sheet.bytes.length, role: "icon" });
  const table = new AssetTable(m, pack);
  expect([table.has("icon", "core:pick/icon"), table.has("icon", "core:spear/icon"), table.has("mesh", "core:pick/icon")]).toEqual([true, false, false]);
  // The `#icon` slot is filled from the manifest as every other slot is. Without a picture it is the swatch.
  const bind = new Binding(reg.defs, table);
  expect([bind.id("core:pick", "icon"), bind.id("core:stone", "icon")]).toEqual(["core:pick/icon", ""]);
  const bad = (change: (m: Manifest) => void): (() => Manifest) => {
    const copy = JSON.parse(JSON.stringify(manifest)) as Manifest;
    change(copy);
    return () => parseManifest(JSON.stringify(copy));
  };
  expect(bad((c) => (c.icons!.cells["core:pick/icon"] = 1))).toThrow("lies outside its sheet");
  expect(bad((c) => (c.icons!.cells["core:pick/icon"] = ICONS_A_SHEET))).toThrow("lies outside its sheet");
  expect(bad((c) => (c.icons!.sheets[0]!.file = 0))).toThrow("does not hold one");
  const old = bad((c) => {
    c.version = 3;
    c.files.pop();
    delete c.icons;
  })();
  expect([old.version, new AssetTable(old, pack).has("icon", "core:pick/icon")]).toEqual([3, false]);
});

test("the bag, the hotbar and the crafting list show an item's picture where it has one, and its swatch where not", () => {
  const id = (s: string): number => reg.index.get(s)!;
  const inv = new Inventory(40 + HOTBAR_SLOTS + ARMOR_SLOTS, 40);
  inv.set(0, id("core:pick"), 1, 0, 0, 0);
  inv.set(1, id("core:stone"), 30, 0, 0, 0);
  inv.set(inv.hotbar, id("core:pick"), 1, 0, 0, 0);
  inv.set(inv.hotbar + 1, id("core:stone"), 30, 0, 0, 0);
  const engrams = reg.defs.flatMap((d, k) => (d?.type === "engram" ? [k] : []));
  const session = { inventory: inv, held: 0, tamed: [], serverTick: 1000, logVersion: 0, log: [], globalChat: true, tribe: { name: "" }, progress: { level: 99, xp: 0, statPoints: 0, engramPoints: 0, jobs: [], engrams }, ownKind: id("core:survivor") } as unknown as ClientSession;
  const frame = (pictures: boolean, character: boolean, page = 0, tab = TAB_MAKE): Ui => {
    const ui = new Ui();
    ui.sheet.page = page;
    if (pictures) new Icons(manifest, reg.defs, "assets", () => new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4)).install(ui.frame);
    [ui.registry, ui.palette, ui.inventory.open, ui.character, ui.sheet.tab] = [reg, pack.palette, true, character, tab];
    const hud = new HudModel();
    fillHotbar(hud, inv, 0, reg, pack.palette);
    ui.build(16 / 9, hud, session);
    return ui;
  };
  const shown = frame(true, false).frame;
  const picture = shown.find(KEY_INV_SLOT + 1)!;
  expect([picture.kind, picture.image, picture.sx, picture.sy, picture.sw, picture.sh]).toEqual([K_IMAGE, IMAGE_ICONS, 0, 0, ICON_SIZE, ICON_SIZE]);
  expect(shown.images[IMAGE_ICONS]).toMatchObject({ width: ICON_SIZE, height: ICON_SIZE, url: "assets/core.icons.0.png" });
  expect([shown.find(KEY_INV_SLOT + 3 + 1)!.kind, shown.find(KEY_INV_SLOT + 3 + 1)!.text]).toEqual([K_PANEL, "ston"]);
  expect(shown.find(KEY_HOTBAR + 1)?.kind).toBe(K_IMAGE);
  expect(shown.find(KEY_HOTBAR + 3 + 1)?.kind).toBe(K_PANEL);
  // A build without pictures shows every swatch as before.
  expect(frame(false, false).frame.find(KEY_INV_SLOT + 1)!.kind).toBe(K_PANEL);
  // The crafting list puts the pick's picture beside its row, on whichever page that is, and no other: no other item has one.
  // Its row is its place among what is made in the hands; what a station makes is listed at the station.
  const made = reg.defs.flatMap((d, k) => (d?.type === "item" && (d as ItemDef).craft && reg.craftAt[k] === 0 ? [k] : []));
  const key = KEY_CHAR_RECIPE_PICTURE + made.indexOf(id("core:pick"));
  const pages = Array.from({ length: frame(true, true).sheet.pages }, (_, page) => frame(true, true, page).frame);
  const page = pages.find((f) => f.find(key) !== null)!;
  expect(page.find(key)!.kind).toBe(K_IMAGE);
  expect(pages.flatMap((f) => f.nodes.slice(0, f.count)).filter((n) => n.kind === K_IMAGE && n.key >= KEY_CHAR_RECIPE_PICTURE && n.key < KEY_CHAR_RECIPE_PICTURE + made.length).length).toBe(1);
  // An engram has no picture of its own, and its row shows its item's: the pick's engram shows the pick, and no other row
  // shows one.
  const order = engramOrder(reg, engrams);
  const pickEngram = order.findIndex((e) => (reg.defs[e] as EngramDef).item === "core:pick");
  const learned = Array.from({ length: frame(true, true, 0, TAB_ENGRAMS).sheet.pages }, (_, page) => frame(true, true, page, TAB_ENGRAMS).frame);
  const shows = learned.find((f) => f.find(KEY_CHAR_ENGRAM_PICTURE + pickEngram) !== null)!.find(KEY_CHAR_ENGRAM_PICTURE + pickEngram)!;
  expect([shows.kind, shows.image, shows.sx, shows.sy]).toEqual([K_IMAGE, IMAGE_ICONS, 0, 0]);
  expect(learned.flatMap((f) => f.nodes.slice(0, f.count)).filter((n) => n.kind === K_IMAGE && n.key >= KEY_CHAR_ENGRAM_PICTURE && n.key < KEY_CHAR_ENGRAM_PICTURE + order.length).length).toBe(1);
});

test("the session bun run snap -- --ui draws the interface from builds the bag, the chat and every tab of the character sheet", () => {
  // Its stand-in was once an object made by hand without `tamed`, and building the bag threw.
  const session = standInSession(reg, "Night Shift");
  session.inventory = new Inventory(40);
  session.inventory.set(0, reg.index.get("core:berry")!, 24, 0, 0, 9000);
  const built = (bag: boolean, tab: number): Ui => {
    const ui = new Ui();
    [ui.registry, ui.palette, ui.inventory.open, ui.character, ui.sheet.tab] = [reg, pack.palette, bag, !bag, tab];
    ui.build(16 / 9, new HudModel(), session);
    return ui;
  };
  expect(built(true, 0).frame.find(KEY_INV_SLOT + 1)?.text).toBe("berr");
  for (const tab of [0, TAB_ENGRAMS, TAB_MAKE]) expect(built(false, tab).frame.find(KEY_CHAR_TAB + tab)?.text).toBe(["Stats", "Engrams", "Make"][tab]);
  const chat = new Ui();
  chat.chat.begin(TEXT_TRIBE, session);
  chat.chat.edit("on my way");
  chat.build(16 / 9, new HudModel(), session);
  expect(chat.frame.count).toBeGreaterThan(0);

});
