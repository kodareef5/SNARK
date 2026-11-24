// The studio opens the same authored assets the wiki used for its picture.

import { landmarkBounds, type MeshBox, type StudioStructure, type WikiModel } from "../../client/core/studio/subject.ts";
import type { Def } from "../../shared/content/defs.ts";
import type { ManifestMesh } from "../../shared/pack/manifest.ts";
import type { Landmark } from "../../shared/world/landmark.ts";
import { partHash } from "../pack/manifest.ts";
import type { Entry } from "./catalogue.ts";
import { BASE, slug } from "./html.ts";

interface ModelFile {
  file: string;
  data: string;
  descriptor: string;
  url: string;
}

export function wikiModels(entries: readonly Entry[], defs: readonly Def[], landmarks: readonly Landmark[], builtMeshes: readonly ManifestMesh[] = []): Map<string, ModelFile> {
  const boxes = new Map(builtMeshes.map(({ id, center, half }) => [id, { center, half }]));
  const byId = new Map(defs.map((d) => [d.id, d]));
  const places = new Map(landmarks.map((land) => [land.name, land]));
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const modelOf = (entry: Entry): WikiModel | null => {
    const { id, label, picture } = entry;
    if (!picture?.meshes.length) return null;
    const { meshes } = picture;
    const d = byId.get(id);
    const land = places.get(id);
    if (entry.kind === "landmarks" && land) {
      const art = new Set(meshes);
      const structures = new Map<string, StudioStructure>();
      for (const d of land.defs) {
        if (d.type !== "structure" || !art.has(d.mesh)) continue;
        const { id, mesh, color, colors, made, under } = d;
        structures.set(id, { id, mesh, color, colors, made, under });
      }
      const pieces = land.pieces.filter((p) => structures.has(p.kind));
      const placedBoxes = new Map<string, MeshBox>();
      for (const [id, { mesh }] of structures) {
        const box = boxes.get(mesh);
        if (box) placedBoxes.set(id, box);
      }
      const bounds = landmarkBounds(pieces, placedBoxes) ?? undefined;
      return { id, label, kind: "landmark", meshes, name: land.name, structures: [...structures.values()], pieces, bounds };
    }
    if (d?.type === "species") return { id, label, kind: "content", target: id, meshes };
    if (d?.type === "item") {
      const deployed = d.deploys && entriesById.get(d.deploys);
      if (deployed && deployed.picture?.meshes.length) return { id, label, kind: "content", target: deployed.id, meshes: deployed.picture.meshes };
      const placed = d.places?.map((s) => byId.get(s)).find((s) => s?.type === "structure" && s.mesh !== "none");
      if (placed?.type === "structure") {
        const mesh = placed.mesh === "shape" || placed.mesh === "box" ? placed.id : placed.mesh;
        if (meshes.includes(mesh)) return { id, label, kind: "content", target: placed.id, meshes: [mesh] };
      }
      return { id, label, kind: "mesh", meshes: [meshes[0]!], color: picture.colors[0] ?? 15 };
    }
    if (d?.type === "node") return { id, label, kind: "mesh", meshes: [meshes[0]!], color: d.color };
    return null;
  };

  const out = new Map<string, ModelFile>();
  for (const entry of entries) {
    const model = modelOf(entry);
    if (!model) continue;
    if (model.kind !== "landmark" && model.meshes.length === 1) model.box = boxes.get(model.meshes[0]!);
    const data = JSON.stringify(model);
    const file = `media/model-${slug(entry.id).replaceAll("/", "-")}.${partHash(new TextEncoder().encode(data))}.json`;
    const descriptor = `${BASE}${file}`;
    const url = `/studio.html?id=${encodeURIComponent(entry.id)}&model=${encodeURIComponent(descriptor)}`;
    out.set(entry.id, { file, data, descriptor, url });
  }
  return out;
}
