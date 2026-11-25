// The jet's code, kept out of the script a page waits for before its first frame: its flight and shapes (the family's
// code, given to its row as it loads), what moves on it as it is drawn, its missiles' smoke and its glass. Fetched the
// first time a page meets a jet (jet-load.ts); tests and tools that fly or draw one import it up front.

import "../../shared/sim/families/jet.ts";
import { FIGHTER } from "./hud/fighter.ts";
import { JET_CODE } from "./jet-load.ts";
import { MissileTrail } from "./missile-trail.ts";
import { JetParts } from "./render/jet-parts.ts";

JET_CODE.code = { parts: () => new JetParts(), trail: () => new MissileTrail(), fighter: FIGHTER };
