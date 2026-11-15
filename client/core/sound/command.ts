// The console's `sound` line, which this client answers itself: it lists the sounds, plays one three metres ahead, or
// says which maker's takes the game plays, to hear two methods side by side where a sound has both.

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
    return [`sound <name>: play it ${AHEAD} m ahead. sound from <${[...makers, "all"].join("|")}>: which takes the game plays (now ${sounds.from || "all"}).`, ...names].join("\n");
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
