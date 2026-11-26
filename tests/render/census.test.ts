// What a frame and the HUD may hold: counts, which load cannot move. The frame on medium at the iPhone's view (D349,
// D423) and the HUD in every mode it has; a real city's downtown on every tier is in census.slow.test.ts.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { WRECK_KINDS } from "../../content/vehicles/wrecks.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { asTextured, boxBase, layBase } from "../../tools/bench/base.ts";
import { SPOTS, VIEW, count, turn, wood, type Counted } from "../../tools/bench/budget.ts";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { withContent } from "../../shared/content/registry.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { KORU_QUAY, koruMapFile, koruPack, koruPoint } from "../fixtures/koru.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";
import type { MenuScreen } from "../../client/core/ui/menu-screen.ts";

const MEDIUM = forTouch(tierOf("medium"), true);
const HEADINGS = 4;
const PER_CHUNK = (JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { street: { cars: { perChunk: number } } }).street.cars.perChunk;

/** A flat map of 16 by 16 chunks holding `lay`'s pieces, on medium at the iPhone's view, levels drawn with their materials. */
function flat(lay: (structs: StructureStore) => void): { scene: Scene; cam: Camera } {
  const reg = coreRegistry();
  const dims = { chunksX: 16, chunksZ: 16 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  hf.heights.fill(32 * 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  lay(structs);
  const scene = new Scene({ dims, hf, structs }, reg, corePack());
  asTextured(scene);
  [scene.assets.tier, scene.viewHeight] = [MEDIUM, VIEW[1]];
  const cam = new Camera();
  [cam.aspect, cam.fovY, cam.y] = [VIEW[0] / VIEW[1], (VIEW[2] * Math.PI) / 180, 1.7];
  return { scene, cam };
}

/** The frame at each yaw from where `cam` stands, settled. */
function headings(scene: Scene, cam: Camera, yaws: number[]): Counted[] {
  return yaws.map((yaw) => {
    cam.yaw = yaw;
    for (let f = 0; f < 3; f++) scene.build(cam, null);
    return count(scene, scene.build(cam, null));
  });
}

const most = (frames: Counted[], f: (c: Counted) => number): number => Math.max(...frames.map(f));

artTest("a frame on medium at the iPhone's view keeps within medium's draws and triangles, with what does not give within the governor's first step", () => {
  const { budget } = MEDIUM;
  const scenes: Record<string, Counted[]> = {};
  for (const [name, spot] of Object.entries(SPOTS)) {
    const { scene, cam, ground } = wood(spot);
    scene.assets.tier = MEDIUM;
    scenes[`${name} wood`] = turn(scene, cam, ground, 40, true, HEADINGS).frames;
  }
  // A street of wrecks, 20 a chunk along both kerbs, over the 7 by 7 chunks round the camera, which stands in it: each
  // chunk's of as many of the street cars' looks as a chunk may hold (street.cars.perChunk), in their paints.
  const looks = Object.values(WRECK_KINDS).map((ids) => ids.map((id) => coreRegistry().index.get(id)!));
  const street = flat((structs) => {
    for (let cz = 5; cz < 12; cz++) for (let cx = 5; cx < 12; cx++) for (let k = 0; k < 20; k++) {
      const kinds = looks[(cz * 16 + cx + (k % PER_CHUNK) * 7) % looks.length]!;
      structs.add(kinds[(cx + k) % kinds.length]!, cx * 64 + 1.6 + (k >> 1) * 6.4, 0, cz * 64 + 28 + (k & 1) * 8, 16384, 0, 8000);
    }
  });
  [street.cam.x, street.cam.z] = [8.5 * 64, 8.5 * 64 - 0.5];
  scenes.street = headings(street.scene, street.cam, Array.from({ length: HEADINGS }, (_, k) => (k / HEADINGS) * Math.PI * 2));
  for (const frames of Object.values(scenes)) {
    expect(most(frames, (f) => f.draws)).toBeLessThanOrEqual(budget.draws);
    expect(most(frames, (f) => f.triangles)).toBeLessThanOrEqual(budget.triangles);
    // 1.5 M is where the governor's first leaves step can no longer be met.
    expect(most(frames, (f) => f.triangles - f.parts.crowns)).toBeLessThanOrEqual(1.5e6);
    expect(most(frames, (f) => f.uploads)).toBe(0);
  }
  // Nothing holds what is cast into the sun's maps yet: pinned at the most a heading. It was 1,112,574, 4,015,468 and
  // 205,904 while a chunk cast all its instances into every cascade its box met; by its 16 m cells, each into the
  // cascades it reaches, it is this (the touch rule's one tap keeps the levels). It was 342,046 and 1,736,330 in the first
  // two until nodes were scattered by their chunks' frame keys (shared/coords.ts), which moves every tree, rock and bush.
  // The native Parasaur adds 29,528 shadow triangles to each woodland fight on top of the feathered Raptor. The first two
  // were 393,476 and 1,871,612 until a cell's reach sideways was its meshes' measured reach (pack.ts meshReach), not
  // their bounds' corner: fewer cells reach a cascade they cannot shade. The street's was 138,704 while its cars were the
  // compact's five looks; as six looks a chunk of the fleet's (the jeep's 24,000 and the semi's 20,564 finest among them,
  // content/vehicles/wrecks.ts) it cast 259,860, and with the Concept's two lighter wreck looks in the rotation, this.
  // The first two were 364,236 and 1,590,572 while survivors were three flat levels, and 367,371 and 1,594,042 cooked as
  // four (tools/pack/body.ts); MakeHuman's bodies, whose finer levels are coarser, cast these: 365,147 and 1,591,582 until
  // the neck seam kept its points on the second level, 365,140 and 1,591,572 until the hide set went flat there, and
  // 365,158 and 1,591,592 until the thumb's root moved onto its joint and the torso's coarser levels lost triangles.
  expect(Object.values(scenes).map((frames) => most(frames, (f) => f.cast))).toEqual([365093, 1591522, 207978]);
});

artTest("a 20,000-piece base 30 and 60 m off on medium at the iPhone's view draws and casts what it did", () => {
  const reg = coreRegistry();
  const base = flat((structs) => void layBase(structs, boxBase(reg, "wood", 64 * 6 + 0.5, 0, 64 * 6 + 0.5, 21, 1, 20000), 1, 1000));
  const frames = [30, 60].map((off) => {
    [base.cam.x, base.cam.z] = [64 * 7 - 0.5 + off, 64 * 6.5];
    const [f] = headings(base.scene, base.cam, [1.5 * Math.PI]);
    return [f!.draws, f!.triangles, f!.cast];
  });
  // Pinned at its draws, triangles and triangles cast. It was 15 draws and 8,676,500 and 8,680,596 triangles while the
  // chunk was drawn whole at the level of its box's nearest point; 5,783,676 and 4,311,372 triangles, casting 256,408 and
  // 250,264, by its 16 m cells, each at its own level. From outside air it draws and casts its shell alone (rooms.ts), in
  // the same draws at the same levels. What it casts is cascade 1's, which holds every cell. It was 21 and 27 draws and
  // 1,435,488 and 1,148,264 triangles, casting 69,052 and 62,908, while wood's levels were modelled for 38, 94 and 301 m:
  // made by its recipe for 19, 60, 147 and 298 m (tools/pack/pieces), three of them with materials, 32 and 15 draws and
  // 895,308 and 526,976, casting 69,044 and 62,900. With no strips at a wall's ends and the client's joints and skirts
  // laid, which are draws of their own, it is this.
  expect(frames).toEqual([[42, 645208, 70052], [18, 363692, 63908]]);
});

artTest("Koru moored in its bay on medium at the iPhone's view: its eight cells, three doors, sails and rig in a few score draws, and what it casts", () => {
  const map = parseMap(koruMapFile());
  const reg = withContent(coreRegistry(), map.content!.defs);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const scene = new Scene({ dims: map.dims, hf: mapHeightfield(map), structs, motion: { states: () => new Map(), tick: () => 0, statics: () => map.statics } }, reg, koruPack());
  asTextured(scene);
  [scene.assets.tier, scene.viewHeight] = [MEDIUM, VIEW[1]];
  const cam = new Camera();
  [cam.aspect, cam.fovY] = [VIEW[0] / VIEW[1], (VIEW[2] * Math.PI) / 180];
  const yacht = new Set(koruPack().header.meshes.flatMap((m, i) => (m.id.startsWith("koru:") ? [i] : [])));
  const views: Record<string, readonly number[]> = {
    dock: [KORU_QUAY[0], KORU_QUAY[1] + 1.62, KORU_QUAY[2]],
    deck: koruPoint([4, 5.37, -24]),
    below: koruPoint([0, 2.37, -12]),
    "200 m off": koruPoint([-200, 2, -10]),
  };
  const got = Object.fromEntries(Object.entries(views).map(([name, at]) => {
    [cam.x, cam.y, cam.z] = at as [number, number, number];
    let own = 0;
    const frames = Array.from({ length: HEADINGS }, (_, k) => {
      const [f] = headings(scene, cam, [(k / HEADINGS) * Math.PI * 2]);
      const p = scene.packet;
      let n = 0;
      for (let d = 0; d < p.drawCount; d++) if (yacht.has(p.drawMesh[d]!)) n++;
      own = Math.max(own, n);
      return f!;
    });
    return [name, [most(frames, (f) => f.draws), most(frames, (f) => f.triangles), most(frames, (f) => f.cast), own]];
  }));
  // The most a heading draws of the whole frame, its triangles, what it casts, and the most of the draws that are the
  // yacht's: its cells, doors, sails and the sixteen parts of its rig, where the modules one draw each made it 470. From
  // the dock it was 85,634 triangles casting 69,756 before the yacht's sails were drawn with the atlas and its masts,
  // booms and hull rounder, 93,164 casting 86,252 in 18 draws before its furniture was made, its ports rimmed, and its
  // plaques drawn from a picture of their own, and 126,184 casting 119,416 in 23 before its rig was its own see-through
  // parts, which cast nothing, and the cells' wires, thickened on their way off, no longer held them to finer levels;
  // a struck headsail is its roll, a line, not its sheet squeezed onto the stay, and the roll stands for the stay too.
  expect(got).toEqual({ dock: [27, 116952, 97532, 25], deck: [31, 115200, 101256, 29], below: [26, 115428, 99712, 24], "200 m off": [34, 72736, 10240, 32] });
  expect(KORU_LAYOUT.cells.length).toBe(8);
});

artTest("Koru's sails, gaffs and rig are drawn as far as its far mesh, past medium's reach for moving parts and short of the far city's", () => {
  const map = parseMap(koruMapFile());
  const reg = withContent(coreRegistry(), map.content!.defs);
  const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  placeStatics(map, structs, reg);
  const scene = new Scene({ dims: map.dims, hf: mapHeightfield(map), structs, motion: { states: () => new Map(), tick: () => 0, statics: () => map.statics } }, reg, koruPack());
  [scene.assets.tier, scene.viewHeight] = [tierOf("medium"), VIEW[1]];
  const cam = new Camera();
  [cam.aspect, cam.fovY] = [VIEW[0] / VIEW[1], (VIEW[2] * Math.PI) / 180];
  const parts = new Set(KORU_LAYOUT.motion.parts.map((p) => scene.assets.table.find(p.mesh)));
  const drawn = Object.fromEntries([1400, 1800, 2200, 2700].map((metres) => {
    const at = koruPoint([-metres, 20, 0]), to = koruPoint([0, 20, 0]);
    [cam.x, cam.y, cam.z] = at;
    headings(scene, cam, [Math.atan2(to[0] - at[0], to[2] - at[2])]);
    let n = 0;
    for (let d = 0; d < scene.packet.drawCount; d++) if (parts.has(scene.packet.drawMesh[d]!)) n++;
    return [metres, [n, scene.packet.dropped]];
  }));
  // Medium draws moving parts to 1,500 m and the far city and the landmarks' far meshes to 2,500 m.
  expect([tierOf("medium").reach.parts, tierOf("medium").reach.city]).toEqual([1500, 2500]);
  expect(drawn).toEqual({ 1400: [21, 0], 1800: [21, 0], 2200: [21, 0], 2700: [0, 0] });
});

test("the HUD holds at most 500 nodes in every mode, the vehicles' dashes and the menus among them, and grows none after warming up", () => {
  const ui = new Ui();
  const hud = new HudModel();
  hud.hotbar.push(...Array.from({ length: 10 }, (_, i) => ({ tint: 0x88aabb, label: `Item ${i}`, number: "100" })));
  for (const vital of hud.vitals) vital.fraction = 0.5;
  const dash = new VehicleTelemetry();
  Object.assign(dash, { active: true, speed: 12, gear: 3, rpm: 3400, fuel: 0.72, altitude: 40, engineOn: true });
  const counts: Record<string, number> = {};
  for (const mode of ["play", "car", "helicopter", "boat", "menu", "settings", "audio", "controls", "controller"] as const) {
    [dash.rotor, dash.boat] = [mode === "helicopter", mode === "boat"];
    hud.vehicle = mode === "car" || mode === "helicopter" || mode === "boat" ? dash : null;
    [ui.screen<MenuScreen>("menu").menu, ui.screen<MenuScreen>("menu").options, ui.settings.tab] = [!["play", "car", "helicopter", "boat"].includes(mode), mode === "settings" || mode === "audio", mode === "audio" ? 1 : 0];
    [ui.screen<MenuScreen>("menu").help, ui.screen<MenuScreen>("menu").helpDevice] = [mode === "controls" || mode === "controller", mode === "controller" ? 1 : 0];
    const frame = (i: number): void => {
      [hud.vitals[0]!.fraction, dash.speed] = [(i % 100) / 100, i % 40];
      ui.build(16 / 9, hud, null);
    };
    for (let i = 0; i < 200; i++) frame(i);
    const allocated = ui.frame.nodes.length;
    for (let i = 0; i < 200; i++) frame(i);
    expect(ui.frame.nodes.length - allocated, mode).toBe(0);
    counts[mode] = ui.frame.count;
  }
  expect(Math.max(...Object.values(counts)), JSON.stringify(counts)).toBeLessThanOrEqual(500);
});
