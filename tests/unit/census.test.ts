// What a frame and the HUD may hold: counts, which load cannot move. The frame on medium at the iPhone's view (D349,
// D423), a real city's downtown on every tier (tools/bench/census.ts), the HUD in every mode it has.

import { expect, test } from "bun:test";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { WRECK_KINDS } from "../../content/vehicles/wrecks.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { asTextured, boxBase } from "../../tools/bench/base.ts";
import { SPOTS, VIEW, count, turn, wood, type Counted } from "../../tools/bench/budget.ts";
import { SETUPS, SLICE_VIEWS, censusWorld } from "../../tools/bench/census.ts";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { withContent } from "../../shared/content/registry.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";
import { farPack } from "../fixtures/farworld.ts";
import { KORU_QUAY, koruMapFile, koruPack, koruPoint } from "../fixtures/koru.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const MEDIUM = forTouch(tierOf("medium"), true);
const HEADINGS = 4;

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
  // A street of wrecks, 20 a chunk along both kerbs, over the 7 by 7 chunks round the camera, which stands in it.
  const kinds = Object.values(WRECK_KINDS).flat().map((id) => coreRegistry().index.get(id)!);
  const street = flat((structs) => {
    for (let cz = 5; cz < 12; cz++) for (let cx = 5; cx < 12; cx++) for (let k = 0; k < 20; k++) structs.add(kinds[(cz * 16 + cx + k) % kinds.length]!, cx * 64 + 1.6 + (k >> 1) * 6.4, 0, cz * 64 + 28 + (k & 1) * 8, 16384, 0, 8000);
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
  expect(Object.values(scenes).map((frames) => most(frames, (f) => f.cast))).toEqual([342060, 1820564, 138704]);
});

artTest("a 20,000-piece base 30 and 60 m off on medium at the iPhone's view draws and casts what it did", () => {
  const reg = coreRegistry();
  const base = flat((structs) => boxBase(reg, "wood", 64 * 6 + 0.5, 0, 64 * 6 + 0.5, 21, 1, 20000).forEach(([kind, x, y, z, yaw]) => structs.add(kind, x, y, z, yaw, 1, 1000)));
  const frames = [30, 60].map((off) => {
    [base.cam.x, base.cam.z] = [64 * 7 - 0.5 + off, 64 * 6.5];
    const [f] = headings(base.scene, base.cam, [1.5 * Math.PI]);
    return [f!.draws, f!.triangles, f!.cast];
  });
  // Pinned at its draws, triangles and triangles cast. It was 15 draws and 8,676,500 and 8,680,596 triangles while the
  // chunk was drawn whole at the level of its box's nearest point; 5,783,676 and 4,311,372 triangles, casting 256,408 and
  // 250,264, by its 16 m cells, each at its own level. From outside air it draws and casts its shell alone (rooms.ts), in
  // the same draws at the same levels. What it casts is cascade 1's, which holds every cell.
  expect(frames).toEqual([[21, 1435488, 69052], [27, 1148264, 62908]]);
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
  const drawn = Object.fromEntries([1100, 1500, 1900, 2300].map((metres) => {
    const at = koruPoint([-metres, 20, 0]), to = koruPoint([0, 20, 0]);
    [cam.x, cam.y, cam.z] = at;
    headings(scene, cam, [Math.atan2(to[0] - at[0], to[2] - at[2])]);
    let n = 0;
    for (let d = 0; d < scene.packet.drawCount; d++) if (parts.has(scene.packet.drawMesh[d]!)) n++;
    return [metres, [n, scene.packet.dropped]];
  }));
  // Medium draws moving parts to 1,200 m and the far city and the landmarks' far meshes to 2,048 m.
  expect([tierOf("medium").reach.parts, tierOf("medium").reach.city]).toEqual([1200, 2048]);
  expect(drawn).toEqual({ 1100: [21, 0], 1500: [21, 0], 1900: [21, 0], 2300: [0, 0] });
});

test("a real city's downtown at its three views on each tier: the near city's draws, casts and triangles, and the far city's draws and triangles", () => {
  const slice = miamiSlice();
  const w = censusWorld(slice.map, slice.centre, coreRegistry(), farPack());
  const got = Object.fromEntries(SLICE_VIEWS.map((v) => [v.name, Object.fromEntries(SETUPS.map((s) => {
    const c = w.count(v, s);
    return [s.name, [c.near, c.cast, c.nearTriangles, c.far, c.farTriangles]];
  }))]));
  // Each view's near window lies whole in the slice, so the first three are what the built Miami draws there with the
  // grey boxes (equal when it was cut on 2026-11-17); the far city's are of the slice's ring of chunks round it, in tiles
  // of the slice's own from its corner. The near city's were 509, 742 and 104,248 at the street on high, 490, 673 and
  // 109,168 on the roof and 574, 635 and 120,588 in the air while each piece was an instance; with a chunk's statics
  // drawn flat as their form one mesh made in 16 m cells (client/core/render/nearcity.ts), what is left a draw is a
  // chunk's run of cells in view and the wrecks, its casters runs of cells, and its triangles the every-box form's, faces
  // held by another piece or the ground left out. The far city's were 15, 24, 11 and 14 draws and 48,382, 62,294, 62,790
  // and 78,520 triangles on the lit tiers while a chunk was in view by its pieces' box and 8 m round it at every level; by
  // the box its level's faces may reach, a box's their pieces' own, chunks at the view's edge drop out. Then they were
  // 22, 17 and 27 draws on the lit tiers and 13, 14 and 18 for touch in tiles of 3 by 3 chunks; in tiles of 4 by 4 there
  // are fewer runs, and the touch rule's every box ends short of more tiles' nearest points. Cut again on 2026-11-18 when
  // a building's bays came to wear their kind's facade modules (content/ruins.ts): the street on high was 41, 51 and
  // 67,608 near and 15 and 57,036 far, the roof 37, 46, 66,988, 19 and 77,014, the air 51, 45, 77,364, 13 and 73,184.
  expect(got).toEqual({
    "street-300": { lowpoly: [44, 0, 124604, 12, 78042], "medium, touch": [17, 9, 61818, 10, 37714], medium: [44, 21, 124604, 15, 111530], high: [44, 51, 124604, 15, 111530], ultra: [44, 57, 124604, 15, 111530] },
    "roof-300": { lowpoly: [40, 0, 129882, 12, 93478], "medium, touch": [24, 7, 77128, 14, 55230], medium: [40, 23, 129882, 19, 142474], high: [40, 48, 129882, 19, 144102], ultra: [40, 59, 129882, 19, 144102] },
    "air-300": { lowpoly: [54, 0, 144268, 11, 91948], "medium, touch": [25, 2, 85578, 9, 41238], medium: [54, 7, 144268, 13, 139652], high: [54, 49, 144268, 13, 139652], ultra: [54, 57, 144268, 13, 139652] },
  });
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
    [ui.menu, ui.options, ui.settings.tab] = [!["play", "car", "helicopter", "boat"].includes(mode), mode === "settings" || mode === "audio", mode === "audio" ? 1 : 0];
    [ui.help, ui.helpDevice] = [mode === "controls" || mode === "controller", mode === "controller" ? 1 : 0];
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
