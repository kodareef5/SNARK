// What the client knows of every asset without its bytes: its levels, its size, what it hangs on. Meshes are read from
// the manifest, and rigs and clips from the boot pack, which is whole at start.

import type { Slot } from "../../../shared/content/classes.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";

export class AssetTable {
  /** Meshes. A mesh is known by its index here, which is its index in the manifest. */
  readonly count: number;
  /** Triangles of each level of each mesh, finest first. */
  readonly tris: readonly (readonly number[])[];
  /** How far, in metres, each level's surface lies from the finest level's (see PackLod). */
  readonly error: readonly (readonly number[])[];
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

  constructor(manifest: Manifest, boot: Pack) {
    const meshes = manifest.meshes;
    this.count = meshes.length;
    this.index = new Map(meshes.map((m, i) => [m.id, i]));
    this.tris = meshes.map((m) => m.levels.map((l) => l.tris));
    this.error = meshes.map((m) => m.levels.map((l) => l.error));
    this.radius = Float32Array.from(meshes, (m) => Math.hypot(m.half[0], m.half[1], m.half[2]) + Math.hypot(m.center[0], m.center[1], m.center[2]));
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
