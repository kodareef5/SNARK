// The looks only salvage leaves (assets/source/core/vehicles/<body>_salvaged), as their packs hold them.

import { expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { streetMaterial, vehicleWeather } from "../../content/street-finishes.ts";
import { SALVAGED_LOOKS, STREET_LOOKS } from "../../content/vehicles/wrecks.ts";
import { parsePack, type PackMesh } from "../../shared/pack/pack.ts";
import { artModule } from "../../tools/art/source.ts";
import type { PiecesAsset } from "../../tools/art/spec.ts";
import { artTest } from "../fixtures/needs-art.ts";

const VEHICLES = new URL("../../assets/source/core/vehicles/", import.meta.url);
const packOf = (name: string) => parsePack(new Uint8Array(readFileSync(new URL(`${name}/${name}.snpk`, VEHICLES))));
/** The pack a body's salvaged looks are in: its own, or the Concept's one pack of every look. */
const salvagedIn = (body: string): string => (existsSync(new URL(`${body}_salvaged`, VEHICLES)) ? `${body}_salvaged` : `${body}_abandoned`);
const salvagedPack = (body: string) => packOf(salvagedIn(body));
const triangles = (m: PackMesh, level = 0): number => m.lods[level]!.indexCount / 3;
/** The pack that holds a body's looks where it stopped: the compact's is beside its own. */
const stoppedMesh = (body: string): PackMesh => packOf(`${body}_abandoned`).header.meshes.find((m) => m.id === `core:${body}_abandoned`)!;

artTest("every look salvage leaves is a rigid mesh within its body's budget, with a flat level and fitted boxes", async () => {
  for (const look of SALVAGED_LOOKS) {
    const pack = salvagedPack(look.body), mesh = pack.header.meshes.find((m) => m.id === look.mesh)!;
    expect([look.mesh, mesh !== undefined, pack.header.rigs.length]).toEqual([look.mesh, true, 0]);
    const whole = stoppedMesh(look.body);
    // No finer than its asset allows, and drawn flat from its second level on.
    const spec = (await artModule(`core/vehicles/${salvagedIn(look.body)}/asset.ts`)).default as PiecesAsset;
    const most = (spec.pieces.find((p) => p.id === look.mesh)!.triangles ?? spec.budgets.triangles)[0]!;
    expect([look.mesh, triangles(mesh) <= most, mesh.lods.length >= 2, triangles(mesh, mesh.lods.length - 1) < triangles(mesh)]).toEqual([look.mesh, true, true, true]);
    // Down on its sills: no taller than it stood, and its boxes are within a hand of the mesh.
    expect(mesh.half[1]).toBeLessThanOrEqual(whole.half[1] + 0.02);
    for (const b of look.boxes) for (let a = 0; a < 3; a++) {
      expect([look.mesh, a, b.at[a]! - b.half[a]! >= mesh.center[a]! - mesh.half[a]! - 0.1, b.at[a]! + b.half[a]! <= mesh.center[a]! + mesh.half[a]! + 0.1]).toEqual([look.mesh, a, true, true]);
    }
  }
});

artTest("a shell is no wider than its body's stripped look, whose door is ajar, and is the most weathered", () => {
  for (const shell of SALVAGED_LOOKS.filter((l) => l.mesh.endsWith("_shell"))) {
    const id = `core:${shell.body}_abandoned_stripped`;
    const pack = STREET_LOOKS.some((l) => l.mesh === id) ? packOf(`${shell.body}_abandoned`) : salvagedPack(shell.body);
    const stripped = pack.header.meshes.find((m) => m.id === id)!;
    const mesh = salvagedPack(shell.body).header.meshes.find((m) => m.id === shell.mesh)!;
    expect([shell.mesh, mesh.half[0] <= stripped.half[0]]).toEqual([shell.mesh, true]);
    expect([shell.mesh, vehicleWeather(shell.mesh), vehicleWeather(id), vehicleWeather(`core:${shell.body}_abandoned`)]).toEqual([shell.mesh, 1, 0.55, 0.55]);
  }
});

artTest("every material a salvaged look is drawn with has its street finish", () => {
  for (const body of new Set(SALVAGED_LOOKS.map((l) => l.body))) {
    for (const m of salvagedPack(body).header.materials ?? []) expect([m.id, streetMaterial(m.id) > 0]).toEqual([m.id, true]);
  }
});
