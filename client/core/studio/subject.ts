// What the wiki's studio shows for a definition, and how big it is: a body (a creature, a survivor, a civilian), a vehicle,
// a structure, a mesh from the game or the placed pieces of a landmark.

import type { StructureDef } from "../../../shared/content/defs.ts";
import type { LandmarkPiece } from "../../../shared/world/landmark.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { ManifestMesh } from "../../../shared/pack/manifest.ts";
import type { Bounds } from "./orbit.ts";
import { MAX_STRUCTURE_HALF } from "../../../shared/content/kinds/shapes.ts";

export type MeshBox = Pick<ManifestMesh, "center" | "half">;

interface ModelBase {
  id: string;
  label: string;
  meshes: readonly string[];
  box?: MeshBox;
}

/** A wiki article's subject, written with the page from the game build. */
export type StudioStructure = Pick<StructureDef, "id" | "mesh" | "color" | "colors" | "made" | "under">;

export type WikiModel = ModelBase & (
  | { kind: "content"; target: string }
  | { kind: "mesh"; color: number }
  | { kind: "landmark"; name: string; structures: readonly StudioStructure[]; pieces: readonly LandmarkPiece[]; bounds?: Bounds }
);

/** A static used only for presenting an authored loose mesh. Its camera uses the mesh's true bounds. */
export function studioStatic(id: string, mesh: ManifestMesh, color: number): StructureDef {
  const half = (side: number): number => Math.min(MAX_STRUCTURE_HALF, Math.max(0.05, Math.abs(mesh.center[side]!) + mesh.half[side]!));
  return { type: "structure", class: "static", id, mesh: mesh.id, color, half: [half(0), half(1), half(2)], hp: 1 };
}

/** The bounds of all drawn pieces at their modelled offsets and angles. */
export function landmarkBounds(pieces: readonly LandmarkPiece[], meshes: ReadonlyMap<string, MeshBox>): Bounds | null {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const p of pieces) {
    const m = meshes.get(p.kind);
    if (!m) continue;
    const a = p.yaw / 65536 * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const center = [p.at[0] + c * m.center[0] + s * m.center[2], p.at[1] + m.center[1], p.at[2] - s * m.center[0] + c * m.center[2]];
    const half = [Math.abs(c) * m.half[0] + Math.abs(s) * m.half[2], m.half[1], Math.abs(s) * m.half[0] + Math.abs(c) * m.half[2]];
    for (let i = 0; i < 3; i++) {
      low[i] = Math.min(low[i]!, center[i]! - half[i]!);
      high[i] = Math.max(high[i]!, center[i]! + half[i]!);
    }
  }
  if (!Number.isFinite(low[0])) return null;
  const middle = (i: number): number => (low[i]! + high[i]!) / 2;
  return { x: middle(0), y: middle(1), z: middle(2), radius: Math.hypot(...high.map((n, i) => (n - low[i]!) / 2)) };
}

export type SubjectKind = "creature" | "survivor" | "vehicle" | "structure" | "item";

export interface Subject {
  kind: SubjectKind;
  /** The content index drawn: the species, the structure placed, or the item lying. */
  index: number;
  /** The definition asked for, which may be the item that places `index`. */
  asked: number;
  label: string;
}

/** The subject for content id `id`, or null where it has none. */
export function subjectOf(reg: Registry, id: string): Subject | null {
  const asked = reg.index.get(id);
  const d = asked === undefined ? undefined : reg.defs[asked];
  if (!d || asked === undefined) return null;
  const label = "name" in d && typeof d.name === "string" ? d.name : id;
  if (d.type === "species") {
    if (d.class === "target") return null;
    const kind: SubjectKind = d.skeleton === "human" ? "survivor" : reg.vehicle[asked] ? "vehicle" : "creature";
    return { kind, index: asked, asked, label };
  }
  if (d.type === "structure") return d.mesh === "none" ? null : { kind: "structure", index: asked, asked, label };
  if (d.type === "item") {
    // An item that places a structure is shown as what it places, standing.
    for (const s of d.places ?? []) {
      const k = reg.index.get(s);
      const placed = k === undefined ? undefined : reg.defs[k];
      if (k !== undefined && placed?.type === "structure" && placed.mesh !== "none") return { kind: "structure", index: k, asked, label };
    }
    return { kind: "item", index: asked, asked, label };
  }
  return null;
}

/**
 * A ball holding the subject as it stands at the origin on flat ground: from its mesh's box where the manifest has one, else
 * from the definition's own size. `scale` is a body's size.
 */
export function boundsOf(reg: Registry, s: Subject, mesh: MeshBox | null, scale = 1): Bounds {
  const d = reg.defs[s.index]!;
  if (mesh && mesh.half.some((h) => h > 0)) {
    const [cx, cy, cz] = mesh.center, [hx, hy, hz] = mesh.half;
    return { x: cx * scale, y: cy * scale, z: cz * scale, radius: Math.hypot(hx, hy, hz) * scale };
  }
  if (d.type === "species") {
    const h = d.height * scale;
    return { x: 0, y: h / 2, z: 0, radius: Math.max(h / 2, d.radius * scale * 2) };
  }
  if (d.type === "structure" && d.half) return { x: 0, y: d.half[1], z: 0, radius: Math.hypot(d.half[0], d.half[1], d.half[2]) };
  return { x: 0, y: 0.15, z: 0, radius: 0.35 };
}
