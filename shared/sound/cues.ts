// The catalogue of every occasion the game is heard on (planning/reference/round9-sound-design.md). A cue is an
// occasion on a class of owner: `step/{ground}` on any body. The game asks for an occasion of an owner, and the owner's
// own sound plays, or the first of the cue's fallbacks that exists, or nothing. A sound is `<owner>/sound/<name>` as the
// build names it, so a new sound for an occasion that exists is only takes and a line in its owner's cue sheet.
//
// Names may hold variables in braces, filled from VARIANTS. A fallback is `<owner>/<name>`, where `{owner}` is the asking
// owner and `{name}` its id without the pack (`shotgun` for `core:shotgun`), so a shared family may hold one owner's
// sound under its name; `{family}` is each shared family the owner belongs to, nearest first (a speedboat's
// core:speedboat, then core:boat: vehicleFamilies). A fallback may end in `@<rate>` to play the stand-in at that rate (a
// death cried with its pain is lower).

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
  road: ["asphalt", "gravel", "dirt", "grass", "mud", "sand"],
  revs: ["idle", "low", "mid", "high"],
};

/** Which voices a cue takes and how it weighs when they are short: see client/core/sound/mixer.ts. */
export type CueKind = "vocal" | "step" | "hit" | "weapon" | "build" | "item" | "ui" | "bed" | "music" | "vehicle";
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
cue("drag/{ground}", BODIES, "step", "body", "waits:dragging", "a body carried or held moves along the ground (CUE_HELD)", { falls: ["core:surface/drag/{ground}"] });
cue("splash/in", BODIES, "hit", "body", "fire", "swimming begins: the swim bit or the own body's mode", { falls: ["{owner}/splash/in", "core:body/splash/in/large"] });
cue("splash/out", BODIES, "hit", "body", "fire", "swimming ends", { falls: ["core:body/splash/out"] });
cue("swim", BODIES, "step", "body", "fire", "a stroke while swimming, by the water covered", { falls: ["{owner}/swim", "core:body/swim/stroke"] });
cue("thump", BODIES, "hit", "body", "built", "a body goes down, knocked out or dead, as its hips meet the ground", { falls: ["{owner}/land@0.9", "core:body/thump/medium"] });
cue("rustle", BODIES, "step", "body", "waits:polish", "a body moves through a plant node", { falls: ["core:body/rustle/foliage"] });

// ---- Creatures (species/creature). Each species' own first, then a stand-in of its own, then the shared.
cue("call", CREATURE, "vocal", "body", "built", "an idle with a sound begins (shared/anim/creature.ts idleOf), as its mouth opens");
cue("startled", CREATURE, "vocal", "body", "built", "CUE_STARTLE in the cue word", { falls: ["{owner}/alarm", "{owner}/hurt"] });
cue("hurt", CREATURE, "vocal", "body", "built", "LAYER_FLINCH in the cue word", { falls: ["{owner}/pain"] });
cue("hurt/badly", CREATURE, "vocal", "body", "hook", "the hurt stage bits rise (server/hurt.ts)", { falls: ["{owner}/hurt@0.94"] });
cue("death", CREATURE, "vocal", "body", "built", "the body leaves the view as the server says it died", { falls: ["{owner}/hurt@0.88"] });
cue("attack", CREATURE, "hit", "body", "built", "act=SWING starts; heard as the blow lands (the bite's lands tick)", { falls: ["{owner}/peck", "{owner}/bite", "core:weapon/swing/hands"] });
cue("land", CREATURE, "hit", "body", "built", "CUE_LAND in the cue word", { falls: ["{owner}/thump", "core:body/thump/medium"] });
cue("torpor_in", CREATURE, "vocal", "body", "built", "CUE_TORPOR as it goes out", { falls: ["{owner}/hurt@0.8"] });
cue("torpor_out", CREATURE, "vocal", "body", "built", "CUE_TORPOR as it comes round", { falls: ["{owner}/call@0.85"] });
cue("snore", CREATURE, "vocal", "body", "waits:polish", "lying knocked out", { loop: true });
cue("eat", CREATURE, "item", "body", "built", "LAYER_EAT in the cue word", { falls: ["core:body/eat"] });
cue("chase", CREATURE, "vocal", "body", "fire", "running (the pose's speed near its run): a call now and then, each body on its own time, so a pack talks as it hunts");
cue("growl", CREATURE, "vocal", "body", "fire", "a hunter (temper 2) walking within 15 m of the ear, now and then");
cue("roar", CREATURE, "vocal", "body", "built", "the authoritative mounted roar cue", { falls: ["{owner}/call", "{owner}/startled"] });
cue("flap", CREATURE, "step", "body", "built", "a flyer's wingbeat at the top of each stroke of its flight, none on still wings, and CUE_TAKEOFF");
cue("graze", CREATURE, "item", "body", "waits:behaviour", "grazing; there is no cue for it yet");
cue("sleep", CREATURE, "vocal", "body", "waits:behaviour", "sleeping; there is no cue for it yet", { loop: true });
cue("tamed", CREATURE, "vocal", "body", "hook", "EVENT_TAMED for the owner", { falls: ["{owner}/call"] });
cue("mate", CREATURE, "vocal", "body", "hook", "the mating step bits rise", { falls: ["{owner}/call@1.1"] });
cue("lay", CREATURE, "item", "world", "waits:breeding", "an egg prop appears beside it", { falls: ["core:body/thump/small"] });
cue("hatch", CREATURE, "vocal", "world", "waits:breeding", "an egg prop goes and a young one appears", { falls: ["{owner}/call@1.3"] });
cue("carried", CREATURE, "vocal", "body", "hook", "CUE_HELD is set", { falls: ["{owner}/startled"] });

