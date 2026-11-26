// The page loads city meshes and distant shadows after drawing its first frame. Tools can load them up front.
import { CityBlocks } from "./cityblocks.ts";
import { FarCity } from "./farcity.ts";
import { FarLandmarks } from "./farlandmarks.ts";
import { FarShadow } from "./farshadow.ts";
import { NearCity } from "./nearcity.ts";
import { RoofMap } from "./roofmap.ts";
import { Scene } from "./scene.ts";

export const cityRenderers = { CityBlocks, FarCity, FarLandmarks, FarShadow, NearCity, RoofMap };
Scene.late = cityRenderers;
