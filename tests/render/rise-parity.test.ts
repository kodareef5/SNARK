// A survivor knocked down and getting up is posed alike on the server, where shots are judged, by a watcher that draws
// it whole and by one short of bones that draws it on one bone: one start, timed by the server, and one way of rising.
// Each watcher's drawn head is set beside the server's hit head from the knock until the survivor walks away.
import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RISE_BLEND } from "../../client/core/ragdoll.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, bodySeed, humanPose } from "../../shared/anim/pose.ts";
import { REACT_FALL, REACT_RISE, reactAge, reactKind } from "../../shared/anim/reactions.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

// The server poses with the pack it serves, so the watchers draw with it too.
const pack = corePack(), rest = Float32Array.from(pack.header.rigs.find((r) => r.id === "human_m")!.rest), colors = new Uint8Array(64);

/**
 * Where the server has `e` and its hit head now, as a shot is judged against it: its place, and its head from there,
 * posed as its ragdoll lies while it lies as one.
 */
function serverHead(h: Harness, e: number, st: AnimState, pose: Pose, solved: Solved): { at: number[]; head: number[]; laid: boolean; moving: boolean } {
  const ents = h.world.ents, laid = h.host.falls.poseOf(e);
  let s = solved, a = (ents.yaw[e]! * TAU) / 65536;
  if (laid) {
    s = laid;
    a = h.host.falls.yawOf(e);
  } else {
    st.unpack(ents.anim[e]!, ents.cue[e]!, ents.emote[e]!, ents.react[e]!);
    st.seed = bodySeed(e);
    st.facing = ents.yaw[e]! / 65536;
    humanPose(h.world.anim!, st, h.world.tick, pose);
    solve(HUMAN, pose, solved);
  }
  const c = Math.cos(a), sn = Math.sin(a), lx = s.pos[B_HEAD * 3]!, lz = s.pos[B_HEAD * 3 + 2]!;
  return { at: [ents.x[e]!, ents.y[e]!, ents.z[e]!], head: [c * lx + sn * lz, s.pos[B_HEAD * 3 + 1]!, -sn * lx + c * lz], laid: laid !== null, moving: !laid && st.speed > 0 };
}

/**
 * The server's hit head at `tick`, which may fall between ticks, from what it had at each: its place between them, and
 * its head from there between them too, or, lying as a ragdoll, as at the tick it had reached (server/combat.ts).
 */
function judged(heads: Map<number, { at: number[]; head: number[]; laid: boolean; moving: boolean }>, tick: number): number[] | null {
  const t0 = Math.floor(tick), a = heads.get(t0), b = heads.get(t0 + 1);
  if (!a || !b) return null;
  const k = tick - t0, laid = a.laid;
  return [0, 1, 2].map((j) => a.at[j]! + (b.at[j]! - a.at[j]!) * k + (laid ? a.head[j]! : a.head[j]! + (b.head[j]! - a.head[j]!) * k));
}

/** Where a watcher draws `e`'s head now, whole or on one bone, and its reaction word; null where it does not. */
function drawnHead(characters: Characters, session: ClientSession, remote: RemoteSample, e: number, rigid: boolean, st: AnimState): { head: number[]; word: number; tick: number } | null {
  session.sampleRemote(remote);
  let i = -1;
  for (let k = 0; k < remote.count; k++) if (remote.id[k] === e) i = k;
  if (i < 0) return null;
  // The renderer is given the checkpoints as the game gives them (client/core/app.ts).
  characters.corpseMotions = session.corpseMotions;
  characters.begin();
  characters.corpses(new FramePacket(), new Camera(), remote, session.world!);
  characters.begin();
  const p = new FramePacket();
  st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!, remote.react[i]!);
  if (!characters.add(p, remote.kind[i]!, remote.x[i]!, remote.y[i]!, remote.z[i]!, remote.yaw[i]!, st, remote.tick, null, 0, colors, 0, null, 0, e, false, false, 1, rigid)) return null;
  // Drawn whole its bones come first; on one bone, the shared pose comes first and its own bone carries it.
  const b = p.bones, o = B_HEAD * BONE_FLOATS, r = B_HEAD * 3;
  const q = [0, 1, 2].map((row) => b[o + row * 4]! * rest[r]! + b[o + row * 4 + 1]! * rest[r + 1]! + b[o + row * 4 + 2]! * rest[r + 2]! + b[o + row * 4 + 3]!);
  const m = HUMAN_BONES * BONE_FLOATS;
  const head = rigid ? [0, 1, 2].map((row) => b[m + row * 4]! * q[0]! + b[m + row * 4 + 1]! * q[1]! + b[m + row * 4 + 2]! * q[2]! + b[m + row * 4 + 3]!) : q;
  return { head, word: remote.react[i]!, tick: remote.tick };
}

