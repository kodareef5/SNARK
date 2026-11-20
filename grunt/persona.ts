// A character's persona: who it is when nobody is telling it what to do. Traits from 0 to 1 weight what its idle does
// (grunt/idle.ts) and how it answers others' emotes; a line for the Director keeps its chat in character. A persona is
// one of the built-in ones by name, or one written out (game_connect's persona, or a file beside the agenda). Nothing
// here calls a model: the idle is rules over the game's own list of emotes.

export interface Traits {
  /** Dances, silly moves, joins in. */
  playful: number;
  /** Greets, waves back, says yes to a high five. */
  social: number;
  /** Stares, stalks, taunts strangers. */
  menacing: number;
  /** Keeps away, cowers from strangers, says no to a hug. */
  shy: number;
  /** Does something often, and the lively thing (exercise, a jump) over the quiet one. */
  energetic: number;
  /** Flexes, shows off a dance when someone is watching. */
  showoff: number;
}

export interface Persona {
  name: string;
  /** How it is, in a line, for the Director. */
  about: string;
  traits: Traits;
}

const traits = (t: Partial<Traits>): Traits => ({ playful: 0.3, social: 0.5, menacing: 0.1, shy: 0.1, energetic: 0.4, showoff: 0.2, ...t });

export const PERSONAS: Record<string, Persona> = {
  stoic: { name: "stoic", about: "calm and steady: few words, a nod for a friend, never a show", traits: traits({ playful: 0.1, social: 0.4, energetic: 0.2, showoff: 0 }) },
  cheerful: { name: "cheerful", about: "warm and upbeat: waves at everyone, dances when it's quiet, always up for a high five", traits: traits({ playful: 0.8, social: 0.9, energetic: 0.7, showoff: 0.4 }) },
  grumpy: { name: "grumpy", about: "gruff and short-tempered: arms crossed, a thumbs down or a head shake, a wave only for its own people", traits: traits({ playful: 0.05, social: 0.2, menacing: 0.35, energetic: 0.2, showoff: 0.1 }) },
  spooky: { name: "spooky", about: "unsettling: stares at strangers, stalks a little, a roar or a zombie shamble when the mood takes it, then laughs", traits: traits({ playful: 0.5, social: 0.3, menacing: 0.9, shy: 0, energetic: 0.5, showoff: 0.3 }) },
  shy: { name: "shy", about: "timid: keeps its distance from strangers, cowers when cornered, a small nod for friends", traits: traits({ playful: 0.2, social: 0.3, menacing: 0, shy: 0.9, energetic: 0.2, showoff: 0 }) },
  showoff: { name: "showoff", about: "loud and proud: flexes, dances for anyone watching, challenges people to a chest bump", traits: traits({ playful: 0.8, social: 0.7, menacing: 0.2, energetic: 0.9, showoff: 0.95 }) },
};

/** A persona written out: any of its parts, its missing traits the defaults. */
export type PersonaInput = { name?: string; about?: string; traits?: Partial<Traits> };

/** A persona by name (or one written out, its missing traits the defaults); the stoic one when none is given. */
export function personaOf(p?: string | PersonaInput | null): Persona {
  if (!p) return PERSONAS.stoic!;
  if (typeof p === "string") return PERSONAS[p.toLowerCase()] ?? { ...PERSONAS.stoic!, name: p };
  return { name: p.name ?? "custom", about: p.about ?? "", traits: traits(p.traits ?? {}) };
}

/** A small seeded random source (mulberry32), so a persona's idle repeats under test. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** One of `items` by weight; null if none weighs anything. */
  pick<T>(items: readonly T[], weight: (t: T) => number): T | null {
    let total = 0;
    for (const t of items) total += Math.max(0, weight(t));
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const t of items) if ((r -= Math.max(0, weight(t))) < 0) return t;
    return items[items.length - 1] ?? null;
  }
}
