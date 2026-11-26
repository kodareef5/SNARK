// Screens on props (content/screens.ts, content/street.ts): every face is sound, lies on its model's glass, and is kept by
// kind; broken forms have none; the tek workstation is a station made at the fabricator, where the plasma guns are made.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stationRecipes } from "../../client/core/ui/station.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { BILLBOARD_FACE } from "../../content/street.ts";
import type { Def, EngramDef, ItemDef, StructureDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { faceFault } from "../../shared/video/face.ts";
import { unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { artTest, fromArt } from "../fixtures/needs-art.ts";

const reg = coreRegistry();
const at = (id: string): number => reg.index.get(id)!;
const def = (id: string): Def => reg.defs[at(id)]!;
const MODELS = join(import.meta.dir, "../../assets/source/core/props/screens");
/** What model.py wrote: each piece's box, and the face its content gives a whole one, in the game's frame. */
const BUILT: Record<string, { half: number[]; face?: number[] }> = JSON.parse(readFileSync(join(MODELS, "faces.json"), "utf8"));
const PROPS = ["tv_flat", "tv_flat_stand", "tv_crt", "laptop"];
/** The four billboards (content/street.ts BOARDS), the props and the workstation. */
const WITH_FACES = [...["", "_low", "_mid", "_small"].map((b) => `core:zzstreet_billboard${b}`), ...PROPS.map((p) => `core:${p}`), "core:workstation"];

test("every screen face is sound and on a static or a station, and only the expected kinds carry one", () => {
  const carried = CORE_CONTENT.filter((d): d is StructureDef => d.type === "structure" && d.screen !== undefined);
  expect(carried.map((d) => d.id).sort()).toEqual([...WITH_FACES].sort());
  for (const d of carried) expect([d.id, faceFault(d.screen!), ["static", "station"].includes(d.class)]).toEqual([d.id, "", true]);
  expect(carried.map((d) => [d.id, d.screen!.type])).toContainEqual(["core:workstation", "laptop"]);
  expect((def("core:tv_crt") as StructureDef).screen!.crt).toBe(true);
});

test("a billboard's LED face lies on its panel's road side, a few mm in front of it", () => {
  const b = def("core:zzstreet_billboard") as StructureDef;
  expect(b.screen).toEqual(BILLBOARD_FACE);
  expect(BILLBOARD_FACE).toMatchObject({ type: "billboard", led: true });
  // The panel box is x -7.4..7.4, y 9.55..14.4, z -0.45..1.55; its sheet hangs at z 0.1 and +Z looks at the road.
  const [x0, x1, y0, y1, z] = BILLBOARD_FACE.face;
  expect([x0 >= -7.4, x1 <= 7.4, y0 >= 9.55, y1 <= 14.4]).toEqual([true, true, true, true]);
  expect(z).toBeGreaterThan(0.11);
  expect(z).toBeLessThan(0.13);
});

test("broken forms carry no screen", () => {
  const broken = ["core:zzstreet_billboard_bare", ...PROPS.map((p) => `core:${p}_broken`)];
  for (const id of broken) expect([id, (def(id) as StructureDef).screen, reg.screenFace[at(id)]]).toEqual([id, undefined, null]);
  for (const p of PROPS) expect([p, (def(`core:${p}_broken`) as StructureDef).near]).toEqual([p, true]);
});

test("the registry keeps each kind's face, null for every other kind", () => {
  expect(reg.screenFace.length).toBe(reg.defs.length);
  const kept = reg.screenFace.flatMap((f, k) => (f ? [reg.ids[k]!] : []));
  expect(kept.sort()).toEqual([...WITH_FACES].sort());
  for (const id of WITH_FACES) expect(reg.screenFace[at(id)]).toBe((def(id) as StructureDef).screen!);
});

test("a structure whose face is unsound is refused", () => {
  const bad: Def = { type: "structure", class: "static", id: "core:bad_tv", mesh: "box", half: [0.5, 0.5, 0.1], color: 11, hp: 10, screen: { type: "tv", face: [0.4, -0.4, 0, 0.5, 0.1] } };
  const orb: Def = { type: "structure", class: "static", id: "core:bad_orb", mesh: "box", half: [0.5, 0.5, 0.1], color: 11, hp: 10, screen: { type: "orb" as "tv", face: [-0.4, 0.4, 0, 0.5, 0.1] } };
  const { errors } = compileContent([...CORE_CONTENT, bad, orb]);
  expect(errors).toContain("core:bad_tv: its face is empty: x1 must be past x0 and y1 past y0");
  expect(errors).toContain("core:bad_orb: a screen is a billboard, a tv or a laptop");
});

test("each prop's box and face are the ones its model was built to", () => {
  for (const name of [...PROPS.flatMap((p) => [p, `${p}_broken`]), "workstation"]) {
    const d = def(`core:${name}`) as StructureDef;
    expect([name, [...d.half]]).toEqual([name, BUILT[name]!.half]);
    expect([name, d.screen ? [...d.screen.face] : undefined]).toEqual([name, BUILT[name]!.face]);
  }
});

const meshes: SourceMesh[] = fromArt(() => unpackMeshes(parsePack(readFileSync(join(MODELS, "screens.snpk")))));

artTest("each face lies on its model's dark glass: inside it, within a centimetre of its edges, and 1 to 5 mm in front", () => {
  for (const name of [...PROPS, "workstation"]) {
    const mesh = meshes.find((m) => m.id === `core:${name}`)!;
    const lod = mesh.lods[0]!;
    const glass = mesh.materials!.findIndex((m) => m.id === "core:screens/screen");
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < lod.indices.length / 3; t++) {
      if ((lod.sections?.[t] ?? 0) !== glass) continue;
      for (let c = 0; c < 3; c++) {
        const v = lod.indices[t * 3 + c]!;
        for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a]!, lod.positions[v * 3 + a]!)), (hi[a] = Math.max(hi[a]!, lod.positions[v * 3 + a]!));
      }
    }
    const [x0, x1, y0, y1, z] = (def(`core:${name}`) as StructureDef).screen!.face;
    const inset = [x0 - lo[0]!, hi[0]! - x1, y0 - lo[1]!, hi[1]! - y1];
    expect([name, inset.every((d) => d > -0.002 && d < 0.01)]).toEqual([name, true]);
    expect([name, z - hi[2]! > 0.001 && z - hi[2]! < 0.005]).toEqual([name, true]);
  }
});

