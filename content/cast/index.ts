// Cast's catalogue, whole: what server/cast runs and the admin page shows (shared/cast/catalogue.ts says what each part is).

import type { Catalogue } from "../../shared/cast/catalogue.ts";
import { ARCHETYPES, LOOKS, NAMES } from "./people.ts";
import { REACTIONS, SCENES } from "./scenes.ts";

export const CAST_CATALOGUE: Catalogue = { archetypes: ARCHETYPES, looks: LOOKS, scenes: SCENES, reactions: REACTIONS, names: NAMES };
