// Views with a round trip between a snapshot and its acknowledgement. The server writes each snapshot against a baseline some
// ticks old while the client already has newer ones, so a body with no room in a snapshot must stay as the client last had it.

import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, MAX_VIEW, SentView, VIEW_RING, ViewRing, readViewDelta, writeViewDelta, type Looks } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";

function looksFor(n: number): Looks {
  return { level: new Uint16Array(n), colors: new Uint8Array(n * 6), names: new Map<number, string>(), looks: new Map<number, Uint8Array>(), gears: new Map<number, Uint16Array>(), team: new Uint32Array(n), seat: new Uint32Array(n), span: new Uint32Array(n), grown: new Uint32Array(n) };
}

/** After a snapshot is read: what the client drew before it and draws now, and the views those were read into. */
type Watcher = (tick: number, before: EntityView | null, drawn: EntityView, was: EntityView | null, view: EntityView) => void;

/** The view code of a server and of one client, with a link between them that delays what each sends and may lose it. */
class Pair {
  readonly sent = new ViewRing(() => new SentView());
  readonly views = new ViewRing(() => new EntityView());
  readonly drawn = new ViewRing(() => new EntityView());
  private readonly w = new BitWriter(1 << 16);
  private readonly r = new BitReader();
  private readonly down: { at: number; tick: number; age: number; data: Uint8Array }[] = [];
  private readonly up: { at: number; tick: number }[] = [];
  private ack = 0;
  private rotate = 0;
  /** The newest snapshot the client has read. */
  latest = 0;
  bytes = 0;
  largest = 0;
  /** The size of the newest snapshot. */
  size = 0;
  /** Whether a snapshot on its way down, or an acknowledgement on its way up, is lost. */
  lost = (_down: boolean): boolean => false;
  /** Ticks each way. A function gives every message its own. */
  delay: (down: boolean) => number;
  private readonly looks: Looks;
  private readonly budget: number;

  constructor(looks: Looks, budget: number, down: number, up: number) {
    this.looks = looks;
    this.budget = budget;
    this.delay = (d) => (d ? down : up);
  }

  /** The server's part of tick `T`: it hears the acknowledgements that have arrived and sends `cur`. */
  send(T: number, cur: SentView): void {
    for (let k = 0; k < this.up.length; k++) {
      if (this.up[k]!.at > T) continue;
      if (this.up[k]!.tick > this.ack) this.ack = this.up[k]!.tick;
      this.up.splice(k--, 1);
    }
    const age = T - this.ack;
    const base = this.ack > 0 && age < VIEW_RING ? this.sent.find(this.ack) : null;
    const next = this.sent.alloc(T);
    const w = this.w;
    w.reset();
    this.rotate = writeViewDelta(w, base, cur, next, this.budget, this.rotate, this.looks, -1, null, MAX_VIEW, this.sent);
    expect(w.overflow).toBe(false);
    this.size = w.byteLength;
    this.bytes += w.byteLength;
    if (w.pos > this.largest) this.largest = w.pos;
    if (!this.lost(true)) this.down.push({ at: T + this.delay(true), tick: T, age: base ? age : 0, data: w.bytes().slice() });
  }

  /** The client's part: it reads the snapshots that have arrived by `T`, oldest first, and acknowledges each. */
  receive(T: number, watch: Watcher | null = null): void {
    const due = this.down.filter((p) => p.at <= T).sort((a, b) => a.tick - b.tick);
    for (const p of due) {
      this.down.splice(this.down.indexOf(p), 1);
      if (p.tick <= this.latest) continue;
      const base = p.age > 0 ? this.views.find(p.tick - p.age) : null;
      expect(p.age > 0 && !base).toBe(false);
      const was = this.views.find(this.latest);
      const view = this.views.alloc(p.tick);
      const drawn = this.drawn.alloc(p.tick);
      const before = this.drawn.find(this.latest);
      this.r.reset(p.data);
      expect(readViewDelta(this.r, base, view, before, drawn) && !this.r.overflow).toBe(true);
      // What the server holds the client to have is what it has.
      const held = this.sent.find(p.tick);
      if (held) {
        let differ = view.count === held.count ? 0 : 1;
        for (let i = 0; i < view.count && differ === 0; i++) if (view.id[i] !== held.id[i] || view.gen[i] !== held.gen[i] || view.rev[i] !== held.rev[i] || view.qx[i] !== held.qx[i] || view.qy[i] !== held.qy[i] || view.qz[i] !== held.qz[i] || view.yaw[i] !== held.yaw[i] || view.flags[i] !== held.flags[i] || view.anim[i] !== held.anim[i]) differ = 1;
        expect(differ).toBe(0);
      }
      watch?.(p.tick, before, drawn, was, view);
      this.latest = p.tick;
      if (!this.lost(false)) this.up.push({ at: T + this.delay(false), tick: p.tick });
    }
  }
}

