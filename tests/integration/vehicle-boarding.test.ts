// Every vehicle kind in the content, got into, driven and got out of where a player can really be: on the quay by its
// doors, swimming at a hull's stern or beside it, on a dock alongside it, on its deck; by its owner, a tribe mate and a
// stranger let aboard. Through the real use button, server, sim and client session, with the client's own prompt and
// words for a refusal (planning/workstreams/vehicle-boarding.md).

import { expect, test } from "bun:test";
import type { Client } from "../../server/game.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { StructMenu } from "../../client/core/ui/structure.ts";
import { lookAt, vehiclePrompt } from "../../client/core/vehicle-prompt.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CUE_HELD } from "../../shared/anim/pose.ts";
import { RESULT_NOT_YOURS, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_USE, MODE_SWIM, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { isBoatVehicle, isRotorVehicle, type BoatVehicleDefinition, type VehicleDefinition } from "../../shared/sim/vehicle.ts";
import { vehiclePoint, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { boatMeetsCapsule } from "../../shared/world/boat.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { helicopterMeetsCapsule } from "../../shared/world/helicopter.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, HIT_STRUCTURE, rayHit } from "../../shared/world/ray.ts";
import { carMeetsCapsule } from "../../shared/world/vehicle.ts";
import { LAUNCH_BOARDING } from "../../content/vehicles/boat-art.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const KINDS = reg.ids.filter((_, k) => !!reg.vehicle[k]);
/** The quay's top and the sea's surface, a dock's top over it and its edge's gap to a hull, a swimmer's feet under it. */
const QUAY = .6, SEA = 0, DOCK = .8, GAP = .4, SWIM = SEA - 1.35;
const LAND = { x: 96, z: 120 }, BERTH = { x: 330, z: 256 };
/** The use key's reach (client/core/app.ts and server/death.ts both cast it so far). */
const REACH = 3.5;

/** A quay to the west 0.6 m over a sea 8 m deep, the vehicle parked or berthed as a map does, and a dock beside a boat. */
function harbour(id: string): Uint8Array<ArrayBuffer> {
  const def = reg.vehicle[reg.index.get(id)!]!, boat = isBoatVehicle(def);
  const hf = new Heightfield({ chunksX: 8, chunksZ: 8 }, 2, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const x = i * hf.cell;
    hf.setSample(i, j, x < 200 ? QUAY : Math.max(-8, QUAY - (x - 200) * .55));
    hf.tint[j * hf.nx + i] = x < 204 ? 4 : 1;
  }
  const at = boat ? BERTH : LAND, statics: MapStatic[] = [];
  if (boat) {
    // A dock of 3 m pieces along the boat's +X side, its edge a fender's gap from the hull.
    const x = at.x + def.spec.halfWidth + GAP + 1.5;
    for (let z = -def.spec.halfLength - 4; z <= def.spec.halfLength + 4; z += 3) statics.push({ kind: "core:ceiling", x, y: DOCK - .1, z: at.z + z, yaw: 0 });
  }
  const map: MapData = { id: `test:harbour:${id}`, dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: SEA, heights: hf.heights, tint: hf.tint,
    statics, nodes: [], spawns: [{ name: "Quay", x: 40, z: 40, yaw: 0 }], vehicles: [{ kind: id, id: `test/${id}`, x: at.x, z: at.z, yaw: 0 }] };
  return writeMap(map);
}

interface Crew { h: Harness; def: VehicleDefinition; e: number; sessions: ClientSession[]; clients: Client[]; seen: { seq: number; code: number }[][] }

/**
 * The vehicle as the map parked it, its tribe's now, and `n` survivors, one for each of its seats unless fewer are
 * asked for: its owner first, then mates and strangers in turn.
 */
function crew(id: string, n = reg.vehicle[reg.index.get(id)!]!.seats.length): Crew {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: harbour(id) });
  const kind = reg.index.get(id)!, def = h.reg.vehicle[kind]!;
  const sessions = Array.from({ length: n }, (_, i) => h.join(i === 0 ? "owner" : i % 2 ? `mate-${i}` : `stranger-${i}`));
  const seen = sessions.map(() => [] as { seq: number; code: number }[]);
  sessions.forEach((s, i) => { s.onResult = (seq, code) => seen[i]!.push({ seq, code }); });
  h.run(600);
  const clients = sessions.map(s => h.client(s)!), records = h.host.records, rec = (c: Client) => records.byPid.get(c.pid)!;
  expect(h.host.tribes.create(rec(clients[0]!), "Crew")).toBe("");
  for (let i = 1; i < clients.length; i += 2) {
    expect(h.host.tribes.invite(rec(clients[0]!), rec(clients[i]!), true)).toBe("");
    expect(h.host.tribes.accept(rec(clients[i]!))).toBe("");
  }
  const vehicle = [...records.byPid.values()].find(r => r.kind === kind)!, e = records.entOf.get(vehicle.pid)!;
  vehicle.team = rec(clients[0]!).team;
  h.run(isBoatVehicle(def) ? 2000 : 500);
  return { h, def, e, sessions, clients, seen };
}

