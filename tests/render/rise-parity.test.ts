// A survivor knocked down and getting up is posed alike on the server, where shots are judged, by a watcher that draws
// it whole, by one short of bones that draws it on one bone, by one that changes from the one to the other halfway up,
// and from its own eye: one start, timed by the server, and one way of rising. Each drawn head, and the own camera, is
// set beside the server's from the knock until the survivor walks away, standing, crouched or prone, turning or not.
import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RISE_BLEND } from "../../client/core/ragdoll.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES, SOCKET_EYE } from "../../shared/anim/human.ts";
import { humanHitPose } from "../../shared/anim/zones.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { MF_DOWN } from "../../shared/sim/character.ts";
import { lyingShare, REACT_FALL, REACT_RISE, reactAge, reactKind } from "../../shared/anim/reactions.ts";
import { boneToModel, Solved, solve } from "../../shared/anim/skeleton.ts";
import { Past } from "../../server/history.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

// The server poses with the pack it serves, so the watchers draw with it too.
const pack = corePack(), rest = Float32Array.from(pack.header.rigs.find((r) => r.id === "human_m")!.rest), colors = new Uint8Array(64);

/** What the server had of the survivor at a tick: its place, and from there its hit head and its eye. */
interface Had { at: number[]; head: number[]; eye: number[]; laid: boolean; moving: boolean }

/** What the server has of `e` now, as a shot is judged against it: posed as its ragdoll lies while it lies as one. */
function serverHad(h: Harness, e: number, st: AnimState, pose: Pose, solved: Solved): Had {
  const ents = h.world.ents, laid = h.host.falls.poseOf(e), eye = new Float64Array(3);
  let s = solved, a = (ents.yaw[e]! * TAU) / 65536;
  if (laid) {
    s = laid;
    a = h.host.falls.yawOf(e);
  } else {
    st.unpack(ents.anim[e]!, ents.cue[e]!, ents.emote[e]!, ents.react[e]!, h.world.history.strideOf(e, h.world.tick, h.world));
    st.seed = bodySeed(e);
    st.facing = ents.yaw[e]! / 65536;
    humanHitPose(h.world.anim!, st, h.world.tick, ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.yaw[e]!, h.host.falls.riseFrom(e, h.world.tick), pose);
    solve(HUMAN, pose, solved);
  }
  boneToModel(s, B_HEAD, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, eye);
  const c = Math.cos(a), sn = Math.sin(a), turn = (x: number, y: number, z: number): number[] => [c * x + sn * z, y, -sn * x + c * z];
  return { at: [ents.x[e]!, ents.y[e]!, ents.z[e]!], head: turn(s.pos[B_HEAD * 3]!, s.pos[B_HEAD * 3 + 1]!, s.pos[B_HEAD * 3 + 2]!), eye: turn(eye[0]!, eye[1]!, eye[2]!), laid: laid !== null, moving: !laid && st.speed > 0 };
}

/**
 * The server's hit head, or eye, at `tick`, which may fall between ticks, from what it had at each: its place between
 * them, and the rest from there between them too, or, lying as a ragdoll, as at the tick it had reached (server/combat.ts).
 */
