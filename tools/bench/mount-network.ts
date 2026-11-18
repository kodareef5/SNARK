// Native Host + two real Apps on a seeded TCP link; no browser/GPU timing. Uses the authored core fixture pack.
// bun tools/bench/mount-network.ts [all|raptor|parasaur] [RTT-ms=150]
// A source-only checkout can reuse a built pack: SNARK_CORE_PACK=/path/to/core.snpk bun tools/bench/mount-network.ts
// Each JSON row's frames are [driver, observer]. Metres compare the rendered saddle origin with seatOn at that SAME
// presented mount pose/tick, not two different network clocks. The graded turning course normally yields 531 frames each.
// Missing/nonfinite samples, missing art, an unseated rider, or a stationary/teleported course fail instead of printing zero.
import { App } from "../../client/core/app.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { seatOn } from "../../shared/anim/seat.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { corePack } from "../../tests/fixtures/pack.ts";

type Species = "raptor" | "parasaur";
interface Distribution { n: number; p95: number; max: number }
function distribution(values: number[], frames: number): Distribution {
  if (values.length !== frames || frames < 500 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("missing or invalid saddle samples");
  values.sort((a, b) => a - b);
  return { n: values.length, p95: values[Math.floor(values.length * .95)]!, max: values[values.length - 1]! };
}

export function mountNetworkTrial(species: Species, latency = 150) {
  if (!Number.isFinite(latency) || latency < 0 || latency > 1000) throw new Error("RTT must be 0..1000 ms");
  const x = 128, z = 57, map = flatMap(4, { spawns: [{ name: "Hill", x: x - 3, z, yaw: 0 }] });
  const side = Math.sqrt(map.heights.length);
  const rise = (a: number, b: number): number => Math.max(0, Math.min(b - 48, 112 - b)) * .364 + .15 * Math.max(-12, Math.min(12, a - x));
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) map.heights[j * side + i] = Math.round((rise(i * 2, j * 2) - map.minY) / map.stepY);
  const h = new Harness({}, 17, 60, { dev: true, map: writeMap(map), wild: false });
  try {
    const link = { latencyMs: latency / 2, jitterMs: 5, tcp: true };
    const driver = new App(h.join("rider", link, { manual: true }), h.reg, corePack());
    const observer = new App(h.join("watcher", link, { manual: true }), h.reg, corePack());
    driver.steer = observer.steer = true;
    const apps = [driver, observer], errors: [number[], number[]] = [[], []];
    let measuring = false, frames = 0, movingFrames = 0, path = 0, lastX = x, lastZ = z, mount = -1;
    const { world } = h, { ents } = world;
    const frame = (now: number): void => {
      for (let i = 0; i < apps.length; i++) {
        const before = errors[i]!.length, packet = apps[i]!.frame(now, 800, 480);
        if (measuring && (!packet || errors[i]!.length !== before + 1)) throw new Error(`${species}: missing/duplicate ${i === 0 ? "driver" : "observer"} saddle at frame ${frames}`);
      }
      if (measuring) {
        const distance = Math.hypot(ents.x[mount]! - lastX, ents.z[mount]! - lastZ);
        if (!Number.isFinite(distance) || distance > 1) throw new Error(`${species}: invalid or discontinuous course movement`);
        if (distance > .001) movingFrames++;
        path += distance; lastX = ents.x[mount]!; lastZ = ents.z[mount]!; frames++;
      }
    };
    const run = (ms: number): void => h.run(ms, frame);
    run(1600);
    const client = h.client(driver.session), watch = h.ent(observer.session);
    if (!client || watch < 0) throw new Error("both Apps must join before the course");
    mount = h.host.spawnCreature(`core:${species}`, x, z, 1);
    const kind = ents.kind[mount]!, saddle = h.reg.index.get(`core:saddle_${species}`), rider = h.host.records.byPid.get(client.pid);
    const record = h.host.records.byPid.get(ents.pid[mount]!);
    if (mount < 0 || saddle === undefined || !record || !rider) throw new Error(`cannot create saddled ${species}`);
    record.team = rider.team; record.saddle = saddle;
    h.host.refreshBody(record); h.host.creatures.claimed(mount); h.host.creatures.mind.stay(mount, 0xffffffff); ents.yaw[mount] = 0;
    ents.setPosition(client.ent, x - 2, world.hf.heightAt(x - 2, z), z); world.history.discontinuity(client.ent);
    ents.setPosition(watch, x - 6, world.hf.heightAt(x - 6, z + 12), z + 12); world.history.discontinuity(watch);
    if (h.host.riding.mount(client, mount) !== RESULT_OK) throw new Error(`cannot mount ${species}`);
    run(1200);
    const seat = h.reg.saddleSeats[saddle]?.[0], anim = world.anims[kind], move = h.reg.tamedMove[kind];
    if (!seat?.socket || !anim?.rig.sockets.has(seat.socket) || !move) throw new Error(`${species}: authored saddle rig is missing; supply the full core fixture pack`);
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i]!, characters = app.scene?.characters;
      if (!characters) throw new Error("App scene did not initialize");
      const original = characters.seat.bind(characters), expected = new Float64Array(12);
      characters.seat = (...args: Parameters<typeof characters.seat>): boolean => {
        const [k, bx, by, bz, yaw, state, tick, out, slot, , , id] = args;
        const ok = original(...args);
        if (k === kind && slot === 1 && id === mount) {
          if (!ok) throw new Error(`${species}: the rendered saddle has no seat`);
          // Scene's public camera is already placed when its seat queries run. These selected calls are camera-relative.
          const { x: cx, y: cy, z: cz } = app.cam, pose = new AnimState();
          pose.unpack(state.pack(), state.packCue()); pose.seed = state.seed;
          expected.fill(NaN);
          seatOn(anim, seat, pose, tick, bx + cx, by + cy, bz + cz, yaw, expected, world, move);
          if (![bx, by, bz, yaw, tick, cx, cy, cz, ...expected, ...out].every(Number.isFinite)) throw new Error(`${species}: nonfinite saddle frame`);
          errors[i]!.push(Math.hypot(expected[0]! - out[0]! - cx, expected[1]! - out[1]! - cy, expected[2]! - out[2]! - cz));
        }
        return ok;
      };
    }
    const startCorrections = driver.session.stats.corrections;
    lastX = ents.x[mount]!; lastZ = ents.z[mount]!; measuring = true;
    driver.key("KeyW", true);
    for (let i = 0; i < 500; i++) {
      const dx = ents.x[mount]! - ents.x[watch]!, dz = ents.z[mount]! - ents.z[watch]!;
      observer.controls.yaw = Math.atan2(dx, dz);
      observer.controls.pitch = Math.atan2(ents.y[mount]! + 1.15 - ents.y[watch]! - 1.6, Math.hypot(dx, dz));
      driver.controls.yaw = i < 120 ? 0 : i < 240 ? .5 : i < 350 ? -.6 : .3;
      run(1000 / 60);
      if (client.drive !== mount || driver.session.driving !== mount) throw new Error(`${species}: rider left the saddle during the course`);
    }
    driver.key("KeyW", false); run(500);
    const travel = Math.hypot(ents.x[mount]! - x, ents.z[mount]! - z);
    if (movingFrames < 200 || path < 10 || travel < 10 || client.drive !== mount) throw new Error(`${species}: course did not maintain real mounted movement`);
    return { species, latency, frames: errors.map(e => distribution(e, frames)), travel, path, movingFrames,
      corrections: driver.session.stats.corrections - startCorrections, seated: true };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const species = process.argv[2] ?? "all", latency = Number(process.argv[3] ?? 150);
  if (!["all", "raptor", "parasaur"].includes(species) || process.argv.length > 4) throw new Error("usage: bun tools/bench/mount-network.ts [all|raptor|parasaur] [RTT-ms=150]");
  for (const kind of species === "all" ? ["raptor", "parasaur"] as const : [species as Species]) console.log(JSON.stringify(mountNetworkTrial(kind, latency)));
}
