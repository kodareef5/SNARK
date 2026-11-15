// Load this bounded native mesh authoring source through the same explicit file boundary as tools/art/assets.ts.
// It is a measured contract, not a Blender AssetSpec, so it must not shadow the art catalogue's asset.ts discovery.
import { resolve } from "node:path";
import type { PackRig } from "../../shared/pack/pack.ts";
import type { SourceMesh } from "../pack/write.ts";

export const COMPACT_SOURCE = resolve(import.meta.dir, "../../assets/source/urban/vehicles/compact");
interface Contract { id: string; textures: { base: string; upholstery: string; runtimeTop: number } }
interface Visual { id: string; paintTint: readonly [number, number, number]; flatPaint: readonly [number, number, number] }
interface Source {
  compactMesh(visual?: Visual): SourceMesh;
  compactRig(): PackRig;
  COPPER_COMPACT: Visual;
  DETAIL_COLORS: readonly (readonly [number, number, number])[];
  DETAIL_ROUGHNESS: readonly number[];
}
export const { COMPACT } = await import(resolve(COMPACT_SOURCE, "contract.ts")) as { COMPACT: Contract };
export const { compactMesh, compactRig, COPPER_COMPACT, DETAIL_COLORS, DETAIL_ROUGHNESS } = await import(resolve(COMPACT_SOURCE, "model.ts")) as Source;
