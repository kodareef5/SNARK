// What the client says of a soul ball (server/balls.ts; planning/workstreams/soul-ball.md): the inventory's line about one,
// and the words beside the crosshair while one is in hand. The server's answer is the one that counts.

import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { CHARGED } from "../../shared/sim/items.ts";

/** A tame kept in a soul ball, as its holder is told of it (OWN_KEPT). */
export interface Kept {
  kind: number;
  level: number;
  name: string;
}

/** A species' name as a prompt writes it: its id without the pack. */
function species(reg: Registry, kind: number): string {
  const id = reg.ids[kind] ?? "";
  return id.slice(id.indexOf(":") + 1).replace(/_/g, " ");
}

/** What a kept tame is called: its name, or "the raptor" for one not named. */
export function keptName(reg: Registry, kept: Kept): string {
  return kept.name !== "" ? kept.name : `the ${species(reg, kept.kind)}`;
}

/** The charge a full ball has left by its clock `spoilAt` at `tick`, in words: "29 days left", or "held at full charge". */
export function chargeWords(spoilAt: number, tick: number): string {
  if (spoilAt === CHARGED) return "held at full charge";
  const s = Math.max(0, Math.ceil((spoilAt - tick) / TICK_RATE));
  // Whole units, rounded down, so it never says more than is left; the smallest unit that leaves a number of at least 2.
  const [n, unit] = s >= 2 * 86400 ? [Math.floor(s / 86400), "days"] : s >= 2 * 3600 ? [Math.floor(s / 3600), "hours"] : s >= 120 ? [Math.floor(s / 60), "minutes"] : [s, "s"];
  return `${n} ${unit} left`;
}

/**
 * The inventory's line about the soul ball `item` in a slot: what it holds, if the holder was told (`kept`), and the charge
 * it has left by its clock. An empty one says what it is for.
 */
export function ballInfo(reg: Registry, item: number, kept: Kept | undefined, spoilAt: number, tick: number): string {
  if (reg.ballFull[item] !== 0) return "soul ball, empty: click one of your tribe's tames to keep it";
  const what = kept ? `${kept.name !== "" ? `${kept.name}, ` : ""}${species(reg, kept.kind)}, level ${kept.level}` : "a tame";
  return `soul ball holds ${what}; ${chargeWords(spoilAt, tick)}`;
}

/** The words beside the crosshair with a full ball in hand. */
export function loosePrompt(reg: Registry, kept: Kept | undefined): string {
  return `click  loose ${kept ? keptName(reg, kept) : "the tame it holds"}`;
}
