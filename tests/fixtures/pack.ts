// The core asset pack, built once per test process.

import { HumanAnim } from "../../shared/anim/pose.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";

let pack: Pack | null = null;
let anim: HumanAnim | null = null;

export function corePack(): Pack {
  return (pack ??= parsePack(buildCorePack()));
}

/** The humanoid clips of the core pack. */
export function coreAnim(): HumanAnim {
  return (anim ??= new HumanAnim(corePack().clips));
}
