import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, readViewDelta, writeViewDelta, type Looks } from "../../shared/net/view.ts";

const PLAYERS = 40;
const CREATURES = 300;
const N = PLAYERS + CREATURES;
/** Players are every eighth id up to 320, so the two kinds are mixed along the id order. */
const isPlayer = (id: number): boolean => id < PLAYERS * 8 && id % 8 === 0;

const looks: Looks = {
  level: new Uint16Array(N),
  colors: new Uint8Array(N * 6),
  name: new Array<string>(N).fill(""),
  look: new Array<Uint8Array | null>(N).fill(null),
  gear: new Array<Uint16Array | null>(N).fill(null),
  team: new Uint32Array(N),
  seat: new Uint32Array(N),
  span: new Uint32Array(N),
  grown: new Uint32Array(N),
};

/** Everyone, `step` paces along x. A pace is 3 wire units, which is a walk. */
function crowd(step: number): SentView {
  const v = new SentView();
  for (let id = 0; id < N; id++) {
    v.push(id, 1, 7, 1000 + id * 300 + step * 3, 200, 300, 5, 1, 0);
    v.urgent[id] = isPlayer(id) ? 1 : 0;
  }
  return v;
}

test("when a snapshot cannot carry every change, players go first, the rest take turns, and the budget is spent on what an update really costs", () => {
  const w = new BitWriter(1 << 16);
  const r = new BitReader();
  const BUDGET = 4000;
  // A walking body's update is 8 bits of id gap, 2 of op, 6 of flags, and 25 for a small move.
  const COST = 41;
  let sent = crowd(0);
  let held = new EntityView();
  for (let id = 0; id < N; id++) held.push(id, 1, 7, 1000 + id * 300, 200, 300, 5, 1, 0);
  let rotate = 0;
  /** The step each entity was last seen at, by the client. */
  const seenAt = new Int32Array(N);
  let fewest = N;
  for (let step = 1; step <= 12; step++) {
    const next = new SentView();
    w.reset();
    rotate = writeViewDelta(w, sent, crowd(step), next, BUDGET, rotate, looks);
    expect(w.pos).toBeLessThanOrEqual(BUDGET + 16);
    r.reset(w.bytes());
    const got = new EntityView();
    expect(readViewDelta(r, held, got)).toBe(true);
    expect(got.count).toBe(N);
    let fresh = 0;
    for (let id = 0; id < N; id++) {
      if (got.qx[id] !== 1000 + id * 300 + step * 3) continue;
      seenAt[id] = step;
      fresh++;
    }
    // Every player is current after every snapshot.
    for (let id = 0; id < PLAYERS * 8; id += 8) expect(seenAt[id]).toBe(step);
    if (fresh < fewest) fewest = fresh;
    // What the server believes the client holds is what the client holds.
    for (let id = 0; id < N; id++) expect(next.qx[id]).toBe(got.qx[id]!);
    sent = next;
    held = got;
  }
  // The budget carries about 97 updates of 41 bits. The players take 40 of them.
  expect(fewest).toBeGreaterThanOrEqual(Math.floor(BUDGET / COST) - 3);
  // The creatures took turns: after twelve snapshots none is more than six behind.
  for (let id = 0; id < N; id++) expect(12 - seenAt[id]!).toBeLessThanOrEqual(6);
});

test("with more players than a snapshot carries, the players take turns and the creatures still move", () => {
  const w = new BitWriter(1 << 16);
  const r = new BitReader();
  const BUDGET = 4000;
  // 320 of the 340 bodies are players. Three quarters of the budget carries 73 of them at 41 bits each.
  const many = (id: number): boolean => id < 320;
  const scene = (step: number): SentView => {
    const v = new SentView();
    for (let id = 0; id < N; id++) {
      v.push(id, 1, 7, 1000 + id * 300 + step * 3, 200, 300, 5, 1, 0);
      v.urgent[id] = many(id) ? 1 : 0;
    }
    return v;
  };
  let sent = scene(0);
  let held = new EntityView();
  for (let id = 0; id < N; id++) held.push(id, 1, 7, 1000 + id * 300, 200, 300, 5, 1, 0);
  let rotate = 0;
  const seenAt = new Int32Array(N);
  const STEPS = 24;
  for (let step = 1; step <= STEPS; step++) {
    const next = new SentView();
    w.reset();
    rotate = writeViewDelta(w, sent, scene(step), next, BUDGET, rotate, looks);
    expect(w.pos).toBeLessThanOrEqual(BUDGET + 16);
    r.reset(w.bytes());
    const got = new EntityView();
    expect(readViewDelta(r, held, got)).toBe(true);
    for (let id = 0; id < N; id++) if (got.qx[id] === 1000 + id * 300 + step * 3) seenAt[id] = step;
    sent = next;
    held = got;
  }
  // 73 players and 24 others fit each snapshot. Each of the 320 players is at most five snapshots old, and each of the 20 creatures one.
  for (let id = 0; id < N; id++) expect(STEPS - seenAt[id]!).toBeLessThanOrEqual(many(id) ? 5 : 1);
});
