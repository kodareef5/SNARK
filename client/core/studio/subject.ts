// What the wiki's studio shows for a definition, and how big it is: a body (a creature, a survivor, a civilian), a vehicle,
// a structure (a building piece, or the one an item places), or an item lying on the ground. A landmark, a resource or a
// status has no one model, and is not shown.

import type { Registry } from "../../../shared/content/registry.ts";
import type { ManifestMesh } from "../../../shared/pack/manifest.ts";
import type { Bounds } from "./orbit.ts";

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
export function boundsOf(reg: Registry, s: Subject, mesh: ManifestMesh | null, scale = 1): Bounds {
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
