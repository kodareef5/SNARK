// The asset folders under assets/source, found once per test process. Tests loop over these, so a new asset is
// tested without a test naming it.

import { findAssets, type Asset } from "../../tools/art/assets.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";

export const ASSETS: readonly Asset[] = await findAssets();

export const CREATURE_ASSETS: readonly (Asset & { spec: CreatureAsset })[] = ASSETS.flatMap((a) => (a.spec.kind === "creature" ? [{ ...a, spec: a.spec }] : []));