function frame(h: Harness, e: number): VehicleFrame {
  const ents = h.world.ents, v = ents.vrow[e]!;
  return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, yaw: ents.vehicleYaw[v]!, pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
    qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]!, steering: ents.steering[v]! };
}
function local(h: Harness, e: number, p: readonly number[]): [number, number, number] {
  const out = [0, 0, 0]; vehiclePoint(frame(h, e), p, out); return [out[0]!, out[1]!, out[2]!];
}
function put(h: Harness, c: Client, [x, y, z]: readonly number[]): void {
  const ents = h.world.ents;
  ents.setPosition(c.ent, x!, y!, z!); ents.vx[c.ent] = ents.vy[c.ent] = ents.vz[c.ent] = 0; c.ownDirty = true;
}
function aim(h: Harness, i: number, c: Client, [x, y, z]: readonly number[]): void {
  const ents = h.world.ents, eye = ents.y[c.ent]! + stanceEye(h.reg.move[ents.kind[c.ent]!]!, ents.stance[c.ent]!);
  const pilot = h.pilots[i]!;
  pilot.yaw = Math.atan2(x! - ents.x[c.ent]!, z! - ents.z[c.ent]!); pilot.pitch = Math.atan2(y! - eye, Math.hypot(x! - ents.x[c.ent]!, z! - ents.z[c.ent]!));
}
function press(h: Harness, i: number): void {
  h.pilots[i]!.buttons |= BTN_USE; h.run(100); h.pilots[i]!.buttons &= ~BTN_USE;
}

const sample = new RemoteSample();
/** What the client's prompt says at session `i`'s crosshair, as client/core/app.ts picks what it is on; and the built piece there, if any. */
function prompt(h: Harness, i: number): { line: string; piece: number } {
  const s = h.sessions[i]!, pilot = h.pilots[i]!, world = s.world!;
  s.sampleRemote(sample);
  const cp = Math.cos(pilot.pitch), d = [Math.sin(pilot.yaw) * cp, Math.sin(pilot.pitch), Math.cos(pilot.yaw) * cp];
  const ox = s.own.x, oy = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance), oz = s.own.z;
  const struck = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, REACH);
  const piece = struck === HIT_STRUCTURE ? rayHit.ref : -1;
  let best = struck === HIT_NONE ? REACH : rayHit.t, hit = -1;
  for (let j = 0; j < sample.count; j++) {
    if ((sample.cue[j]! & CUE_HELD) !== 0) continue;
    const t = lookAt(h.reg, sample, j, ox, oy, oz, d, 1);
    if (t < best) { best = t; hit = j; }
  }
  if (hit >= 0 && sample.seatSlot[hit] !== 0) for (let j = 0; j < sample.count; j++) if (sample.id[j] === sample.seat[hit]! - 1 && sample.gen[j] === sample.seatGen[hit]) { hit = j; break; }
  const line = hit >= 0 && h.reg.vehicle[sample.kind[hit]!] ? vehiclePrompt(h.reg, sample, hit, ox, oz) : "";
  return { line, piece };
}
/** What the client shows for a result no command asked for, as client/core/app.ts routes one, the crosshair on `piece`. */
function shown(code: number, piece: number): string {
  const menu = new StructMenu();
  menu.result(0, code, 0, null, piece);
  return menu.notice;
}
/** Every unasked answer session `i` has had since `from`, as the client words it, the crosshair on `piece`. */
function words(c: Crew, i: number, from: number, piece: number): string[] {
  return c.seen[i]!.slice(from).filter(r => r.seq === 0).map(r => shown(r.code, piece));
}

