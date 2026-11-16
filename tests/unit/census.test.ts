// What a frame and the HUD may hold: counts, which load cannot move. The frame on medium at the iPhone's view (D349,
// D423), the HUD in every mode it has.

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

test("a frame on medium at the iPhone's view keeps within medium's draws and triangles, with what does not give within the governor's first step", () => {
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
  // cascades it reaches, it is this (the touch rule's one tap keeps the levels).
  expect(Object.values(scenes).map((frames) => most(frames, (f) => f.cast))).toEqual([342046, 1736330, 138704]);
});

test("a 20,000-piece base 30 and 60 m off on medium at the iPhone's view draws and casts what it did", () => {
  const reg = coreRegistry();
  const base = flat((structs) => boxBase(reg, "wood", 64 * 6 + 0.5, 0, 64 * 6 + 0.5, 21, 1, 20000).forEach(([kind, x, y, z, yaw]) => structs.add(kind, x, y, z, yaw, 1, 1000)));
  const frames = [30, 60].map((off) => {
    [base.cam.x, base.cam.z] = [64 * 7 - 0.5 + off, 64 * 6.5];
    const [f] = headings(base.scene, base.cam, [1.5 * Math.PI]);
    return [f!.draws, f!.triangles, f!.cast];
  });
  // Pinned at its draws, triangles and triangles cast, to fall again as shell is drawn before interior (review B4). It was
  // 15 draws and 8,676,500 and 8,680,596 triangles while the chunk was drawn whole at the level of its box's nearest
  // point; by its 16 m cells, each at its own level, it is this. What it casts is cascade 1's, which holds every cell.
  expect(frames).toEqual([[27, 5784668, 256408], [27, 4311372, 250264]]);
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
