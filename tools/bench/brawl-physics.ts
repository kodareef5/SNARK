// A crowded brawl, for the physics lane (server/lane.ts): twenty survivors walking among three hundred creatures in a
// city block's worth of ground, bodies blocking bodies, creatures turning their heads off walls, things thrown, blows
// landing and told to everyone near, with one survivor on a delayed link. Rows: the lane's time a tick (median, 99th
// percentile and the worst, against its reservation), the whole tick, what the lane admitted, and the corrections the
// delayed survivor's prediction took a minute. `bun tools/bench/brawl-physics.ts` runs these alone.

import { LANE_RESERVE_MS } from "../../server/lane.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { CMD_THROW } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const SURVIVORS = 20;
const CREATURES = 300;
const KINDS = ["core:raptor", "core:parasaur", "core:dodo", "core:trike", "core:stego", "core:rex"];
const SECONDS = 20;

const at = (times: number[], q: number): number => [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * q))]!;

export function benchBrawlPhysics(section: Section, record: Row): void {
  section(`A brawl: ${SURVIVORS} survivors among ${CREATURES} creatures, bodies blocking bodies, things thrown and blows landing, one survivor 150 ms away`);
  const h = new Harness({}, 1, 30, { dev: true });
  const sessions = Array.from({ length: SURVIVORS }, (_, k) => h.join(`s${k}`, k === 0 ? { latencyMs: 75, jitterMs: 6 } : {}));
  h.run(1500);
  const ents = h.world.ents, rng = new Rng(11);
  const [cx, cz] = [ents.x[h.ent(sessions[0]!)]!, ents.z[h.ent(sessions[0]!)]!];
  for (const s of sessions) {
    h.say(s, "enablecheats");
    h.host.survival.gods.add(h.client(s)!.pid);
    h.say(s, `tp ${(cx + rng.range(-30, 30)).toFixed(2)} ${(cz + rng.range(-30, 30)).toFixed(2)}`, 0);
  }
  for (let k = 0; k < CREATURES; k++) h.host.spawnCreature(KINDS[k % KINDS.length]!, cx + rng.range(-60, 60), cz + rng.range(-60, 60), 1 + rng.int(30));
  h.run(3000);
  const server = h.server, tick = server.tick.bind(server), lane = server.lane;
  // Timed as the real server times it.
  lane.setClock(() => performance.now());
  const lanes: number[] = [], ticks: number[] = [];
  server.tick = () => {
    const t = performance.now();
    tick();
    ticks.push(performance.now() - t);
    lanes.push(lane.physicsMs);
  };
  // Puts a pistol in survivor `k`'s hand, to throw.
  const pistol = h.reg.index.get("core:pistol")!, items = h.host.items;
  const arm = (k: number): void => {
    const rec = h.host.records.byPid.get(h.client(sessions[k]!)!.pid)!, inv = items.inv(rec);
    if (inv.item[inv.hotbar] !== 0) return;
    if (items.mint(rec, pistol, 1) !== 1) return;
    items.move(rec, inv.item.lastIndexOf(pistol), rec, inv.hotbar, 1);
    rec.held = 0;
  };
  const before = sessions[0]!.stats.corrections, met = server.players.blocking.stats.met, walkers = server.players.blocking.stats.walkers;
  let frame = 0;
  h.run(SECONDS * 1000, () => {
    frame++;
    // Each survivor walks this way and that, swings now and then, and now and then throws what is in its hand.
    for (let k = 0; k < SURVIVORS; k++) {
      const p = h.pilots[k]!;
      if ((frame + k * 7) % 90 === 0) [p.yaw, p.moveZ] = [rng.range(0, Math.PI * 2), rng.int(3) === 0 ? 0 : 127];
      p.buttons = (frame + k * 11) % 45 < 3 ? BTN_PRIMARY : 0;
      if ((frame + k * 13) % 240 === 0) {
        arm(k);
        sessions[k]!.command(CMD_THROW, () => {});
      }
    }
  });
  server.tick = tick;
  record("lane: physics a tick, median", at(lanes, 0.5), "ms", LANE_RESERVE_MS);
  record("lane: physics a tick, 99th percentile", at(lanes, 0.99), "ms", LANE_RESERVE_MS);
  record("lane: physics in the worst tick", Math.max(...lanes), "ms", LANE_RESERVE_MS * 2);
  record("whole tick, median", at(ticks, 0.5), "ms", 8);
  record("whole tick, 99th percentile", at(ticks, 0.99), "ms", 16);
  record("lane: ticks in which the work that can wait gave way", lane.yielded, "");
  record("bodies met a walker a tick", (server.players.blocking.stats.met - met) / ticks.length, "");
  record("walkers that met a body a tick", (server.players.blocking.stats.walkers - walkers) / ticks.length, "");
  record("things thrown", h.host.loose.stats.thrown, "");
  record("things thrown laid to rest", h.host.loose.stats.rested, "");
  record("things thrown that struck a body", h.host.loose.stats.struck, "");
  record("the delayed survivor's corrections a minute", ((sessions[0]!.stats.corrections - before) * 60) / SECONDS, "");

  // Past the cap: 400 throws in one tick, the last 144 or more over it. Each over it is let fall at the thrower's feet at
  // the cost of a drop, so the burst costs what its bags do and no physics.
  const loose = h.host.loose, dropped = loose.stats.dropped, client = h.client(sessions[1]!)!;
  const t0 = performance.now();
  for (let k = 0; k < 400; k++) {
    arm(1);
    loose.command(client);
  }
  // A throw is a command, at most four a session a tick: 400 in a tick is a hundred survivors throwing at once. Its cost is
  // the bag's record and body, outside the lane, the same thrown or let fall.
  record("a throw, its bag made: time", (performance.now() - t0) / 400, "ms");
  record("400 throws in one tick: let fall for want of room in the lane", loose.stats.dropped - dropped, "");
  const lanesBefore = lanes.length;
  server.tick = () => { tick(); lanes.push(lane.physicsMs); };
  h.run(1000);
  server.tick = tick;
  record("the second after: physics in the worst tick, the cap's things in flight", Math.max(...lanes.slice(lanesBefore)), "ms", LANE_RESERVE_MS * 2);
  h.host.shutdown();
}

if (import.meta.main) {
  benchBrawlPhysics(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
