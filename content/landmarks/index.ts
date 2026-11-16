// Every landmark a map may place (shared/world/landmark.ts), by its name. A landmark is this line, its content file and its
// art; nothing of it is in the core content or the core pack.

import type { Landmark } from "../../shared/world/landmark.ts";
import { KORU } from "./koru.ts";

export const LANDMARKS: readonly Landmark[] = [KORU];
