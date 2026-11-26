// Cast's state: the people it keeps (characters), what they are doing (stories), where things happen (spots), and how
// lively each part of the map should be (regions). Plain data, saved as JSON (server/cast/store.ts) and shown on the
// admin page. Bodies in the world are only ever a story's people near players; everything else is this.

import type { Tier, Traits } from "./catalogue.ts";

/** A fact about a character. A locked one was seen by a player and is never rewritten (Watch Dogs: Legion's rule). */
export interface Fact {
  text: string;
  /** World tick it became true. */
  t: number;
  locked?: boolean;
}

/** What a character thinks of one player: -1 hostile to 1 friendly, and what passed between them. */
export interface Relation {
  stance: number;
  /** Times they met. */
  met: number;
  last: number;
  notes: string[];
}

/**
 * A person's body as it was drawn, kept for good once a player has met it or it is featured: drawn again from this, never
 * from a population or outfit that an admin may have edited since.
 */
export interface KeptPerson {
  /** Its look's bytes, in base64. */
  look: string;
  /** The seed form it was drawn from: its population by content id or store id. Sent in place of the bytes while that
   * revision still gives them. */
  born?: { seed: number; population: string | number; revision: number };
  /** Armour pieces put on, by item id. */
  wear: string[];
  /** One entry a wardrobe slot: the garment by item id, its edition and its dye as one number; or null. */
  wardrobe: ([string, number, number] | null)[];
  /** The revision of the named person it was drawn from. */
  rev?: number;
}

export interface Character {
  /** "c" and a number, never reused. */
  id: string;
  tier: Tier;
  archetype: string;
  look: string;
  name: string;
  /** The seed the rest of an extra is drawn from: promoted, its life is drawn and kept. */
  seed: number;
  traits: Traits;
  /** The region it belongs to, by index. */
  home: number;
  /** A featured one's life: a line of flavour each, grown by the planner from the archetype's tags. */
  want?: string;
  struggle?: string;
  hope?: string;
  facts: Fact[];
  /** By player name. */
  relations: Record<string, Relation>;
  /** The story it is in, if any. */
  story?: string;
  /** World tick the keeper last looked at it (the hourly pass takes the longest untouched first). */
  touched: number;
  /** Dead in the world: it stays for the memory of it, and is never cast again. */
  dead?: boolean;
  /** The named person of the people store it plays, by store id. */
  person?: number;
  kept?: KeptPerson;
}

/** What an admin chose of who Cast's people are, over the catalogue: kept with Cast's save. */
export interface Casting {
  /** A look's people drawn from an admin population and dressed in an admin outfit, each by store id. */
  looks: Record<string, { population?: number; outfit?: number }>;
  /** A role (`scene/role`) whose first body is a named person, by store id. */
  roles: Record<string, number>;
}

export type Phase = "planned" | "entering" | "active" | "leaving" | "done";
export const PHASES: readonly Phase[] = ["planned", "entering", "active", "leaving", "done"];

/** One person in a story: who plays which role, and where in its script it is. */
export interface Part {
  character: string;
  role: string;
  /** Index into the role's script. */
  step: number;
  /** World tick the current step began. */
  since: number;
  /** In the world now: its entity's pid, while it has a body. */
  pid?: number;
  /** Arrived and gone. */
  gone?: boolean;
}

export interface Story {
  /** "s" and a number. */
  id: string;
  scene: string;
  /** The spot it happens at, by index, and where that is. */
  spot: number;
  x: number;
  z: number;
  region: number;
  phase: Phase;
  parts: Part[];
  /** The scene's choices as made (by the planner or the rules): name → option. */
  choices: Record<string, string>;
  /** Short slots the planner filled (a motive, a name, what they argue about), each a short line. */
  slots: Record<string, string>;
  /** Players it is meant for (near when it began), and players who engaged with its people. */
  for: string[];
  engaged: string[];
  /** 0 to 1: how much it matters (players engaged, someone hurt, a featured person in it). */
  importance: number;
  /** World ticks: made, phase began, last looked at by the planner. */
  made: number;
  since: number;
  planned: number;
  /** What happened, a short line each, oldest first; kept short. */
  history: string[];
  /** A story that must wake at this world tick whatever the pace (police coming to trouble). */
  due?: number;
}

/** A place: what it is, how many it holds at once, and, for a queue, its line. */
export interface Spot {
  x: number;
  z: number;
  tags: string[];
  /** People at once. */
  cap: number;
  /** A queue: the way the line runs from its head (radians, as shared/cast/queue.ts has it), the metres between people
   * in it, and seconds to serve each. */
  queue?: { yaw: number; spacing: number; serve: number };
  /** A name, for an authored or landmark spot. */
  name?: string;
}

/** The pacing of one region (Left 4 Dead's director, per area): quiet, building, at a peak, fading. */
export type Pace = "relax" | "build" | "peak" | "fade";
export const PACES: readonly Pace[] = ["relax", "build", "peak", "fade"];

export interface Region {
  /** Player presence: an average of players in it, decaying over hours, so a well-played part of the map stays lively. */
  heat: number;
  /** Players in it now. */
  players: number;
  pace: Pace;
  /** World tick the pace changes next. */
  next: number;
  /** Background people it holds offscreen, not yet anyone (the count Left 4 Dead keeps per area). */
  extras: number;
  /** Scene id → world tick it may run here again. */
  cooldowns: Record<string, number>;
}

/** The knobs (server settings, the admin page). */
export interface CastSettings {
  enabled: boolean;
  /** Stories kept at most, running and waiting. */
  size: number;
  /** 0 (nothing happens) to 2 (busy); 1 is the middle. */
  activity: number;
  /** 0 (even) to 1 (long quiet, sharp peaks). */
  spikiness: number;
  maxBodies: number;
  maxPerPlayer: number;
  /** Bodies a crowd scene may have at once. */
  crowdMax: number;
  /** 0 never fights, 1 fights back, 2 may start one. */
  hostility: number;
  /** Seconds between hostile scenes for the same player. */
  hostileCooldown: number;
  /** The model the planner asks; empty for rules only. */
  model: string;
  callsPerHour: number;
  /** Stories and characters the hourly pass takes. */
  hourlyBatch: number;
}

export const DEFAULT_SETTINGS: CastSettings = {
  enabled: true, size: 300, activity: 1, spikiness: 0.6, maxBodies: 120, maxPerPlayer: 14, crowdMax: 200,
  hostility: 2, hostileCooldown: 1200, model: "anthropic/claude-haiku-5.5", callsPerHour: 90, hourlyBatch: 50,
};
