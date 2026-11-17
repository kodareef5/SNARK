// One JSON row per encounter through native Host, TCP loopback and ClientSession. Seeds vary impact offset and transport.
// bun tools/bench/collision-network.ts [--case=crossing] [--rtt=80] [--seed=1 | --seeds=20] [--loss=.02]
import { predictedVehiclePose } from "../../client/core/vehicle-view.ts";
import { makeHandle } from "../../shared/ids.ts";
import { quatMul } from "../../shared/math/quat.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, MF_ROOTED, type Body } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";

const CASES = ["wall", "dodo", "parasaur", "protected", "parked", "crossing", "oncoming", "swerve", "near-miss", "push"] as const;
const EXTRA_CASES = ["stop-short", "close-pass"] as const;
export type CollisionCase = typeof CASES[number] | typeof EXTRA_CASES[number];
interface Correction { now: number; tick: number; at: number; distance: number; yaw: number; angle: number; displayYaw: number; displayDistance: number; snap: boolean }
interface Sample { now: number; tick: number; x: number; z: number; yaw: number; smooth: number; angle: number; gap: number | null }
export interface CollisionNetworkOptions { kind: CollisionCase; rtt: number; seed: number; loss?: number; jitter?: number; speed?: number }
const LANE = 128, START = 30, TARGET = 135, LEAD_TICKS = 12, WINDOW_TICKS = 150;
const round = (n: number): number => Math.round(n * 10000) / 10000;
const degrees = (n: number): number => Math.abs(Math.atan2(Math.sin(n), Math.cos(n))) * 180 / Math.PI;
let map: ReturnType<typeof writeMap> | undefined;

// The same observer also runs against the Phase 1 baseline, which only eased translation.
type ObservedSession = ClientSession & {
  vehicleCorrection?: { q: Float64Array; angle: number };
  vehicleContacts?: { stats: { contacts: number; lastTick: number; lastTarget: number } } | null;
};
function display(session: ObservedSession) {
  const a = session.alpha, own = session.own, prev = session.ownPrev;
  const pose = predictedVehiclePose(prev, own, a, false);
  const q = [pose.qx ?? 0, pose.qy ?? 0, pose.qz ?? 0, pose.qw ?? 1];
  if (session.vehicleCorrection) quatMul(q, 0, session.vehicleCorrection.q, 0, q, 0);
  const [qx, qy, qz, qw] = q as [number, number, number, number];
  return { x: prev.x + (own.x - prev.x) * a + session.smoothX, y: prev.y + (own.y - prev.y) * a + session.smoothY,
    z: prev.z + (own.z - prev.z) * a + session.smoothZ, yaw: Math.atan2(2 * (qx * qz + qy * qw), 1 - 2 * (qx * qx + qy * qy)) };
}

/** Signed horizontal clearance between the two *drawn* footprints. Negative is overlap.
 * Axes are the upright ground projections of the boxes; this deliberately measures the flat driving course only. */
function footprintGap(dx: number, dz: number, yaw: number, width: number, length: number, otherYaw: number, otherWidth: number, otherLength: number | null): number {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const side = c * dx - s * dz, front = s * dx + c * dz;
  if (otherLength === null) {
    const x = Math.abs(side) - width, z = Math.abs(front) - length;
    return Math.hypot(Math.max(0, x), Math.max(0, z)) + Math.min(Math.max(x, z), 0) - otherWidth;
  }
  const co = Math.cos(otherYaw), so = Math.sin(otherYaw), dc = Math.abs(Math.cos(yaw - otherYaw)), ds = Math.abs(Math.sin(yaw - otherYaw));
  return Math.max(Math.abs(side) - width - dc * otherWidth - ds * otherLength,
    Math.abs(front) - length - ds * otherWidth - dc * otherLength,
    Math.abs(co * dx - so * dz) - otherWidth - dc * width - ds * length,
    Math.abs(so * dx + co * dz) - otherLength - ds * width - dc * length);
}

