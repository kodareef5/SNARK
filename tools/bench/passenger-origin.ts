// Native App/Host passenger course, not browser frame timing. The driver circles at full throttle while the
// passenger aims, fires and reloads normally over seeded TCP loss (2%) and jitter (10 ms). No input/view timestamps
// or acknowledgements are replaced. App installs the same posed shot-origin callback used during play.
// bun tools/bench/passenger-origin.ts [all|50|150|300=all] [seconds=30]
// SNARK_CORE_PACK may reuse an existing core.snpk, as with the native integration tests.
import { App } from "../../client/core/app.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { BTN_PRIMARY, BTN_RELOAD, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { takeInHand } from "../../tests/fixtures/gather.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { corePack } from "../../tests/fixtures/pack.ts";

interface LocalShot { tick: number; origin: Float64Array }
interface ServerShot extends LocalShot { current: Float64Array; speed: number; used: boolean }

function distribution(values: number[]) {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error("missing or invalid passenger samples");
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return { median: at(.5), p95: at(.95), max: at(1) };
}

function distance(a: Float64Array, b: Float64Array): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

export function passengerOriginTrial(rtt: number, seconds = 30, pack: Pack = corePack()) {
  if (!Number.isFinite(rtt) || rtt < 0 || rtt > 1000 || !Number.isFinite(seconds) || seconds < 5 || seconds > 120)
    throw new Error("invalid passenger course duration or RTT");
  const h = new Harness({}, 13, 60, { dev: true, map: writeMap(flatMap(4)), clips: pack.clips, rigs: pack.header.rigs });
  try {
    const driver = h.join("aim-driver"), passenger = h.join("aim-passenger", { latencyMs: rtt / 2, jitterMs: 10, loss: .02, tcp: true });
    h.run(3000); h.say(passenger, "enablecheats", 1500); h.say(passenger, "kit pistol", 1500); h.run(3000);
    takeInHand(h, passenger, h.reg.index.get("core:pistol")!); h.run(4000);
    const a = h.client(driver), b = h.client(passenger), ents = h.world.ents;
    if (!a || !b) throw new Error("passenger course did not join");
    const car = h.host.spawnVehicle("core:compact", 128, 120, 0);
    if (car < 0) throw new Error("passenger course car did not spawn");
    ents.setPosition(a.ent, 129.6, 0, 120.12); ents.setPosition(b.ent, 126.4, 0, 120.12);
    if (h.host.urban.mount(a, car) !== RESULT_OK || h.host.urban.mount(b, car) !== RESULT_OK) throw new Error("passenger course did not board");
    h.run(2500);
    if (driver.driving !== car || passenger.driving >= 0 || passenger.own.seat !== car + 1) throw new Error("passenger course lost its seats");
    const app = new App(passenger, h.reg, pack); app.steer = false;
    h.pilots[0]!.moveZ = 1; h.pilots[0]!.moveX = .35;

    const server: ServerShot[] = [], local: LocalShot[] = [];
    const combat = h.host.combat, projectiles = h.host.projectiles;
    const eye = combat.eye.bind(combat), launch = projectiles.launch.bind(projectiles);
    let capture: Float64Array | null = null, captured = 0;
    combat.eye = (e, out, at, clip, viewer) => {
      const result = eye(e, out, at, clip, viewer);
      if (capture && e === b.ent) {
        if (!result) throw new Error("passenger launch fell back to a standing eye");
        capture.set(out); captured++;
      }
      return result;
    };
    projectiles.launch = (c, rec, weapon, quality, ammo, draw) => {
      if (c !== b) { launch(c, rec, weapon, quality, ammo, draw); return; }
      const current = new Float64Array(3), origin = new Float64Array(3), fired = projectiles.fired;
      eye(b.ent, current, h.world.tick); capture = origin; captured = 0;
      try { launch(c, rec, weapon, quality, ammo, draw); } finally { capture = null; }
      if (projectiles.fired !== fired + 1 || captured !== 1) throw new Error("passenger launch did not resolve exactly one public eye");
      server.push({ tick: h.world.tick, origin, current, speed: Math.hypot(ents.vx[car]!, ents.vz[car]!), used: false });
    };
    let frame = 0, next = 120, reloadAt = 0;
    const update = passenger.update.bind(passenger);
    passenger.update = (now, mx, mz) => {
      frame++;
      let buttons = BTN_SECONDARY;
      if (frame >= next && passenger.own.rounds > 0) buttons |= BTN_PRIMARY;
      if (passenger.own.rounds === 0 && frame >= reloadAt) { buttons |= BTN_RELOAD; reloadAt = frame + 240; }
      const before = passenger.fired.length;
      update(now, mx, mz, 1.1 + .6 * Math.sin(frame / 50), .1, buttons);
      if (passenger.fired.length > before) {
        if (passenger.fired.length !== before + 1) throw new Error("multiple local shots in one passenger frame");
        const shot = passenger.fired[before]!;
        local.push({ tick: passenger.simTick, origin: Float64Array.of(shot.x, shot.y, shot.z) }); next = frame + 50;
      }
    };
    h.run(seconds * 1000);
    for (const shot of [...local, ...server]) {
      if (!Number.isInteger(shot.tick) || shot.origin.some(v => !Number.isFinite(v))) throw new Error("invalid passenger shot");
    }
    const errors: number[] = [], rewinds: number[] = [], speeds: number[] = [];
    let exact = 0, adjacent = 0, unmatchedLocal = 0;
    for (const shot of local) {
      // Each launch can pair once. Prefer its exact simulation tick, then the preceding/following tick;
      // ordinary packet loss can leave a predicted shot unmatched. Report it instead of assigning zero error.
      let match: ServerShot | undefined;
      for (const offset of [0, -1, 1]) {
        match = server.find(s => !s.used && s.tick === shot.tick + offset);
        if (match) break;
      }
      if (!match) { unmatchedLocal++; continue; }
      match.used = true;
      if (match.tick === shot.tick) exact++; else adjacent++;
      errors.push(distance(match.origin, shot.origin)); rewinds.push(distance(match.origin, match.current)); speeds.push(match.speed);
    }
    const speedMps = distribution(speeds);
    if (speedMps.median < 15 || local.length < 3 || errors.length / local.length < .7) throw new Error("insufficient moving passenger shot coverage");
    if (driver.driving !== car || passenger.own.seat !== car + 1) throw new Error("passenger course lost an occupant");
    return { rtt, seconds, frames: frame, localShots: local.length, serverShots: server.length, paired: errors.length,
      exact, adjacent, unmatchedLocal, unmatchedServer: server.filter(s => !s.used).length,
      speedMps, errorM: distribution(errors), rewindFromCurrentEyeM: distribution(rewinds), undecodable: passenger.stats.undecodable };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const which = process.argv[2] ?? "all", seconds = Number(process.argv[3] ?? 30);
  if (!["all", "50", "150", "300"].includes(which)) throw new Error("expected all, 50, 150 or 300 ms RTT");
  for (const rtt of which === "all" ? [50, 150, 300] : [Number(which)]) console.log(JSON.stringify(passengerOriginTrial(rtt, seconds)));
}