/** What one watcher saw: how far its head was from the server's, by stage, and the most it popped between frames. */
interface Seen {
  /**
   * Lying as a ragdoll once its checkpoint came; a rise's first ticks, eased in from it; toppling or getting up after
   * them, while it keeps still and once it moves; on its feet again, walking away.
   */
  lying: number[];
  handOff: number[];
  rising: number[];
  risingOff: number[];
  walking: number[];
  /** How far its head moved between frames beyond how far the server's did, after the hand-off. */
  pops: number[];
  /** Frames drawn standing while the server's lay, or lying while the server's stood. */
  wrong: number;
  frames: number;
}

/**
 * Knocks a survivor down before two watchers, one drawing it whole and one on one bone, and watches until it has got up
 * and walked away from them: `topple` as a body past the fall budget goes down, else as a ragdoll. Its player looks
 * `turn` radians aside as it is told to get up, or as its topple lies all the way down. Also returns how far the server's
 * head moved about its body's place while a topple lay all the way down.
 */
function watch(topple: boolean, turn = 0): { whole: Seen; one: Seen; still: number } {
  const h = new Harness({}, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, wild: false, map: writeMap(flatMap(4)) });
  try {
    h.host.setSetting("Knockdowns", "true");
    const w1 = h.join("whole"), w2 = h.join("short"), f = h.join("faller");
    h.run(300);
    const ents = h.world.ents, e = h.client(f)!.ent;
    for (const [s, x, z] of [[w1, 98, 70], [w2, 102, 70], [f, 100, 76]] as const) {
      ents.setPosition(h.client(s)!.ent, x, 0, z);
      h.world.history.discontinuity(h.client(s)!.ent);
    }
    h.run(600);
    if (topple) {
      // As the game topples a body no ragdoll may fall for: by its reaction, held where it lies until it is up.
      ents.vx[e] = 1.2; ents.vz[e] = 1.6;
      h.host.reactions.topple(e);
    } else expect(h.host.falls.knock(e, 1.5, 1, 2, 2, 0, 1)).toBe(true);
    const knocked = h.world.tick;
    const watchers = [
      { session: w1, rigid: false, characters: new Characters(h.reg, pack, new Assets(h.reg, pack)), remote: new RemoteSample(), seen: seen(), last: null as number[] | null, lastServer: null as number[] | null, lastTick: -1 },
      { session: w2, rigid: true, characters: new Characters(h.reg, pack, new Assets(h.reg, pack)), remote: new RemoteSample(), seen: seen(), last: null as number[] | null, lastServer: null as number[] | null, lastTick: -1 },
    ];
    const heads = new Map<number, { at: number[]; head: number[]; laid: boolean; moving: boolean }>(), st = new AnimState(), sst = new AnimState(), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
    let last = -1, worded = false, walked = false, turned = false, still = 0, first: number[] | null = null;
    h.run(topple ? 4500 : 7000, () => {
      if (h.world.tick !== last) {
        last = h.world.tick;
        const now = serverHead(h, e, sst, pose, solved);
        heads.set(last, now);
        // It walks away as soon as it is told to get up, and moves once the game lets it: when its rise's stun has
        // passed, or once its topple is over.
        const word = ents.react[e]!, kind = reactKind(word), age = reactAge(word, last);
        worded ||= kind === (topple ? REACT_FALL : REACT_RISE);
        if (!turned && worded && (!topple || age >= 15)) { turned = true; h.pilots[2]!.yaw += turn; }
        if (!walked && worded && (!topple || kind === 0)) { walked = true; h.pilots[2]!.moveZ = 1; }
        if (topple && kind === REACT_FALL && age >= 12 && age <= 58) {
          first ??= now.head;
          still = Math.max(still, Math.hypot(now.head[0]! - first[0]!, now.head[1]! - first[1]!, now.head[2]! - first[2]!));
        }
      }
      for (const w of watchers) {
        const d = drawnHead(w.characters, w.session, w.remote, e, w.rigid, st);
        if (!d) continue;
        const server = judged(heads, d.tick), t0 = Math.floor(d.tick);
        if (!server || d.tick < knocked) continue;
        const off = Math.hypot(d.head[0]! - server[0]!, d.head[1]! - server[1]!, d.head[2]! - server[2]!);
        const s = w.seen, ragdoll = heads.get(t0)!.laid && heads.get(t0 + 1)!.laid;
        const kind = reactKind(d.word), handing = kind === REACT_RISE && reactAge(d.word, d.tick) <= RISE_BLEND + 1;
        s.frames++;
        // Its fall's checkpoint takes a few ticks to come; laid, the watcher draws its ragdoll.
        if (ragdoll) { if (d.tick > knocked + 10) s.lying.push(off); }
        else if (handing) s.handOff.push(off);
        else if (kind === REACT_FALL || kind === REACT_RISE) (heads.get(t0)!.moving || heads.get(t0 + 1)!.moving ? s.risingOff : s.rising).push(off);
        else if (d.tick >= knocked + 10) s.walking.push(off);
        // Standing on one screen and lying on the other: a head under 0.6 m against one over 1.2 m, or the other way.
        if ((server[1]! < 0.6 && d.head[1]! > 1.2) || (server[1]! > 1.2 && d.head[1]! < 0.6)) s.wrong++;
        if (w.last && w.lastServer && w.lastTick !== d.tick && !handing && d.tick > knocked + 10) {
          s.pops.push(Math.hypot(d.head[0]! - w.last[0]! - server[0]! + w.lastServer[0]!, d.head[1]! - w.last[1]! - server[1]! + w.lastServer[1]!, d.head[2]! - w.last[2]! - server[2]! + w.lastServer[2]!));
        }
        w.last = d.head; w.lastServer = server; w.lastTick = d.tick;
      }
    });
    h.pilots[2]!.moveZ = 0;
    // It got up and walked well away.
    expect([worded, walked, turned, ents.z[e]! > 79 || turn !== 0]).toEqual([true, true, true, true]);
    return { whole: watchers[0]!.seen, one: watchers[1]!.seen, still };
  } finally {
    h.host.shutdown();
  }
}