export function collisionNetworkTrial({ kind, rtt, seed, loss = 0, jitter = 10, speed = 20 }: CollisionNetworkOptions) {
  const h = new Harness({}, seed, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: map ??= writeMap(flatMap(4)) });
  try {
    const link = { tcp: true, latencyMs: rtt / 2, jitterMs: jitter, loss };
    const crossing = kind === "crossing" || kind === "near-miss" || kind === "stop-short" || kind === "close-pass";
    const opposingCar = kind === "oncoming" || kind === "swerve";
    const session: ObservedSession = h.join("impact-driver", link);
    const remote = crossing || opposingCar ? h.join("impact-target", link) : null;
    h.run(4000);
    const client = h.client(session)!, ents = h.world.ents, urban = h.host.urban;
    const start = kind === "push" ? TARGET - 5 : START;
    const car = h.host.spawnVehicle("core:compact", LANE, start, 0, 0);
    const driver = h.reg.vehicle[ents.kind[car]!]!;
    ents.setPosition(client.ent, LANE + 1.6, 0, start + .12);
    if (urban.mount(client, car) !== RESULT_OK) throw new Error("could not board impact car");
    h.host.survival.gods.add(client.pid);
    // A deterministic spread across the front bumper also varies the contact lever arm.
    const offset = (((seed * 7 % 23) + 23) % 23 / 22 - .5) * 1.4;
    let target = -1;
    if (kind === "wall") {
      const wall = h.reg.index.get("core:wall")!;
      for (const x of [-3, 0, 3]) h.world.structs.add(wall, LANE + x + offset, 1.5, TARGET, 0, 0, 10000);
    } else if (kind === "parked" || opposingCar) {
      const x = LANE + offset + (kind === "swerve" ? 1.65 : 0);
      target = h.host.spawnVehicle("core:compact", x, TARGET, 0, opposingCar ? Math.PI : 0);
      if (remote) {
        const peer = h.client(remote)!;
        ents.setPosition(peer.ent, x - 1.6, 0, TARGET - .12);
        if (urban.mount(peer, target) !== RESULT_OK) throw new Error("could not board oncoming car");
        h.host.survival.gods.add(peer.pid);
      }
    } else if (crossing && remote) {
      const peer = h.client(remote)!;
      target = peer.ent;
      const side = kind === "near-miss" ? 12 : kind === "close-pass" ? 1.53 + offset * .28 : kind === "stop-short" ? 4.9 + offset * .35 : 3.3 + offset;
      ents.setPosition(target, LANE + side, 0, TARGET);
      h.host.survival.gods.add(peer.pid);
    } else {
      target = h.host.spawnCreature(kind === "dodo" ? "core:dodo" : "core:parasaur", LANE + offset, TARGET, 1);
      ents.mflags[target] = ents.mflags[target]! | MF_ROOTED;
      if (kind === "protected" || kind === "push") {
        const victim = h.host.records.byPid.get(ents.pid[target]!)!, owner = h.host.records.byPid.get(client.pid)!;
        victim.team = owner.team; ents.setTeam(target, victim.team);
      }
    }
    h.run(3500);
    if (session.driving !== car || (kind !== "wall" && target < 0)) throw new Error("impact course setup failed");
    const generation = ents.gen[target], targetKind = ents.kind[target], draw = new RemoteSample();
    const corrections: Correction[] = [], samples: Sample[] = [];
    let impactTick = -1, impactNow = -1, impactSpeed = 0, otherSpeed = 0, touchTicks = 0, lastTouch = -1, serverHit = false;
    let preSpeed = 0, preTarget = 0;
    const mark = () => { impactTick = h.world.tick; impactNow = h.now; impactSpeed = preSpeed; otherSpeed = preTarget; };
    const pair = urban.collisionPair.bind(urban);
    urban.collisionPair = event => {
      const a = event.a.entity, b = event.b.entity;
      if ((a === car && b === target) || (a === target && b === car)) {
        if (!serverHit) mark();
        serverHit = true;
        if (lastTouch !== event.tick) { touchTicks++; lastTouch = event.tick; }
      }
      pair(event);
    };
    const step = h.server.tick.bind(h.server);
    h.server.tick = () => {
      preSpeed = Math.hypot(ents.vx[car]!, ents.vz[car]!);
      preTarget = target >= 0 ? Math.hypot(ents.vx[target]!, ents.vz[target]!) : 0;
      step();
      if (impactTick >= 0) return;
      if (kind === "wall" && preSpeed - Math.hypot(ents.vx[car]!, ents.vz[car]!) > 3 && Math.abs(ents.z[car]! - TARGET) < 5) {
        serverHit = true; mark();
      } else if ((crossing && ents.z[car]! >= TARGET) || (opposingCar && ents.z[car]! >= ents.z[target]!)) mark();
    };
    const observed = session as unknown as { reconcile(tick: number, body: Body): void };
    const reconcile = observed.reconcile.bind(session);
    const predictedTicks = new Set<number>();
    observed.reconcile = (tick, body) => {
      const sim = session.simTick, own = session.own;
      const x = own.x, y = own.y, z = own.z, yaw = own.vehicleYaw;
      const qx = own.vehicleQx, qy = own.vehicleQy, qz = own.vehicleQz, qw = own.vehicleQw;
      const transitions = session.stats.transitions, drawnBefore = display(session);
      reconcile(tick, body);
      if (tick >= sim || session.stats.transitions !== transitions) return;
      const distance = Math.hypot(own.x - x, own.y - y, own.z - z);
      const norm = Math.hypot(qx, qy, qz, qw) * Math.hypot(own.vehicleQx, own.vehicleQy, own.vehicleQz, own.vehicleQw);
      const dot = norm > 0 ? Math.min(1, Math.abs(qx * own.vehicleQx + qy * own.vehicleQy + qz * own.vehicleQz + qw * own.vehicleQw) / norm) : 1;
      const drawnAfter = display(session);
      corrections.push({ displayYaw: degrees(drawnAfter.yaw - drawnBefore.yaw),
        displayDistance: Math.hypot(drawnAfter.x - drawnBefore.x, drawnAfter.y - drawnBefore.y, drawnAfter.z - drawnBefore.z), now: h.now, tick, at: h.world.tick, distance, yaw: degrees(own.vehicleYaw - yaw),
        angle: 2 * Math.acos(dot) * 180 / Math.PI, snap: distance > .001 && session.smoothX === 0 && session.smoothY === 0 && session.smoothZ === 0 });
    };
    const update = session.update.bind(session);
    session.update = (...args: Parameters<typeof update>) => {
      // Network delivery (and replay) precedes this forward frame in Harness.run. Replay cannot count as a predicted hit.
      const stats = session.vehicleContacts?.stats, before = stats?.contacts ?? 0;
      update(...args);
      if (stats && stats.contacts > before && target >= 0 && stats.lastTarget === makeHandle(target, generation!)) predictedTicks.add(stats.lastTick);
      session.sampleRemote(draw);
      const { x, z, yaw } = display(session);
      let gap: number | null = null;
      for (let i = 0; i < draw.count; i++) if (draw.id[i] === target && draw.gen[i] === generation && draw.kind[i] === targetKind) {
        const v = h.reg.vehicle[targetKind!], r = h.reg.move[targetKind!]!.radius;
        gap = footprintGap(draw.x[i]! - x, draw.z[i]! - z, yaw, driver.spec.halfWidth, driver.spec.halfLength,
          draw.yaw[i]!, v?.spec.halfWidth ?? r, v?.spec.halfLength ?? null);
        break;
      }
      samples.push({ x, z, yaw, angle: (session.vehicleCorrection?.angle ?? 0) * 180 / Math.PI, now: h.now, tick: h.world.tick, smooth: Math.hypot(session.smoothX, session.smoothY, session.smoothZ), gap });
    };
    const pilot = h.pilots[0]!, downlink = h.ends[0]!.peer, bytesBefore = downlink.bytesSent, driveStart = h.now;
    let crossingStarted = false, crossingStopped = false, swerving = false;
    for (let elapsed = 0; elapsed < 22000 && (impactTick < 0 || h.world.tick <= impactTick + WINDOW_TICKS + 12); elapsed += 50) {
      h.run(50, () => {
        const velocity = Math.hypot(ents.vx[car]!, ents.vz[car]!), age = impactTick < 0 ? 0 : h.world.tick - impactTick;
        const pulse = kind === "push" && age < 100, braking = pulse ? age % 30 >= 18 : age > 30;
        pilot.moveZ = braking ? 0 : velocity < speed - .3 ? 1 : velocity > speed + .3 ? 0 : .35;
        pilot.buttons = braking ? BTN_JUMP : 0;
        if (!remote) return;
        const other = h.pilots[1]!;
        if (crossing) {
          crossingStarted ||= ents.z[car]! > TARGET - 17;
          crossingStopped ||= kind === "stop-short" && ents.x[target]! < LANE + 2.15;
          other.moveX = crossingStarted && !crossingStopped && kind !== "close-pass" && age < 18 ? 1 : 0;
        } else {
          // Last-moment steering/braking is an input the other driver cannot have received yet.
          swerving ||= kind === "swerve" && ents.z[target]! - ents.z[car]! < 14;
          other.moveX = swerving && age < 18 ? (seed % 2 ? 1 : -1) : 0;
          other.moveZ = velocity > 8 && age < 1 && !swerving ? .7 : 0;
          other.buttons = age >= 1 || swerving ? BTN_JUMP : 0;
        }
      });
    }
    if (impactTick < 0) throw new Error(`no encounter: ${kind}/${rtt}/${seed} (z=${ents.z[car]})`);
    // A snapshot *before* the crash can already replay the predicted driver through impact.
    // Count the corrections when the driver receives them, including the final approach.
    const window = corrections.filter(c => c.at >= impactTick - LEAD_TICKS && c.at <= impactTick + WINDOW_TICKS);
    if (!window.length) throw new Error("encounter has no reconciled snapshots");
    const moved = window.filter(c => c.distance > .02 || c.yaw > .05);
    const visible = samples.filter(s => s.tick >= impactTick - LEAD_TICKS && s.tick <= impactTick + WINDOW_TICKS);
    const encounter = samples.filter(s => s.gap !== null && s.tick >= impactTick - LEAD_TICKS && s.tick <= impactTick + LEAD_TICKS);
    const firstFrame = encounter.find(s => s.tick >= impactTick), drawnHit = encounter.some(s => s.gap! <= .1);
    let peakFrameTravel = 0, peakFrameYaw = 0;
    for (let i = 1; i < visible.length; i++) {
      const a = visible[i - 1]!, b = visible[i]!;
      peakFrameTravel = Math.max(peakFrameTravel, Math.hypot(b.x - a.x, b.z - a.z));
      peakFrameYaw = Math.max(peakFrameYaw, degrees(b.yaw - a.yaw));
    }
    const lastVisible = visible.filter(s => s.smooth > .02 || s.angle > .3).at(-1);
    const predictions = [...predictedTicks].filter(t => t >= impactTick - LEAD_TICKS && t <= impactTick + LEAD_TICKS);
    const peak = (field: "distance" | "yaw" | "angle" | "displayYaw" | "displayDistance") => Math.max(0, ...window.map(c => c[field]));
    return { kind, transport: "tcp", rttMs: rtt, jitterMs: jitter, loss, seed, requestedSpeed: speed, impactTick, impactSpeed: round(impactSpeed),
      driverDownlinkBytesPerSec: Math.round(1000 * (downlink.bytesSent - bytesBefore) / (h.now - driveStart)),
      targetSpeed: round(otherSpeed), serverHit, touchTicks, drawnHit: target >= 0 ? drawnHit : null,
      predictedHit: target >= 0 && session.vehicleContacts ? predictions.length > 0 : null,
      predictedLeadTicks: predictions.length ? impactTick - Math.min(...predictions) : null,
      peakFrameTravelM: round(peakFrameTravel), peakFrameYawDeg: round(peakFrameYaw),
      peakDisplayCorrectionM: round(peak("displayDistance")), peakDisplayCorrectionYawDeg: round(peak("displayYaw")),
      lastVisibleFadeMs: lastVisible ? Math.round(lastVisible.now - impactNow) : null,
      fadeCensored: !!lastVisible && lastVisible.tick >= impactTick + WINDOW_TICKS - 1,
      drawnGapAtImpactM: firstFrame ? round(firstFrame.gap!) : null,
      closestDrawnGapM: encounter.length ? round(Math.min(...encounter.map(s => s.gap!))) : null,
      deepestDrawnOverlapM: encounter.length ? round(Math.max(0, ...encounter.map(s => -s.gap!))) : null,
      approachTicks: LEAD_TICKS, windowTicks: WINDOW_TICKS, comparedSnapshots: window.length, peakTranslationM: round(peak("distance")), peakYawDeg: round(peak("yaw")),
      peakAngleDeg: round(peak("angle")), significantCorrections: moved.length, directSnaps: window.filter(c => c.snap).length,
      lastCorrectionDelayMs: moved.length ? Math.round(moved.at(-1)!.now - impactNow) : null,
      censored: moved.length > 0 && moved.at(-1)!.at >= impactTick + WINDOW_TICKS - 3,
      peakHiddenTranslationM: round(Math.max(0, ...visible.map(s => s.smooth))),
      correctionEvents: moved.map(c => ({ receivedTickFromImpact: c.at - impactTick, baselineTickFromImpact: c.tick - impactTick, metres: round(c.distance), yawDeg: round(c.yaw) })) };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const args = new Map(process.argv.slice(2).map(word => { const at = word.indexOf("="); return [word.slice(0, at), word.slice(at + 1)]; }));
  const kind = args.get("--case"), cases = kind ? [...CASES, ...EXTRA_CASES].filter(c => c === kind) : CASES;
  if (!cases.length) throw new Error(`unknown collision case ${kind}`);
  const rtts = args.has("--rtt") ? [Number(args.get("--rtt"))] : [0, 80, 150];
  const count = Number(args.get("--seeds") ?? 20);
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error("invalid seed count");
  const seeds = args.has("--seed") ? [Number(args.get("--seed"))] : Array.from({ length: count }, (_, i) => i + 1);
  const loss = Number(args.get("--loss") ?? 0), jitter = Number(args.get("--jitter") ?? 10), speed = Number(args.get("--speed") ?? 20);
  if (!rtts.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) || !seeds.every(Number.isInteger) || !(loss >= 0 && loss < 1) || !(jitter >= 0 && jitter <= 1000) || !(speed > 0 && speed <= 40)) throw new Error("invalid collision course options");
  for (const kind of cases) for (const rtt of rtts) for (const seed of seeds) console.log(JSON.stringify(collisionNetworkTrial({ kind, rtt, seed, loss, jitter, speed })));
}