function judged(had: Map<number, Had>, tick: number, eye = false): number[] | null {
  const t0 = Math.floor(tick), a = had.get(t0), b = had.get(t0 + 1);
  if (!a || !b) return null;
  const k = a.laid === b.laid ? tick - t0 : 0, from = eye ? a.eye : a.head, to = eye ? b.eye : b.head;
  if (a.laid !== b.laid) return a.at.map((v, j) => v + from[j]!);
  return [0, 1, 2].map((j) => a.at[j]! + (b.at[j]! - a.at[j]!) * k + (a.laid ? from[j]! : from[j]! + (to[j]! - from[j]!) * k));
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
  p.camX = session.own.x; p.camY = session.own.y; p.camZ = session.own.z;
  st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!, remote.react[i]!, remote.stride[i]!);
  st.seed = bodySeed(e);
  if (!characters.add(p, remote.kind[i]!, remote.x[i]! - p.camX, remote.y[i]! - p.camY, remote.z[i]! - p.camZ, remote.yaw[i]!, st, remote.tick, null, 0, colors, 0, null, 0, e, false, false, 1, rigid)) return null;
  // Drawn whole its bones come first; on one bone, the shared pose comes first and its own bone carries it.
  const b = p.bones, o = B_HEAD * BONE_FLOATS, r = B_HEAD * 3;
  const q = [0, 1, 2].map((row) => b[o + row * 4]! * rest[r]! + b[o + row * 4 + 1]! * rest[r + 1]! + b[o + row * 4 + 2]! * rest[r + 2]! + b[o + row * 4 + 3]!);
  const m = HUMAN_BONES * BONE_FLOATS;
  const head = rigid ? [0, 1, 2].map((row) => b[m + row * 4]! * q[0]! + b[m + row * 4 + 1]! * q[1]! + b[m + row * 4 + 2]! * q[2]! + b[m + row * 4 + 3]!) : q;
  head[0]! += p.camX; head[1]! += p.camY; head[2]! += p.camZ;
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
  freshWalking: number[];
  /** How far its head moved between frames beyond how far the server's did, after the hand-off. */
  pops: number[];
  /** Frames drawn standing while the server's lay, or lying while the server's stood. */
  wrong: number;
  frames: number;
}

/** What the survivor saw from its own eye. */
interface Eye {
  /**
   * The most its camera moved in a frame going down, from the knock on, and getting up; and the highest it was while
   * getting up with its reaction having it three quarters down or more, of how many frames. Its reaction comes to it from
   * the server a round trip late, as any blow's does, so going down it catches up.
   */
  stepDown: number;
  stepUp: number;
  downHigh: number;
  down: number;
  /** Its camera's height over the ground before the knock, at its lowest, and at the end. */
  before: number;
  lowest: number;
  after: number;
}

interface Scene {
  /** Down as a body past the fall budget goes down, else as a ragdoll. */
  topple?: boolean;
  /** Radians its player looks aside as it is told to get up, or as its topple lies all the way down. */
  turn?: number;
  /** A key its player presses as it is told to get up, for the stance it gets up in. */
  stance?: "KeyC" | "KeyX";
}

/**
 * Knocks a survivor down, seen from its own eye and by three watchers, and watches until it has got up and walked away.
 * Also returns how far the server's head moved about its body's place while a topple lay all the way down.
 */
