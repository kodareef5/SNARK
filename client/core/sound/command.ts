// The console's `sound` line, which this client answers itself: it lists the sounds, plays one three metres ahead,
// says which maker's takes the game plays (to hear two methods side by side where a sound has both), shows the last
// occasions heard and what became of each, lists the occasions asked for that had no sound, and plays any occasion of
// any owner as the game would.

import { KEYS, cueKey } from "../../../shared/sound/cues.ts";
import type { Sounds } from "./sounds.ts";

const AHEAD = 3;

/** The answer to a console line, or null for a line that is not this command's. */
export function soundCommand(line: string, sounds: Sounds, own: { x: number; y: number; z: number }, yaw: number, nowMs: number): string | null {
  const words = line.trim().split(/\s+/);
  if (words[0] !== "sound") return null;
  const lib = sounds.library;
  const makers = [...new Set(lib.sounds.flatMap((s) => s.takes.map((t) => t.from ?? "")).filter((f) => f !== ""))];
  if (words.length === 1) {
    const names = lib.sounds.map((s) => `${s.id} (${s.takes.map((t) => t.from ?? "?").join(" ")})`);
    return [`sound <name>: play it ${AHEAD} m ahead. sound from <${[...makers, "all"].join("|")}>: which takes the game plays (now ${sounds.from || "all"}). sound log: the last occasions. sound missing: occasions with no sound. sound cue <cue> [owner]: hear an occasion.`, ...names].join("\n");
  }
  if (words[1] === "log") return sounds.logLines().join("\n") || "nothing heard yet";
  if (words[1] === "missing") {
    const r = sounds.resolver;
    const out = KEYS.flatMap((k, i) => (r.missed[i]! > 0 ? [`${k.key}: ${r.missed[i]} of ${r.asked[i]} asked had no sound`] : []));
    return out.join("\n") || "every occasion asked for had a sound";
  }
  if (words[1] === "cue") {
    const key = words[2] ?? "";
    let k: number;
    try {
      k = cueKey(key);
    } catch {
      return `no cue ${key} in shared/sound/cues.ts`;
    }
    const owner = sounds.resolver.owner(words[3] ?? (KEYS[k]!.cue.on.includes("ui") ? "core:ui" : KEYS[k]!.cue.on.includes("world") ? "core:world" : "core:survivor"));
    const s = sounds.resolver.peek(owner, k);
    // Asked, not heard: it plays as soon as it is held, as `sound <name>` does.
    if (s >= 0) sounds.ask(s, own.x + Math.sin(yaw) * AHEAD, own.y + 0.5, own.z + Math.cos(yaw) * AHEAD, nowMs);
    return s >= 0 ? `${key} of ${sounds.resolver.owners[owner]}: ${lib.sounds[s]!.id}` : `${key} of ${sounds.resolver.owners[owner]}: no sound`;
  }
  if (words[1] === "from") {
    const who = words[2] ?? "";
    if (who !== "all" && !makers.includes(who)) return `sound from: one of ${[...makers, "all"].join(", ")}`;
    sounds.from = who === "all" ? "" : who;
    return `sounds play ${who === "all" ? "every take" : `${who}'s takes where a sound has them`}`;
  }
  const name = words[1]!;
  const s = lib.sounds.findIndex((x) => x.id === name || x.id.endsWith(`/sound/${name}`));
  if (s < 0) return `no sound ${name}; "sound" lists them`;
  sounds.ask(s, own.x + Math.sin(yaw) * AHEAD, own.y + 0.5, own.z + Math.cos(yaw) * AHEAD, nowMs);
  return `playing ${lib.sounds[s]!.id}`;
}