// ---- The survivor (species/survivor). Others hear these placed; the player hears their own at the ear.
cue("voice/{sex}/hurt", SURVIVOR, "vocal", "body", "fire", "EVENT_HURT for the player; others cannot see it (gap)");
cue("voice/{sex}/hurt/badly", SURVIVOR, "vocal", "body", "fire", "EVENT_HURT taking a quarter of health or more", { falls: ["core:survivor/voice/{sex}/hurt@0.95"] });
cue("voice/{sex}/death", SURVIVOR, "vocal", "body", "fire", "the session goes to SESSION_DEAD; others: the body leaves as died");
cue("voice/{sex}/jump", SURVIVOR, "vocal", "body", "fire", "grounded is lost going up");
cue("voice/{sex}/land", SURVIVOR, "vocal", "body", "fire", "landing from a fall fast enough to hurt");
cue("voice/{sex}/winded", SURVIVOR, "vocal", "ear", "fire", "MF_WINDED is set on the own body");
cue("voice/{sex}/gasp", SURVIVOR, "vocal", "ear", "hook", "the eye comes up out of the water after a while under it");
cue("voice/{sex}/drown", SURVIVOR, "vocal", "ear", "hook", "oxygen is gone and health falls");
cue("voice/{sex}/knocked_out", SURVIVOR, "vocal", "ear", "fire", "MF_OUT is set");
cue("voice/{sex}/wake", SURVIVOR, "vocal", "ear", "fire", "MF_OUT is cleared");
// The glider (planning/workstreams/glider.md), heard from the movement family's takes until it has its own.
cue("glider/open", SURVIVOR, "hit", "body", "fire", "a glider is thrown open: the glide in a body's word begins, or in the own body", { falls: ["core:movement/parachute"] });
cue("glider/fold", SURVIVOR, "hit", "body", "fire", "it folds: by its key, on landing, in water or with stamina spent", { falls: ["core:movement/parachute@1.7"] });
// What an emote says as it begins (shared/anim/emotes.ts `sound`): the voice bank's lines, a man's or a woman's.
for (const line of ["greet", "yes", "no", "laugh", "cheer"]) {
  cue(`voice/male/emote/${line}`, SURVIVOR, "vocal", "body", "fire", `a survivor's emote with sound "${line}" begins (its emote word changes)`, { falls: [`core:voices/${line}/american_man`] });
  cue(`voice/female/emote/${line}`, SURVIVOR, "vocal", "body", "fire", `a survivor's emote with sound "${line}" begins (its emote word changes)`, { falls: [`core:voices/${line}/american_woman`] });
}
cue("voice/{sex}/eat", SURVIVOR, "item", "ear", "fire", "food rises after using an item");
cue("voice/{sex}/drink", SURVIVOR, "item", "ear", "fire", "water rises after using an item");
cue("voice/{sex}/cough", SURVIVOR, "vocal", "ear", "waits:weather", "smoke or sickness");
cue("heartbeat", SURVIVOR, "vocal", "ear", "fire", "health under a quarter", { loop: true });
cue("hungry", SURVIVOR, "vocal", "ear", "fire", "food or water falls past a tenth");
cue("hurt/other", SURVIVOR, "vocal", "body", "gap", "another survivor is hurt: no hurt state is replicated for survivors");
cue("knocked_out/other", SURVIVOR, "vocal", "body", "gap", "another survivor is knocked out: only the forced prone stance shows");

