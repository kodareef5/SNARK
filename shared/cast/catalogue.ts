// Cast's catalogue: who the city's people are and what they do, as data. Archetypes (a kind of person), looks (what one
// wears), scenes (an activity with roles and a short script for each), reaction tables (what a person does when a
// player comes close, stares, waves, talks, shoots). The engine (server/cast) runs any of it; teams add to it here and
// in content/cast without touching the engine. An entry marked `placeholder` stands in for art or behaviour still to
// come: it has its id and works with what exists (planning/workstreams/cast.md).

/** Persistent and named (a cop with a beat, the gang member who drew on you), or anonymous background, promoted to
 * featured the moment a player engages one. Players are the leads and grunt's bots the second billing. */
export type Tier = "featured" | "extra";

/** What a scene needs of the engine and the world. A scene whose needs are not all met is never cast. */
export type Capability = "walk" | "drive" | "weapon" | "queue" | "emote" | "speech";
export const CAPABILITIES: readonly Capability[] = ["walk", "drive", "weapon", "queue", "emote", "speech"];

/** What a spot is: where a scene may take place, or a person stand. */
export type SpotTag =
  | "sidewalk" | "corner" | "plaza" | "beach" | "park" | "storefront" | "bench" | "parking" | "road" | "landmark" | "spawn"
  | "beat" | "queue" | "cart" | "quiet" | "busy";
export const SPOT_TAGS: readonly SpotTag[] = ["sidewalk", "corner", "plaza", "beach", "park", "storefront", "bench", "parking", "road", "landmark", "spawn", "beat", "queue", "cart", "quiet", "busy"];

/** What a scene is like, for pacing and for the planner: calm and social fill the relax, tense and hostile the peaks. */
export type SceneTag = "calm" | "social" | "tense" | "hostile" | "crowd" | "comic" | "sad" | "busy" | "vehicle";
export const SCENE_TAGS: readonly SceneTag[] = ["calm", "social", "tense", "hostile", "crowd", "comic", "sad", "busy", "vehicle"];

/** A person's leanings, 0 to 1: few on purpose, so a scene's rules can weigh them. */
export interface Traits {
  /** Keeps its head; low panics. */
  calm: number;
  /** Greets, chats, answers. */
  social: number;
  /** Stands its ground, confronts; low gives way. */
  bold: number;
  /** Jokes, dances, plays along. */
  playful: number;
}
export const TRAIT_NAMES: readonly (keyof Traits)[] = ["calm", "social", "bold", "playful"];

/** What one wears and looks like. `mesh` is the body (the human's until other models come); `wear` are items put on
 * from the game's own (cloth, hide, flak pieces), or none for an outfit of the population's; `colors` are palette indices
 * for the body's regions. */
export interface Look {
  id: string;
  mesh: string;
  wear: string[];
  /** The population its people are drawn from: a content one by id (content/people), or an admin one by its store id at
   * its latest revision; the city's where not given. */
  population?: string | number;
  colors?: number[];
  placeholder?: boolean;
  /** For an artist: what this look is meant to be once it has its own art. */
  note?: string;
}

/** Keys of lines a person says: a scene step or a reaction names one, and the archetype (or the scene) has lines for it. */
export type LineKey = string;

/** A kind of person. */
export interface Archetype {
  id: string;
  name: string;
  /** The tier a new one of this kind starts at. */
  tier: Tier;
  /** The body's species (content/civilians.ts). */
  species: string;
  /** Whether one runs when hurt or fights back, over its species' own (a cop, a gang member: "defends"). */
  temper?: "flees" | "defends";
  looks: string[];
  /** Ranges each trait is rolled in; missing ones are 0.2 to 0.8. */
  traits?: Partial<Record<keyof Traits, [number, number]>>;
  /** What one carries, and what it holds in hand when a scene says hold. */
  items?: Record<string, number>;
  /** A pool of first names in `names` of the catalogue. */
  names: string;
  lines: Record<LineKey, string[]>;
  /** The reaction table it uses. */
  reactions: string;
  /** Seeds of a life: tags the planner's backstory grows from. */
  wants: string[];
  struggles: string[];
  hopes: string[];
  placeholder?: boolean;
}

/** A role in a scene: who may play it, and how many of them (a range: a crowd of 20 to 60). */
export interface Role {
  role: string;
  archetypes: string[];
  count: [number, number];
  /** A named person of the people store, by id, who plays the first of it when free. */
  person?: number;
}

/** Where a step goes or looks: the scene's place, a free slot about it, another role (its first, or all of them), the
 * player the scene is for, or the way out (where no player is). */
