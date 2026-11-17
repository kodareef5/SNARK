// Goal 1 baseline for Goal 2: event-window corrections through the real host, TCP loopback and ClientSession replay.
// No physics/policy/prediction overrides. Observers wrap diagnostics only; terrain and native inputs create each impact.
// bun tools/bench/collision-network.ts [--case=wall|dodo|parasaur|protected|parked] [--rtt=80] [--seed=1] [--loss=0]
// Defaults: three seeded impacts of every class at 0/80/150ms RTT, 10ms jitter, no loss. JSONL is emitted per impact.
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, MF_ROOTED, type Body } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";

export type CollisionCase = "wall" | "dodo" | "parasaur" | "protected" | "parked";
interface Correction { now: number; tick: number; distance: number; yaw: number; angle: number; snap: boolean }
interface Sample { now: number; tick: number; smooth: number }
export interface CollisionNetworkOptions { kind: CollisionCase; rtt: number; seed: number; loss?: number; jitter?: number; speed?: number }
const CASES: readonly CollisionCase[] = ["wall", "dodo", "parasaur", "protected", "parked"];
const WINDOW_TICKS = 60, LANE = 128, START = 30, TARGET = 135;
const round = (n: number): number => Math.round(n * 10000) / 10000;

/** One isolated, native impact. Every returned correction belongs to authoritative ticks [impact, impact+60]. */
export function collisionNetworkTrial({ kind, rtt, seed, loss = 0, jitter = 10, speed = 20 }: CollisionNetworkOptions) {
  const h = new Harness({}, seed, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const session = h.join("impact-driver", { tcp: true, latencyMs: rtt / 2, jitterMs: jitter, loss }); h.run(4000);
    const client = h.client(session)!, ents = h.world.ents;
    const car = h.host.spawnVehicle("core:compact", LANE, START, 0, 0);
    if (car < 0) throw new Error("collision baseline: no car");
    ents.setPosition(client.ent, LANE + 1.6, 0, START + .12);
    if (h.host.urban.mount(client, car) !== RESULT_OK) throw new Error("collision baseline: cannot board");
    h.host.survival.gods.add(client.pid); h.run(2500);
    if (session.driving !== car) throw new Error("collision baseline: mount did not settle");
    // All clients receive real static rows before driving. Seed controls transport jitter and a small impact offset.
    const offset = (seed % 3 - 1) * .2;
    if (kind === "wall") {
      const wall = h.reg.index.get("core:wall")!;
      for (const x of [-3, 0, 3]) h.world.structs.add(wall, LANE + x, 1.5, TARGET, 0, 0, 10000);
    } else if (kind === "parked") {
      if (h.host.spawnVehicle("core:compact", LANE + offset, TARGET, 0, 0) < 0) throw new Error("collision baseline: no parked target");
    } else {
      const target = h.host.spawnCreature(kind === "dodo" ? "core:dodo" : "core:parasaur", LANE + offset, TARGET, 1);
      if (target < 0) throw new Error("collision baseline: no creature");
      ents.mflags[target] = ents.mflags[target]! | MF_ROOTED;
      if (kind === "protected") {
        const victim = h.host.records.byPid.get(ents.pid[target]!)!, owner = h.host.records.byPid.get(client.pid)!;
        victim.team = owner.team; ents.setTeam(target, victim.team);
      }
    }
    h.run(1000);
    const corrections: Correction[] = [], samples: Sample[] = [];
    let impactTick = -1, impactNow = -1, impactSpeed = 0;
    const contacts = h.host.urban.contacts!, step = h.server.tick.bind(h.server);
    h.server.tick = () => {
      const count = contacts.contacts, before = Math.hypot(ents.vx[car]!, ents.vy[car]!, ents.vz[car]!);
      step();
      const after = Math.hypot(ents.vx[car]!, ents.vy[car]!, ents.vz[car]!);
      if (impactTick < 0 && (kind === "wall" ? before - after > 3 && Math.abs(ents.z[car]! - TARGET) < 5 : contacts.contacts > count)) {
        impactTick = h.world.tick; impactNow = h.now; impactSpeed = before;
      }
    };
    // Measuring the newest replayed body before/after reconcile excludes ordinary forward stepping and render easing.
    const observed = session as unknown as { reconcile(tick: number, body: Body): void };
    const reconcile = observed.reconcile.bind(session);
    observed.reconcile = (tick, body) => {
      const sim = session.simTick, own = session.own;
      const x = own.x, y = own.y, z = own.z, yaw = own.vehicleYaw;
      const qx = own.vehicleQx, qy = own.vehicleQy, qz = own.vehicleQz, qw = own.vehicleQw;
      const transitions = session.stats.transitions;
      reconcile(tick, body);
      // Joins, stalled-clock adoption and seat/body transitions are not dynamic-contact corrections.
      if (tick >= sim || session.stats.transitions !== transitions) return;
      const distance = Math.hypot(own.x - x, own.y - y, own.z - z), dyaw = own.vehicleYaw - yaw;
      const norm = Math.hypot(qx, qy, qz, qw) * Math.hypot(own.vehicleQx, own.vehicleQy, own.vehicleQz, own.vehicleQw);
      const dot = norm > 0 ? Math.min(1, Math.abs(qx * own.vehicleQx + qy * own.vehicleQy + qz * own.vehicleQz + qw * own.vehicleQw) / norm) : 1;
      corrections.push({ now: h.now, tick, distance, yaw: Math.abs(Math.atan2(Math.sin(dyaw), Math.cos(dyaw))) * 180 / Math.PI,
        angle: 2 * Math.acos(dot) * 180 / Math.PI, snap: distance > .001 && session.smoothX === 0 && session.smoothY === 0 && session.smoothZ === 0 });
    };
    const update = session.update.bind(session);
    session.update = (...args: Parameters<typeof update>) => {
      update(...args);
      samples.push({ now: h.now, tick: h.world.tick, smooth: Math.hypot(session.smoothX, session.smoothY, session.smoothZ) });
    };
    const pilot = h.pilots[0]!;
    // Hold throttle briefly after impact to expose a correction train, then stop through native handbrake input.
    for (let elapsed = 0; elapsed < 18000 && (impactTick < 0 || h.world.tick <= impactTick + WINDOW_TICKS + 45); elapsed += 50) {
      h.run(50, () => {
        const velocity = Math.hypot(session.own.vx, session.own.vz), braking = impactTick >= 0 && h.world.tick > impactTick + 30;
        pilot.moveZ = braking ? 0 : velocity < speed - .3 ? 1 : velocity > speed + .3 ? 0 : .35;
        pilot.moveX = 0; pilot.buttons = braking ? BTN_JUMP : 0;
      });
    }
    if (impactTick < 0) throw new Error(`collision baseline: ${kind}/${rtt}/${seed} did not hit (z=${ents.z[car]})`);
    const window = corrections.filter(c => c.tick >= impactTick && c.tick <= impactTick + WINDOW_TICKS);
    const moved = window.filter(c => c.distance > .02 || c.yaw > .05), visible = samples.filter(s => s.tick >= impactTick && s.tick <= impactTick + WINDOW_TICKS);
    const peak = (field: "distance" | "yaw" | "angle") => Math.max(0, ...window.map(c => c[field]));
    return { kind, rttMs: rtt, jitterMs: jitter, loss, transport: "tcp", seed, requestedSpeed: speed, impactTick,
      impactSpeed: round(impactSpeed), windowTicks: WINDOW_TICKS, comparedSnapshots: window.length,
      peakTranslationM: round(peak("distance")), peakYawDeg: round(peak("yaw")), peakAngleDeg: round(peak("angle")),
      significantCorrections: moved.length, directSnaps: window.filter(c => c.snap).length,
      firstCorrectionDelayMs: moved.length ? Math.round(moved[0]!.now - impactNow) : null,
      lastCorrectionDelayMs: moved.length ? Math.round(moved.at(-1)!.now - impactNow) : null,
      peakHiddenTranslationM: round(Math.max(0, ...visible.map(s => s.smooth))),
      correctionEvents: moved.map(c => ({ tickFromImpact: c.tick - impactTick, metres: round(c.distance), yawDeg: round(c.yaw) })),
      finalSpeed: round(Math.hypot(ents.vx[car]!, ents.vy[car]!, ents.vz[car]!)),
      finalPredictionDeltaM: round(Math.hypot(session.own.x - ents.x[car]!, session.own.y - ents.y[car]!, session.own.z - ents.z[car]!)),
      finalHiddenTranslationM: round(Math.hypot(session.smoothX, session.smoothY, session.smoothZ)) };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const args = new Map(process.argv.slice(2).map(word => { const at = word.indexOf("="); return [word.slice(0, at), word.slice(at + 1)]; }));
  const kind = args.get("--case"), cases = kind ? CASES.filter(c => c === kind) : CASES;
  if (!cases.length) throw new Error(`unknown collision case ${kind}`);
  const rtts = args.has("--rtt") ? [Number(args.get("--rtt"))] : [0, 80, 150];
  const seeds = args.has("--seed") ? [Number(args.get("--seed"))] : [1, 2, 3];
  const loss = Number(args.get("--loss") ?? 0), jitter = Number(args.get("--jitter") ?? 10), speed = Number(args.get("--speed") ?? 20);
  if (!rtts.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) || !seeds.every(Number.isInteger) || !(loss >= 0 && loss <= 1) || !(jitter >= 0 && jitter <= 1000) || !(speed > 0 && speed <= 40)) throw new Error("invalid collision baseline options");
  for (const kind of cases) for (const rtt of rtts) for (const seed of seeds) console.log(JSON.stringify(collisionNetworkTrial({ kind, rtt, seed, loss, jitter, speed })));
}
