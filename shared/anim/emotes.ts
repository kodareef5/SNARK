// Emotes: gestures, dances, scary and idle moves, reactions, and the moves two play together. Each is one row here and
// one clip, `human/emote/<id>` (written as code in emote-clips.ts, or brought in from a motion library). A survivor's
// emote is replicated as its number (its place in this list, from 1) with its first tick (AnimState.packEmote), so
// the list only ever grows at the end. Tags say what a move is for: a player's emote wheel pages by them and a bot's
// idle picks by them (grunt, through the game's capabilities).

export interface EmoteDef {
  readonly id: string;
  readonly name: string;
  /** A loop plays until stopped (or for `seconds`); a one-shot plays once, its clip's length. */
  readonly loop: boolean;
  /** "upper": the arms, back and head, over whatever the legs do; "full": the whole body. */
  readonly mask: "full" | "upper";
  /** The body may walk while it plays (an upper-body move); otherwise moving ends it. */
  readonly moving: boolean;
  readonly tags: readonly string[];
  /** A loop ends by itself after this long; 0 for until stopped. */
  readonly seconds: number;
  /** A voice line played as it begins (shared/sound). */
  readonly sound?: string;
  /** Played by two face to face, `apart` metres between them: the other side plays `with` (itself if the same). */
  readonly pair?: { readonly with: string; readonly apart: number };
  /** Others may join it, in step with the one they join. */
  readonly group?: boolean;
}

type Extra = Partial<Pick<EmoteDef, "moving" | "seconds" | "sound" | "pair" | "group">>;

const gesture = (id: string, name: string, tags: string[], extra: Extra = {}): EmoteDef => ({ id, name, loop: false, mask: "upper", moving: true, tags, seconds: 0, ...extra });
const held = (id: string, name: string, tags: string[], extra: Extra = {}): EmoteDef => ({ id, name, loop: true, mask: "upper", moving: true, tags, seconds: 0, ...extra });
const whole = (id: string, name: string, tags: string[], extra: Extra = {}): EmoteDef => ({ id, name, loop: false, mask: "full", moving: false, tags, seconds: 0, ...extra });
const dance = (id: string, name: string, tags: string[] = [], extra: Extra = {}): EmoteDef => ({ id, name, loop: true, mask: "full", moving: false, tags: ["dance", "fun", ...tags], seconds: 0, group: true, ...extra });
const pose = (id: string, name: string, tags: string[], extra: Extra = {}): EmoteDef => ({ id, name, loop: true, mask: "full", moving: false, tags, seconds: 0, ...extra });
const pair = (id: string, name: string, tags: string[], apart: number, partner = id, extra: Extra = {}): EmoteDef => ({ id, name, loop: false, mask: "full", moving: false, tags: ["pair", ...tags], seconds: 0, pair: { with: partner, apart }, ...extra });

