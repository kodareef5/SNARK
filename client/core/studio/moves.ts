// What the wiki's studio (client/entry/studio.ts) offers a body to play: every clip it has, in groups a player knows them
// by, named for what they are. A move names its clip by where it comes from, not by the clip itself, since a creature's
// clips and the survivor's emotes come after the first frame and the objects holding them are made again then.

import type { Clip } from "../../../shared/anim/clip.ts";
import type { CreatureAnim } from "../../../shared/anim/creature.ts";
import { EMOTES, LIBRARY_EMOTES } from "../../../shared/anim/emotes.ts";
import type { HumanAnim } from "../../../shared/anim/pose.ts";
import { EMOTE_PAGES } from "../ui/emotes.ts";

/** Where a move's clip is: a creature's clip by name, a survivor's by its field, or an emote by its number. */
export type MoveSource = { rig: string } | { human: HumanClip } | { emote: number };

export interface Move {
  /** Stable within a subject: what the page's list and a link name it by. */
  key: string;
  label: string;
  source: MoveSource;
  /** Not to be had here yet: an emote whose clip comes with the art release. */
  missing?: string;
}

export interface MoveGroup {
  name: string;
  moves: Move[];
}

/** The survivor's own clips, by field, in the order they are listed. */
const HUMAN_GROUPS = [
  ["Moving", [["idle", "Idle"], ["walk", "Walk"], ["jog", "Jog"], ["sprint", "Sprint"], ["fall", "Fall"]]],
  ["Crouch and prone", [["crouchIdle", "Crouched"], ["crouchWalk", "Crouched walk"], ["proneIdle", "Prone"], ["proneCrawl", "Crawl"]]],
  ["Swimming", [["swimIdle", "Treading water"], ["swim", "Swim"]]],
  ["Fists and tools", [["jab", "Jab"], ["cross", "Cross"], ["chopA", "Chop, steep"], ["chopB", "Chop, flat"], ["pickA", "Pick, overhead"], ["pickB", "Pick, from the shoulder"], ["toolCarry", "Tool carried"], ["toolSwing", "Spear swing"], ["throwing", "Throw"]]],
  ["Bow and guns", [["bowReady", "Bow ready"], ["bowDrawn", "Bow drawn"], ["gunAimed", "Rifle aimed"], ["gunLowered", "Rifle lowered"], ["pistolAimed", "Pistol aimed"], ["pistolLowered", "Pistol lowered"]]],
] as const;
export type HumanClip = (typeof HUMAN_GROUPS)[number][1][number][0];

/** A creature's clips by group: each name in RIG_CLIPS falls in the first group that lists it; idles go first. */
const RIG_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["Moving", ["idle", "walk", "run", "turn", "jump", "fall", "land", "swim_idle", "swim", "take_off", "hover", "fly", "fly_fast", "glide", "dive", "barrel_roll"]],
  ["Fighting", ["attack", "attack_right", "attack_air", "charge_windup", "charge", "charge_stop", "impale_in", "impale_hold", "impale_out", "grab", "carry", "release"]],
  ["Calls and reactions", ["call", "startled", "startled_swim", "flinch", "land_swim"]],
  ["Plates", ["plate_switch", "plate_hardened", "plate_heavy", "plate_sharpened"]],
  ["Knocked out", ["torpor_in", "torpor_idle", "torpor_eat", "torpor_out", "torpor_out_swim", "torpor_fall"]],
  ["Death", ["death", "death_air"]],
  ["Held and carried", ["held", "carried"]],
];

/** "take_off" as "Take off", "idle_look" as "Idle: look". */
export function labelOf(name: string): string {
  const idle = /^idle_(\w+)$/.exec(name);
  const words = (idle ? `idle: ${idle[1]}` : name).replaceAll("_", " ");
  return words[0]!.toUpperCase() + words.slice(1);
}

/** Every clip a creature has, grouped, the groups in order and none empty. */
export function creatureMoves(anim: CreatureAnim): MoveGroup[] {
  const have = anim.rig.clips;
  const listed = new Set<string>();
  const groups: MoveGroup[] = [];
  for (const [name, names] of RIG_GROUPS) {
    const moves: Move[] = [];
    for (const n of names) {
      if (!have.has(n) || listed.has(n)) continue;
      listed.add(n);
      moves.push({ key: n, label: labelOf(n), source: { rig: n } });
      // A creature's idles play after its idle.
      if (n === "idle") for (const extra of [...have.keys()].filter((k) => /^idle_\w+$/.test(k)).sort()) {
        listed.add(extra);
        moves.push({ key: extra, label: labelOf(extra), source: { rig: extra } });
      }
    }
    if (moves.length) groups.push({ name, moves });
  }
  // Anything else its asset gives it, so that nothing it has is hidden.
  const rest = [...have.keys()].filter((n) => !listed.has(n)).sort();
  if (rest.length) groups.push({ name: "More", moves: rest.map((n) => ({ key: n, label: labelOf(n), source: { rig: n } })) });
  return groups;
}

/**
 * The survivor's moves: its own clips by group, then every emote by the Z menu's pages. The emotes' clips come after the
 * first frame; until they are `here` each is still on its way, and once they are, one without its clip is a motion-library
 * emote whose clip comes with the art release.
 */
export function humanMoves(anim: HumanAnim, here: boolean): MoveGroup[] {
  const groups: MoveGroup[] = [];
  for (const [name, fields] of HUMAN_GROUPS) {
    const moves = fields.filter(([f]) => anim[f] !== null).map(([f, label]): Move => ({ key: f, label, source: { human: f } }));
    if (moves.length) groups.push({ name, moves });
  }
  const placed = new Set<string>();
  for (const page of [...EMOTE_PAGES, { name: "More", tags: null }]) {
    const moves: Move[] = [];
    for (let i = 0; i < EMOTES.length; i++) {
      const e = EMOTES[i]!;
      if (placed.has(e.id) || (page.tags && !e.tags.some((t) => page.tags!.includes(t)))) continue;
      placed.add(e.id);
      const n = i + 1;
      const missing = anim.emotes[n] ? undefined : !here ? "on its way" : LIBRARY_EMOTES.has(e.id) ? "needs the art release" : "not in this build";
      moves.push({ key: `emote:${e.id}`, label: e.name, source: { emote: n }, ...(missing ? { missing } : {}) });
    }
    if (moves.length) groups.push({ name: `Emotes: ${page.name}`, moves });
  }
  return groups;
}

/** The clip of `move` for a body as it is now, or null while it has not come. */
export function clipOf(source: MoveSource, creature: CreatureAnim | null, human: HumanAnim | null): Clip | null {
  if ("rig" in source) return creature?.rig.clips.get(source.rig) ?? null;
  if ("human" in source) return human?.[source.human] ?? null;
  return human?.emotes[source.emote] ?? null;
}

/** The move a subject opens on: its idle, or the first it has. */
export function firstMove(groups: readonly MoveGroup[]): Move | null {
  for (const g of groups) for (const m of g.moves) if (m.key === "idle") return m;
  return groups[0]?.moves.find((m) => !m.missing) ?? null;
}