test("the tek workstation is a station placed from its item, made at the fabricator after the fabricator's engram", () => {
  const w = def("core:workstation") as StructureDef;
  expect([w.class, w.slots, w.screen!.type]).toEqual(["station", 60, "laptop"]);
  const piece = def("core:piece_workstation") as ItemDef;
  expect([piece.places, piece.craft!.at, piece.stack]).toEqual([["core:workstation"], "core:fabricator", 1]);
  expect(piece.craft!.needs.map((n) => n.item).every((id) => reg.index.has(id))).toBe(true);
  const engram = def("core:engram-piece_workstation") as EngramDef;
  expect([engram.item, engram.level, engram.requires]).toEqual(["core:piece_workstation", 90, ["core:engram-piece_fabricator"]]);
  expect(engram.level).toBeGreaterThan((def("core:engram-piece_fabricator") as EngramDef).level);
});

test("the plasma rifle and pistol are made at the tek workstation, and no longer at the fabricator", () => {
  const made = (kind: string): string[] => stationRecipes(reg, at(kind)).map((k) => reg.ids[k]!);
  for (const gun of ["core:rifle_plasma", "core:pistol_plasma"]) {
    expect([gun, (def(gun) as ItemDef).craft!.at]).toEqual([gun, "core:workstation"]);
    expect([gun, made("core:workstation").includes(gun), made("core:fabricator").includes(gun)]).toEqual([gun, true, false]);
    expect((def(`core:engram-${gun.slice(5)}`) as EngramDef).requires).toContain("core:engram-piece_workstation");
  }
});
