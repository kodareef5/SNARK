// How far the catalogue (shared/sound/cues.ts) is covered by the sounds of a build: for each occasion, the shared sound
// any owner falls back to, the owners with a sound of their own, and so whether it is heard at all. The sound board
// (client/sound/board.ts) draws this, and `bun run sounds` prints it.

import { KEYS, candidates, type CueKey } from "../../../shared/sound/cues.ts";

/** An owner with no sounds of its own: what it is heard by is what every owner of its class falls back to. */
const NOBODY = "core:nobody";

export interface CoverageRow {
  key: string;
  cue: CueKey["cue"];
  /** The sound any owner falls back to, and the rate it plays at; null where there is none. */
  shared: string | null;
  rate: number;
  /** Owners that have a sound of their own for it: by its name, or by a name its fallbacks give `{owner}`. */
  owners: string[];
}

export interface Coverage {
  rows: CoverageRow[];
  /** Occasions heard through a shared sound, only by some owners' own, and not at all; and of those not at all, how many wait on a feature. */
  shared: number;
  ownOnly: number;
  silent: number;
  silentWaiting: number;
  /** Every owner with a sound, and its sounds' names. */
  owners: Map<string, string[]>;
}

/** The coverage of the catalogue by sounds with these ids (`core:dodo/sound/call`). */
export function coverage(ids: readonly string[]): Coverage {
  const have = new Set(ids);
  const owners = new Map<string, string[]>();
  for (const id of ids) {
    const at = id.indexOf("/sound/");
    if (at < 0) continue;
    const o = id.slice(0, at);
    owners.set(o, [...(owners.get(o) ?? []), id.slice(at + 7)]);
  }
  const rows: CoverageRow[] = [];
  let shared = 0;
  let ownOnly = 0;
  let silent = 0;
  let silentWaiting = 0;
  for (const k of KEYS) {
    const fallback = candidates(NOBODY, k).find((c) => !c.id.startsWith(`${NOBODY}/`) && have.has(c.id));
    const own: string[] = [];
    for (const o of owners.keys()) {
      const mine = candidates(o, k).filter((c) => c.id.startsWith(`${o}/sound/`));
      if (mine.some((c) => have.has(c.id)) && !candidates(NOBODY, k).some((c) => c.id.startsWith(`${o}/sound/`))) own.push(o);
    }
    rows.push({ key: k.key, cue: k.cue, shared: fallback?.id ?? null, rate: fallback?.rate ?? 1, owners: own });
    if (fallback) shared++;
    else if (own.length > 0) ownOnly++;
    else {
      silent++;
      if (k.cue.status.startsWith("waits:")) silentWaiting++;
    }
  }
  return { rows, shared, ownOnly, silent, silentWaiting, owners };
}

/** The coverage in a few lines, for a terminal or a commit message. */
export function coverageLines(c: Coverage, all = false): string[] {
  const out = [`${c.rows.length} occasions: ${c.shared} heard through a shared sound, ${c.ownOnly} only by owners of their own, ${c.silent} silent (${c.silentWaiting} of them wait on a feature); ${c.owners.size} owners have sounds.`];
  for (const r of c.rows) {
    if (!all && (r.shared || r.owners.length > 0 || r.cue.status.startsWith("waits:"))) continue;
    out.push(`  ${r.shared ? "heard " : r.owners.length > 0 ? "owners" : "SILENT"}  ${r.key.padEnd(28)} ${r.cue.status.padEnd(16)} ${r.shared ?? ""}${r.owners.length > 0 ? ` own: ${r.owners.join(" ")}` : ""}`);
  }
  return out;
}
