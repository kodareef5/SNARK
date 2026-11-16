// Which sounds of a build the game can play with its content, so that the client's file holds those and no others. A
// sound is heard when a cue the client fires (status built or fire, shared/sound/cues.ts) finds it first for an owner
// that asks: any definition, the interface or the world. A creature's own sounds are all heard, since its idles and its
// cue sheet name them by its clips. Every vehicle is asked the vehicle cues the client fires (client/core/sound/vehicles.ts),
// falling back through its families to the shared car's.

import type { Registry } from "../content/registry.ts";
import { KEYS, candidates, vehicleFamilies, type CueKey } from "./cues.ts";

const FIRED = KEYS.filter((k) => k.cue.status === "built" || k.cue.status === "fire");
const SHARED = FIRED.filter((k) => !k.cue.on.includes("species/vehicle"));
const VEHICLE = FIRED.filter((k) => k.cue.on.includes("species/vehicle"));
/** Keys whose fallbacks name the asking owner's name, so that one with no sounds of its own may still find its own. */
const NAMED = SHARED.filter((k) => k.cue.falls.some((f) => f.includes("{name}")));

/** The ids of `ids` the game with `reg` can play. */
export function soundsHeard(ids: readonly string[], reg: Registry): Set<string> {
  const have = new Set(ids);
  const owners = new Set(ids.map((id) => id.slice(0, id.indexOf("/sound/"))));
  const out = new Set<string>();
  const ask = (owner: string, keys: readonly CueKey[], families: readonly string[] = []): void => {
    for (const k of keys) {
      const c = candidates(owner, k, families).find((c) => have.has(c.id));
      if (c) out.add(c.id);
    }
  };
  // What every owner without a sound of its own falls back to.
  for (const owner of ["core:nobody", "core:ui", "core:world"]) ask(owner, SHARED);
  for (let kind = 0; kind < reg.defs.length; kind++) {
    const d = reg.defs[kind];
    if (!d) continue;
    const v = reg.vehicle[kind];
    if (v) ask(d.id, VEHICLE, vehicleFamilies(d.id, "aliases" in d ? (d.aliases ?? []) : []));
    else ask(d.id, owners.has(d.id) ? SHARED : NAMED);
    if (d.type === "species" && d.class === "creature") for (const id of have) if (id.startsWith(`${d.id}/sound/`)) out.add(id);
  }
  return out;
}