function seen(): Seen {
  return { lying: [], handOff: [], rising: [], risingOff: [], walking: [], pops: [], wrong: 0, frames: 0 };
}

const most = (v: number[]): number => v.reduce((a, b) => Math.max(a, b), 0);
const share = (v: number[], p: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;

function report(what: string, s: Seen): string {
  const cm = (v: number): string => (v * 100).toFixed(1);
  return `${what}: ${s.frames} frames; lying ${s.lying.length} worst ${cm(most(s.lying))}; hand-off ${s.handOff.length} worst ${cm(most(s.handOff))}; rising ${s.rising.length} worst ${cm(most(s.rising))}; moving off ${s.risingOff.length} worst ${cm(most(s.risingOff))}; walking ${s.walking.length} p99 ${cm(share(s.walking, 0.99))} worst ${cm(most(s.walking))}; pop worst ${cm(most(s.pops))}; wrong ${s.wrong}`;
}

/** What both watchers must see: never one standing where the other lies, and no head popping between frames. */
function steady(whole: Seen, one: Seen): void {
  const why = `${report("whole", whole)}\n${report("one bone", one)}`;
  for (const s of [whole, one]) expect(s.wrong, why).toBe(0);
  expect(most(whole.pops), why).toBeLessThan(0.1);
  expect(most(one.pops), why).toBeLessThan(0.2);
  // Walking away, a stride's phase is the watcher's own, by how far the body has gone, and the server's by the tick:
  // a running head bobs out of step by as much as its bob.
  expect(most(whole.walking), why).toBeLessThan(0.25);
  expect(most(one.walking), why).toBeLessThan(0.2);
}

test("a ragdoll fall's rise is drawn as the server poses it, whole and on one bone", () => {
  const { whole, one } = watch(false), why = `${report("whole", whole)}\n${report("one bone", one)}`;
  for (const s of [whole, one]) expect([s.lying.length > 40, s.handOff.length > 0, s.rising.length > 10, s.risingOff.length > 10], why).toEqual([true, true, true, true]);
  // Whole: lying as the ragdoll does, eased from it into the rise over a few ticks, then rising as the server poses it.
  expect(most(whole.lying), why).toBeLessThan(0.01);
  expect(most(whole.handOff), why).toBeLessThan(0.12);
  expect(most(whole.rising), why).toBeLessThan(0.02);
  expect(most(whole.risingOff), why).toBeLessThan(0.2);
  // On one bone: in shared poses, laid as far down as the ragdoll is and getting up step by step.
  expect(most(one.lying), why).toBeLessThan(0.25);
  expect(most(one.handOff), why).toBeLessThan(0.12);
  expect(most(one.rising), why).toBeLessThan(0.12);
  expect(most(one.risingOff), why).toBeLessThan(0.15);
  steady(whole, one);
});

test("a topple is drawn as the server poses it, whole and on one bone", () => {
  const { whole, one } = watch(true), why = `${report("whole", whole)}\n${report("one bone", one)}`;
  for (const s of [whole, one]) expect([s.rising.length > 60, s.walking.length > 30], why).toEqual([true, true]);
  expect(most(whole.rising), why).toBeLessThan(0.02);
  expect(most(whole.risingOff), why).toBeLessThan(0.1);
  expect(most(one.rising), why).toBeLessThan(0.12);
  expect(most(one.risingOff), why).toBeLessThan(0.15);
  steady(whole, one);
});

test("a body lying by its reaction stays put while its player looks around", () => {
  // Lying all the way down, a topple lies against the facing it had as it went down, however its player turns.
  const topple = watch(true, Math.PI / 2);
  expect(topple.still).toBeLessThan(0.01);
  // Turning as it gets up, it turns with its player as it stands, alike on every screen.
  for (const { whole, one } of [topple, watch(false, Math.PI / 2)]) {
    const why = `${report("whole", whole)}\n${report("one bone", one)}`;
    expect(most(whole.rising), why).toBeLessThan(0.02);
    expect(most(one.rising), why).toBeLessThan(0.15);
    steady(whole, one);
  }
});