/** Entries of `a` whose body is in `b` further back along x, and entries that `b` has no body for. */
function steps(a: EntityView | null, b: EntityView): [back: number, gone: number] {
  let back = 0;
  let gone = 0;
  for (let i = 0, j = 0; a && i < a.count; i++) {
    while (j < b.count && b.id[j]! < a.id[i]!) j++;
    if (j === b.count || b.id[j] !== a.id[i]) gone++;
    else if (b.qx[j]! < a.qx[i]!) back++;
  }
  return [back, gone];
}

const PACE = 51;
/** `n` bodies in view from the first tick, each a fifth of a metre further along x every tick. */
function herd(n: number, T: number): SentView {
  const v = new SentView();
  for (let id = 0; id < n; id++) v.push(id, 1, 7, 100000 + id * 300 + T * PACE, 2000, 3000, 5, 1, 0);
  return v;
}

test("with a round trip between a snapshot and its acknowledgement, a body that had to wait stays where the client last had it: none steps back and none blinks out", () => {
  const N = 120;
  // A third of the bodies fit a snapshot once the baseline is so old that every move is sent whole.
  const BUDGET = 3200;
  for (const [down, up] of [[1, 2], [3, 3]] as const) {
    const link = new Pair(looksFor(N), BUDGET, down, up);
    /** Counted over what the client draws, and over its views, which is what it drew before it kept the two apart. */
    const drawn = [0, 0];
    const views = [0, 0];
    let stalest = 0;
    let whole = 0;
    for (let T = 1; T <= 240; T++) {
      link.send(T, herd(N, T));
      link.receive(T, (tick, before, now, was, view) => {
        const [back, gone] = steps(before, now);
        drawn[0]! += back;
        drawn[1]! += gone;
        const [b, g] = steps(was, view);
        views[0]! += b;
        views[1]! += g;
        if (whole === 0 && now.count === N) whole = tick;
        // Once every body has had a turn, none is drawn further behind than the turns take.
        if (tick > 120) for (let i = 0; i < now.count; i++) stalest = Math.max(stalest, tick - (now.qx[i]! - 100000 - now.id[i]! * 300) / PACE);
      });
    }
    expect(drawn).toEqual([0, 0]);
    // The views do both, as they must: each is what its own baseline gives.
    expect(views[0]).toBeGreaterThan(N * 20);
    expect(views[1]).toBeGreaterThan(N * 2);
    // Twelve creates fit a snapshot, so the herd is all there after ten of them, whatever the round trip.
    expect(whole).toBeLessThanOrEqual(down + 12);
    expect(stalest).toBeLessThanOrEqual(6);
    expect(link.largest).toBeLessThanOrEqual(BUDGET + 16);
  }
});

test("a body that leaves view and is back within the round trip is drawn again where it is, not where its baseline had it", () => {
  const N = 120;
  const link = new Pair(looksFor(N), 3200, 3, 3);
  /** Every tenth body is out of view for two ticks. */
  const away = (id: number, T: number): boolean => id % 10 === 5 && (T === 100 || T === 101);
  const lastX = new Int32Array(N);
  let returned = 0;
  for (let T = 1; T <= 160; T++) {
    const cur = new SentView();
    for (let id = 0; id < N; id++) if (!away(id, T)) cur.push(id, 1, 7, 100000 + id * 300 + T * PACE, 2000, 3000, 5, 1, 0);
    link.send(T, cur);
    link.receive(T, (tick, before, drawn) => {
      let b = 0;
      for (let i = 0; i < drawn.count; i++) {
        const id = drawn.id[i]!;
        while (before && b < before.count && before.id[b]! < id) b++;
        if (tick >= 102 && id % 10 === 5 && !(before && b < before.count && before.id[b] === id)) returned++;
        expect(drawn.qx[i]).toBeGreaterThanOrEqual(lastX[id]!);
        lastX[id] = drawn.qx[i]!;
      }
      // While they are away the client does not draw them.
      if (tick === 101) expect(drawn.count).toBe(N - 12);
    });
  }
  expect(returned).toBe(12);
});

