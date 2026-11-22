// The cruise ship's far mesh made from its whole art, at every yaw a map may set it down at. It reads every cell of the
// ship, so it runs before a merge; landmark-far.test.ts holds the same code on made pieces and on the yacht.
import { expect } from "bun:test";
import { CRUISE } from "../../content/landmarks/cruise.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { TAU, detCos, detSin } from "../../shared/math/scalar.ts";
import { landmarkFars } from "../../shared/pack/far.ts";
import { describePack } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { HALF_SIDE } from "../../shared/world/frame.ts";
import { landmarkPoint, placeLandmark } from "../../shared/world/landmark.ts";
import { landmarkArt, landmarkPack } from "../../tools/pack/far.ts";
import { artTest } from "../fixtures/needs-art.ts";

artTest("the cruise ship's far mesh is its 475 cells at 112,964 and 48,898 triangles, in few runs of the chunks a client does not hold, near its statics at any yaw", () => {
  const art = landmarkArt(CRUISE), pack = parsePack(landmarkPack(art));
  const [far] = landmarkFars(describePack(pack, { name: "", bytes: 0 }));
  expect([far!.name, far!.pieces, pack.header.meshes[far!.mesh]!.lods.map((l) => l.indexCount / 3), art.far!.otherwise]).toEqual(["cruise", 475, [112964, 48898], []]);
  // The pieces it draws are the cells, each once.
  const defs = new Map(CRUISE.defs.map((d) => [d.id, d]));
  const cells = CRUISE.pieces.filter((p) => /:cell_\d+$/.test((defs.get(p.kind) as { mesh: string }).mesh));
  expect(Array.from({ length: far!.pieces }, (_, p) => Array.from(far!.at.subarray(p * 3, p * 3 + 3)).join(",")).sort()).toEqual(cells.map((p) => p.at.join(",")).sort());
  const origin = [2048.3, 0.25, 2047.7] as const, p = [0, 0, 0];
  let most = 0, runs = 0, cases = 0, worst = 0;
  for (const yaw of [0, 1, 3000, 9123, 16384, 20000, 40000, 50000, 61000]) {
    // Where its plain turn sets each piece, against the static the lattice frame stands it on.
    const { statics } = placeLandmark(CRUISE, origin[0], origin[1], origin[2], yaw);
    const a = (yaw / 65536) * TAU, c = detCos(a), s = detSin(a);
    CRUISE.pieces.forEach((piece, i) => {
      const [x, y, z] = piece.at, d = Math.hypot(origin[0] + c * x + s * z - statics[i]!.x, origin[1] + y - statics[i]!.y, origin[2] + c * z - s * x - statics[i]!.z);
      expect(d).toBeLessThanOrEqual((Math.hypot(x, z) * Math.SQRT1_2) / HALF_SIDE + Math.sqrt(3) / (2 * STRUCT_UNITS));
      most = Math.max(most, d);
    });
    // The pieces outside the chunks within three of a camera round the ship are few runs of the mesh.
    const chunk = Array.from({ length: far!.pieces }, (_, k) => {
      landmarkPoint(origin[0], origin[1], origin[2], yaw, [far!.at[k * 3]!, far!.at[k * 3 + 1]!, far!.at[k * 3 + 2]!], p);
      return [Math.floor(p[0]! / 64), Math.floor(p[2]! / 64)] as const;
    });
    for (let metres = 60; metres <= 700; metres += 80) for (let k = 0; k < 16; k++) {
      const cx = Math.floor((origin[0] + metres * Math.sin((k / 16) * TAU)) / 64), cz = Math.floor((origin[2] + metres * Math.cos((k / 16) * TAU)) / 64);
      const out = chunk.map(([x, z]) => Math.max(Math.abs(x - cx), Math.abs(z - cz)) > 3);
      if (out.every(Boolean) || !out.some(Boolean)) continue;
      const n = out.filter((o, q) => o && !out[q - 1]).length;
      [runs, cases, worst] = [runs + n, cases + 1, Math.max(worst, n)];
    }
  }
  expect(most).toBeLessThan(0.2);
  // 11 runs at most and 3.1 on average over 449 cameras; in the order its layout lists them, some 20 on average.
  expect(worst).toBeLessThanOrEqual(12);
  expect(runs / cases).toBeLessThan(4);
});
