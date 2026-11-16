// The actual delivered map-local asset, with exact authored-to-native face ownership.
import { readFileSync } from "node:fs";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { frameAxes, HALF_SIDE } from "../../shared/world/frame.ts";
import { cruiseGeometry, type CruiseGeometrySection } from "../../tools/cruise/geometry.ts";
import { verifyCruiseGroups, type CruisePackedGroups } from "../../tools/cruise/packed-groups.ts";
import type { SourceLod } from "../../tools/pack/write.ts";

export const cruiseArtBytes = readFileSync(new URL("../../assets/source/landmarks/cruise/cruise.snpk", import.meta.url));
export const cruiseArtGroups: CruisePackedGroups = JSON.parse(readFileSync(new URL("../../assets/source/landmarks/cruise/ref/packed-groups.json", import.meta.url), "utf8"));
verifyCruiseGroups(cruiseArtGroups, readFileSync(new URL("../../content/landmarks/cruise-layout.json", import.meta.url)), cruiseArtBytes);
export const cruiseArt = cruiseGeometry(CRUISE_LAYOUT, cruiseArtBytes, cruiseArtGroups);
const cache = new Map<number, readonly CruiseGeometrySection[]>();
export function cruiseArtSections(level: number): readonly CruiseGeometrySection[] {
  let sections = cache.get(level);
  if (!sections) { sections = [...cruiseArt.sections(level)]; cache.set(level, sections); }
  return sections;
}

/** Put only this fragment's vertices back into the owner's native frame for aperture/cap tests. */
export function cruiseOwnerLod(section: CruiseGeometrySection): SourceLod {
  const { instance } = section, origin = instance.at.map(v => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS), axes = new Int32Array(4);
  frameAxes(Math.round(instance.yaw * YAW_UNITS / 360) & (YAW_UNITS - 1), axes);
  const determinant = axes[0]! * axes[3]! - axes[1]! * axes[2]!;
  // A cell can contain hundreds of owners. Copying its whole vertex buffer for each
  // range would turn a small floor or furniture check into repeated work on the room.
  const vertices = new Map<number, number>();
  const indices = Uint32Array.from(section.indices, v => {
    let index = vertices.get(v);
    if (index === undefined) { index = vertices.size; vertices.set(v, index); }
    return index;
  });
  const positions = new Float32Array(vertices.size * 3), colors = new Uint8Array(vertices.size);
  for (const [vertex, index] of vertices) {
    const v = vertex * 3, out = index * 3;
    const x = section.positions[v]! - origin[0]!, z = section.positions[v + 2]! - origin[2]!;
    positions[out] = HALF_SIDE * (x * axes[3]! - z * axes[2]!) / determinant;
    positions[out + 1] = section.positions[v + 1]! - origin[1]!;
    positions[out + 2] = HALF_SIDE * (z * axes[0]! - x * axes[1]!) / determinant;
    colors[index] = section.lod.colors[vertex]!;
  }
  return { positions, colors, indices };
}
