// The human bodies' pack as the art cook leaves it: each MakeHuman head carries its face table, fitted to its own finest
// level, with its rows and pivots. A cook whose meshes settle on the committed ones still writes the new tables.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { meshFaces, parsePack } from "../../shared/pack/pack.ts";
import { decodeFaces, FACE_ROWS } from "../../shared/people/faces.ts";
import { FACE_COUNT } from "../../shared/anim/look.ts";
import { SOURCE } from "../../tools/art/source.ts";
import { test } from "../fixtures/needs-art.ts";

test("each sex's head in the bodies' pack holds a face table for its finest level", () => {
  const pack = parsePack(new Uint8Array(readFileSync(join(SOURCE, "core/humans/human-bodies/human-bodies.snpk"))));
  for (const id of ["core:human_m/head", "core:human_f/head"]) {
    const mesh = pack.header.meshes[pack.meshIndex.get(id)!]!;
    const bytes = meshFaces(pack, mesh);
    expect(bytes).not.toBeNull();
    const table = decodeFaces(bytes!);
    expect(table.vertexCount).toBe(mesh.lods[0]!.vertexCount);
    expect(table.modifiers.length).toBe(FACE_COUNT);
    expect(table.rows!.vertices.length).toBeGreaterThan(0);
    expect(Math.max(...table.rows!.row)).toBeLessThan(FACE_ROWS);
    expect(table.pivots!.length).toBe(9);
  }
  // Only those heads carry one.
  expect(pack.header.meshes.filter((m) => m.faces).map((m) => m.id).sort()).toEqual(["core:human_f/head", "core:human_m/head"]);
});
