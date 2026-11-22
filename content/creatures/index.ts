// One file a creature: its species and what belongs to it alone (its egg, its saddle and how the saddle is made).
// A new creature is a file here and a line below. A modelled one names a mesh and a skeleton, which its asset folder
// makes (assets/source/README.md).
//
// Stats are [base, gain per wild level, gain per level an owner gives]. The last is the raw gain times the reference
// game's default multiplier for the stat (shared/sim/genome.ts TAMED_GAIN): health 27% x 0.2 = 0.054, melee
// 10% x 0.17 = 0.017. A server's PerLevelStatsMultiplier settings scale each from there.
//
// `keeps: 4` is the reference game's: food keeps four times as long in a creature as in a survivor's hands.

import type { Def } from "../../shared/content/defs.ts";
import { CARBONEMYS } from "./carbonemys.ts";
import { REX } from "./rex.ts";
import { DODO } from "./dodo.ts";
import { GRAZER } from "./grazer.ts";
import { PARASAUR } from "./parasaur.ts";
import { PTERANODON } from "./pteranodon.ts";
import { RAPTOR } from "./raptor.ts";
import { TRIKE } from "./trike.ts";
import { STEGO } from "./stego.ts";
import { BRACHIO } from "./brachio.ts";
import { SPINO } from "./spino.ts";
import { TRILOBITE } from "./trilobite.ts";

export const CREATURES: readonly Def[] = [...DODO, ...GRAZER, ...PARASAUR, ...PTERANODON, ...RAPTOR, ...TRIKE, ...STEGO, ...CARBONEMYS, ...REX, ...SPINO, ...BRACHIO, ...TRILOBITE];