test("a body that only some baselines have is taken away when it leaves, though the baseline of the moment never had it", () => {
  const N = 10;
  // Room for one create a snapshot, three ticks from a snapshot to its use as a baseline. Body 0 is sent on tick 10 and is
  // in the baselines of ticks 13, 16 and so on, and in no other until its turn comes round again.
  const link = new Pair(looksFor(N), 300, 1, 2);
  let T = 1;
  // The snapshot of tick 13 is lost, and with it the one line of baselines that had the body.
  link.lost = (down) => down && T === 13;
  const drawn: number[] = [];
  for (; T <= 80; T++) {
    const cur = new SentView();
    for (let id = 0; id < N; id++) if (T >= 10 && (id !== 0 || T < 14)) cur.push(id, 1, 7, 1000 + id, 200, 300, 5, 1, 0);
    link.send(T, cur);
    link.receive(T, (tick, _before, now) => {
      if (tick === 12 || tick === 14 || tick === 16) drawn.push(now.count > 0 && now.id[0] === 0 ? 1 : 0);
    });
  }
  // Drawn from the snapshot that created it, and gone with the snapshot of the tick it left on.
  expect(drawn).toEqual([1, 0, 0]);
  const last = link.drawn.find(link.latest)!;
  expect(Array.from(last.id.subarray(0, last.count))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(link.sent.told!.count).toBe(0);
});

test("bodies that no baseline has are taken away 1,024 to a snapshot, so that a reader never meets more ops than it allows", () => {
  const N = 1500;
  const link = new Pair(looksFor(N * 2), 1 << 22, 1, 2);
  const drawn: number[] = [];
  for (let T = 1; T <= 7; T++) {
    const cur = new SentView();
    // 1,500 bodies for one tick, then 1,500 others in their place, before any snapshot is acknowledged.
    for (let k = 0; k < N; k++) cur.push((T < 2 ? 0 : N) + k, 1, 7, 1000 + k, 200, 300, 5, 1, 0);
    link.send(T, cur);
    link.receive(T, (_tick, _before, now) => drawn.push(now.count));
  }
  // No baseline has the first 1,500, so each is taken away by a remove of its own: 1,024 in a snapshot. The 476 left go
  // with the fourth snapshot, whose baseline is the first.
  expect(drawn).toEqual([1500, 1500 + 476, 1500 + 476, 1500, 1500, 1500]);
});

test("nothing is sent at rest, and with room for every op a round trip costs no more bytes than it did", () => {
  const N = 200;
  const rng = new Rng(9);
  /** Bodies that walk for a while and stand for a while, and a few that come and go. */
  const walking = new Uint8Array(N);
  const here = new Uint8Array(N).fill(1);
  const at = new Int32Array(N);
  const scenes: SentView[] = [];
  for (let T = 1; T <= 400; T++) {
    const v = new SentView();
    for (let id = 0; id < N; id++) {
      if (T <= 300 && rng.int(20) === 0) walking[id] ^= 1;
      if (T <= 300 && id % 10 === 0 && rng.int(40) === 0) here[id] ^= 1;
      if (T > 300) here[id] = 1;
      else if (walking[id] === 1) at[id]! += 12;
      if (here[id] === 1) v.push(id, 1, 7, 100000 + id * 300 + at[id]!, 2000, 3000, 5, 1, 0);
    }
    scenes.push(v);
  }
  const plain = (down: number, up: number): number => {
    // The same link with no record of what the client was told: the views alone.
    const w = new BitWriter(1 << 16);
    const sent = new ViewRing(() => new SentView());
    let bytes = 0;
    for (let T = 1; T <= 400; T++) {
      const base = T > down + up ? sent.find(T - down - up) : null;
      w.reset();
      writeViewDelta(w, base, scenes[T - 1]!, sent.alloc(T), 1 << 20, 0, looksFor(N));
      bytes += w.byteLength;
    }
    return bytes;
  };
  for (const [down, up] of [[0, 1], [1, 2], [3, 3]] as const) {
    const link = new Pair(looksFor(N), 1 << 20, down, up);
    for (let T = 1; T <= 400; T++) {
      link.send(T, scenes[T - 1]!);
      link.receive(T);
    }
    // One byte says no ops.
    expect(link.size).toBe(1);
    expect(link.sent.told!.count).toBe(0);
    const last = link.drawn.find(link.latest)!;
    expect(last.count).toBe(N);
    for (let id = 0; id < N; id++) expect(last.qx[id]).toBe(100000 + id * 300 + at[id]!);
    // A body that leaves before its create is acknowledged is now told to go, two bytes each time. Nothing else is new.
    const before = plain(down, up);
    expect(link.bytes).toBeGreaterThanOrEqual(before);
    expect(link.bytes).toBeLessThanOrEqual(before * 1.002);
  }
});

test("a body that turns its head and turns it back within a round trip is drawn as it is, though its baseline never changed", () => {
  const N = 4;
  const scene = (T: number): SentView => {
    const v = new SentView();
    // Body 2 looks aside on ticks 10 and 11 only.
    for (let id = 0; id < N; id++) v.push(id, 1, 7, 1000 + id, 200, 300, id === 2 && (T === 10 || T === 11) ? 300 : 5, 1, 0);
    return v;
  };
  for (const lossy of [false, true]) {
    const link = new Pair(looksFor(N), 1 << 20, 3, 3);
    // The snapshots that say it looks ahead again are lost for a while, as are some acknowledgements.
    let T = 1;
    if (lossy) link.lost = (down) => down && T >= 12 && T < 16;
    const yaws: number[] = [];
    for (; T <= 60; T++) {
      link.send(T, scene(T));
      link.receive(T, (_tick, _before, drawn) => yaws.push(drawn.yaw[2]!));
    }
    expect(yaws.includes(300)).toBe(true);
    expect(yaws[yaws.length - 1]).toBe(5);
    // Once told, it stays told.
    expect(yaws.lastIndexOf(300)).toBeLessThan(yaws.indexOf(5, yaws.indexOf(300)));
    expect(link.size).toBe(1);
    expect(link.sent.told!.count).toBe(0);
  }
});

test("a client the server has had no word from for a second is sent everything again, goes on drawing what it had, and is rid of a body that left meanwhile", () => {
  const N = 40;
  // Room for one create a snapshot, so that a body can leave before its turn to be sent again comes.
  const BUDGET = 300;
  const scene = (T: number): SentView => {
    const v = new SentView();
    for (let id = 0; id < N; id++) if (id !== 33 || T < 165) v.push(id, 1, 7, 1000 + id, 200, 300, 5, 1, 0);
    return v;
  };
  // Acknowledgements alone are lost, then everything both ways, then the server sends nothing at all.
  for (const what of ["acks", "link", "server"]) {
    const link = new Pair(looksFor(N), BUDGET, 1, 2);
    let T = 1;
    link.lost = (down) => T >= 120 && T < 200 && (what === "link" || (what === "acks" && !down));
    let fewest = N;
    let blank = 0;
    for (; T <= 420; T++) {
      if (what !== "server" || T < 120 || T >= 200) link.send(T, scene(T));
      link.receive(T, (tick, _before, drawn, _was, view) => {
        if (tick > 100 && drawn.count < fewest) fewest = drawn.count;
        // With no baseline a view holds only what its own snapshot had room for.
        if (tick > 100 && view.count < 10) blank++;
      });
    }
    const last = link.drawn.find(link.latest)!;
    expect(Array.from(last.id.subarray(0, last.count))).toEqual(Array.from({ length: N }, (_, id) => id).filter((id) => id !== 33));
    expect(link.size).toBe(1);
    expect(link.sent.told!.count).toBe(0);
    expect(blank).toBeGreaterThan(what === "server" ? 0 : 20);
    // Hearing every snapshot, the client never draws less than there is. Cut off for a second, it starts again as the server does.
    if (what === "acks") expect(fewest).toBe(N - 1);
    else expect(fewest).toBeLessThan(10);
  }
});

/** One body's true state on one tick, as one number each for what a view compares. */
interface State {
  gen: number;
  rev: number;
  qx: number;
  yaw: number;
}

test("over a link that loses and delays snapshots and acknowledgements, what a client draws is never older than what it drew, and ends as the server has it", () => {
  const N = 48;
  for (let seed = 1; seed <= 32; seed++) {
    const rng = new Rng(seed * 7919);
    const looks = looksFor(N);
    // Some seeds have room for everything and some for a sixth of it. Odd seeds lose nothing.
    const link = new Pair(looks, seed % 3 === 0 ? 1 << 20 : 700 + rng.int(1500), 1 + rng.int(3), 1 + rng.int(3));
    const lossy = seed % 2 === 0;
    let T = 1;
    let blackout = 0;
    let silence = 0;
    if (lossy) {
      link.lost = () => T < 460 && (T < blackout || rng.int(100) < 12);
      link.delay = (down) => (T < silence && !down ? 1000 : 1 + rng.int(4));
    }
    const here = new Uint8Array(N);
    const walking = new Uint8Array(N);
    const aside = new Uint8Array(N);
    const state: State[] = [];
    for (let id = 0; id < N; id++) state.push({ gen: 1, rev: 0, qx: 100000 + id * 5000, yaw: 5 });
    /** Every state each body has been in while in view, oldest first, and where in that list the client's drawing of it is. */
    const history: State[][] = state.map(() => []);
    const shown = new Int32Array(N).fill(-1);
    /** Which bodies were in view on each tick. */
    const inView: Uint8Array[] = [];
    let older = 0;
    let vanished = 0;
    let cur = new SentView();
    const check: Watcher = (tick, before, drawn) => {
      let b = 0;
      const gone = (id: number): void => {
        // Gone from the drawing. With nothing lost, that is only ever a body out of view on the snapshot's tick.
        if (!lossy && inView[tick]![id] === 1) vanished++;
        shown[id] = -1;
      };
      for (let i = 0; i < drawn.count; i++) {
        const id = drawn.id[i]!;
        while (before && b < before.count && before.id[b]! < id) gone(before.id[b++]!);
        if (before && b < before.count && before.id[b] === id) b++;
        else shown[id] = -1;
        // The state drawn is one the body was in, no earlier than the one drawn before.
        const h = history[id]!;
        let at = -1;
        for (let k = Math.max(0, shown[id]!); k < h.length && at < 0; k++) if (h[k]!.gen === drawn.gen[i] && h[k]!.rev === drawn.rev[i] && h[k]!.qx === drawn.qx[i] && h[k]!.yaw === drawn.yaw[i]) at = k;
        if (at < 0) older++;
        shown[id] = at;
      }
      while (before && b < before.count) gone(before.id[b++]!);
    };
    for (; T <= 560; T++) {
      // The world changes for 400 ticks and then stands still.
      if (T <= 400) {
        if (lossy && rng.int(120) === 0) blackout = T + 10 + rng.int(40);
        if (lossy && rng.int(150) === 0) silence = T + 30 + rng.int(20);
        cur = new SentView();
        for (let id = 0; id < N; id++) {
          const s = state[id]!;
          // Bodies come and go. Every third, once it has gone after the first hundred ticks, stays away.
          if (rng.int(here[id] === 1 ? 60 : 12) === 0 && (here[id] === 1 || id % 3 !== 0 || T < 100)) here[id] ^= 1;
          if (rng.int(25) === 0) walking[id] ^= 1;
          if (walking[id] === 1) s.qx += rng.int(8) === 0 ? 400 : 20;
          // A head turned aside comes back to exactly where it was, after one tick or after many.
          if (aside[id]! > 0) {
            if (--aside[id]! === 0) s.yaw = 5;
          } else if (rng.int(30) === 0) {
            s.yaw = 300;
            aside[id] = 1 + rng.int(rng.int(2) === 0 ? 2 : 20);
          }
          if (rng.int(200) === 0) s.gen = (s.gen % 4000) + 1;
          if (rng.int(150) === 0) s.rev = (s.rev + 1) & 15;
          if (here[id] === 0) continue;
          // The other fields follow from these, each part of the pose changing at its own pace, so that every part of an update is sent.
          const pose = (((s.qx >> 4) & 0xfff) | ((s.yaw === 300 ? 17 : 0) << 12) | ((Math.floor(s.qx / 400) & 0x3fff) << 18)) >>> 0;
          cur.push(id, s.gen, 7, s.qx, 2000 + (s.qx & 127), 3000 + ((s.qx >> 2) & 0xffff), s.yaw, s.yaw === 300 ? 5 : 1, pose, s.rev);
          const h = history[id]!;
          const was = h[h.length - 1];
          if (!was || was.gen !== s.gen || was.rev !== s.rev || was.qx !== s.qx || was.yaw !== s.yaw) h.push({ ...s });
        }
      }
      inView[T] = here.slice();
      link.send(T, cur);
      link.receive(T, check);
    }
    expect([older, vanished]).toEqual([0, 0]);
    // Nothing is left to say, and the client draws what the server has: every body, each as it is, and none besides.
    expect(link.size).toBe(1);
    expect(link.sent.told!.count).toBe(0);
    const last = link.drawn.find(link.latest)!;
    expect(link.latest).toBeGreaterThan(540);
    expect(last.count).toBe(cur.count);
    for (let i = 0; i < cur.count; i++) expect([last.id[i], last.gen[i], last.rev[i], last.qx[i], last.qz[i], last.yaw[i], last.flags[i], last.anim[i]]).toEqual([cur.id[i]!, cur.gen[i]!, cur.rev[i]!, cur.qx[i]!, cur.qz[i]!, cur.yaw[i]!, cur.flags[i]!, cur.anim[i]!]);
  }
});