/** In the order they were added: an emote's number is its place here, from 1. Add only at the end. */
export const EMOTES: readonly EmoteDef[] = [
  // Greetings and calls.
  gesture("wave", "Wave", ["greeting", "friendly"], { sound: "greet" }),
  gesture("wave_big", "Big wave", ["greeting", "friendly", "fun"], { sound: "greet" }),
  gesture("beckon", "Come here", ["call", "friendly"]),
  gesture("point", "Point", ["call"]),
  gesture("point_up", "Point up", ["call"]),
  gesture("salute", "Salute", ["greeting", "respect"]),
  gesture("nod", "Nod", ["answer", "friendly"], { sound: "yes" }),
  gesture("head_shake", "Shake head", ["answer"], { sound: "no" }),
  gesture("stop", "Stop", ["call", "warning"]),
  // Approval and feeling.
  gesture("thumbs_up", "Thumbs up", ["approval", "friendly"]),
  gesture("thumbs_down", "Thumbs down", ["disapproval", "rude"]),
  gesture("clap", "Clap", ["approval", "fun"]),
  gesture("slow_clap", "Slow clap", ["approval", "taunt"]),
  gesture("cheer", "Cheer", ["approval", "victory", "fun"], { sound: "cheer" }),
  gesture("fist_pump", "Fist pump", ["victory", "fun"]),
  gesture("shrug", "Shrug", ["answer", "idle"]),
  gesture("facepalm", "Facepalm", ["disapproval", "fun"]),
  gesture("think", "Think", ["idle"]),
  gesture("shush", "Shush", ["warning"]),
  gesture("watching_you", "I'm watching you", ["taunt", "scary"]),
  gesture("throat_slash", "Throat slash", ["taunt", "rude", "scary"]),
  gesture("laugh", "Laugh", ["reaction", "fun"], { sound: "laugh" }),
  gesture("check_wrist", "Check the time", ["idle", "taunt"]),
  gesture("yawn", "Yawn", ["idle", "rest"]),
  held("cross_arms", "Cross arms", ["idle", "waiting"]),
  held("hands_on_hips", "Hands on hips", ["idle", "waiting"]),
  held("stare", "Stare", ["scary", "taunt"]),
  // Whole-body one-shots.
  whole("bow", "Bow", ["greeting", "respect"]),
  whole("flex", "Flex", ["showoff", "fun", "victory"]),
  whole("stretch", "Stretch", ["idle", "rest"]),
  whole("roar", "Roar", ["scary", "taunt"]),
  whole("startle", "Startle", ["reaction"]),
  whole("victory_jump", "Victory jump", ["victory", "fun"], { sound: "cheer" }),
  whole("claw", "Claw swipe", ["scary", "taunt"]),
  // Dances.
  dance("sway", "Sway", ["calm"]),
  dance("robot", "The robot"),
  dance("chicken", "Chicken dance", ["silly"]),
  dance("side_shuffle", "Side shuffle"),
  dance("running_man", "Running man"),
  dance("sprinkler", "Sprinkler", ["silly"]),
  dance("raise_roof", "Raise the roof"),
  dance("disco", "Disco"),
  dance("twist", "The twist"),
  dance("headbang", "Headbang"),
  dance("jumping_jacks", "Jumping jacks", ["exercise"]),
  dance("pogo", "Pogo"),
  dance("egyptian", "Walk like an Egyptian", ["silly"]),
  // Rest, life and showing off.
  pose("sit", "Sit", ["rest", "idle"]),
  pose("sit_cross", "Sit cross-legged", ["rest", "idle", "calm"]),
  pose("lie_back", "Lie back", ["rest", "idle"]),
  pose("meditate", "Meditate", ["rest", "calm"]),
  pose("kneel", "Kneel", ["rest", "respect"]),
  pose("pushups", "Push-ups", ["exercise", "showoff"]),
  pose("play_dead", "Play dead", ["fun", "silly"]),
  pose("cower", "Cower", ["reaction", "scared"]),
  pose("stalk", "Stalk", ["scary"]),
  pose("zombie", "Zombie", ["scary", "silly"]),
  pose("cry", "Cry", ["reaction", "sad"]),
  // Played by two.
  pair("handshake", "Handshake", ["greeting", "friendly"], 0.68),
  pair("high_five", "High five", ["greeting", "friendly", "victory", "fun"], 0.64),
  pair("fist_bump", "Fist bump", ["greeting", "friendly"], 0.68),
  pair("hug", "Hug", ["friendly"], 0.42),
  pair("chest_bump", "Chest bump", ["victory", "fun"], 0.55),
  pair("scare", "Scare", ["scary", "fun"], 0.9, "startled"),
  pair("startled", "Startled", ["reaction"], 0.9, "scare"),
  // From the motion library (LIBRARY_EMOTES): their clips are in the art packs, not written here.
  dance("groove", "Groove"),
  pose("talk", "Talk", ["idle", "social"]),
  pose("phone", "On the phone", ["idle", "silly"]),
  pose("fold_arms", "Fold arms", ["idle", "waiting"]),
  pose("fix", "Fix something", ["idle", "work"]),
  pose("magic", "Conjure", ["fun", "silly"]),
  pose("zombie_idle", "Zombie sway", ["scary", "silly"]),
  gesture("yes", "Yes", ["answer", "friendly"], { sound: "yes" }),
  gesture("no", "No", ["answer"], { sound: "no" }),
  gesture("eat", "Eat", ["idle", "rest"]),
  gesture("cast", "Cast", ["fun", "taunt"]),
  whole("flinch", "Flinch", ["reaction"]),
  whole("zombie_scratch", "Zombie scratch", ["scary", "taunt"]),
  whole("plant", "Plant a seed", ["idle", "work"]),
  whole("water_plants", "Water the plants", ["idle", "work"]),
];

/** Emotes whose clips come from the motion library in the art packs (assets/source/core/humans/human-clips): where a
 * pack lacks one, it cannot be played there. */
export const LIBRARY_EMOTES: ReadonlySet<string> = new Set(["groove", "talk", "phone", "fold_arms", "fix", "magic", "zombie_idle", "yes", "no", "eat", "cast", "flinch", "zombie_scratch", "plant", "water_plants"]);

/** An emote's number (its place from 1), or 0 if there is no such. */
export const EMOTE_NUMBER: ReadonlyMap<string, number> = new Map(EMOTES.map((e, i) => [e.id, i + 1]));

export function emoteOf(n: number): EmoteDef | null {
  return EMOTES[n - 1] ?? null;
}

export const emoteClipId = (id: string): string => `human/emote/${id}`;

/** Ticks to blend an emote in, and a one-shot out. */
export const EMOTE_FADE = 6;
