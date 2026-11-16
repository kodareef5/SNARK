// What the sound board (client/sound/sounds.html) lists, as a person looks for a sound: by owner (a creature, the
// survivor, a shared family), then by occasion (call, alarm, pain, death, attack, steps by ground), each with how the
// game hears it in this build: by its own takes, by a stand-in of the owner's own (a death cried with its pain, lower),
// by a shared family's sound, or not at all. A sound's takes are the variants the game picks among, never the same one
// twice running. The server adds what the build does not ship: each owner's folder, its takes' files and what made them.

import type { ManifestSound } from "../../../shared/pack/sound.ts";
import { CUES, KEYS, candidates, expand, vehicleFamilies, type Cue } from "../../../shared/sound/cues.ts";

/** An owner as the server lists it (server/sound-board.ts). */
export interface ListedOwner {
  id: string;
  /** `species/creature`, `species/survivor`, `family`, a definition's type, or "" for an owner nobody defines. */
  cls: string;
  folder: string | null;
  files: string[];
  takes: Record<string, string[]>;
  wants: Record<string, string>;
  made: Record<string, string>;
}

/** How an occasion of an owner is heard: its own sound, a stand-in of its own, a shared one, or nothing. */
export type HeardBy = "own" | "stand-in" | "shared" | "none";

export interface Variant {
  /** The concrete key (`step/grass`), and the word that fills the occasion's variable (`grass`), or "" for none. */
  key: string;
  word: string;
  by: HeardBy;
  /** The sound it plays, and at what rate, or null. */
  sound: string | null;
  rate: number;
}

export interface Occasion {
  name: string;
  label: string;
  when: string;
  status: string;
  kind: string;
  loop: boolean;
  /** What the owner's brief asks of the sound, where it says. */
  want: string;
  variants: Variant[];
}

export interface Take {
  seconds: number;
  from: string;
  file: string;
  made: string;
}

export interface Card {
  id: string;
  title: string;
  cls: string;
  folder: string | null;
  files: string[];
  occasions: Occasion[];
  /** Sounds of its own that no occasion of the catalogue plays. */
  loose: string[];
  count: Record<HeardBy, number>;
}

/** Plain words for the occasions a listener looks for first. */
const LABEL: Readonly<Record<string, string>> = {
  startled: "alarm",
  hurt: "pain",
  "hurt/badly": "pain, badly hurt",
  attack: "attack",
  land: "landing",
  thump: "body meets the ground",
  torpor_in: "knocked out",
  torpor_out: "comes round",
  eat: "eating",
  "step/{ground}": "steps",
  "land/{ground}": "landing",
  "drag/{ground}": "dragged along",
  "splash/in": "into water",
  "splash/out": "out of water",
  swim: "swimming",
  rustle: "through plants",
};
/** The order occasions are listed in, by kind: voices first, then blows and bodies, things used, building, steps, beds. */
const KIND_ORDER = ["vocal", "hit", "weapon", "item", "build", "step", "ui", "bed", "music"];
const GROUPS: readonly [string, (cls: string) => boolean][] = [
  ["Creatures", (c) => c === "species/creature"],
  ["The survivor", (c) => c === "species/survivor"],
  ["Shared sounds, which every owner without its own falls back to", (c) => c === "family"],
  ["Structures, items and nodes", (c) => c === "structure" || c === "item" || c === "node" || c === "prop"],
  ["Owners nothing defines yet", () => true],
];

const label = (name: string): string => LABEL[name] ?? name.replace(/\/?\{\w+\}/g, "").replaceAll("/", " ").replaceAll("_", " ");
const rank = (kind: string): number => KIND_ORDER.indexOf(kind);

/** The occasions an owner of class `cls` has: those its class is named in. A creature has no hands to swing or fire with. */
function occasionsOf(cls: string): Cue[] {
  const on = cls === "species/creature" || cls === "species/survivor" ? cls : cls === "" ? "species/creature" : cls;
  return CUES.filter((c) => c.on.includes(on) && !(on === "species/creature" && c.on.includes("item")));
}