function scene(o: Scene = {}): { whole: Seen; one: Seen; both: Seen; eye: Eye; still: number } {
  const h = new Harness({}, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, wild: false, map: writeMap(flatMap(4)) });
  try {
    h.host.setSetting("Knockdowns", "true");
    const w1 = h.join("whole"), w2 = h.join("short"), w3 = h.join("both"), own = h.join("faller", {}, { manual: true });
    const app = new App(own, h.reg, pack), run = (ms: number, each?: () => void): void => h.run(ms, (now) => { app.frame(now, 1280, 720); each?.(); });
    run(300);
    const ents = h.world.ents, e = h.client(own)!.ent, ground = 0;
    for (const [s, x, z] of [[w1, 98, 70], [w2, 102, 70], [w3, 100, 66], [own, 100, 76]] as const) {
      ents.setPosition(h.client(s)!.ent, x, 0, z);
      h.world.history.discontinuity(h.client(s)!.ent);
    }
    run(600);
    if (app.view.thirdPerson) { app.key("KeyV", true); run(50); app.key("KeyV", false); run(300); }
    expect(app.view.thirdPerson).toBe(false);
    const before = app.cam.y - ground;
    if (o.topple) {
      // As the game topples a body no ragdoll may fall for: by its reaction, held where it lies until it is up.
      ents.vx[e] = 1.2; ents.vz[e] = 1.6;
      h.host.reactions.topple(e);
    } else expect(h.host.falls.knock(e, 1.5, 1, 2, 2, 0, 1)).toBe(true);
    const knocked = h.world.tick;
    const watcher = (session: ClientSession, rigid: (tick: number) => boolean) => ({ session, rigid, characters: new Characters(h.reg, pack, new Assets(h.reg, pack)), remote: new RemoteSample(), seen: seen(), last: null as number[] | null, lastServer: null as number[] | null, lastTick: -1 });
    // The third draws it whole until it is halfway up, then on one bone.
    let halfway = Infinity;
    const watchers = [watcher(w1, () => false), watcher(w2, () => true), watcher(w3, (t) => t >= halfway)];
    const past = new Past(), had = new Map<number, Had>(), st = new AnimState(), sst = new AnimState(), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
    let downHigh = -Infinity, down = 0, stepDown = 0, stepUp = 0, getting = false, was = false;
    let last = -1, worded = false, walked = false, acted = 0, still = 0, first: number[] | null = null, lowest = Infinity, cam: number[] | null = null;
    run(o.topple ? 4500 : 7000, () => {
      if (h.world.tick !== last) {
        last = h.world.tick;
        const now = serverHad(h, e, sst, pose, solved);
        had.set(last, now);
        const word = ents.react[e]!, kind = reactKind(word), age = reactAge(word, last);
        if (!worded && kind === (o.topple ? REACT_FALL : REACT_RISE)) { worded = true; halfway = last + (o.topple ? 67 : 15); }
        // Told to get up, or lying all the way down from a topple, its player looks aside and takes its stance; it walks
        // away once the game lets it: when its rise's stun has passed, or once its topple is over.
        if (acted === 0 && worded && (!o.topple || age >= 15)) {
          acted = 1;
          app.controls.yaw += o.turn ?? 0;
          if (o.stance) app.key(o.stance, true);
        } else if (acted === 1) {
          acted = 2;
          if (o.stance) app.key(o.stance, false);
        }
        if (!walked && worded && (!o.topple || kind === 0)) { walked = true; app.key("KeyW", true); }
        if (o.topple && kind === REACT_FALL && age >= 12 && age <= 58) {
          first ??= now.head;
          still = Math.max(still, Math.hypot(now.head[0]! - first[0]!, now.head[1]! - first[1]!, now.head[2]! - first[2]!));
        }
      }
      // Its own eye: from the knock on, how far the camera moves a frame, and where it is as it gets up: once its own
      // body is up from its ragdoll, or its topple begins to get up.
      const at = [app.cam.x, app.cam.y, app.cam.z], word = app.session.own.react, clock = app.session.tickClock;
      const lying = (app.session.own.mflags & MF_DOWN) !== 0 || reactKind(word) === REACT_FALL;
      getting ||= was && (!lying || (reactKind(word) === REACT_FALL && reactAge(word, clock) >= 60));
      was ||= lying;
      if (cam) {
        const moved = Math.hypot(at[0]! - cam[0]!, at[1]! - cam[1]!, at[2]! - cam[2]!);
        if (getting) stepUp = Math.max(stepUp, moved);
        else stepDown = Math.max(stepDown, moved);
      }
      cam = at;
      lowest = Math.min(lowest, at[1]! - ground);
      if (getting && lyingShare(word, clock) >= 0.75) { downHigh = Math.max(downHigh, at[1]! - ground); down++; }
      for (const w of watchers) {
        const rigid = w.rigid(w.remote.tick), d = drawnHead(w.characters, w.session, w.remote, e, rigid, st);
        if (!d) continue;
        const server = judged(had, d.tick), t0 = Math.floor(d.tick);
        if (!server || d.tick < knocked) continue;
        // Rewind takes the nearer motion state and evaluates its pose at the fractional shot tick.
        if (!had.get(t0)!.laid && !had.get(t0 + 1)!.laid && h.world.history.sample(d.tick, e, past)) {
          sst.unpack(past.anim, past.cue, ents.emote[e]!, past.react, past.stride);
          sst.seed = bodySeed(e); sst.facing = past.yaw / 65536;
          humanHitPose(h.world.anim, sst, d.tick, past.x, past.y, past.z, past.yaw, h.host.falls.riseFrom(e, d.tick), pose);
          solve(HUMAN, pose, solved);
          const a = sst.facing * TAU, x = solved.pos[B_HEAD * 3]!, z = solved.pos[B_HEAD * 3 + 2]!;
          server[0] = past.x + Math.cos(a) * x + Math.sin(a) * z;
          server[1] = past.y + solved.pos[B_HEAD * 3 + 1]!;
          server[2] = past.z - Math.sin(a) * x + Math.cos(a) * z;
        }
        const off = Math.hypot(d.head[0]! - server[0]!, d.head[1]! - server[1]!, d.head[2]! - server[2]!);
        const s = w.seen, ragdoll = had.get(t0)!.laid;
        const kind = reactKind(d.word), handing = kind === REACT_RISE && reactAge(d.word, d.tick) <= RISE_BLEND + 1;
        s.frames++;
        // Its fall's checkpoint takes a few ticks to come; laid, the watcher draws its ragdoll.
        if (ragdoll) { if (d.tick > knocked + 10) s.lying.push(off); }
        else if (handing) s.handOff.push(off);
        else if (kind === REACT_FALL || kind === REACT_RISE) (had.get(t0)!.moving || had.get(t0 + 1)!.moving ? s.risingOff : s.rising).push(off);
        else if (d.tick >= knocked + 10) {
          s.walking.push(off);
          if (w.characters.fresh) s.freshWalking.push(off);
        }
        // Standing on one screen and lying on the other: a head under 0.6 m against one over 1.2 m, or the other way.
        if ((server[1]! < 0.6 && d.head[1]! > 1.2) || (server[1]! > 1.2 && d.head[1]! < 0.6)) s.wrong++;
        if (w.last && w.lastServer && w.lastTick !== d.tick && !handing && d.tick > knocked + 10) {
          s.pops.push(Math.hypot(d.head[0]! - w.last[0]! - server[0]! + w.lastServer[0]!, d.head[1]! - w.last[1]! - server[1]! + w.lastServer[1]!, d.head[2]! - w.last[2]! - server[2]! + w.lastServer[2]!));
        }
        w.last = d.head; w.lastServer = server; w.lastTick = d.tick;
      }
    });
    app.key("KeyW", false);
    // It got up and walked away.
    expect([worded, walked, acted === 2, Math.hypot(ents.x[e]! - 100, ents.z[e]! - 76) > 2]).toEqual([true, true, true, true]);
    return { whole: watchers[0]!.seen, one: watchers[1]!.seen, both: watchers[2]!.seen, eye: { stepDown, stepUp, downHigh, down, before, lowest, after: app.cam.y - ground }, still };
  } finally {
    h.host.shutdown();
  }
}

