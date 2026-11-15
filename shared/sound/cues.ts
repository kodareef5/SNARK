// The catalogue of every occasion the game is heard on (planning/reference/round9-sound-design.md). A cue is an
// occasion on a class of owner: `step/{ground}` on any body. The game asks for an occasion of an owner, and the owner's
// own sound plays, or the first of the cue's fallbacks that exists, or nothing. A sound is `<owner>/sound/<name>` as the
// build names it, so a new sound for an occasion that exists is only takes and a line in its owner's cue sheet.
//
// Names may hold variables in braces, filled from VARIANTS. A fallback is `<owner>/<name>`, where `{owner}` is the asking
// owner, and may end in `@<rate>` to play the stand-in at that playback rate (a death cried with its pain is lower).

import { HOLD_NAMES } from "../sim/weapon.ts";

/** The words a cue name's variables are filled from. Add a word here and every cue that uses the variable gains it. */
export const VARIANTS: Readonly<Record<string, readonly string[]>> = {
  ground: ["grass", "sand", "stone", "dirt", "wood", "metal", "thatch", "water", "snow"],
  material: ["flesh", "hide", "chitin", "wood", "stone", "metal", "thatch", "foliage", "water", "dirt", "glass"],
  size: ["small", "medium", "large", "huge"],
  hold: HOLD_NAMES,
  tier: ["thatch", "wood", "stone", "metal"],
  door: ["wood", "metal"],
  sex: ["male", "female"],
  biome: ["beach", "jungle", "grass"],
  time: ["day", "night"],
  order: ["follow", "stay", "attack", "all"],
  screen: ["inventory", "map", "character", "options", "station", "structure", "tame", "chat"],
};

/** Which voices a cue takes and how it weighs when they are short: see client/core/sound/mixer.ts. */
export type CueKind = "vocal" | "step" | "hit" | "weapon" | "build" | "item" | "ui" | "bed" | "music";
/** Placed where it happened, following the body that made it, or at the ear and not placed at all. */
export type CueSpace = "world" | "body" | "ear";
/**
 * `built`: fired, and a sound exists. `fire`: the client knows of it and fires it. `hook`: the client computes it but
 * keeps nothing yet. `gap`: a client other than the actor cannot see it. `waits:<feature>`: nothing happens yet.
 */
export type CueStatus = "built" | "fire" | "hook" | "gap" | `waits:${string}`;

export interface Cue {
  name: string;
  /** Owner classes: `species/creature`, `species/survivor`, `item`, `structure`, `node`, `prop`, `ui`, `world`, `music`. */
  on: readonly string[];
  /** How the client knows it happened. */
  when: string;
  kind: CueKind;
  space: CueSpace;
  /** Plays until whatever makes it stops, or leaves hearing. */
  loop?: boolean;
  /** Tried in turn when the owner has no sound of this name. */
  falls: readonly string[];
  status: CueStatus;
}

const C: Cue[] = [];
type Opt = Partial<Pick<Cue, "loop" | "falls">>;
function cue(name: string, on: string | readonly string[], kind: CueKind, space: CueSpace, status: CueStatus, when: string, opt: Opt = {}): void {
  C.push({ name, on: typeof on === "string" ? [on] : on, when, kind, space, status, falls: opt.falls ?? [], ...(opt.loop ? { loop: true } : {}) });
}

const BODIES = ["species/creature", "species/survivor"];
const CREATURE = "species/creature";
const SURVIVOR = "species/survivor";

// ---- Any body: steps, landings, water. Shared families: core:surface, core:body.
cue("step/{ground}", BODIES, "step", "body", "built", "a foot plants, from the gait as drawn (creatures) or the ground covered (survivors); the ground from client/core/sound/ground.ts", { falls: ["{owner}/step", "{owner}/step/grass", "core:surface/step/{ground}"] });
cue("land/{ground}", BODIES, "hit", "body", "fire", "the airborne bit clears; how hard from the fall", { falls: ["{owner}/land", "core:surface/land/{ground}"] });
cue("drag/{ground}", BODIES, "step", "body", "fire", "a body carried or held moves along the ground (CUE_HELD)", { falls: ["core:surface/drag/{ground}"] });
cue("splash/in", BODIES, "hit", "body", "fire", "swimming begins: the swim bit or the own body's mode", { falls: ["{owner}/splash/in", "core:body/splash/in/large"] });
cue("splash/out", BODIES, "hit", "body", "fire", "swimming ends", { falls: ["core:body/splash/out"] });
cue("swim", BODIES, "step", "body", "fire", "a stroke while swimming, by the water covered", { falls: ["{owner}/swim", "core:body/swim/stroke"] });
cue("thump", BODIES, "hit", "body", "built", "a body goes down, knocked out or dead, as its hips meet the ground", { falls: ["{owner}/land@0.9", "core:body/thump/medium"] });
cue("rustle", BODIES, "step", "body", "fire", "a body moves through a plant node", { falls: ["core:body/rustle/foliage"] });

