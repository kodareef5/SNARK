// The board owns its line through prediction and reconciliation. A parked board starts a fresh run.
export const ROLL = 0, PUSH = 1, OLLIE = 2, KICKFLIP = 3, SHOVE = 4, GRIND = 5, BAIL = 6;
export const SKATE_MOVES = ["Coasting", "Pushing", "Ollie", "Kickflip", "360 shove-it", "50-50 grind", "Bail"];
export const TRICK_TICKS = 13;
export class SkateState {
  move = ROLL;
  ticks = 0;
  keys = 0;
  grace = 0;
  buffer = 0;
  chain = 0;
  score = 0;
  bank = 0;
  window = 0;
}
export function copySkate(target: SkateState | null, source: SkateState | null): SkateState | null {
  return source ? Object.assign(target ?? new SkateState(), source) : null;
}
export function sameSkate(a: SkateState | null, b: SkateState | null): boolean {
  return a === b || !!a && !!b && a.move === b.move && a.ticks === b.ticks && a.keys === b.keys &&
    a.grace === b.grace && a.buffer === b.buffer && a.chain === b.chain && a.score === b.score && a.bank === b.bank && a.window === b.window;
}