// ---- Weapons and tools, by how they are held. Shared family: core:weapon.
cue("swing/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "act=SWING begins (own: predicted; others: the pose word)", { falls: ["{owner}/swing", "core:weapon/swing/{name}", "core:weapon/swing/{hold}", "core:weapon/swing/hands"] });
cue("draw/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "act=DRAW begins", { falls: ["{owner}/draw", "core:weapon/draw/bow"] });
cue("release/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "a bow's arrow leaves: act goes to COOL after HOLD", { falls: ["{owner}/release", "core:weapon/release/bow"] });
cue("fire/{hold}", ["item", ...BODIES], "weapon", "world", "fire", "own: session.fired; others: EVENT_SHOT within 260 m", { falls: ["{owner}/fire", "core:weapon/fire/{name}", "core:weapon/fire/{hold}"] });
cue("fire/far", "item", "weapon", "world", "fire", "EVENT_SHOT from beyond 150 m", { falls: ["core:weapon/fire/far"] });
cue("fire/crossbow", "item", "weapon", "world", "hook", "a crossbow's shot", { falls: ["{owner}/fire", "core:weapon/fire/crossbow"] });
cue("fire/sling", "item", "weapon", "world", "hook", "a slingshot's shot", { falls: ["{owner}/fire", "core:weapon/fire/sling"] });
cue("fire/silenced", "item", "weapon", "world", "waits:W0", "EVENT_SHOT's silenced bit (protocol 13)");
cue("reload/{hold}", ["item", ...BODIES], "weapon", "body", "fire", "act=RELOAD begins", { falls: ["{owner}/reload", "core:weapon/reload/{name}", "core:weapon/reload/{hold}", "core:weapon/reload/rifle"] });
cue("dry", "item", "weapon", "ear", "hook", "the trigger with no rounds loaded", { falls: ["core:weapon/dry"] });
cue("equip", ["item", ...BODIES], "item", "body", "fire", "act=EQUIP begins", { falls: ["{owner}/equip", "core:weapon/equip"] });
cue("throw", ["item", ...BODIES], "weapon", "body", "fire", "a throw (hold THROW) begins", { falls: ["{owner}/throw", "core:weapon/throw/{name}", "core:weapon/throw"] });
cue("fly/arrow", "prop", "weapon", "world", "hook", "a flying shot passes the ear (shots.ts flies it)", { falls: ["core:weapon/fly/arrow"] });
cue("whiz", "prop", "weapon", "world", "fire", "a hitscan shot's line passes within 4 m of the ear", { falls: ["core:weapon/whiz/bullet"] });
cue("ricochet", "prop", "weapon", "world", "fire", "a hitscan shot ends on the world", { falls: ["core:weapon/ricochet"] });
cue("stick", "prop", "hit", "world", "hook", "an arrow_stuck prop appears", { falls: ["core:weapon/stick"] });
cue("impact/{material}", ["prop", "item"], "hit", "world", "fire", "a blow or a shot lands: EVENT_HIT for the attacker; a projectile's end; the struck thing's material", { falls: ["core:surface/impact/{material}"] });
cue("blast/near", "prop", "weapon", "world", "fire", "EVENT_BLAST within 120 m", { falls: ["core:weapon/blast/near"] });
cue("blast/far", "prop", "weapon", "world", "fire", "EVENT_BLAST beyond 120 m", { falls: ["core:weapon/blast/far"] });
cue("fuse", "prop", "weapon", "body", "hook", "a live grenade lies in view", { loop: true, falls: ["core:weapon/fuse"] });
cue("bounce", "prop", "hit", "body", "waits:polish", "a live grenade's velocity turns", { falls: ["core:weapon/bounce"] });
cue("zap", "prop", "weapon", "world", "hook", "a shock dart's buff on a body", { falls: ["core:weapon/zap"] });
cue("ball/keep", "prop", "item", "world", "fire", "EVENT_BALL with its bit set: a tame goes into a soul ball", { falls: ["core:tech/shimmer"] });
cue("ball/loose", "prop", "item", "world", "fire", "EVENT_BALL with its bit clear: a tame comes out of a soul ball", { falls: ["core:tech/pulse"] });
// A supply drop (planning/workstreams/supply.md). Nothing is sent for these: each client hears a drop from the list it
// is told (S_SUPPLY) and the pose its ticks give (client/core/sound/supply.ts). The supply family's six takes are its
// own; the rest are the tech family's, the banging family's and the weather's.
cue("supply/call", "prop", "item", "world", "fire", "a supply drop has just been called: its shaft comes up", { falls: ["core:tech/chime"] });
cue("supply/shaft", "prop", "build", "world", "fire", "a drop's shaft within hearing, nearest the ear along its height", { loop: true, falls: ["core:supply/shaft", "core:tech/obelisk"] });
cue("supply/release", "prop", "item", "world", "fire", "a drop's cast leaves its sender: the knot's strike, heard as late as its distance makes it", { falls: ["core:weather/thunder/far"] });
cue("supply/pass", "prop", "vehicle", "world", "fire", "a capsule in flight is most of the way to its shaft", { falls: ["core:supply/pass", "core:explosion/rocket/launch"] });
cue("supply/ignite", "prop", "weapon", "world", "fire", "a capsule's jets light, where it starts to brake", { falls: ["core:supply/ignite", "core:explosion/shockwave"] });
cue("supply/jet", "prop", "vehicle", "world", "fire", "a capsule's jets burn: as it brakes, and as it goes", { loop: true, falls: ["core:supply/jet", "core:weapon/flare/burn"] });
cue("supply/cut", "prop", "item", "world", "fire", "a capsule's jets cut as it lands", { falls: ["core:supply/cut", "core:tech/pulse"] });
cue("supply/land", "prop", "hit", "world", "fire", "a capsule touches down", { falls: ["core:supply/land", "core:bang/crate"] });
cue("supply/settle", "prop", "build", "world", "fire", "a landed capsule's louvres start to open", { falls: ["core:bang/lid"] });
cue("supply/count", "prop", "item", "world", "fire", "a chime for each step of a drop's tier, as its lantern opens", { falls: ["core:tech/chime"] });
cue("supply/open", "prop", "item", "world", "fire", "a capsule's hatch is first opened", { falls: ["core:bang/gate"] });
cue("supply/gone", "prop", "item", "world", "fire", "a capsule shuts and goes", { falls: ["core:tech/pulse"] });
cue("hit/marker", "ui", "ui", "ear", "fire", "EVENT_HIT for the attacker", { falls: ["core:weapon/hit/marker"] });
cue("hit/head", "ui", "ui", "ear", "fire", "EVENT_HIT on the head zone", { falls: ["core:weapon/hit/head"] });
cue("kill", "ui", "ui", "ear", "fire", "EVENT_HIT with the killed bit, or EVENT_KILL", { falls: ["core:weapon/kill"] });
cue("break", "item", "item", "ear", "hook", "a held item's durability reaches 0", { falls: ["core:structure/demolish@1.3"] });
cue("auto", "item", "weapon", "world", "waits:W2", "automatic fire");
cue("pellets", "item", "weapon", "world", "waits:W3", "a shotgun's burst");
cue("pump", ["item", ...BODIES], "weapon", "body", "fire", "a pump gun fired: its pump follows the shot", { falls: ["{owner}/pump", "core:weapon/pump/{name}"] });
cue("shell", ["item", ...BODIES], "item", "body", "fire", "a spent case falls after the player's own gunshot", { falls: ["{owner}/shell", "core:weapon/shell/eject"] });
cue("bola", "item", "weapon", "world", "hook", "a bola wraps a body (the root buff appears)", { falls: ["core:weapon/bola/wrap"] });
cue("smoke", "prop", "weapon", "world", "hook", "a smoke or poison cloud near the ear", { loop: true, falls: ["core:weapon/gas/hiss"] });
cue("flare", "prop", "weapon", "world", "hook", "a flare burning near the ear", { loop: true, falls: ["core:weapon/flare/burn"] });
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
cue("lock", "structure", "build", "ear", "hook", "RESULT_PIN or a lock command's result, for its user only", { falls: ["core:structure/lock"] });
cue("box/open/{door}", "structure", "build", "ear", "hook", "OWN_OPEN opens, for its user only", { falls: ["core:structure/box/open/{door}"] });
cue("box/close/{door}", "structure", "build", "ear", "hook", "OWN_OPEN closes", { falls: ["core:structure/box/close/{door}"] });
cue("fire/light", "structure", "build", "world", "fire", "a station's kind swaps to its lit kind", { falls: ["core:structure/fire/light"] });
cue("fire/out", "structure", "build", "world", "fire", "a lit kind swaps back", { falls: ["core:structure/fire/out"] });
cue("fire/burn", "structure", "bed", "world", "fire", "a lit station within hearing", { loop: true, falls: ["core:world/fire"] });
cue("station/run", "structure", "build", "world", "waits:stations", "a station's jobs run", { loop: true, falls: ["core:structure/grind"] });
cue("bed/use", "structure", "ui", "ear", "hook", "respawning at a bed", { falls: ["core:structure/bed/use"] });
cue("turret", "structure", "weapon", "world", "waits:defences", "a turret fires");

// ---- Nodes. Shared family core:node, by the node's material.
cue("felled", "node", "build", "world", "fire", "a wood node's slot is used up (S_NODES)", { falls: ["{owner}/felled", "core:node/felled/wood"] });
cue("crumble", "node", "build", "world", "fire", "a stone node's slot is used up", { falls: ["{owner}/crumble", "core:node/crumble/stone"] });
cue("picked", "node", "build", "world", "fire", "a plant node's slot is used up", { falls: ["{owner}/picked", "core:node/picked/foliage"] });
cue("struck", "node", "hit", "world", "hook", "a blow lands on a node (own strike and aim, which the session does not keep)", { falls: ["core:surface/impact/wood"] });
cue("regrow", "node", "build", "world", "waits:polish", "a node's slot is freed");

// ---- The interface, never placed. Shared family core:ui.
// The interface fires these (client/core/ui/ui.ts, client/core/sound/actions.ts); the rest have their moment in the
// interface's code and wait for a line there.
const UI_FIRED = new Set(["click", "level_up", "engram", "respawn", "tame/done", "dead"]);
for (const n of ["click", "hover", "back", "tab", "toggle", "slider", "slot/pick", "slot/drop", "craft/queue", "craft/done", "error", "notice", "chat", "level_up", "engram", "respawn", "tame/done", "tribe", "ghost/snap", "dead"]) {
  // `dead` is the player's own death sting; `death` is the creature's cry.
  cue(n, "ui", "ui", "ear", UI_FIRED.has(n) ? "fire" : "hook", `the interface: ${n.replace("/", " ")}`, { falls: [`core:ui/${n === "dead" ? "death" : n}`] });
}
cue("screen/{screen}/open", "ui", "ui", "ear", "fire", "a screen or panel opens", { falls: ["core:ui/open"] });
cue("screen/{screen}/close", "ui", "ui", "ear", "fire", "a screen or panel closes", { falls: ["core:ui/close"] });
cue("whistle/{order}", "ui", "ui", "ear", "hook", "a whistle key; others hear nothing (gap)", { falls: ["core:ui/whistle/{order}", "core:ui/whistle/follow"] });

// ---- The world, where the ear is. Shared family core:world.
cue("bed/{biome}/{time}", "world", "bed", "ear", "fire", "the clock (shared/sim/clock.ts) and the place: beach near the sea, jungle among many trees, else grass", { loop: true, falls: ["core:world/bed/{biome}/{time}", "core:world/bed/grass/{time}"] });
cue("bed/ruins", "world", "bed", "ear", "waits:maps", "inside static ruins", { loop: true, falls: ["core:world/bed/ruins"] });
cue("bed/sea", "world", "bed", "ear", "fire", "the ear over open water far from land", { loop: true, falls: ["core:world/bed/sea"] });
cue("underwater", "world", "bed", "ear", "fire", "the eye below sea level", { loop: true, falls: ["core:world/underwater"] });
cue("shore", "world", "bed", "ear", "fire", "the ear near the edge of the sea", { loop: true, falls: ["core:world/shore"] });
cue("wind/light", "world", "bed", "ear", "fire", "the ear well above the ground", { loop: true, falls: ["core:world/wind/light"] });
cue("wind/strong", "world", "bed", "ear", "fire", "the ear high above the ground", { loop: true, falls: ["core:world/wind/strong"] });
cue("glider/air", "world", "bed", "ear", "fire", "the own body is under an open glider, louder the faster it flies", { loop: true, falls: ["core:movement/fall"] });
cue("stinger/dawn", "world", "bed", "ear", "fire", "the clock passes sunrise", { falls: ["core:world/stinger/dawn"] });
cue("stinger/dusk", "world", "bed", "ear", "fire", "the clock passes sunset", { falls: ["core:world/stinger/dusk"] });
cue("rain/light", "world", "bed", "ear", "waits:weather", "rain", { loop: true, falls: ["core:world/rain/light"] });
cue("rain/heavy", "world", "bed", "ear", "waits:weather", "a storm", { loop: true, falls: ["core:world/rain/heavy"] });
cue("thunder", "world", "bed", "ear", "waits:weather", "lightning", { falls: ["core:world/thunder"] });
cue("river", "world", "bed", "world", "waits:maps", "a river near the ear", { loop: true, falls: ["core:world/river"] });
cue("waterfall", "world", "bed", "world", "waits:maps", "a waterfall near the ear", { loop: true, falls: ["core:world/waterfall"] });
cue("cave", "world", "bed", "ear", "waits:caves", "inside a cave", { loop: true });
cue("crate/land", "prop", "build", "world", "waits:loot", "a supply crate lands");

// ---- Vehicles (species/vehicle; feat/vehicle-foundation). A vehicle's own sounds first (in its folder), then its
// families' (`{family}`: core:helicopter, then any family it belongs to as well, from vehicleFamilies), then core:vehicle,
// the shared car. Every family names its sounds as core:vehicle does, so one engine of four layers serves a car, a rotor
// or an outboard alike.
const VEHICLE = "species/vehicle";
const WAITS_VEHICLES = "waits:vehicles";
// Every vehicle fires these from its snapshot state (client/core/sound/vehicles.ts).
const FIRED = new Set(["engine/{revs}", "engine/start", "engine/stop", "vehicle/cabin", "vehicle/wash", "vehicle/wash/water", "vehicle/hull/slow", "vehicle/hull/fast", "vehicle/thruster/boost", "vehicle/thruster/burst"]);
const vstatus = (name: string): CueStatus => (FIRED.has(name) ? "fire" : WAITS_VEHICLES);
const vfalls = (n: string, shared = true): string[] => [`{owner}/${n}`, `{family}/${n}`, ...(shared ? [`core:vehicle/${n}`] : [])];
cue("engine/{revs}", VEHICLE, "vehicle", "body", vstatus("engine/{revs}"), "a running engine (a rotor, a propeller, an outboard): four layers looped and faded across by rpm, not yet pitched to it", { loop: true, falls: vfalls("engine/{revs}") });
for (const n of ["start", "stop", "rev", "stall"]) cue(`engine/${n}`, VEHICLE, "vehicle", "body", vstatus(`engine/${n}`), `the engine: ${n} (the snapshot's engine state)`, { falls: vfalls(`engine/${n}`) });
cue("engine/brake", VEHICLE, "vehicle", "body", WAITS_VEHICLES, "a truck slowing on its engine brake", { falls: vfalls("engine/brake", false) });
cue("shift", VEHICLE, "vehicle", "body", WAITS_VEHICLES, "the gear changes", { falls: vfalls("shift") });
cue("tire/roll/{road}", VEHICLE, "vehicle", "body", WAITS_VEHICLES, "wheels on the ground at speed, by the surface under them (urban:asphalt, gravel, mud)", { loop: true, falls: ["core:vehicle/tire/roll/{road}", "core:vehicle/tire/roll/dirt"] });
cue("tire/skid/{road}", VEHICLE, "vehicle", "body", WAITS_VEHICLES, "the wheels slip", { loop: true, falls: ["core:vehicle/tire/skid/{road}", "core:vehicle/tire/skid/asphalt"] });
for (const n of ["brake", "handbrake", "horn", "door/open", "door/close", "crash/light", "crash/heavy", "glass/break", "suspension", "splash"]) cue(`vehicle/${n}`, VEHICLE, "vehicle", "body", WAITS_VEHICLES, `the vehicle: ${n.replace("/", " ")}`, { falls: vfalls(n) });
cue("vehicle/wind", VEHICLE, "bed", "ear", WAITS_VEHICLES, "wind past the cabin at speed, for the driver and passengers", { loop: true, falls: ["{family}/wind", "core:vehicle/wind"] });
cue("vehicle/cabin", VEHICLE, "bed", "ear", vstatus("vehicle/cabin"), "the engine as heard inside, for the pilot and passengers of a helicopter or plane", { loop: true, falls: vfalls("cabin", false) });
// Each family's own occasions: a rotor's wash, a hull in the water, a raft's paddle and sail, a ship's anchor, a board's tricks.
const VEHICLE_ONCE: Readonly<Record<string, string>> = {
  flyby: "a helicopter or plane passes fast and low, heard by those it passes",
  land: "it comes down onto the ground: a helicopter's skids, a skateboard after a jump",
  gear: "a plane's landing gear lowers or rises",
  touchdown: "a plane's wheels meet the runway",
  stall: "a plane's stall warning, as it slows too far in the air",
  alarm: "a helicopter's cockpit warning: low fuel, a wreck",
  slam: "a hull drops onto the water off a wave",
  beach: "a hull or raft runs aground",
  bump: "a raft knocks into a rock or a shore",
  paddle: "a paddle stroke",
  "sail/fill": "a sail catches the wind",
  "horn/small": "a yacht's horn, where its owner has a ship's as well",
  "anchor/drop": "the anchor goes down",
  "anchor/raise": "the anchor comes up",
  bell: "a ship's bell",
  push: "a rider pushes a skateboard on",
  ollie: "a skateboard leaves the ground",
  grind: "a skateboard grinds along an edge",
};
for (const [n, when] of Object.entries(VEHICLE_ONCE)) cue(`vehicle/${n}`, VEHICLE, "vehicle", "body", WAITS_VEHICLES, when, { falls: vfalls(n, false) });
const VEHICLE_LOOPS: Readonly<Record<string, string>> = {
  wash: "a helicopter's downwash on the ground below it",
  "wash/water": "a helicopter's downwash on the water below it",
  "hull/slow": "water at the hull, moving slowly or at rest",
  "hull/fast": "water at the hull at speed",
  creak: "a raft's logs and lashings, or a wooden hull, working in the swell",
  "sail/flap": "a sail loose in the wind",
  reverse: "a truck backing up",
  roll: "a bicycle coasting",
  pedal: "a bicycle being pedalled",
  "roll/rough": "a skateboard rolling on rough ground",
  "roll/smooth": "a skateboard rolling on smooth ground",
};
for (const [n, when] of Object.entries(VEHICLE_LOOPS)) cue(`vehicle/${n}`, VEHICLE, "vehicle", "body", vstatus(`vehicle/${n}`), when, { loop: true, falls: vfalls(n, false) });
// A board's tricks, each standing in for a sound of its own until it has takes: the pop's crack quicker for a flip, the
// landing's quicker for the feet catching the deck, a slow push for a revert's scrape, and the grind's take held.
const SKATE_ONCE: Readonly<Record<string, readonly [string, string]>> = {
  flip: ["a skateboard turning under its rider in a trick", "ollie@1.5"],
  catch: ["a rider's feet meeting the deck again after a trick", "land@1.3"],
  revert: ["a skateboard's wheels scraping round in a revert", "push@.75"],
};
for (const [n, [when, stand]] of Object.entries(SKATE_ONCE)) cue(`vehicle/${n}`, VEHICLE, "vehicle", "body", WAITS_VEHICLES, when, { falls: [...vfalls(n, false), `{family}/${stand}`] });
cue("vehicle/grind/loop", VEHICLE, "vehicle", "body", WAITS_VEHICLES, "a skateboard grinding along an edge, held", { loop: true, falls: [...vfalls("grind/loop", false), "{family}/grind"] });
cue("vehicle/slide/loop", VEHICLE, "vehicle", "body", WAITS_VEHICLES, "a skateboard sliding across an edge, held", { loop: true, falls: [...vfalls("slide/loop", false), "{family}/grind@.8"] });
// A thruster car's cold gas (shared/sim/vehicle-thrusters.ts), until it has takes of its own: the supply capsule's jets.
cue("vehicle/thruster/boost", VEHICLE, "vehicle", "body", vstatus("vehicle/thruster/boost"), "a thruster car's boost: compressed air roaring from its tail nozzles", { loop: true, falls: [...vfalls("thruster/boost", false), "core:supply/jet"] });
cue("vehicle/thruster/burst", VEHICLE, "vehicle", "body", vstatus("vehicle/thruster/burst"), "a thruster car's burst: a sharp blast of compressed air that hops it and turns it over", { falls: [...vfalls("thruster/burst", false), "core:supply/ignite"] });

/** The shared families a vehicle may belong to, each by the words that name it, and the family each one also falls back to. */
export const VEHICLE_FAMILIES: Readonly<Record<string, { words: readonly string[]; also?: string }>> = {
  helicopter: { words: ["helicopter", "heli", "chopper", "gyrocopter"] },
  plane: { words: ["plane", "airplane", "aeroplane", "aircraft", "biplane", "seaplane", "glider"] },
  speedboat: { words: ["speedboat", "powerboat", "jetski"], also: "boat" },
  boat: { words: ["boat", "motorboat", "dinghy", "skiff"] },
  raft: { words: ["raft", "canoe", "kayak"], also: "boat" },
  ship: { words: ["ship", "yacht", "ferry", "trawler"], also: "boat" },
  motorbike: { words: ["motorbike", "motorcycle", "dirtbike", "scooter", "quad"] },
  bicycle: { words: ["bicycle", "bmx", "cycle"] },
  skateboard: { words: ["skateboard", "longboard"] },
  truck: { words: ["truck", "lorry", "pickup", "semi", "bus"] },
  muscle: { words: ["muscle", "musclecar", "hotrod"] },
};

/** A vehicle's families, nearest first (`core:speedboat`, then `core:boat`), from its id and its definition's aliases: the
 * first family one of them names, and the family that one falls back to. A name is a word whole and each of its parts, so
 * a livery or a wreck (`core:helicopter_rescue`, `core:boat_wreck`) is of its vehicle's family. None for a vehicle no word
 * places (the compact). */
export function vehicleFamilies(id: string, aliases: readonly string[] = []): string[] {
  const words = [id.slice(id.indexOf(":") + 1), ...aliases].flatMap((w) => {
    const lower = w.toLowerCase();
    return [lower.replace(/[^a-z0-9]/g, ""), ...lower.split(/[^a-z0-9]+/)];
  });
  for (const [f, def] of Object.entries(VEHICLE_FAMILIES)) {
    if (def.words.some((w) => words.includes(w))) return [`core:${f}`, ...(def.also ? [`core:${def.also}`] : [])];
  }
  return [];
}

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
export function candidates(owner: string, k: CueKey, families: readonly string[] = []): { id: string; rate: number }[] {
  const name = owner.slice(owner.indexOf(":") + 1);
  const fill = (s: string, family: string): string => s.replace(/\{(\w+)\}/g, (_, v: string) => (v === "owner" ? owner : v === "name" ? name : v === "family" ? family : (k.vars[v] ?? `{${v}}`)));
  const out = [{ id: `${owner}/sound/${k.key}`, rate: 1 }];
  for (const f of k.cue.falls) {
    const [path, rate] = f.split("@") as [string, string | undefined];
    // `{family}` stands for each of the owner's families in turn, and for nothing where it has none.
    for (const family of path.includes("{family}") ? families : [""]) {
      const full = fill(path, family);
      const slash = full.indexOf("/");
      out.push({ id: `${full.slice(0, slash)}/sound/${full.slice(slash + 1)}`, rate: rate ? Number(rate) : 1 });
    }
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
      if (!/^(\{owner\}|\{family\}|[a-z0-9_]+:[a-z0-9_]+)\/[a-z0-9_/{}]+(@[0-9.]+)?$/.test(f)) out.push(`${c.name}: fallback ${f} is not <owner>/<name>[@rate]`);
      for (const m of f.matchAll(/\{(\w+)\}/g)) if (m[1] !== "owner" && m[1] !== "name" && m[1] !== "family" && !c.name.includes(`{${m[1]}}`)) out.push(`${c.name}: fallback ${f} uses {${m[1]}}, which the name does not fill`);
    }
  }
  if (new Set(KEYS.map((k) => k.key)).size !== KEYS.length) out.push("two cues expand to the same key");
  return out;
}
