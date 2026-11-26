// What the client knows of every asset without its bytes: its levels, its size, what it hangs on, what it is drawn
// with. Meshes, materials, inventory pictures and the clips that come later are read from the manifest, and rigs and
// the clips the first frame poses with from the boot pack, which is whole at start. A mesh whose page has not come is
// known by its id and what it hangs on alone, with as many levels as it has, each of no triangles and no error, and
// its bounds a point, until `learn`.

import { BODY_LEVEL_TOLERANCE, bodyLevelError } from "../../../content/vehicles/level-tolerance.ts";
import type { Slot } from "../../../shared/content/classes.ts";
import { meshKnown, type Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack, PackMaterial } from "../../../shared/pack/pack.ts";

const NONE: readonly number[] = [];

export class AssetTable {
  /** Meshes. A mesh is known by its index here, which is its index in the manifest. */
  readonly count: number;
  /** Triangles of each level of each mesh, finest first. Each mesh's array is filled in place when it is learned. */
  readonly tris: readonly number[][];
  /** How far, in metres, each level's surface lies from the finest level's (see PackLod). Filled in place as `tris`. */
  readonly error: readonly number[][];
  /** Body selection errors include the model's pixel allowance and share the measured array on ordinary meshes. */
  readonly bodyError: readonly number[][];
  /** The sections of each level of each mesh: a material, its first index and how many indices, for each. None on a flat level. */
  readonly sections: readonly (readonly number[])[][];
  /** The skin zones of each level of each mesh: a zone, its first index and how many indices, for each (see PackLod). None where a level is not cut by zone. */
  readonly zones: readonly (readonly number[])[][];
  /** The first level of each mesh that is flat. Every level from it on is drawn in palette colours on any tier. */
  readonly flat: Uint8Array;
  /** The materials that sections name. */
  readonly materials: readonly PackMaterial[];
  /** Radius, in metres, of a sphere about the mesh's origin that holds it. */
  readonly radius: Float32Array;
  /** How far, in metres, the mesh reaches from its origin sideways at any turn, and its lowest and highest points. */
  readonly side: Float32Array;
  /** How far its vertices reach sideways from its origin at any level, as measured when it was packed (manifest `reach`); its bounds' corner, `side`, where not measured. Never more than `side`. */
  readonly reach: Float32Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
  /** The skeleton each mesh follows, or "". */
  readonly skeleton: readonly string[];
  /** Index into the pack's rigs of the body a mesh was made on, or -1. */
  readonly rig: Int16Array;
  /** For a mesh whose every vertex follows one bone (a held item), that bone. */
  readonly bone: Uint8Array;
  /** By a rig's id, the manifest's skeleton whose clips it plays, where the boot pack does not hold them. */
  readonly skeletons: ReadonlyMap<string, number>;
  private readonly manifest: Manifest;
  private readonly index: ReadonlyMap<string, number>;
  private readonly rigs: ReadonlySet<string>;
  private readonly clips: ReadonlySet<string>;
  /** The ids of the inventory pictures, as `#icon` slots name them (shared/pack/icons.ts). */
  private readonly icons: ReadonlySet<string>;

  constructor(manifest: Manifest, boot: Pack) {
    const meshes = manifest.meshes;
    this.manifest = manifest;
    this.count = meshes.length;
    this.index = new Map(meshes.map((m, i) => [m.id, i]));
    this.tris = meshes.map((m) => m.levels.map(() => 0));
    this.error = meshes.map((m) => m.levels.map(() => 0));
    this.bodyError = meshes.map((m, i) => BODY_LEVEL_TOLERANCE[m.id] ? m.levels.map(() => 0) : this.error[i]!);
    this.sections = meshes.map((m) => m.levels.map(() => NONE));
    this.zones = meshes.map((m) => m.levels.map(() => NONE));
    this.flat = new Uint8Array(this.count);
    this.materials = manifest.materials ?? [];
    this.radius = new Float32Array(this.count);
    this.side = new Float32Array(this.count);
    this.reach = new Float32Array(this.count);
    this.low = new Float32Array(this.count);
    this.high = new Float32Array(this.count);
    this.skeleton = meshes.map((m) => m.skeleton ?? "");
    this.rig = Int16Array.from(meshes, (m) => m.rig ?? -1);
    this.bone = Uint8Array.from(meshes, (m) => m.bone ?? 0);
    this.rigs = new Set(boot.header.rigs.map((r) => r.id));
    const streamed = manifest.clips ?? [];
    this.skeletons = new Map(streamed.map((e, c) => [e.rig, c]));
    this.clips = new Set([...boot.clips.index.keys(), ...streamed.flatMap((e) => e.clips.map((c) => c.id))]);
    this.icons = new Set(Object.keys(manifest.icons?.cells ?? {}));
    meshes.forEach((m, i) => meshKnown(m) && this.learn(i));
  }

  /** Takes in what the manifest now says of a mesh whose page has come. */
  learn(mesh: number): void {
    const m = this.manifest.meshes[mesh]!;
    const tolerance = BODY_LEVEL_TOLERANCE[m.id];
    m.levels.forEach((l, k) => {
      this.tris[mesh]![k] = l.tris;
      this.error[mesh]![k] = l.error;
      if (tolerance) this.bodyError[mesh]![k] = bodyLevelError(tolerance, k, l.error);
      this.sections[mesh]![k] = l.sections ?? [];
      this.zones[mesh]![k] = l.zones ?? NONE;
    });
    this.flat[mesh] = m.flat ?? 0;
    this.radius[mesh] = Math.hypot(m.half[0], m.half[1], m.half[2]) + Math.hypot(m.center[0], m.center[1], m.center[2]);
    this.side[mesh] = Math.hypot(Math.abs(m.center[0]) + m.half[0], Math.abs(m.center[2]) + m.half[2]);
    this.reach[mesh] = Math.min(this.side[mesh]!, m.reach ?? Infinity);
    this.low[mesh] = m.center[1] - m.half[1];
    this.high[mesh] = m.center[1] + m.half[1];
  }

  /** The index of the mesh with this id, or -1. */
  find(id: string): number {
    return this.index.get(id) ?? -1;
  }

  /** Whether an asset of this kind and id exists. */
  readonly has = (asset: Slot["asset"], id: string): boolean => (asset === "mesh" ? this.index.has(id) : asset === "rig" ? this.rigs.has(id) : asset === "clip" ? this.clips.has(id) : asset === "icon" ? this.icons.has(id) : false);
}