export type Target = "place" | "slot" | "player" | "culprit" | "out" | { role: string } | { spot: SpotTag };

/** One step of a role's script. `when` makes it happen only for a planner's choice (`{ ending: "argue" }`). */
export type Step = (
  | { do: "goto"; to: Target; pace?: "stroll" | "walk" | "run" }
  | { do: "wait"; s: [number, number] }
  | { do: "face"; to: Target }
  | { do: "emote"; emote: string; s?: [number, number] }
  | { do: "say"; line: LineKey }
  | { do: "hold"; item: string }
  /** Join the place's queue and wait to be served; served, go on. */
  | { do: "queue" }
  /** Serve the place's queue for `s` seconds (a vendor). */
  | { do: "serve"; s: [number, number] }
  /** Drive there; out of the car at the end, unless it stays at the wheel (a pick-up); `fast` as police to a call. */
  | { do: "drive"; to: Target; stay?: boolean; fast?: boolean }
  /** Get into another role's car beside its driver, and go where it goes. */
  | { do: "ride"; with: string }
  | { do: "attack"; target: Target }
  /** Wait here until every role has reached a sync of the same name (a flash mob's beat, a meeting's handshake). */
  | { do: "sync"; name: string }
  | { do: "leave"; pace?: "stroll" | "walk" | "run" | "drive" }
) & { when?: Record<string, string> };

/** An activity: its roles, where it happens, a script for each role, and the choices a planner may make in it. */
export interface Scene {
  id: string;
  name: string;
  /** A line about it, for the admin page and the planner. */
  about: string;
  roles: Role[];
  place: { tags: SpotTag[] };
  script: Record<string, Step[]>;
  tags: SceneTag[];
  needs: Capability[];
  /** Relative weight when the caster picks among scenes that fit. */
  weight: number;
  /** Hours of the game day it may start, as [from, to) pairs; all day when missing. */
  hours?: [number, number][];
  /** Seconds before the same scene may start again near the same players. */
  cooldown: number;
  /** Seconds it may run at most before everyone leaves. */
  most: number;
  /** Choices the planner makes (or the rules, at random): each a name and its options, the first the default. */
  choices?: Record<string, string[]>;
  /** Lines of its own, for the roles that play it, beside their archetypes'. */
  lines?: Record<LineKey, string[]>;
  /** It may start a fight with a player (CastHostility 2). */
  hostile?: boolean;
  /** The vehicles a role that drives may come in (a species each); a compact unless given. */
  vehicles?: string[];
  placeholder?: boolean;
}

/** What a person notices. */
/** `fight`: violence seen near (a brawl, a body falling); `gunshot`: a shot heard; `danger`: a dinosaur hunting near, or
 * the people about running and screaming. */
export type Stimulus = "near" | "stare" | "wave" | "talk" | "attacked" | "gunshot" | "fight" | "danger" | "bumped";
export const STIMULI: readonly Stimulus[] = ["near", "stare", "wave", "talk", "attacked", "gunshot", "fight", "danger", "bumped"];

/** What a person does about it, at once and by rule. */
/** `watch`: keeps back from the trouble, out of harm's way, and looks on (a phone out, a finger pointing). */
export type Response = "ignore" | "glance" | "wave" | "step_aside" | "say" | "flee" | "cower" | "watch" | "fight" | "call_cop";
export const RESPONSES: readonly Response[] = ["ignore", "glance", "wave", "step_aside", "say", "flee", "cower", "watch", "fight", "call_cop"];

/** One row: a stimulus, optionally only for a trait over a threshold, a response and maybe a line. The first row that
 * matches (and passes its chance) answers. */
export interface ReactionRow {
  on: Stimulus;
  /** Only for one whose trait is at least this (`{ bold: 0.6 }`), or below it with a minus (`{ bold: -0.4 }`). */
  if?: Partial<Record<keyof Traits, number>>;
  do: Response;
  line?: LineKey;
  chance?: number;
}

export interface ReactionTable {
  id: string;
  rows: ReactionRow[];
}

export interface Catalogue {
  archetypes: Archetype[];
  looks: Look[];
  scenes: Scene[];
  reactions: ReactionTable[];
  names: Record<string, string[]>;
  /** First names that are a man's (0) or a woman's (1): a person of one is drawn of that sex. */
  sexes?: Record<string, number>;
}

/** What the world offers, to check a catalogue against: the emotes, items and species it has. */
export interface Known {
  emotes: ReadonlySet<string>;
  items: ReadonlySet<string>;
  species: ReadonlySet<string>;
  /** The populations a look may name; any where not given. */
  populations?: ReadonlySet<string>;
}