function seen(): Seen {
  return { lying: [], handOff: [], rising: [], risingOff: [], walking: [], freshWalking: [], pops: [], wrong: 0, frames: 0 };
}

const most = (v: number[]): number => v.reduce((a, b) => Math.max(a, b), 0);
const share = (v: number[], p: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
const cm = (v: number): string => (v * 100).toFixed(1);

function report(what: string, s: Seen): string {
  return `${what}: ${s.frames} frames; lying ${s.lying.length} worst ${cm(most(s.lying))}; hand-off ${s.handOff.length} worst ${cm(most(s.handOff))}; rising ${s.rising.length} worst ${cm(most(s.rising))}; moving off ${s.risingOff.length} worst ${cm(most(s.risingOff))}; walking ${s.walking.length} p99 ${cm(share(s.walking, 0.99))} worst ${cm(most(s.walking))}; freshly posed worst ${cm(most(s.freshWalking))}; pop worst ${cm(most(s.pops))}; wrong ${s.wrong}`;
}

function reports(r: ReturnType<typeof scene>): string {
  const e = r.eye;
  return [report("whole", r.whole), report("one bone", r.one), report("whole then one bone", r.both), `own eye: most a frame going down ${cm(e.stepDown)}, getting up ${cm(e.stepUp)}; getting up three quarters down ${e.down} frames, at most ${cm(e.downHigh)} high; height ${cm(e.before)}, lowest ${cm(e.lowest)}, after ${cm(e.after)}`].join("\n");
}

/**
 * What every scene must show: no screen standing where another lies, no head popping between frames, and the own eye
 * going down and getting up with its body, smoothly, standing at the end at the height it stood at.
 */
function steady(r: ReturnType<typeof scene>, ends: readonly [number, number] = [1.5, 1.75]): void {
  const why = reports(r);
  for (const s of [r.whole, r.one, r.both]) expect(s.wrong, why).toBe(0);
  expect(most(r.whole.pops), why).toBeLessThan(0.1);
  expect(most(r.one.pops), why).toBeLessThan(0.2);
  // Changing from whole to one bone halfway up moves the head no more than one bone's own steps.
  expect(most(r.both.pops), why).toBeLessThan(0.2);
  expect(r.whole.freshWalking.length, why).toBeGreaterThan(20);
  expect(most(r.whole.freshWalking), why).toBeLessThan(.025);
  expect(most(r.whole.walking), why).toBeLessThan(.08);
  expect(most(r.one.walking), why).toBeLessThan(0.2);
  // Its own eye goes down with it, and gets up with it, never standing while its reaction still has it down.
  expect(r.eye.down, why).toBeGreaterThan(3);
  expect(r.eye.downHigh, why).toBeLessThan(0.8);
  // A topple stands up in half a second, and walking off moves the eye 7.4 cm a frame: a pop would be several times it.
  expect(r.eye.stepUp, why).toBeLessThan(0.12);
  expect(r.eye.stepDown, why).toBeLessThan(0.25);
  expect([r.eye.before > 1.5, r.eye.lowest < 0.6, r.eye.after > ends[0] && r.eye.after < ends[1]], why).toEqual([true, true, true]);
}

test("a ragdoll fall's rise is alike on the server, two watchers and its own eye", () => {
  const r = scene(), why = reports(r);
  for (const s of [r.whole, r.one]) expect([s.lying.length > 40, s.handOff.length > 0, s.rising.length > 10, s.risingOff.length > 10], why).toEqual([true, true, true, true]);
  // Whole: lying as the ragdoll does, eased from it into the rise over a few ticks, then rising as the server poses it.
  expect(most(r.whole.lying), why).toBeLessThan(0.01);
  expect(most(r.whole.handOff), why).toBeLessThan(.005);
  expect(most(r.whole.rising), why).toBeLessThan(0.02);
  expect(most(r.whole.risingOff), why).toBeLessThan(0.2);
  // On one bone: in shared poses, laid as far down as the ragdoll is and getting up step by step.
  expect(most(r.one.lying), why).toBeLessThan(0.04);
  expect(most(r.one.handOff), why).toBeLessThan(0.12);
  expect(most(r.one.rising), why).toBeLessThan(0.12);
  expect(most(r.one.risingOff), why).toBeLessThan(0.15);
  steady(r);
});

test("a topple is alike on the server, two watchers and its own eye", () => {
  const r = scene({ topple: true }), why = reports(r);
  for (const s of [r.whole, r.one]) expect([s.rising.length > 60, s.walking.length > 30], why).toEqual([true, true]);
  expect(most(r.whole.rising), why).toBeLessThan(0.02);
  expect(most(r.whole.risingOff), why).toBeLessThan(0.1);
  expect(most(r.one.rising), why).toBeLessThan(0.12);
  expect(most(r.one.risingOff), why).toBeLessThan(0.15);
  steady(r);
});

test("getting up crouched or prone is alike at every detail and from its own eye", () => {
  for (const [stance, ends] of [["KeyC", [0.9, 1.4]], ["KeyX", [0.15, 0.7]]] as const) {
    const r = scene({ stance }), why = `${stance}\n${reports(r)}`;
    expect(most(r.whole.rising), why).toBeLessThan(0.02);
    expect(most(r.one.rising), why).toBeLessThan(0.15);
    steady(r, ends);
  }
});

test("a body lying by its reaction stays put while its player looks around", () => {
  // Lying all the way down, a topple lies against the facing it had as it went down, however its player turns.
  const topple = scene({ topple: true, turn: Math.PI / 2 });
  expect(topple.still).toBeLessThan(0.01);
  // Turning as it gets up, it turns with its player as it stands, alike on every screen and from its own eye.
  for (const r of [topple, scene({ turn: Math.PI / 2 }), scene({ turn: -2.5 })]) {
    const why = reports(r);
    expect(most(r.whole.rising), why).toBeLessThan(0.02);
    expect(most(r.one.rising), why).toBeLessThan(0.15);
    steady(r);
  }
});