// ---- Creatures (species/creature). Each species' own first, then a stand-in of its own, then the shared.
cue("call", CREATURE, "vocal", "body", "built", "an idle with a sound begins (shared/anim/creature.ts idleOf), as its mouth opens");
cue("startled", CREATURE, "vocal", "body", "built", "CUE_STARTLE in the cue word", { falls: ["{owner}/alarm", "{owner}/hurt"] });
cue("hurt", CREATURE, "vocal", "body", "built", "LAYER_FLINCH in the cue word", { falls: ["{owner}/pain"] });
cue("hurt/badly", CREATURE, "vocal", "body", "fire", "the hurt stage bits rise (server/hurt.ts)", { falls: ["{owner}/hurt@0.94"] });
cue("death", CREATURE, "vocal", "body", "built", "the body leaves the view as the server says it died", { falls: ["{owner}/hurt@0.88"] });
cue("attack", CREATURE, "hit", "body", "built", "act=SWING starts; heard as the blow lands (the bite's lands tick)", { falls: ["{owner}/peck", "{owner}/bite", "core:weapon/swing/hands"] });
cue("land", CREATURE, "hit", "body", "built", "CUE_LAND in the cue word", { falls: ["{owner}/thump", "core:body/thump/medium"] });
cue("torpor_in", CREATURE, "vocal", "body", "built", "CUE_TORPOR as it goes out", { falls: ["{owner}/hurt@0.8"] });
cue("torpor_out", CREATURE, "vocal", "body", "built", "CUE_TORPOR as it comes round");
cue("snore", CREATURE, "vocal", "body", "waits:polish", "lying knocked out", { loop: true });
cue("eat", CREATURE, "item", "body", "built", "LAYER_EAT in the cue word");
cue("roar", CREATURE, "vocal", "body", "waits:riding", "a rider's roar key", { falls: ["{owner}/startled"] });
cue("flap", CREATURE, "step", "body", "waits:flyers", "a flyer's wingbeat, by its gait");
cue("graze", CREATURE, "item", "body", "waits:behaviour", "grazing; there is no cue for it yet");
cue("sleep", CREATURE, "vocal", "body", "waits:behaviour", "sleeping; there is no cue for it yet", { loop: true });
cue("tamed", CREATURE, "vocal", "body", "fire", "EVENT_TAMED for the owner", { falls: ["{owner}/call"] });
cue("mate", CREATURE, "vocal", "body", "fire", "the mating step bits rise", { falls: ["{owner}/call@1.1"] });
cue("lay", CREATURE, "item", "world", "fire", "an egg prop appears beside it", { falls: ["core:body/thump/small"] });
cue("hatch", CREATURE, "vocal", "world", "fire", "an egg prop goes and a young one appears", { falls: ["{owner}/call@1.3"] });
cue("carried", CREATURE, "vocal", "body", "fire", "CUE_HELD is set", { falls: ["{owner}/startled"] });