/** Where survivor `i` gets in: by its seat's door, half a metre out from the hull, looking at the door. */
function door(c: Crew, i: number): { at: number[]; look: number[]; name: string } {
  const { h, def, e } = c, seat = def.seats[i]!, side = seat.entry[0] >= 0 ? 1 : -1, move = h.reg.move[h.world.ents.kind[c.clients[i]!.ent]!]!;
  const at = local(h, e, [side * (Math.max(Math.abs(seat.entry[0]), def.spec.halfWidth + move.radius + .08) + .5), 0, seat.entry[2]]);
  at[1] = QUAY;
  return { at, look: local(h, e, [side * def.spec.halfWidth * .5, Math.min(1, def.spec.height * .5), seat.entry[2]]), name: `${seat.id}'s door` };
}

/** A place on the deck by local (x, z): on the top of the nearest hull part no higher than `most`, half a metre inside its edge. */
function deckAt(def: BoatVehicleDefinition, x: number, z: number, most: number): [number, number, number] {
  let best: [number, number, number] = [x, -Infinity, z], gap = Infinity;
  for (const b of def.spec.hullBoxes) {
    const top = b.at[1] + b.half[1];
    if (top > most || b.half[0] < .5 || b.half[2] < .5) continue;
    const px = Math.max(b.at[0] - b.half[0] + .5, Math.min(b.at[0] + b.half[0] - .5, x)), pz = Math.max(b.at[2] - b.half[2] + .5, Math.min(b.at[2] + b.half[2] - .5, z));
    const d = Math.hypot(px - x, pz - z);
    if (d < gap - .01 || (d < gap + .01 && top > best[1])) { gap = d; best = [px, top, pz]; }
  }
  expect(Number.isFinite(best[1])).toBe(true);
  return best;
}
/** The places round a boat a survivor can be, in the order its crew take them. */
const PLACES = ["swimming at the stern", "on the dock amidships", "on the dock at the stern", "on the deck", "swimming alongside"] as const;
function berth(c: Crew, place: (typeof PLACES)[number]): { at: number[]; look: number[] } {
  const { h, e } = c, def = c.def as BoatVehicleDefinition, s = def.spec, r = .3, keel = h.world.ents.y[e]!, water = s.draft;
  const y = (local: number): number => keel + local;
  if (place === "swimming at the stern") return { at: [...local(h, e, [s.halfWidth * .4, 0, -s.halfLength - .8])].map((v, k) => k === 1 ? SWIM : v), look: local(h, e, [s.halfWidth * .4, water + .25, -s.halfLength + .5]) };
  if (place === "swimming alongside") return { at: [...local(h, e, [-(s.halfWidth + .4 + r), 0, 0])].map((v, k) => k === 1 ? SWIM : v), look: local(h, e, [-s.halfWidth + .3, water + .25, 0]) };
  if (place === "on the deck") {
    const route = def.boarding ?? LAUNCH_BOARDING, [x, top, z] = deckAt(def, route.deck[0], route.deck[2], route.deck[1] + .3);
    return { at: local(h, e, [x, top + .02, z]), look: local(h, e, [x, top - .05, z + 1.2]) };
  }
  const z = place === "on the dock amidships" ? 0 : -s.halfLength + .6;
  const at = local(h, e, [s.halfWidth + GAP + r + .15, 0, z]); at[1] = DOCK;
  return { at, look: local(h, e, [s.halfWidth - .3, Math.min(s.height, Math.max(water + .3, DOCK - y(0))), z]) };
}

