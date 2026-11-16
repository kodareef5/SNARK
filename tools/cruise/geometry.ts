// Native cell triangles with their authored semantic owners. Collision modules are never substituted for art.
import type { CruiseInstance, CruiseLayout, CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { frameAxes, HALF_SIDE } from "../../shared/world/frame.ts";
import { unpackMeshes, type SourceLod } from "../pack/write.ts";
import { cruiseHash, type CruisePackedGroups } from "./packed-groups.ts";

export interface CruiseGeometrySection {
  readonly instance: CruiseInstance;
  readonly prototype: CruisePrototype;
  readonly mesh: string;
  readonly level: number;
  readonly lod: SourceLod;
  /** Native decoded vertices, posed in ship metres, shared by every section of this cell. */
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
}

function pose(positions: Float32Array, at: readonly number[], yaw: number): Float64Array {
  const axes = new Int32Array(4), origin = at.map(v => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
  frameAxes(Math.round(yaw * YAW_UNITS / 360) & (YAW_UNITS - 1), axes);
  const out = new Float64Array(positions.length);
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]!, y = positions[v + 1]!, z = positions[v + 2]!;
    out[v] = origin[0]! + (x * axes[0]! + z * axes[2]!) / HALF_SIDE;
    out[v + 1] = origin[1]! + y;
    out[v + 2] = origin[2]! + (x * axes[1]! + z * axes[3]!) / HALF_SIDE;
  }
  return out;
}

export function cruiseGeometry(layout: CruiseLayout, bytes: Uint8Array, groups?: CruisePackedGroups) {
  const pack = parsePack(bytes), meshes = unpackMeshes(pack), byId = new Map(meshes.map(m => [m.id, m]));
  const prototypes = new Map(layout.prototypes.map(p => [p.id, p]));
  const cells = new Map((layout.cells ?? []).map(c => [c.id, c]));
  if (cells.size) {
    if (!groups || groups.packSHA256 !== cruiseHash(bytes)) throw new Error("Cruise cells require ownership evidence for this native pack");
    if (groups.meshes.length !== cells.size || new Set(groups.meshes.map(m => m.id)).size !== cells.size || groups.meshes.some(m => !cells.has(m.id))) throw new Error("Cruise ownership must cover every rendered cell exactly once");
  }
  function* sections(level: number): Generator<CruiseGeometrySection> {
    for (const record of groups?.meshes ?? []) {
      const cell = cells.get(record.id)!;
      if (record.yaw !== cell.yaw || record.origin.some((v, k) => v !== cell.origin[k])) throw new Error(`${record.id}: packed ownership uses another anchor frame`);
      const mesh = byId.get(record.id), lod = mesh?.lods[level], owned = record.levels.find(l => l.level === level);
      if (!lod || !owned || owned.triangles !== lod.indices.length / 3) throw new Error(`${record.id} L${level}: missing native geometry or complete ownership`);
      const positions = pose(lod.positions, cell.origin, cell.yaw), members = new Map(cell.members.map(m => [m.instance, m]));
      let end = 0;
      for (const [first, count, owner] of owned.ranges) {
        if (first !== end || !Number.isInteger(count) || count < 1) throw new Error(`${record.id} L${level}: invalid ownership range`);
        end += count;
        const instance = layout.instances[owner], member = instance && members.get(instance.id);
        const prototype = member && prototypes.get(member.prototype);
        if (!instance?.placed || !prototype || prototype.category !== member!.category) throw new Error(`${record.id} L${level}: triangle belongs to an unauthored cell member`);
        yield { instance, prototype, mesh: mesh!.id, level, lod, positions, indices: lod.indices.subarray(first * 3, end * 3) };
      }
      if (end !== owned.triangles) throw new Error(`${record.id} L${level}: incomplete native ownership`);
    }
    // Independent door states/signs, or a small non-cell synthetic scale fixture.
    for (const instance of layout.instances) {
      if (!instance.placed) continue;
      const prototype = prototypes.get(instance.prototype);
      if (!prototype) throw new Error(`${instance.id}: unknown authored prototype`);
      if (prototype.mesh === "none" || cells.has(prototype.mesh)) continue;
      const mesh = byId.get(prototype.mesh), lod = mesh?.lods[Math.min(level, mesh.lods.length - 1)];
      if (!lod) throw new Error(`${instance.id} L${level}: missing native mesh`);
      yield { instance, prototype, mesh: mesh!.id, level, lod, positions: pose(lod.positions, instance.at, instance.yaw), indices: lod.indices };
    }
  }
  return { pack, meshes, byId, sections };
}
