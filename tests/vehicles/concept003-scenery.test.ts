import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { STREET_LOOKS, WRECKS } from "../../content/vehicles/wrecks.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";

artTest("the parked and stripped concept cars have rigid meshes and fitted cover", () => {
  const pack = parsePack(readFileSync(new URL("../../assets/source/core/vehicles/concept003_abandoned/concept003_abandoned.snpk", import.meta.url)));
  expect(pack.header.rigs).toHaveLength(0);
  const intact = pack.header.meshes.find(m => m.id === "core:concept003_abandoned")!;
  const shell = pack.header.meshes.find(m => m.id === "core:concept003_abandoned_stripped")!;
  expect(shell.half[1]).toBeLessThan(intact.half[1]);
  for (const mesh of [intact, shell]) {
    expect(mesh.lods[0]!.indexCount / 3).toBeLessThan(10000);
    expect(mesh.lods.at(-1)!.indexCount).toBeLessThan(mesh.lods[0]!.indexCount);
    expect(STREET_LOOKS.find(s => s.mesh === mesh.id)?.boxes.length).toBeGreaterThan(0);
    expect(WRECKS.some(d => d.type === "structure" && d.mesh === mesh.id)).toBe(true);
  }
});
