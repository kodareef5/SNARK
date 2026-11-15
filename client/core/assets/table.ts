// What the client knows of every asset without its bytes: its levels, its size, what it hangs on, what it is drawn
// with. Meshes and materials are read from the manifest, and rigs and clips from the boot pack, which is whole at start.

import type { Slot } from "../../../shared/content/classes.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack, PackMaterial } from "../../../shared/pack/pack.ts";

export class AssetTable {
  /** Meshes. A mesh is known by its index here, which is its index in the manifest. */
  readonly count: number;
  /** Triangles of each level of each mesh, finest first. */
  readonly tris: readonly (readonly number[])[];
  /** How far, in metres, each level's surface lies from the finest level's (see PackLod). */
  readonly error: readonly (readonly number[])[];
  /** The sections of each level of each mesh: a material, its first index and how many indices, for each. None on a flat level. */
  readonly sections: readonly (readonly (readonly number[])[])[];
  /** The first level of each mesh that is flat. Every level from it on is drawn in palette colours on any tier. */
  readonly flat: Uint8Array;
  /** The materials that sections name. */
  readonly materials: readonly PackMaterial[];
  /** Radius, in metres, of a sphere about the mesh's origin that holds it. */
  readonly radius: Float32Array;
  /** How far, in metres, the mesh reaches from its origin sideways at any turn, and its lowest and highest points. */
  readonly side: Float32Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
  /** The skeleton each mesh follows, or "". */
  readonly skeleton: readonly string[];
  /** Index into the pack's rigs of the body a mesh was made on, or -1. */
  readonly rig: Int16Array;
  /** For a mesh whose every vertex follows one bone (a held item), that bone. */
  readonly bone: Uint8Array;
  private readonly index: ReadonlyMap<string, number>;
  private readonly rigs: ReadonlySet<string>;
  private readonly clips: ReadonlyMap<string, number>;

  constructor(manifest: Manifest, boot: Pack) {
    const meshes = manifest.meshes;
    this.count = meshes.length;
    this.index = new Map(meshes.map((m, i) => [m.id, i]));
    this.tris = meshes.map((m) => m.levels.map((l) => l.tris));
    this.error = meshes.map((m) => m.levels.map((l) => l.error));
    this.sections = meshes.map((m) => m.levels.map((l) => l.sections ?? []));
    this.flat = Uint8Array.from(meshes, (m) => m.flat ?? 0);
    this.materials = manifest.materials ?? [];
    this.radius = Float32Array.from(meshes, (m) => Math.hypot(m.half[0], m.half[1], m.half[2]) + Math.hypot(m.center[0], m.center[1], m.center[2]));
    this.side = Float32Array.from(meshes, (m) => Math.hypot(Math.abs(m.center[0]) + m.half[0], Math.abs(m.center[2]) + m.half[2]));
    this.low = Float32Array.from(meshes, (m) => m.center[1] - m.half[1]);
    this.high = Float32Array.from(meshes, (m) => m.center[1] + m.half[1]);
    this.skeleton = meshes.map((m) => m.skeleton ?? "");
    this.rig = Int16Array.from(meshes, (m) => m.rig ?? -1);
    this.bone = Uint8Array.from(meshes, (m) => m.bone ?? 0);
    this.rigs = new Set(boot.header.rigs.map((r) => r.id));
    this.clips = boot.clips.index;
  }

  /** The index of the mesh with this id, or -1. */
  find(id: string): number {
    return this.index.get(id) ?? -1;
  }

  /** Whether an asset of this kind and id exists. */
  readonly has = (asset: Slot["asset"], id: string): boolean => (asset === "mesh" ? this.index.has(id) : asset === "rig" ? this.rigs.has(id) : asset === "clip" ? this.clips.has(id) : false);
}
