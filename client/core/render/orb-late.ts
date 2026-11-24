// The orbs' screens, kept out of the script a page waits for before its first frame: the scenes' shader text, their
// twins, the frame's lanes and the pass. No map draws an orb until this has come, and the first frame needs none. The
// page fetches this file at boot without waiting for it; tests and tools import it up front. Loading it hands the pass
// to every scene and the text to the program table.

import { ORB_FRAGMENT, writeOrb } from "./orb.ts";
import { Orbs } from "./passes/orb.ts";
import { LATE } from "./programs.ts";
import { Scene } from "./scene.ts";

LATE.orb = ORB_FRAGMENT;
Scene.orb = { Orbs, writeOrb };
