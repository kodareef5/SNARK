// The asset folders under assets/source, found once per test process. Tests loop over these, so a new asset is
// tested without a test naming it. An asset whose pack has not been built yet is no part of the game, and is left out.

import { existsSync } from "node:fs";
import { findAssets, type Asset } from "../../tools/art/assets.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";

export const ASSETS: readonly Asset[] = (await findAssets()).filter((a) => existsSync(a.file));

export const CREATURE_ASSETS: readonly (Asset & { spec: CreatureAsset })[] = ASSETS.flatMap((a) => (a.spec.kind === "creature" ? [{ ...a, spec: a.spec }] : []));
