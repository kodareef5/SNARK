import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glassAt, glassSet } from "../../client/core/render/vehicle-glass.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { readPng } from "../../tools/pack/png-read.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

const folder = join(import.meta.dir, "../../assets/source/core/vehicles/concept003");
const pack = parsePack(readFileSync(join(folder, "concept003.snpk")));
const rig = pack.header.rigs[0]!;
const mesh = unpackMeshes(pack)[0]!;
const names = rig.names!;

test("all glazing can shatter and each side pane follows its door at every level", () => {
  const fine = mesh.lods[0]!;
  const glass = glassSet(mesh.materials![0]!.id);
  expect(glass).toBeGreaterThan(0);
  for (const pane of ["front", "rear", "left", "right", "rear_left", "rear_right"]) {
    const joint = names.indexOf("glass_" + pane);
    const door = names.indexOf("door_" + pane);
    expect(joint).toBeGreaterThan(0);
    expect(rig.parent![joint]).toBe(Math.max(0, door));
    for (const level of mesh.lods) expect(level.bones!.includes(joint)).toBe(true);
    const translucent = fine.bones!.some((bone, i) => bone === joint &&
      glassAt(glass, fine.uvs![i * 2]!, fine.uvs![i * 2 + 1]!, 0));
    expect(translucent).toBe(true);
  }
});

test("the four rolling tyres share one baked tread and keep their rim geometry", () => {
  const fine = mesh.lods[0]!;
  const map = readPng(join(folder, "normal.png"));
  const slopes = new Set<number>();
  for (let p = 0; p < map.width * (map.height / 2); p++) {
    const at = p * map.channels;
    slopes.add((map.data[at]! << 8) | map.data[at + 1]!);
  }
  expect(slopes.size).toBeGreaterThan(256);
  expect(mesh.materials).toHaveLength(1);
  for (const end of ["front", "rear"]) for (const side of ["left", "right"]) {
    const wheel = names.indexOf(`wheel_${end}_${side}`);
    let tread = 0, rim = 0;
    for (let t = 0; t < fine.indices.length; t += 3) {
      const i = fine.indices[t]!;
      if (fine.bones![i] !== wheel) continue;
      if (fine.uvs![2 * i + 1]! <= 0.5) tread++;
      else rim++;
    }
    expect(tread).toBeGreaterThan(0);
    expect(rim).toBeGreaterThan(0);
    expect(tread + rim).toBeLessThan(3500);
  }
});
