// The hand rule for each profile: a line of weights written by a person. It decides until a trained scorer beats it,
// and it is the mark a trained one is held to (tools/decide).

import { linear, type Model } from "./forward.ts";
import { profileHash, type Profile } from "./profile.ts";
import { DO, PICK, PROBE, REACH, RING_FAR, RING_MID, RING_NEAR, SNAG, SURE } from "./profiles.ts";

interface Weights<S extends string, C extends string> {
  state?: Partial<Record<S, number>>;
  /** For the candidate's own columns. */
  own?: Partial<Record<C, number>>;
  /** In a ring, for the same columns of the candidate on either side. */
  beside?: Partial<Record<C, number>>;
  /** For the profile's crosses, each named `state*column`. */
  cross?: Partial<Record<`${S}*${C}`, number>>;
  constant?: number;
}

/** A line of weights for `p` from weights given by column name; a column not named weighs nothing. */
export function ruleOf<S extends string, C extends string>(p: Profile<S, C>, w: Weights<S, C>): Model {
  const m = linear(p, profileHash(p));
  const s = p.state.length, n = p.columns.length;
  for (const [name, v] of Object.entries(w.state ?? {})) m.w1[p.s[name as S]] = v as number;
  for (const [name, v] of Object.entries(w.own ?? {})) m.w1[s + p.c[name as C]] = v as number;
  if (w.beside && !p.ring) throw new Error(`${p.name} is no ring and has nothing beside a candidate`);
  for (const [name, v] of Object.entries(w.beside ?? {})) {
    m.w1[s + n + p.c[name as C]] = v as number;
    m.w1[s + 2 * n + p.c[name as C]] = v as number;
  }
  const first = s + n * (p.ring ? 3 : 1);
  for (const [name, v] of Object.entries(w.cross ?? {})) {
    const at = p.crosses.findIndex(([a, b]) => `${a}*${b}` === name);
    if (at < 0) throw new Error(`${p.name} has no cross ${name}`);
    m.w1[first + at] = v as number;
  }
  m.b2 = w.constant ?? 0;
  return m;
}

/** Toward what it wants and away from what it fears, a little toward the heading it holds, away from one that failed. */
export const RULE_FAR = ruleOf(RING_FAR, {
  own: { goal: 2, way: 2.5, threat: -1, prey: 2.5, home: 0.5, pull: 1.5, held: 0.3, tried: -1.5 },
  // Deep in trouble the goal's own bearing counts for less and the way back along its trail for more.
  cross: { "flee*threat": -2, "rung*goal": -2, "rung*trail": 1 },
});
/** Toward free ground, more where the ways beside it are free too; away from drops, climbs, water, harm and crowds. */
export const RULE_MID = ruleOf(RING_MID, {
  own: { run: 2, runHigh: 1, drop: -1.5, rise: -0.75, wet: -4, hurt: -2, crowd: -0.5, held: 0.3, tried: -1.5 },
  beside: { run: 0.4, runHigh: 0.2 },
  // Pain is a price, and the deeper the trouble the more of it is worth paying: at the last rung water is nearly free.
  cross: { "rung*wet": 3.6, "rung*hurt": 1, "rung*drop": 0.6 },
});
/** Away from what it presses on, toward the open side. */
export const RULE_NEAR = ruleOf(RING_NEAR, { own: { open: 2, pressed: -3, body: -1, held: 0.2, tried: -1 }, beside: { open: 0.5 }, cross: { "pinned*pressed": -2 } });
/** A snag is likely where pace and gain are low, and nearly sure once it is stuck or pinned. */
export const RULE_SNAG = ruleOf(SNAG, { own: { pace: -2, gain1: -1.5, gain2: -1, gain4: -0.5, stuck: 3, pinned: 3, onWay: -0.3, noWay: 1.5 }, constant: -2 });
/** A pick frees it where it is clear, leads the others, and was not tried. */
export const RULE_SURE = ruleOf(SURE, { own: { ways: 1, open: 2, run: 1.5, price: -1, tried: -2 }, constant: -1.5 });
/** It arrives unless it is far, blocked, told there is no way, often stuck, or nearly out of time. */
export const RULE_REACH = ruleOf(REACH, { own: { lineSoon: -1, waySoon: -0.5, blocked: -1, onWay: 1, noWay: -3, stucks: -2, spent: -1.5 }, constant: 2.5 });
/** The freest of the three, the one drawn where they are near alike, and a little toward the way it faces. */
export const RULE_PROBE = ruleOf(PROBE, { own: { run: 3, runHigh: 1.5, drawn: 0.5, facing: 0.2 } });
/** The highest priority, then the nearest; a little toward the place already made for. */
export const RULE_PICK = ruleOf(PICK, {
  own: { priority: 3, pull: 1.5, travelSoon: -1.5, danger: -1.5, crowd: -0.3, age: -0.2, current: 0.4, detour: -0.5 },
  // In a hurry the nearer place wins over the more wanted one.
  cross: { "urgency*travelSoon": -3 },
});
/** To keep moving, unless something it can do fits what is in the way and is cheap. */
export const RULE_DO = ruleOf(DO, {
  own: { none: 1.5, fits: 1.5, seconds: -0.5, stamina: -0.5, health: -2, wear: -0.5, noise: -0.2, readySoon: -1, handSoon: -0.5 },
  // An action is worth more the deeper the trouble, and where it is the kind that meets what is in the way.
  cross: { "rung*fits": 2, "tall*over": 1, "soft*removes": 1, "water*medium": 1 },
});

export const RULES: readonly Model[] = [RULE_FAR, RULE_MID, RULE_NEAR, RULE_SNAG, RULE_SURE, RULE_REACH, RULE_PROBE, RULE_PICK, RULE_DO];