/** The board: owners in groups, each owner's occasions and how each is heard by `sounds`. */
export function listSounds(sounds: readonly ManifestSound[], owners: readonly ListedOwner[]): { title: string; cards: Card[] }[] {
  const have = new Map(sounds.map((s) => [s.id, s]));
  const cards: Card[] = owners.map((o) => {
    const reached = new Set<string>();
    const occasions = o.cls === "family" ? familyOccasions(o.id, have) : ownOccasions(o, have);
    for (const oc of occasions) for (const v of oc.variants) if (v.sound) reached.add(v.sound);
    const count: Record<HeardBy, number> = { own: 0, "stand-in": 0, shared: 0, none: 0 };
    for (const oc of occasions) for (const v of oc.variants) if (!oc.status.startsWith("waits:")) count[v.by]++;
    for (const oc of occasions) oc.want = o.wants[oc.name] ?? oc.variants.map((v) => o.wants[v.key]).find((w) => w !== undefined) ?? "";
    const own = sounds.filter((s) => s.id.startsWith(`${o.id}/sound/`));
    return {
      id: o.id,
      title: o.id.slice(o.id.indexOf(":") + 1).replaceAll("_", " "),
      cls: o.cls,
      folder: o.folder,
      files: o.files,
      occasions,
      loose: own.filter((s) => !reached.has(s.id)).map((s) => s.id.slice(o.id.length + 7)),
      count,
    };
  });
  const left = new Set(cards);
  return GROUPS.map(([title, fits]) => {
    const mine = [...left].filter((c) => fits(c.cls)).sort((a, b) => (a.title < b.title ? -1 : 1));
    for (const c of mine) left.delete(c);
    return { title, cards: mine };
  }).filter((g) => g.cards.length > 0);
}

function ownOccasions(o: ListedOwner, have: ReadonlyMap<string, ManifestSound>): Occasion[] {
  const cues = occasionsOf(o.cls).sort((a, b) => rank(a.kind) - rank(b.kind));
  return cues.map((c) => ({
    name: c.name,
    label: label(c.name),
    when: c.when,
    status: c.status,
    kind: c.kind,
    loop: c.loop === true,
    want: "",
    variants: KEYS.filter((k) => k.cue === c).map((k) => {
      const found = candidates(o.id, k).find((x) => have.has(x.id));
      const word = Object.values(k.vars).join(" ");
      if (!found) return { key: k.key, word, by: "none" as const, sound: null, rate: 1 };
      const by: HeardBy = found.id === `${o.id}/sound/${k.key}` ? "own" : found.id.startsWith(`${o.id}/sound/`) ? "stand-in" : "shared";
      return { key: k.key, word, by, sound: found.id, rate: found.rate };
    }),
  }));
}

/** A shared family's occasions: each name the catalogue's fallbacks look for in it, and the cues that fall back there. */
function familyOccasions(id: string, have: ReadonlyMap<string, ManifestSound>): Occasion[] {
  const vehicle = vehicleFamilies(id).includes(id);
  const rows = new Map<string, { cues: Cue[] }>();
  for (const c of CUES) {
    for (const f of c.falls) {
      // A vehicle family holds what `{family}` stands for as well as what names it.
      const at = f.startsWith(`${id}/`) ? id.length + 1 : vehicle && f.startsWith("{family}/") ? 9 : -1;
      if (at < 0) continue;
      const pattern = f.slice(at).split("@")[0]!;
      const row = rows.get(pattern) ?? { cues: [] };
      if (!row.cues.includes(c)) row.cues.push(c);
      rows.set(pattern, row);
    }
  }
  return [...rows].map(([pattern, { cues }]) => ({
    name: pattern,
    label: label(pattern),
    when: `what ${cues.map((c) => c.name).join(", ")} fall${cues.length === 1 ? "s" : ""} back to: ${cues[0]!.when}`,
    status: cues.some((c) => !c.status.startsWith("waits:")) ? (cues.find((c) => !c.status.startsWith("waits:"))!.status) : cues[0]!.status,
    kind: cues[0]!.kind,
    loop: cues.some((c) => c.loop === true),
    want: "",
    variants: (pattern.includes("{name}") ? named(id, pattern, have) : expand(pattern)).map((e) => {
      const sound = `${id}/sound/${e.key}`;
      return { key: e.key, word: Object.values(e.vars).join(" "), by: have.has(sound) ? ("own" as const) : ("none" as const), sound: have.has(sound) ? sound : null, rate: 1 };
    }),
  })).sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** A family's sounds under owners' names (`fire/{name}`): those it has, each with the name it is under. */
function named(id: string, pattern: string, have: ReadonlyMap<string, ManifestSound>): { key: string; vars: Record<string, string> }[] {
  const re = new RegExp(`^${pattern.replace(/\{name\}/g, "([a-z0-9_]+)").replace(/\{(\w+)\}/g, "[a-z0-9_]+")}$`);
  const out: { key: string; vars: Record<string, string> }[] = [];
  for (const sound of have.keys()) {
    if (!sound.startsWith(`${id}/sound/`)) continue;
    const m = re.exec(sound.slice(id.length + 7));
    if (m) out.push({ key: sound.slice(id.length + 7), vars: { name: m[1]! } });
  }
  return out;
}

/** The takes of a sound, as the board shows each: its length, its maker, its file and what made it. */
export function takesOf(sound: ManifestSound, owner: ListedOwner | undefined): Take[] {
  const name = sound.id.slice(sound.id.indexOf("/sound/") + 7);
  const files = owner?.takes[name] ?? [];
  return sound.takes.map((t, k) => ({ seconds: t.samples / sound.rate, from: t.from ?? "", file: files[k] ?? "", made: owner?.made[files[k] ?? ""] ?? "" }));
}
