// A body on foot pressed against vehicles costs the page no correction while they stand (shared/sim/foot-contact.ts),
// and what it cannot know in time, a vehicle driving off or a creature's knock, is eased in and never shown back and forth.
import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { Found } from "../../shared/world/structures.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { carMeetsCapsule } from "../../shared/world/vehicle.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const LINKS: [string, LinkOptions][] = [["loopback", {}], ["tcp loss=0.01 latency=100", { tcp: true, loss: 0.01, latencyMs: 100 }]];

function yard(link: LinkOptions, drivers = 0) {
  const h = new Harness({}, 1, 60, { dev: true, wild: false, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) });
  const s = h.join("walker", link);
  for (let i = 0; i < drivers; i++) h.join(`driver-${i}`, link);
  h.run(1500);
  const a = h.world.ents, walker = h.client(s)!;
  const put = (e: number, x: number, z: number, y = 0) => { a.vx[e] = a.vy[e] = a.vz[e] = 0; a.setPosition(e, x, y, z); h.world.history.discontinuity(e); };
  const car = (x: number, z: number) => h.host.spawnVehicle("core:compact", x, z, 0, 0);
  return { h, s, a, walker, put, car };
}

interface Watched { corrections: number; line: number; largest: number; step: number; hidden: number; reversals: number }
/**
 * Corrections, those of them at a tick the server stepped the body on a guessed input (the line's, not the world's), and
 * the largest; the largest step the drawn body took in a frame, the most hidden at once, and how often it went back.
 */
function watch(h: Harness, s: ClientSession, ms: number, each?: (age: number) => void): Watched {
  const start = h.now, corrections = s.stats.corrections, out: Watched = { corrections: 0, line: 0, largest: 0, step: 0, hidden: 0, reversals: 0 };
  const client = h.client(s)!, tick = h.server.tick, guessed = new Set<number>();
  h.server.tick = () => { if (!client.inputs.has(h.world.tick + 1)) guessed.add(h.world.tick + 1); tick.call(h.server); };
  s.prediction.enabled = true;
  s.prediction.differences.length = 0;
  let x = NaN, z = 0, dx = 0, dz = 0;
  try {
    h.run(ms, now => {
      each?.(now - start);
      const a = s.alpha, b = s.own, p = s.ownPrev;
      const nx = p.x + (b.x - p.x) * a + s.smoothX, nz = p.z + (b.z - p.z) * a + s.smoothZ;
      out.hidden = Math.max(out.hidden, Math.hypot(s.smoothX, s.smoothY, s.smoothZ));
      if (!Number.isNaN(x)) {
        const ex = nx - x, ez = nz - z, step = Math.hypot(ex, ez);
        out.step = Math.max(out.step, step);
        if (step > .002) {
          if (ex * dx + ez * dz < -.5 * step * Math.hypot(dx, dz)) out.reversals++;
          dx = ex; dz = ez;
        }
      }
      x = nx; z = nz;
    });
  } finally { h.server.tick = tick; }
  expect(s.prediction.dropped).toBe(0);
  for (const d of s.prediction.differences) {
    out.largest = Math.max(out.largest, d.distance);
    if (guessed.has(d.tick)) out.line++;
  }
  out.corrections = s.stats.corrections - corrections;
  return out;
}
const say = (label: string, w: Watched) => console.log(`${label}: ${w.corrections} corrections (${w.line} on guessed inputs), largest ${w.largest.toFixed(3)} m; drawn step ${w.step.toFixed(3)} m, hidden ${w.hidden.toFixed(3)} m, ${w.reversals} back`);