// ---- The survivor (species/survivor). Others hear these placed; the player hears their own at the ear.
cue("voice/{sex}/hurt", SURVIVOR, "vocal", "body", "fire", "EVENT_HURT for the player; others cannot see it (gap)");
cue("voice/{sex}/hurt/badly", SURVIVOR, "vocal", "body", "fire", "EVENT_HURT taking a quarter of health or more", { falls: ["core:survivor/voice/{sex}/hurt@0.95"] });
cue("voice/{sex}/death", SURVIVOR, "vocal", "body", "fire", "the session goes to SESSION_DEAD; others: the body leaves as died");
cue("voice/{sex}/jump", SURVIVOR, "vocal", "body", "fire", "grounded is lost going up");
cue("voice/{sex}/land", SURVIVOR, "vocal", "body", "fire", "landing from a fall fast enough to hurt");
cue("voice/{sex}/winded", SURVIVOR, "vocal", "ear", "fire", "MF_WINDED is set on the own body");
cue("voice/{sex}/gasp", SURVIVOR, "vocal", "ear", "fire", "the eye comes up out of the water after a while under it");
cue("voice/{sex}/drown", SURVIVOR, "vocal", "ear", "fire", "oxygen is gone and health falls");
cue("voice/{sex}/knocked_out", SURVIVOR, "vocal", "ear", "fire", "MF_OUT is set");
cue("voice/{sex}/wake", SURVIVOR, "vocal", "ear", "fire", "MF_OUT is cleared");
cue("voice/{sex}/eat", SURVIVOR, "item", "ear", "fire", "food rises after using an item");
cue("voice/{sex}/drink", SURVIVOR, "item", "ear", "fire", "water rises after using an item");
cue("voice/{sex}/cough", SURVIVOR, "vocal", "ear", "waits:weather", "smoke or sickness");
cue("heartbeat", SURVIVOR, "vocal", "ear", "fire", "health under a quarter", { loop: true });
cue("hungry", SURVIVOR, "vocal", "ear", "fire", "food or water falls past a tenth");
cue("hurt/other", SURVIVOR, "vocal", "body", "gap", "another survivor is hurt: no hurt state is replicated for survivors");
cue("knocked_out/other", SURVIVOR, "vocal", "body", "gap", "another survivor is knocked out: only the forced prone stance shows");