/**
 * Survivor `i` at `at`, looking at `look`, is offered its seat and takes it with the use key. Where `steep` is allowed and
 * the hull's side is too high to climb from there, the prompt and the server both say so, and nothing else happens.
 */
function board(c: Crew, i: number, at: readonly number[], look: readonly number[], where: string, steep = false): boolean {
  const { h } = c, client = c.clients[i]!;
  put(h, client, at); h.run(400);
  aim(h, i, client, look); h.run(200);
  const { line } = prompt(h, i);
  if (steep && line === "Too high to climb aboard here") {
    const from = c.seen[i]!.length;
    press(h, i); h.run(1500);
    expect(h.host.urban.occupancy.seatOf(client.pid)).toBeNull();
    expect(words(c, i, from, -1)).toEqual([line]);
    return false;
  }
  expect(`${where}: ${line}`).toMatch(/: E {2}/);
  press(h, i);
  for (let t = 0; t < 30 && !h.host.urban.occupancy.seatOf(client.pid); t++) h.run(100);
  h.run(300);
  expect(`${where}: ${h.host.urban.occupancy.seatOf(client.pid)?.seat ?? "not aboard"}`).toBe(`${where}: ${c.def.seats[i]!.id}`);
  return true;
}

/**
 * Everyone aboard presses the use key at once, half of them with a PIN-locked box of the tribe under the crosshair. A
 * crowd at one door gets out in turns: whoever is out walks off, and whoever could not yet get out presses again.
 */
function leave(c: Crew, box: number): void {
  const { h, def, e } = c, ents = h.world.ents, move = h.reg.move[ents.kind[c.clients[0]!.ent]!]!, from = c.seen.map(s => s.length);
  const bx = h.world.structs.chunks[Math.floor(box / 65536)]!, slot = box & 0xffff;
  const boxAt = [bx.x[slot]!, bx.y[slot]!, bx.z[slot]!];
  c.clients.forEach((client, i) => aim(h, i, client, i % 2 ? [ents.x[e]!, ents.y[e]! + 1, ents.z[e]!] : boxAt));
  h.run(100);
  const pieces = c.clients.map((_, i) => prompt(h, i).piece);
  const out: ({ x: number; y: number; z: number; vehicle: VehicleFrame } | null)[] = c.clients.map(() => null);
  for (let wave = 0; wave < 3 && out.some(o => !o); wave++) {
    const aboard = out.map(o => !o);
    c.clients.forEach((_, i) => { if (aboard[i]) h.pilots[i]!.buttons |= BTN_USE; });
    const until = h.now + 100;
    h.run(3500, now => {
      if (now >= until) for (const pilot of h.pilots) pilot.buttons &= ~BTN_USE;
      c.clients.forEach((client, i) => {
        if (!out[i] && ents.seat[client.ent] === 0) out[i] = { x: ents.x[client.ent]!, y: ents.y[client.ent]!, z: ents.z[client.ent]!, vehicle: frame(h, e) };
      });
    });
    h.run(1000);
    c.clients.forEach((client, i) => {
      const got = out[i], who = `${c.def.id} ${def.seats[i]!.id}`;
      if (!aboard[i] || !got) return;
      expect(h.host.urban.occupancy.seatOf(client.pid)).toBeNull();
      // Beside the vehicle where it was as the seat let go, clear of it and of the world, and standing or swimming after.
      expect(Math.hypot(got.x - got.vehicle.x, got.z - got.vehicle.z)).toBeLessThan(Math.hypot(def.spec.halfWidth, def.spec.halfLength) + 3);
      const meets = isBoatVehicle(def) ? boatMeetsCapsule(def, got.vehicle, got.x, got.y, got.z, move.radius, move.height)
        : isRotorVehicle(def) ? helicopterMeetsCapsule(def, got.vehicle, got.x, got.y, got.z, move.radius, move.height)
        : carMeetsCapsule(def.spec, got.vehicle, got.x, got.y, got.z, move.radius, move.height);
      expect(`${who}: ${meets ? "inside the hull" : "clear"}`).toBe(`${who}: clear`);
      expect(capsuleFree(h.world, got.x, got.y, got.z, move.radius, move.height)).toBe(true);
      expect(`${who}: ${ents.mode[client.ent] === MODE_SWIM || (ents.flags[client.ent]! & F_GROUNDED) !== 0 ? "standing or swimming" : "falling"}`).toBe(`${who}: standing or swimming`);
      // Off out of the way.
      const dx = ents.x[client.ent]! - ents.x[e]!, dz = ents.z[client.ent]! - ents.z[e]!, d = Math.hypot(dx, dz) || 1;
      put(h, client, [ents.x[client.ent]! + dx / d * 12, ents.y[client.ent]!, ents.z[client.ent]! + dz / d * 12]);
    });
    h.run(300);
  }
  c.clients.forEach((client, i) => {
    const who = `${c.def.id} ${def.seats[i]!.id}`;
    expect(words(c, i, from[i]!, pieces[i]!).filter(w => /PIN/.test(w))).toEqual([]);
    expect(`${who}: ${out[i] ? "left" : `still in, told ${[...words(c, i, from[i]!, pieces[i]!), ...c.sessions[i]!.log.slice(-2).map(l => l.text)].join("; ")}`}`).toBe(`${who}: left`);
  });
}

