// Paired native Host ticks, with only controlled-body blocking toggled. AI, terrain and snapshots are identical.
// bun tools/bench/body-blocking.ts [counts=0,100,300,600] [seconds=8] [rounds=2]
// Uses no artist rigs/clips. CPU is this thread's user+system ms per simulation tick, never browser frame time.
// Both variants must finish with bit-identical actor positions. Following AI must never call body blocking.
import { loadavg } from "node:os";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { groundBlockingActive } from "../../shared/sim/body-contact.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";

const quantile = (values: number[], p: number): number => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;
function trial(count: number, moving: boolean, enabled: boolean, seconds: number) {
  const h = new Harness({}, 1, 30, { dev: true, wild: false, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  try {
    const session = h.join("owner"); h.run(800);
    const c = h.client(session)!, a = h.world.ents, owner = h.host.records.byPid.get(c.pid)!, tames: number[] = [];
    a.setPosition(c.ent, 160, 0, 120); h.world.history.discontinuity(c.ent);
    const kinds = ["raptor", "parasaur", "dodo", "grazer"], side = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const e = h.host.spawnCreature(`core:${kinds[i % kinds.length]}`, 160 + (i % side - side / 2) * 2.4, 160 + (Math.floor(i / side) - side / 2) * 2.4, 1);
      if (e < 0) throw new Error("incomplete follower fixture");
      const record = h.host.records.byPid.get(a.pid[e]!)!; record.team = owner.team;
      h.host.refreshBody(record); h.host.creatures.claimed(e); h.host.creatures.mind.follow(e, c.ent); tames.push(e);
    }
    const contacts = h.server.bodyContacts, prepare = contacts.prepare.bind(contacts);
    let queries = 0, rows = 0, largest = 0;
    contacts.prepare = (...args: Parameters<typeof prepare>) => {
      if (args[0] !== c.ent) throw new Error("AI body query returned");
      if (groundBlockingActive(args[1], args[5], args[6], args[7])) {
        queries++; const n = args[3]?.count ?? 0; rows += n; largest = Math.max(largest, n);
      }
      return enabled ? prepare(...args) : undefined;
    };
    const steer = (): void => {
      if (!moving) return;
      const dx = a.x[c.ent]! - 160, dz = a.z[c.ent]! - 160;
      h.pilots[0]!.moveZ = 1; h.pilots[0]!.yaw = Math.atan2(dx, dz) + Math.PI / 2 + (Math.hypot(dx, dz) > 25 ? .3 : -.3);
    };
    h.run(3000, steer); queries = rows = largest = 0;
    const cpu: number[] = [], tick = h.server.tick.bind(h.server);
    h.server.tick = () => {
      const before = process.threadCpuUsage(); tick(); const after = process.threadCpuUsage(before);
      cpu.push((after.user + after.system) / 1000);
    };
    h.run(seconds * 1000, steer);
    const positions = new Float32Array((tames.length + 1) * 3);
    for (const [i, e] of [c.ent, ...tames].entries()) { positions[i * 3] = a.x[e]!; positions[i * 3 + 1] = a.y[e]!; positions[i * 3 + 2] = a.z[e]!; }
    return { positions, report: { count, moving, enabled, ticks: cpu.length, cpuMsMedian: quantile(cpu, .5), cpuMsP99: quantile(cpu, .99),
      cpuMsMean: cpu.reduce((sum, n) => sum + n, 0) / cpu.length, activeQueriesPerTick: queries / cpu.length,
      viewRowsPerTick: rows / cpu.length, maxViewRows: largest, load: loadavg() } };
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const counts = (process.argv[2] ?? "0,100,300,600").split(",").map(Number), seconds = Number(process.argv[3] ?? 8), rounds = Number(process.argv[4] ?? 2);
  if (counts.some(n => !Number.isInteger(n) || n < 0 || n > 1000) || !Number.isFinite(seconds) || seconds < 1 || seconds > 30 || !Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new Error("invalid benchmark size/duration");
  for (let round = 0; round < rounds; round++) for (const count of counts) for (const moving of [false, true]) {
    const first = trial(count, moving, round % 2 === 1, seconds), second = trial(count, moving, round % 2 !== 1, seconds);
    if (first.positions.length !== second.positions.length || first.positions.some((n, i) => !Object.is(n, second.positions[i]))) throw new Error("blocking changed follower/owner movement");
    console.log(JSON.stringify({ round, ...first.report })); console.log(JSON.stringify({ round, ...second.report }));
  }
}
