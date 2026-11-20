// The far city and the city's blocks, kept out of the script a page waits for before its first frame (D873). Neither
// draws anything until the map's buildings have come, which is after the first frame anyway. The page fetches this file
// at boot without waiting for it; tests and tools import it up front. Loading it hands both to every scene.

import { CityBlocks } from "./cityblocks.ts";
import { FarCity } from "./farcity.ts";
import { Scene } from "./scene.ts";

Scene.late = { FarCity, CityBlocks };