/** A storage box of the tribe beside the vehicle, at `local` in its frame, on a dock piece over water; with a PIN or none. */
function boxBeside(c: Crew, at: readonly number[], pin: boolean): number {
  const { h, e } = c, ents = h.world.ents, p = local(h, e, at), water = h.world.hf.waterAt(p[0], p[2]);
  const team = h.host.records.byPid.get(c.clients[0]!.pid)!.team, kind = h.reg.index.get("core:storage_box")!;
  let y = QUAY;
  if (Number.isFinite(water) && water > h.world.hf.heightAt(p[0], p[2])) {
    y = water + .3;
    h.world.structs.add(h.reg.index.get("core:ceiling")!, p[0], y - .1, p[2], 0, team, 10000);
  }
  const box = h.world.structs.add(kind, p[0], y + h.reg.halfY[kind]!, p[2], ents.yaw[e]!, team, 500);
  if (pin) { const state = h.host.fixtures.ensure(box); state.lock = 1; state.pin = 2468; }
  return box;
}

/** What the test showed was wrong before this change, which the next makes right. */
const FAILING = new Set(["belvedere", "boat", "boat_police", "boat_rescue", "bus", "helicopter", "helicopter_police", "helicopter_rescue", "jon_boat",
  "lagoon", "manta", "meridian", "needle", "riptide", "solstice", "sovereign", "tanker", "thunderbolt"].map(n => `core:${n}`));