// ---- Weapons and tools, by how they are held. Shared family: core:weapon.
cue("swing/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "act=SWING begins (own: predicted; others: the pose word)", { falls: ["{owner}/swing", "core:weapon/swing/{hold}", "core:weapon/swing/hands"] });
cue("draw/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "act=DRAW begins", { falls: ["{owner}/draw", "core:weapon/draw/bow"] });
cue("release/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "a bow's arrow leaves: act goes to COOL after HOLD", { falls: ["{owner}/release", "core:weapon/release/bow"] });
cue("fire/{hold}", ["item", ...BODIES], "weapon", "world", "fire", "own: session.fired; others: EVENT_SHOT within 260 m", { falls: ["{owner}/fire", "core:weapon/fire/{hold}"] });
cue("fire/far", "item", "weapon", "world", "fire", "EVENT_SHOT from beyond 150 m", { falls: ["core:weapon/fire/far"] });
cue("fire/crossbow", "item", "weapon", "world", "fire", "a crossbow's shot", { falls: ["{owner}/fire", "core:weapon/fire/crossbow"] });
cue("fire/sling", "item", "weapon", "world", "fire", "a slingshot's shot", { falls: ["{owner}/fire", "core:weapon/fire/sling"] });
cue("fire/silenced", "item", "weapon", "world", "waits:W0", "EVENT_SHOT's silenced bit (protocol 13)");
cue("reload/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "act=RELOAD begins", { falls: ["{owner}/reload", "core:weapon/reload/{hold}", "core:weapon/reload/rifle"] });
cue("dry", "item", "weapon", "ear", "fire", "the trigger with no rounds loaded", { falls: ["core:weapon/dry"] });
cue("equip", ["item", ...BODIES], "item", "body", "fire", "act=EQUIP begins", { falls: ["{owner}/equip", "core:weapon/equip"] });
cue("throw", ["item", ...BODIES], "weapon", "body", "fire", "a throw (hold THROW) begins", { falls: ["{owner}/throw", "core:weapon/throw"] });
cue("fly/arrow", "prop", "weapon", "world", "hook", "a flying shot passes the ear (shots.ts flies it)", { falls: ["core:weapon/fly/arrow"] });
cue("whiz", "prop", "weapon", "world", "fire", "a hitscan shot's line passes within 4 m of the ear", { falls: ["core:weapon/whiz/bullet"] });
cue("ricochet", "prop", "weapon", "world", "fire", "a hitscan shot ends on the world", { falls: ["core:weapon/ricochet"] });
cue("stick", "prop", "hit", "world", "fire", "an arrow_stuck prop appears", { falls: ["core:weapon/stick"] });
cue("impact/{material}", ["prop", "item"], "hit", "world", "fire", "a blow or a shot lands: EVENT_HIT for the attacker; a projectile's end; the struck thing's material", { falls: ["core:surface/impact/{material}"] });
cue("blast/near", "prop", "weapon", "world", "fire", "EVENT_BLAST within 120 m", { falls: ["core:weapon/blast/near"] });
cue("blast/far", "prop", "weapon", "world", "fire", "EVENT_BLAST beyond 120 m", { falls: ["core:weapon/blast/far"] });
cue("fuse", "prop", "weapon", "body", "fire", "a live grenade lies in view", { loop: true, falls: ["core:weapon/fuse"] });
cue("bounce", "prop", "hit", "body", "fire", "a live grenade's velocity turns", { falls: ["core:weapon/bounce"] });
cue("zap", "prop", "weapon", "world", "fire", "a shock dart's buff on a body", { falls: ["core:weapon/zap"] });
cue("hit/marker", "ui", "ui", "ear", "fire", "EVENT_HIT for the attacker", { falls: ["core:weapon/hit/marker"] });
cue("hit/head", "ui", "ui", "ear", "fire", "EVENT_HIT on the head zone", { falls: ["core:weapon/hit/head"] });
cue("kill", "ui", "ui", "ear", "fire", "EVENT_HIT with the killed bit, or EVENT_KILL", { falls: ["core:weapon/kill"] });
cue("break", "item", "item", "ear", "fire", "a held item's durability reaches 0", { falls: ["core:structure/demolish@1.3"] });
cue("auto", "item", "weapon", "world", "waits:W2", "automatic fire");
cue("pellets", "item", "weapon", "world", "waits:W3", "a shotgun's burst");
cue("bola", "item", "weapon", "world", "waits:W4", "a bola thrown and wrapping");
cue("smoke", "prop", "weapon", "world", "waits:W5", "a smoke or poison cloud", { loop: true });
cue("flare", "prop", "weapon", "world", "waits:W6", "a flare burning", { loop: true });
cue("attach", "item", "item", "ear", "waits:W7", "an attachment fitted or toggled");

// ---- Building. Shared family core:structure, by tier (the material without its `mat_`).
cue("place/{tier}", "structure", "build", "world", "fire", "a structure row appears in an empty slot", { falls: ["{owner}/place", "core:structure/place/{tier}"] });
cue("destroy/{tier}", "structure", "build", "world", "fire", "a removal with GONE_DESTROYED", { falls: ["{owner}/destroy", "core:structure/destroy/{tier}", "core:weapon/debris/stone"] });
cue("collapse", "structure", "build", "world", "fire", "a removal with GONE_FELL", { falls: ["core:structure/collapse"] });
cue("debris/{tier}", "structure", "build", "world", "hook", "falling pieces meet the ground (rubble.ts)", { falls: ["core:weapon/debris/{tier}", "core:weapon/debris/stone"] });
cue("hit/{tier}", "structure", "hit", "world", "fire", "a structure row's health falls", { falls: ["core:surface/impact/{tier}"] });
cue("repair", "structure", "build", "world", "fire", "a structure row's health rises", { falls: ["core:structure/repair"] });
cue("demolish", "structure", "build", "world", "fire", "a removal with GONE_TAKEN", { falls: ["core:structure/demolish"] });
cue("door/open/{door}", "structure", "build", "world", "fire", "a door's kind swaps to its open kind", { falls: ["{owner}/open", "core:structure/door/open/{door}"] });
cue("door/close/{door}", "structure", "build", "world", "fire", "an open door's kind swaps back", { falls: ["{owner}/close", "core:structure/door/close/{door}"] });
cue("door/locked", "structure", "build", "ear", "fire", "RESULT_LOCKED for the one who tried it", { falls: ["core:structure/door/locked"] });
cue("lock", "structure", "build", "ear", "fire", "RESULT_PIN or a lock command's result, for its user only", { falls: ["core:structure/lock"] });
cue("box/open/{door}", "structure", "build", "ear", "fire", "OWN_OPEN opens, for its user only", { falls: ["core:structure/box/open/{door}"] });
cue("box/close/{door}", "structure", "build", "ear", "fire", "OWN_OPEN closes", { falls: ["core:structure/box/close/{door}"] });
cue("fire/light", "structure", "build", "world", "fire", "a station's kind swaps to its lit kind", { falls: ["core:structure/fire/light"] });
cue("fire/out", "structure", "build", "world", "fire", "a lit kind swaps back", { falls: ["core:structure/fire/out"] });
cue("fire/burn", "structure", "bed", "world", "fire", "a lit station within hearing", { loop: true, falls: ["core:world/fire"] });
cue("station/run", "structure", "build", "world", "waits:stations", "a station's jobs run", { loop: true, falls: ["core:structure/grind"] });
cue("bed/use", "structure", "ui", "ear", "fire", "respawning at a bed", { falls: ["core:structure/bed/use"] });
cue("turret", "structure", "weapon", "world", "waits:defences", "a turret fires");

// ---- Nodes. Shared family core:node, by the node's material.
cue("felled", "node", "build", "world", "fire", "a wood node's slot is used up (S_NODES)", { falls: ["{owner}/felled", "core:node/felled/wood"] });
cue("crumble", "node", "build", "world", "fire", "a stone node's slot is used up", { falls: ["{owner}/crumble", "core:node/crumble/stone"] });
cue("picked", "node", "build", "world", "fire", "a plant node's slot is used up", { falls: ["{owner}/picked", "core:node/picked/foliage"] });
cue("struck", "node", "hit", "world", "hook", "a blow lands on a node (own strike and aim, which the session does not keep)", { falls: ["core:surface/impact/wood"] });
cue("regrow", "node", "build", "world", "waits:polish", "a node's slot is freed");

// ---- The interface, never placed. Shared family core:ui.
for (const n of ["click", "hover", "back", "tab", "toggle", "slider", "slot/pick", "slot/drop", "craft/queue", "craft/done", "error", "notice", "chat", "level_up", "engram", "respawn", "tame/done", "tribe", "ghost/snap", "dead"]) {
  // `dead` is the player's own death sting; `death` is the creature's cry.
  cue(n, "ui", "ui", "ear", n === "hover" || n === "slider" || n === "tribe" ? "hook" : "fire", `the interface: ${n.replace("/", " ")}`, { falls: [`core:ui/${n === "dead" ? "death" : n}`] });
}
cue("screen/{screen}/open", "ui", "ui", "ear", "fire", "a screen or panel opens", { falls: ["core:ui/open"] });
cue("screen/{screen}/close", "ui", "ui", "ear", "fire", "a screen or panel closes", { falls: ["core:ui/close"] });
cue("whistle/{order}", "ui", "ui", "ear", "fire", "a whistle key; others hear nothing (gap)", { falls: ["core:ui/whistle/{order}", "core:ui/whistle/follow"] });

// ---- The world, where the ear is. Shared family core:world.
cue("bed/{biome}/{time}", "world", "bed", "ear", "fire", "the clock (shared/sim/clock.ts) and the place: beach near the sea, jungle among many trees, else grass", { loop: true, falls: ["core:world/bed/{biome}/{time}", "core:world/bed/grass/{time}"] });
cue("bed/ruins", "world", "bed", "ear", "waits:maps", "inside static ruins", { loop: true, falls: ["core:world/bed/ruins"] });
cue("bed/sea", "world", "bed", "ear", "fire", "the ear over open water far from land", { loop: true, falls: ["core:world/bed/sea"] });
cue("underwater", "world", "bed", "ear", "fire", "the eye below sea level", { loop: true, falls: ["core:world/underwater"] });
cue("shore", "world", "bed", "ear", "fire", "the ear near the edge of the sea", { loop: true, falls: ["core:world/shore"] });
cue("wind/light", "world", "bed", "ear", "fire", "the ear well above the ground", { loop: true, falls: ["core:world/wind/light"] });
cue("wind/strong", "world", "bed", "ear", "fire", "the ear high above the ground", { loop: true, falls: ["core:world/wind/strong"] });
cue("stinger/dawn", "world", "bed", "ear", "fire", "the clock passes sunrise", { falls: ["core:world/stinger/dawn"] });
cue("stinger/dusk", "world", "bed", "ear", "fire", "the clock passes sunset", { falls: ["core:world/stinger/dusk"] });
cue("rain/light", "world", "bed", "ear", "waits:weather", "rain", { loop: true, falls: ["core:world/rain/light"] });
cue("rain/heavy", "world", "bed", "ear", "waits:weather", "a storm", { loop: true, falls: ["core:world/rain/heavy"] });
cue("thunder", "world", "bed", "ear", "waits:weather", "lightning", { falls: ["core:world/thunder"] });
cue("river", "world", "bed", "world", "waits:maps", "a river near the ear", { loop: true, falls: ["core:world/river"] });
cue("waterfall", "world", "bed", "world", "waits:maps", "a waterfall near the ear", { loop: true, falls: ["core:world/waterfall"] });
cue("cave", "world", "bed", "ear", "waits:caves", "inside a cave", { loop: true });
cue("crate/land", "prop", "build", "world", "waits:loot", "a supply crate lands");

// ---- Music, never placed.
cue("music/explore/{biome}/{time}", "music", "music", "ear", "waits:music", "quiet stretches, rarely");
cue("music/combat/{time}", "music", "music", "ear", "waits:music", "hostile creatures aware of the player, or recent harm");
cue("music/death", "music", "music", "ear", "waits:music", "the player dies");
cue("music/menu", "music", "music", "ear", "waits:music", "the title and creation screens");

export const CUES: readonly Cue[] = C;

/** Every concrete name a cue stands for, its variables filled, with the values used. */
export function expand(name: string): { key: string; vars: Record<string, string> }[] {
  let out: { key: string; vars: Record<string, string> }[] = [{ key: name, vars: {} }];
  for (const m of name.matchAll(/\{(\w+)\}/g)) {
    const words = VARIANTS[m[1]!];
    if (!words) throw new Error(`cue ${name}: no variant ${m[1]}`);
    out = out.flatMap((o) => words.map((w) => ({ key: o.key.replace(m[0], w), vars: { ...o.vars, [m[1]!]: w } })));
  }
  return out;
}

/** A concrete key (`step/grass`), the cue it belongs to, and the variables it fills. */
export interface CueKey {
  key: string;
  cue: Cue;
  vars: Readonly<Record<string, string>>;
}

/** Every concrete key of the catalogue, in order. A key's index is its number in the engine. */
export const KEYS: readonly CueKey[] = CUES.flatMap((c) => expand(c.name).map((e) => ({ key: e.key, cue: c, vars: e.vars })));
const KEY_INDEX = new Map(KEYS.map((k, i) => [k.key, i]));

/** The number of a concrete key, for code that fires it. Throws on a name the catalogue lacks: the check runs every caller. */
export function cueKey(key: string): number {
  const i = KEY_INDEX.get(key);
  if (i === undefined) throw new Error(`sound: no cue ${key} in shared/sound/cues.ts`);
  return i;
}

/** The sound ids a key looks for when asked of `owner`, in order, with the playback rate of each. */
export function candidates(owner: string, k: CueKey): { id: string; rate: number }[] {
  const fill = (s: string): string => s.replace(/\{(\w+)\}/g, (_, v: string) => (v === "owner" ? owner : (k.vars[v] ?? `{${v}}`)));
  const out = [{ id: `${owner}/sound/${k.key}`, rate: 1 }];
  for (const f of k.cue.falls) {
    const [path, rate] = f.split("@") as [string, string | undefined];
    const full = fill(path);
    const slash = full.indexOf("/");
    out.push({ id: `${full.slice(0, slash)}/sound/${full.slice(slash + 1)}`, rate: rate ? Number(rate) : 1 });
  }
  return out;
}

/** What is wrong with the catalogue: names twice, unknown variables, fallbacks that are not `<owner>/<name>`. */
export function cueFaults(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of CUES) {
    if (seen.has(c.name)) out.push(`${c.name} is listed twice`);
    seen.add(c.name);
    try {
      expand(c.name);
    } catch (e) {
      out.push((e as Error).message);
    }
    for (const f of c.falls) {
      if (!/^(\{owner\}|[a-z0-9_]+:[a-z0-9_]+)\/[a-z0-9_/{}]+(@[0-9.]+)?$/.test(f)) out.push(`${c.name}: fallback ${f} is not <owner>/<name>[@rate]`);
      for (const m of f.matchAll(/\{(\w+)\}/g)) if (m[1] !== "owner" && !c.name.includes(`{${m[1]}}`)) out.push(`${c.name}: fallback ${f} uses {${m[1]}}, which the name does not fill`);
    }
  }
  if (new Set(KEYS.map((k) => k.key)).size !== KEYS.length) out.push("two cues expand to the same key");
  return out;
}
