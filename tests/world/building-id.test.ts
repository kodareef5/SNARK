// A building's id is its footprint's place and shape (tools/mapworld/building-id.ts), not its row in the data.

import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { buildingIds } from "../../tools/mapworld/building-id.ts";
import { readBuildings } from "../../tools/mapworld/heaps.ts";

type Ring = number[][];
interface Feature { geometry: { type: string; coordinates: unknown }; properties: { id: number } }

const rect = (e: number, n: number, w: number, d: number, turn = 0): Ring => {
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const ring = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [e + u! * c - v! * s, n + u! * s + v! * c]);
  return [...ring, ring[0]!];
};
/** A ring started at another corner and wound the other way: the same footprint. */
const again = (ring: Ring, from: number, back: boolean): Ring => {
  const open = ring.slice(0, -1), turned = [...open.slice(from % open.length), ...open.slice(0, from % open.length)];
  if (back) turned.reverse();
  return [...turned, turned[0]!];
};
/** Lattice metres of a point east and north of a projection's centre, as a site gives them. */
const toLattice = (e: number, n: number): [number, number] => [70000 - e, n + 60000];

function city(): Feature[] {
  const rng = new Rng(9);
  const out: Feature[] = [];
  for (let k = 0; k < 600; k++) out.push({ properties: { id: k + 1 }, geometry: { type: "Polygon", coordinates: [rect(rng.int(8000) + rng.int(100) / 100, rng.int(8000) + rng.int(100) / 100, 6 + rng.int(40), 6 + rng.int(40), rng.int(628) / 100)] } });
  // One listed twice, two of one middle and area and other shapes, one with a court, and one of two parts.
  const twin = rect(500.25, 700.5, 20, 10);
  out.push({ properties: { id: 601 }, geometry: { type: "Polygon", coordinates: [twin] } }, { properties: { id: 602 }, geometry: { type: "Polygon", coordinates: [twin.map((p) => [...p])] } });
  out.push({ properties: { id: 603 }, geometry: { type: "Polygon", coordinates: [rect(900, 900, 20, 10)] } }, { properties: { id: 604 }, geometry: { type: "Polygon", coordinates: [rect(900, 900, 10, 20)] } });
  out.push({ properties: { id: 605 }, geometry: { type: "Polygon", coordinates: [rect(1200, 300, 40, 40), rect(1200, 300, 10, 10)] } });
  out.push({ properties: { id: 606 }, geometry: { type: "MultiPolygon", coordinates: [[rect(2000, 2000, 12, 12)], [rect(2030, 2000, 12, 12)]] } });
  return out;
}

/** Each footprint's id by its outer ring's corners, sorted: what tells a footprint whatever row it is. */
function byShape(features: Feature[]): Map<string, number[]> {
  const buildings = readBuildings({ features }, toLattice);
  const ids = buildingIds(buildings, toLattice);
  const out = new Map<string, number[]>();
  buildings.forEach((b, k) => {
    const key = b.rings.map((ring) => ring.slice(0, -1).map((p) => `${p[0]!.toFixed(3)},${p[1]!.toFixed(3)}`).sort().join(" ")).join(" | ");
    out.set(key, [...(out.get(key) ?? []), ids[k]!].sort((a, b) => a - b));
  });
  return out;
}

test("a building's id does not change when the data's rows are shuffled and renumbered", () => {
  const first = city();
  const rng = new Rng(77);
  const shuffled = first.map((f, k) => ({ f, at: rng.int(1 << 30), k })).sort((a, b) => a.at - b.at).map(({ f }, k): Feature => {
    const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
    // Another row number, and each ring from another corner, wound the other way in every other one.
    const turned = polys.map((rings) => rings.map((ring) => again(ring, 1 + (k % 3), k % 2 === 0)));
    return { properties: { id: 90000 - k * 7 }, geometry: { type: f.geometry.type, coordinates: f.geometry.type === "Polygon" ? turned[0] : turned } };
  });
  const [was, now] = [byShape(first), byShape(shuffled)];
  expect(was.size).toBe(606);
  expect([...now].sort()).toEqual([...was].sort());
  // The same city moved a frame: built as a cut or widened, a footprint stands at the same lattice place and keeps its id.
  expect(buildingIds(readBuildings({ features: first }, toLattice).slice(40, 90), toLattice)).toEqual(buildingIds(readBuildings({ features: first }, toLattice), toLattice).slice(40, 90));
});

test("two buildings never share an id, a footprint listed twice among them", () => {
  const buildings = readBuildings({ features: city() }, toLattice);
  const ids = buildingIds(buildings, toLattice);
  expect(new Set(ids).size).toBe(ids.length);
  expect(buildings.map((b) => b.id)).toEqual(ids);
  expect(ids.every((id) => Number.isInteger(id) && id >= 0 && id < 2 ** 48)).toBe(true);
  // The twins differ, and so do the two of one middle and area; a footprint moved a metre is another building.
  const of = (row: number): number[] => buildings.flatMap((b, k) => (b.row === row ? [ids[k]!] : []));
  expect([of(601)[0] !== of(602)[0], of(603)[0] !== of(604)[0], of(606).length]).toEqual([true, true, 2]);
  const moved = buildingIds(readBuildings({ features: [{ properties: { id: 1 }, geometry: { type: "Polygon", coordinates: [rect(501.25, 700.5, 20, 10)] } }] }, toLattice), toLattice);
  expect(ids.includes(moved[0]!)).toBe(false);
});
