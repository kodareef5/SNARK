// The city kit already on the client supplies these definitions instead of the startup download.

import { BENT_SECTIONS } from "./bends.ts";
import { BREAK_BLOCKS } from "./breaks/kinds.ts";
import { LETTER_BLOCKS } from "./lettering.ts";
import { ORBS } from "./orb.ts";
import { RUIN_BLOCKS } from "./ruins.ts";
import { SLOPE_BLOCKS } from "./slopes.ts";
import { STREET } from "./street.ts";
import { TERMINALS } from "./terminals.ts";

export const WORLD_GENERATED_CONTENT = [...BREAK_BLOCKS, ...ORBS, ...RUIN_BLOCKS, ...LETTER_BLOCKS, ...SLOPE_BLOCKS, ...STREET, ...TERMINALS];
export const STUDIO_GENERATED_CONTENT = [...BREAK_BLOCKS, ...ORBS, ...BENT_SECTIONS];