const FAILING_BOATS = test.failing;
for (const id of KINDS) {
  (FAILING.has(id) ? test.failing : test)(`${id}: boarded from where a survivor can be, driven, and every seat left by its owner, a mate and a stranger`, () => {
    const c = crew(id), { h, def, e } = c, ents = h.world.ents, pilot = h.pilots[0]!;
    try {
      // In, one by one, each by its own way in.
      for (let i = 0; i < def.seats.length; i++) {
        if (!isBoatVehicle(def)) { const d = door(c, i); board(c, i, d.at, d.look, `${id} ${d.name}`); continue; }
        // A swimmer beside a high side swims round to the stern.
        const place = PLACES[i % PLACES.length]!, p = berth(c, place), stern = berth(c, PLACES[0]);
        if (!board(c, i, p.at, p.look, `${id} ${def.seats[i]!.id} ${place}`, place === "swimming alongside")) board(c, i, stern.at, stern.look, `${id} ${def.seats[i]!.id} then at the stern`);
      }
      // Driven or flown.
      const start = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
      if (isRotorVehicle(def)) {
        pilot.buttons = BTN_JUMP; h.run(5000);
        expect(ents.y[e]! - start[1]!).toBeGreaterThan(1);
        expect(ents.flags[e]! & F_GROUNDED).toBe(0);
        // A passenger who asks to get out in the air is told why, in a vehicle's words.
        const from = c.seen[1]!.length;
        press(h, 1); h.run(1500);
        expect(h.host.urban.occupancy.seatOf(c.clients[1]!.pid)?.seat).toBe(def.seats[1]!.id);
        const told = words(c, 1, from, -1);
        expect(told.length).toBeGreaterThan(0);
        for (const line of told) expect(line).not.toMatch(/PIN/);
        pilot.buttons = BTN_CROUCH;
        for (let t = 0; t < 40 && (ents.flags[e]! & F_GROUNDED) === 0; t++) h.run(500);
        h.run(1500); pilot.buttons = 0; h.run(500);
        expect(ents.flags[e]! & F_GROUNDED).not.toBe(0);
      } else {
        pilot.moveZ = 1; h.run(isBoatVehicle(def) ? 3500 : 1500); pilot.moveZ = 0;
        expect(Math.hypot(ents.x[e]! - start[0]!, ents.z[e]! - start[2]!)).toBeGreaterThan(isBoatVehicle(def) ? .2 : 2);
        // A car is stopped on its brake; a boat is left while it still makes way.
        if (!isBoatVehicle(def)) { pilot.buttons = BTN_JUMP; h.run(2500); pilot.buttons = 0; }
      }
      // Out, all at once, with and without a PIN set on the box beside them.
      const box = boxBeside(c, [def.spec.halfWidth + 2.6, 0, def.spec.halfLength + 1], KINDS.indexOf(id) % 2 === 0);
      leave(c, box);
    } finally { h.host.shutdown(); }
  });
}

const BOATS = KINDS.filter(id => isBoatVehicle(reg.vehicle[reg.index.get(id)!]!));
FAILING_BOATS("every boat is left while it still makes way, into the water beside it, and nobody is told of a PIN", () => {
  for (const id of BOATS) {
    const c = crew(id, 1), { h, e } = c, ents = h.world.ents, client = c.clients[0]!, pilot = h.pilots[0]!;
    try {
      const p = berth(c, "swimming at the stern");
      put(h, client, p.at); ents.mode[client.ent] = MODE_SWIM; h.run(300);
      expect(h.host.urban.mount(client, e)).toBe(RESULT_OK); h.run(1500);
      expect(client.drive).toBe(e);
      pilot.moveZ = 1; h.run(3000); pilot.moveZ = 0;
      const speed = Math.hypot(ents.vx[e]!, ents.vz[e]!), from = c.seen[0]!.length;
      expect(speed).toBeGreaterThan(.55);
      press(h, 0); h.run(2500);
      expect(`${id}: ${words(c, 0, from, -1).join("; ")}`).toBe(`${id}: `);
      expect(`${id}: ${ents.seat[client.ent] === 0 ? "out" : "still aboard"}`).toBe(`${id}: out`);
      expect(ents.mode[client.ent]).toBe(MODE_SWIM);
    } finally { h.host.shutdown(); }
  }
});

test("on PvE a stranger is told the vehicle is not its tribe's, and nobody is told of a PIN", () => {
  for (const id of ["core:compact", "core:helicopter", "core:boat"]) {
    const c = crew(id), { h, def } = c;
    try {
      h.host.setSetting("serverPVE", "True");
      const i = 2 % def.seats.length === 0 ? 0 : 2;
      if (i === 0) continue;
      const from = c.seen[i]!.length;
      if (isBoatVehicle(def)) { const p = berth(c, "swimming at the stern"); put(h, c.clients[i]!, p.at); h.run(400); aim(h, i, c.clients[i]!, p.look); }
      else { const d = door(c, i); put(h, c.clients[i]!, d.at); h.run(400); aim(h, i, c.clients[i]!, d.look); }
      h.run(200); press(h, i); h.run(1500);
      expect(h.host.urban.occupancy.seatOf(c.clients[i]!.pid)).toBeNull();
      expect(c.seen[i]!.slice(from).filter(r => r.seq === 0).map(r => r.code)).toEqual([RESULT_NOT_YOURS]);
      expect(words(c, i, from, -1)).toEqual(["That is not your tribe's"]);
    } finally { h.host.shutdown(); }
  }
});