for (const [name, link] of LINKS) {
  test(`${name}: walking into a parked car for five seconds costs no correction and moves neither`, () => {
    const { h, s, a, walker, put, car } = yard(link);
    try {
      put(walker.ent, 100, 100);
      const e = car(100, 104);
      h.run(1500);
      const z = a.z[e]!, contacts = h.host.urban.contacts!.contacts, met = h.server.players.feet.met, kept = h.host.urban.restingKept;
      h.pilots[0]!.moveZ = 1;
      const w = watch(h, s, 5000);
      say(`${name}, into a parked car`, w);
      expect(h.server.players.feet.met - met).toBeGreaterThan(100);
      // The car's heartbeats while it is pressed are answered from the last (server/vehicle-rest.ts), and it still stops the walker.
      expect(h.host.urban.restingKept - kept).toBeGreaterThan(0);
      expect(w.corrections - w.line).toBe(0);
      // The car's own sweep finds the walker clear of its true hull, so it is neither pushed nor pushes.
      expect(h.host.urban.contacts!.contacts).toBe(contacts);
      expect(a.z[e]).toBe(z);
      const p = h.reg.move[a.kind[walker.ent]!]!, v = a.vrow[e]!, def = h.reg.vehicle[a.kind[e]!]!;
      expect(carMeetsCapsule(def.spec as never, { x: a.x[e]!, y: a.y[e]!, z: a.z[e]!, yaw: 0, pitch: 0, roll: 0, qx: a.vehicleQx[v]!, qy: a.vehicleQy[v]!, qz: a.vehicleQz[v]!, qw: a.vehicleQw[v]! },
        a.x[walker.ent]!, a.y[walker.ent]!, a.z[walker.ent]!, p.radius, p.height)).toBeNull();
      expect(a.z[walker.ent]!).toBeGreaterThan(101.5);
    } finally { h.host.shutdown(); }
  });

  test(`${name}: walking into a parked helicopter, and swimming into a floating boat, costs no correction`, () => {
    for (const [kind, sea] of [["core:helicopter", -Infinity], ["core:boat", 2]] as const) {
      const h = new Harness({}, 1, 60, { dev: true, wild: false, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4, { seaLevel: sea })) });
      try {
        const s = h.join("walker", link); h.run(1500);
        const a = h.world.ents, walker = h.client(s)!;
        a.setPosition(walker.ent, 100, 0, 96); h.world.history.discontinuity(walker.ent);
        const e = h.host.spawnVehicle(kind, 100, 103, 0, 0);
        expect(e).toBeGreaterThanOrEqual(0);
        h.run(4000);
        const met = h.server.players.feet.met;
        h.pilots[0]!.moveZ = 1;
        const w = watch(h, s, 5000);
        say(`${name}, into ${sea > 0 ? "a floating" : "a parked"} ${kind}`, w);
        expect(h.server.players.feet.met - met).toBeGreaterThan(30);
        expect(w.corrections - w.line).toBe(0);
      } finally { h.host.shutdown(); }
    }
  });

  test(`${name}: along a row of parked cars, and wedged between two, costs no correction`, () => {
    for (const between of [false, true]) {
      const { h, s, walker, put, car } = yard(link);
      try {
        if (between) { put(walker.ent, 101.2, 98); car(100, 104); car(102.4, 104); }
        else { put(walker.ent, 101.6, 100); for (const z of [104, 110, 116, 122]) car(100, z); }
        h.run(1500);
        const met = h.server.players.feet.met;
        h.pilots[0]!.moveZ = 1; h.pilots[0]!.moveX = between ? 0 : .3;
        const w = watch(h, s, 5000);
        say(`${name}, ${between ? "between two" : "along a row"}`, w);
        expect(h.server.players.feet.met - met).toBeGreaterThan(between ? 100 : 20);
        expect(w.corrections - w.line).toBe(0);
      } finally { h.host.shutdown(); }
    }
  });

  test(`${name}: off a kerb into a parked car's side and back onto it costs no correction`, () => {
    const { h, s, a, walker, put, car } = yard(link);
    try {
      const slab = h.reg.index.get("core:ceiling")!;
      for (const z of [95.5, 98.5, 101.5, 104.5, 107.5, 110.5]) h.world.structs.add(slab, 97.4, .15 - h.reg.halfY[slab]!, z, 0, 0, 10000);
      put(walker.ent, 97.6, 97, .15);
      car(100.2, 104);
      h.run(2000);
      expect(s.world!.structs.query(95, 93, 100, 112, new Found())).toBe(6);
      const met = h.server.players.feet.met;
      let low = Infinity, high = -Infinity;
      h.pilots[0]!.moveZ = .5;
      const w = watch(h, s, 6000, age => {
        h.pilots[0]!.moveX = Math.floor(age / 1000) % 2 ? .7 : -.7;
        low = Math.min(low, a.y[walker.ent]!); high = Math.max(high, a.y[walker.ent]!);
      });
      say(`${name}, off and onto a kerb beside one`, w);
      expect(h.server.players.feet.met - met).toBeGreaterThan(5);
      expect(low).toBeLessThan(.01); expect(high).toBeGreaterThan(.14);
      expect(w.corrections - w.line).toBe(0);
    } finally { h.host.shutdown(); }
  });

  test(`${name}: a car driven off while pressed into eases the walker after it, never back and forth`, () => {
    for (const throttle of [1, .4]) {
      const { h, s, a, walker, put, car } = yard(link, 1);
      try {
        const e = car(100, 104), driver = h.client(h.sessions[1]!)!;
        put(walker.ent, 100, 100); put(driver.ent, 101.6, 104.1);
        expect(h.host.urban.mount(driver, e)).toBe(RESULT_OK);
        h.run(1500);
        h.pilots[0]!.moveZ = 1;
        const standing = watch(h, s, 2000);
        if (throttle === 1) say(`${name}, pressed into a car with a driver at its wheel`, standing);
        expect(standing.corrections - standing.line).toBe(0);
        const z = a.z[e]!;
        const w = watch(h, s, 4000, age => { h.pilots[1]!.moveZ = age < 2500 ? throttle : 0; });
        say(`${name}, the car driven off at throttle ${throttle}`, w);
        expect(a.z[e]! - z).toBeGreaterThan(4);
        expect(w.reversals).toBe(0);
        expect(w.step).toBeLessThan(.2);
      } finally { h.host.shutdown(); }
    }
  });

  test(`${name}: a creature's knock is one correction, eased and never shown back and forth`, () => {
    const { h, s, a, walker, put } = yard(link);
    try {
      put(walker.ent, 100, 100);
      h.pilots[0]!.moveZ = 1; h.run(500);
      let next = h.world.tick + 21, knocks = 0;
      // As the host knocks a body a trike's charge meets (attack.knockback, 7 m/s), across its way.
      const w = watch(h, s, 5000, () => {
        if (h.world.tick < next) return;
        next = h.world.tick + 21; knocks++;
        a.vx[walker.ent] = Math.fround(a.vx[walker.ent]! + 7);
      });
      say(`${name}, a knock of 7 m/s every 0.7 s`, w);
      expect(w.corrections).toBeLessThanOrEqual(knocks + 1);
      expect(w.reversals).toBe(0);
      const p = h.reg.move[a.kind[walker.ent]!]!;
      expect(capsuleFree(h.world, a.x[walker.ent]!, a.y[walker.ent]!, a.z[walker.ent]!, p.radius, p.height)).toBe(true);
    } finally { h.host.shutdown(); }
  });
}
