// Server rules: the numbers an operator may turn without touching content.
//
// Each is a factor in the one damage function (shared/sim/damage.ts) or a
// switch a client is told of. They are saved with the world, changed from the
// console (`rule`), and read where they are used: nothing caches one.

export const RULE_DEFAULTS = {
  /** What damage from one survivor to another is multiplied by. 0 makes survivors safe from each other. */
  playerDamage: 1,
  /** What damage from a survivor to a creature is multiplied by. */
  creatureDamage: 1,
  /** What damage to anything built is multiplied by. */
  structureDamage: 1,
  /** What a survivor's own blast does to them. */
  selfDamage: 1,
  /** 1: where a hit lands matters (a head counts for more). 0: every part counts once. */
  headshots: 1,
  /** 1: clients may show the damage of their hits as numbers. 0: they are told the numbers but asked not to show them. */
  damageNumbers: 1,
  /** 1: members of a tribe can hurt each other, their tames and what they built. 0: only their blasts can. */
  friendlyFire: 0,
  /** 1: there is a text channel that reaches everyone. 0: only those near, and one's tribe. */
  globalChat: 1,
  /** 1: a voice is heard by everyone, wherever they are. 0: only by those it carries to. */
  globalVoice: 0,
} as const;

export type RuleName = keyof typeof RULE_DEFAULTS;
export const RULE_NAMES = Object.keys(RULE_DEFAULTS) as RuleName[];

export class Rules {
  readonly values: Record<RuleName, number> = { ...RULE_DEFAULTS };
  /** Counts every change, for sending and for saving. */
  version = 0;

  /** Set a rule. False if there is no such rule or the value is not a number from 0 to 100. */
  set(name: string, value: number): boolean {
    if (!(RULE_NAMES as string[]).includes(name) || !(value >= 0 && value <= 100)) return false;
    this.values[name as RuleName] = value;
    this.version++;
    return true;
  }

  serialize(): string {
    return JSON.stringify(this.values);
  }

  /** Take in saved rules. Anything unknown or out of range is left at its default. */
  restore(saved: string | number | null): void {
    if (typeof saved !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    for (const name of RULE_NAMES) {
      const v = (parsed as Record<string, unknown>)[name];
      if (typeof v === "number" && v >= 0 && v <= 100) this.values[name] = v;
    }
  }
}
