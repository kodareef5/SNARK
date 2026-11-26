// The map events' stand-ins (planning/workstreams/map-events.md), drawn by client/core/mapevent/craft.ts and site.ts
// where the pack has not a look's own meshes: a turned disc of grey bands with a ring of colour region 0 under its rim
// and round its portholes, which the client sets to the craft's glow; and a cone for a beam, a wreck's smoke and a
// site's column. Both stand with +Y up and are drawn to the size the feed gives: the disc a metre round and through,
// its dome a little over, so it fills a hull; the cone from its tip at the origin to a metre round at y = 1.

import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

const STEEL = 4;
const PORCELAIN = 10;
/** Sides round a turned mesh. */
const SIDES = 32;

/** A band of a turned profile: from (r0, y0) to (r1, y1) round the Y axis, in one colour. */
type Band = readonly [r0: number, y0: number, r1: number, y1: number, color: number];

/** Bands turned round +Y as one mesh, each its own vertices so its colour is its own. Faces point outward. */
function turn(bands: readonly Band[], sides = SIDES): SourceLod {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const cs: number[] = [];
  const sn: number[] = [];
  for (let k = 0; k <= sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    cs.push(Math.cos(a));
    sn.push(Math.sin(a));
  }
  for (const [r0, y0, r1, y1, color] of bands) {
    const base = positions.length / 3;
    // (r sin a, y, r cos a) is (r cos a, r sin a, y) with its axes turned in their order, which keeps the faces' winding.
    for (let k = 0; k <= sides; k++) {
      positions.push(r0 * sn[k]!, y0, r0 * cs[k]!, r1 * sn[k]!, y1, r1 * cs[k]!);
      colors.push(color, color);
    }
    // Each band runs the profile the same way round the solid, from the middle of its underside out to the rim and in
    // over its top, so one winding faces every band out.
    for (let k = 0; k < sides; k++) {
      const a = base + k * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  return { positions: Float32Array.from(positions), colors: Uint8Array.from(colors), indices: Uint32Array.from(indices) };
}

/** A disc 22 m across and 6.4 m through in the stand-in's own measure: heights by the hull's half, 3.2 m. */
const R = 11;
const H = 3.2;
const band = (r0: number, y0: number, r1: number, y1: number, color: number): Band => [r0 / R, y0 / H, r1 / R, y1 / H, color];

/** Ids are those client/core/render/passes/map-events.ts finds. */
export function mapEventMeshes(): SourceMesh[] {
  const top: Band[] = [
    band(11, 0, 10.4, 0.55, STEEL),
    band(10.4, 0.55, 8, 1.5, STEEL),
    band(8, 1.5, 5.2, 2.2, STEEL),
    band(5.2, 2.2, 4.6, 2.35, REGION_BASE),
    band(4.6, 2.35, 3.6, 2.6, STEEL),
    band(3.6, 2.6, 2.6, 3.5, PORCELAIN),
    band(2.6, 3.5, 1.2, 4.1, PORCELAIN),
    band(1.2, 4.1, 0, 4.2, PORCELAIN),
  ];
  const under: Band[] = [
    band(0, -2.4, 2.8, -2.25, STEEL),
    band(2.8, -2.25, 3.4, -2.25, REGION_BASE),
    band(3.4, -2.25, 4.4, -2.1, REGION_BASE),
    band(4.4, -2.1, 8, -1.3, STEEL),
    band(8, -1.3, 10.2, -0.5, STEEL),
    band(10.2, -0.5, 10.6, -0.3, REGION_BASE),
    band(10.6, -0.3, 11, 0, STEEL),
  ];
  const coarse: Band[] = [band(11, 0, 5, 2.2, STEEL), band(5, 2.2, 0, 4.2, PORCELAIN), band(0, -2.4, 4.4, -2.1, REGION_BASE), band(4.4, -2.1, 11, 0, STEEL)];
  return [
    { id: "core:event_disc", lods: [turn([...top, ...under]), turn(coarse, 12)] },
    { id: "core:event_cone", lods: [turn([[0.12, 0, 1, 1, REGION_BASE]], 16)] },
  ];
}