const isTarget = (t: unknown): boolean =>
  t === "place" || t === "slot" || t === "player" || t === "culprit" || t === "out" ||
  (typeof t === "object" && t !== null && (typeof (t as { role?: unknown }).role === "string" || SPOT_TAGS.includes((t as { spot?: SpotTag }).spot!)));

const range = (r: unknown, lo = 0): boolean => Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && n >= lo) && r[0] <= r[1];

/** Every problem with a catalogue, as lines; none when it is sound. */
export function validateCatalogue(c: Catalogue, known: Known): string[] {
  const out: string[] = [];
  // Each kind has ids of its own: a look and the archetype that wears it may share a name.
  const ids = new Map<string, Set<string>>();
  const unique = (kind: string, id: string) => {
    if (!/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(id)) out.push(`${kind} ${id}: an id is namespace:name in lower case`);
    const of = ids.get(kind) ?? ids.set(kind, new Set()).get(kind)!;
    if (of.has(id)) out.push(`${kind} ${id}: the id is used twice`);
    of.add(id);
  };
  const looks = new Map(c.looks.map((l) => [l.id, l]));
  const archetypes = new Map(c.archetypes.map((a) => [a.id, a]));
  const tables = new Set(c.reactions.map((t) => t.id));
  for (const l of c.looks) {
    unique("look", l.id);
    for (const w of l.wear) if (!known.items.has(w)) out.push(`look ${l.id}: wears ${w}, which is no item`);
    if (typeof l.population === "number" ? !(Number.isSafeInteger(l.population) && l.population >= 1) : l.population !== undefined && known.populations && !known.populations.has(l.population)) out.push(`look ${l.id}: draws from ${l.population}, which is no population`);
    if (l.colors && (l.colors.length > 6 || l.colors.some((n) => !Number.isInteger(n) || n < 0 || n > 255))) out.push(`look ${l.id}: up to six palette colours, 0 to 255`);
  }
  for (const a of c.archetypes) {
    unique("archetype", a.id);
    if (!known.species.has(a.species)) out.push(`archetype ${a.id}: species ${a.species} is not in the content`);
    if (a.temper !== undefined && a.temper !== "flees" && a.temper !== "defends") out.push(`archetype ${a.id}: temper is flees or defends`);
    if (!a.looks.length) out.push(`archetype ${a.id}: needs a look`);
    for (const l of a.looks) if (!looks.has(l)) out.push(`archetype ${a.id}: look ${l} is not in the catalogue`);
    for (const i of Object.keys(a.items ?? {})) if (!known.items.has(i)) out.push(`archetype ${a.id}: carries ${i}, which is no item`);
    if (!c.names[a.names]?.length) out.push(`archetype ${a.id}: name pool ${a.names} is missing or empty`);
    if (!tables.has(a.reactions)) out.push(`archetype ${a.id}: reaction table ${a.reactions} is not in the catalogue`);
    for (const [k, r] of Object.entries(a.traits ?? {})) if (!TRAIT_NAMES.includes(k as keyof Traits) || !range(r) || r![1] > 1) out.push(`archetype ${a.id}: trait ${k} wants a range within 0 to 1`);
  }
  const lineOf = (a: Archetype, s: Scene, k: LineKey) => !!(a.lines[k]?.length || s.lines?.[k]?.length);
  for (const s of c.scenes) {
    unique("scene", s.id);
    const roles = new Set(s.roles.map((r) => r.role));
    if (!s.roles.length) out.push(`scene ${s.id}: needs a role`);
    if (roles.size !== s.roles.length) out.push(`scene ${s.id}: a role is named twice`);
    if (!s.place.tags.length || s.place.tags.some((t) => !SPOT_TAGS.includes(t))) out.push(`scene ${s.id}: place wants known spot tags`);
    if (s.tags.some((t) => !SCENE_TAGS.includes(t))) out.push(`scene ${s.id}: an unknown scene tag`);
    if (s.needs.some((n) => !CAPABILITIES.includes(n))) out.push(`scene ${s.id}: an unknown capability`);
    if (!(s.weight >= 0) || !(s.cooldown >= 0) || !(s.most > 0)) out.push(`scene ${s.id}: weight and cooldown at least 0, most above 0`);
    for (const h of s.hours ?? []) if (!range(h) || h[1] > 24) out.push(`scene ${s.id}: hours are [from, to) within 0 to 24`);
    const syncs = new Map<string, number>();
    for (const r of s.roles) {
      if (!range(r.count) || r.count[1] < 1) out.push(`scene ${s.id}: role ${r.role} wants a count range of at least 1`);
      if (!r.archetypes.length) out.push(`scene ${s.id}: role ${r.role} needs an archetype`);
      if (r.person !== undefined && !(Number.isSafeInteger(r.person) && r.person >= 1)) out.push(`scene ${s.id}: role ${r.role} names a person by store id`);
      for (const a of r.archetypes) if (!archetypes.has(a)) out.push(`scene ${s.id}: role ${r.role}: archetype ${a} is not in the catalogue`);
      const steps = s.script[r.role];
      if (!steps?.length) {
        out.push(`scene ${s.id}: role ${r.role} has no script`);
        continue;
      }
      if (steps.at(-1)!.do !== "leave") out.push(`scene ${s.id}: role ${r.role}'s script ends with leave (everyone goes where no one is)`);
      for (const st of steps) {
        const where = `scene ${s.id}: role ${r.role}: ${st.do}`;
        for (const [k, v] of Object.entries(st.when ?? {})) if (!s.choices?.[k]?.includes(v)) out.push(`${where}: when ${k}=${v} is not one of the scene's choices`);
        switch (st.do) {
          case "goto": case "face": case "drive": if (!isTarget(st.to)) out.push(`${where}: an unknown target`); break;
          case "attack": if (!isTarget(st.target)) out.push(`${where}: an unknown target`); break;
          case "wait": case "serve": if (!range(st.s)) out.push(`${where}: s wants a range of seconds`); break;
          case "emote": if (!known.emotes.has(st.emote)) out.push(`${where}: ${st.emote} is no emote`); if (st.s && !range(st.s)) out.push(`${where}: s wants a range of seconds`); break;
          case "hold": if (!known.items.has(st.item)) out.push(`${where}: ${st.item} is no item`); break;
          case "say": for (const a of r.archetypes) if (archetypes.has(a) && !lineOf(archetypes.get(a)!, s, st.line)) out.push(`${where}: ${a} has no lines for ${st.line}`); break;
          case "sync": syncs.set(st.name, (syncs.get(st.name) ?? 0) + 1); break;
          case "ride": if (!roles.has(st.with) || st.with === r.role) out.push(`${where}: rides with role ${st.with}, which is not another role of the scene`); else if (!s.script[st.with]?.some((x) => x.do === "drive")) out.push(`${where}: role ${st.with} never drives`); break;
        }
        for (const t of [("to" in st ? st.to : undefined), ("target" in st ? st.target : undefined)]) if (t && typeof t === "object" && "role" in t && !roles.has(t.role)) out.push(`${where}: role ${t.role} is not in the scene`);
      }
    }
    for (const [name, n] of syncs) if (n !== s.roles.length) out.push(`scene ${s.id}: sync ${name} must be in every role's script once (it is in ${n} of ${s.roles.length})`);
    if (s.hostile && !s.tags.includes("hostile")) out.push(`scene ${s.id}: a hostile scene is tagged hostile`);
    if (s.needs.includes("drive") && !s.tags.includes("vehicle")) out.push(`scene ${s.id}: a scene that drives is tagged vehicle`);
    for (const v of s.vehicles ?? []) if (!known.species.has(v)) out.push(`scene ${s.id}: vehicle ${v} is not in the content`);
  }
  for (const t of c.reactions) {
    unique("reactions", t.id);
    for (const row of t.rows) {
      if (!STIMULI.includes(row.on) || !RESPONSES.includes(row.do)) out.push(`reactions ${t.id}: an unknown stimulus or response (${row.on} → ${row.do})`);
      if (row.do === "say" && !row.line) out.push(`reactions ${t.id}: say needs a line (${row.on})`);
      if (row.chance !== undefined && !(row.chance > 0 && row.chance <= 1)) out.push(`reactions ${t.id}: chance is above 0 and at most 1`);
    }
    for (const a of c.archetypes.filter((a) => a.reactions === t.id)) for (const row of t.rows) if (row.line && !a.lines[row.line]?.length) out.push(`reactions ${t.id}: ${a.id} has no lines for ${row.line}`);
  }
  for (const [k, v] of Object.entries(c.names)) if (!v.length) out.push(`names ${k}: empty`);
  for (const [k, v] of Object.entries(c.sexes ?? {})) if (v !== 0 && v !== 1) out.push(`sexes ${k}: 0 for a man's name, 1 for a woman's`);
  return out;
}
