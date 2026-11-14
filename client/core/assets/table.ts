// What the client knows of every asset without its bytes: its levels, its size, what it hangs on. Today this is read
// from the whole pack. When assets stream it is read from a manifest, and nothing that uses the table changes.

import type { Slot } from "../../../shared/content/classes.ts";
import { lodVertices, type Pack } from "../../../shared/pack/pack.ts";

export class AssetTable {
  /** Meshes. A mesh is known by its index here, which is its index in the pack. */
  readonly count: number;
  /** Triangles of each level of each mesh, finest first. */
  readonly tris: readonly (readonly number[])[];
  /** Radius, in metres, of a sphere about the mesh's origin that holds it. */
  readonly radius: Float32Array;
  /** The skeleton each mesh follows, or "". */
  readonly skeleton: readonly string[];
  /** Index into the pack's rigs of the body a mesh was made on, or -1. */
  readonly rig: Int16Array;
  /** For a mesh whose every vertex follows one bone (a held item), that bone. */
  readonly bone: Uint8Array;
  private readonly index: ReadonlyMap<string, number>;
  private readonly rigs: ReadonlySet<string>;
  private readonly clips: ReadonlyMap<string, number>;

  constructor(pack: Pack) {
    const meshes = pack.header.meshes;
    this.count = meshes.length;
    this.index = pack.meshIndex;
    this.tris = meshes.map((m) => m.lods.map((l) => l.indexCount / 3));
    this.radius = Float32Array.from(meshes, (m) => Math.hypot(m.half[0], m.half[1], m.half[2]) + Math.hypot(m.center[0], m.center[1], m.center[2]));
    this.skeleton = meshes.map((m) => m.skeleton ?? "");
    this.rig = Int16Array.from(meshes, (m) => m.rig ?? -1);
    // Every vertex of a one-bone mesh names the same bone, so the first vertex says which.
    this.bone = Uint8Array.from(meshes, (m) => (m.skeleton !== undefined && m.lods[0]!.vertexCount > 0 ? lodVertices(pack, m.lods[0]!)[7]! : 0));
    this.rigs = new Set(pack.header.rigs.map((r) => r.id));
    this.clips = pack.clips.index;
  }

  /** The index of the mesh with this id, or -1. */
  find(id: string): number {
    return this.index.get(id) ?? -1;
  }

  /** Whether an asset of this kind and id exists. */
  readonly has = (asset: Slot["asset"], id: string): boolean => (asset === "mesh" ? this.index.has(id) : asset === "rig" ? this.rigs.has(id) : asset === "clip" ? this.clips.has(id) : false);
}
