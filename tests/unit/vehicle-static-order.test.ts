import { expect, test } from 'bun:test';
import { COMPACT, COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { Body } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { createVehicle } from '../../shared/sim/vehicle.ts';
import { NodeField, nodeForms } from '../../shared/world/nodes.ts';
import { Found } from '../../shared/world/structures.ts';
import { StaticVehicleWorld } from '../../shared/world/vehicle.ts';
import { flatWorld } from '../fixtures/world.ts';

function car(kind: number): Body {
  const b = new Body(); b.kind = kind; b.vehicle = true; b.x = 40; b.z = 47; b.fuel = 40; b.vz = 20;
  return b;
}

test('identical static rows inserted in reverse grid order produce identical contacts and native crash replay', () => {
  const a = flatWorld(), b = flatWorld(), wall = a.kind('core:wall');
  for (const i of [0, 1, 2]) a.structs.put(0, i, wall, 39.4 + i * .6, 1.5, 50, 0, 0, 10000, 1);
  for (const i of [2, 1, 0]) b.structs.put(0, i, wall, 39.4 + i * .6, 1.5, 50, 0, 0, 10000, 1);
  const qa = new Found(), qb = new Found();
  const na = a.structs.query(35, 45, 45, 55, qa), nb = b.structs.query(35, 45, 45, 55, qb);
  expect(Array.from(qa.refs.subarray(0, na))).not.toEqual(Array.from(qb.refs.subarray(0, nb)));
  const from = createVehicle(COMPACT, 40, 0, 47), to = { ...from, z: 49 };
  const ca = new StaticVehicleWorld(a).contact(from, to, COMPACT), cb = new StaticVehicleWorld(b).contact(from, to, COMPACT);
  expect(ca).not.toBeNull(); expect(cb).toEqual(ca);
  const ownA = car(a.kind('core:compact')), ownB = car(b.kind('core:compact'));
  for (let tick = 0; tick < 60; tick++) {
    stepVehicleBody(a, ownA, 0, 127, 0, COMPACT_VEHICLE);
    stepVehicleBody(b, ownB, 0, 127, 0, COMPACT_VEHICLE);
    expect(ownA.equals(ownB)).toBe(true);
  }
});

test('node contact keys and results survive cold reload and a regrown slot relink', () => {
  const world = flatWorld(), kind = world.kind('core:tree'), form = nodeForms(world.reg).first[kind]!;
  const nodes = new NodeField(world.dims, world.reg, { perChunk: 2, at(chunk, index, out) {
    Object.assign(out, { kind: chunk === 0 ? kind : 0, form, x: 39.6 + index * .8, y: 0, z: 50, yaw: 0 });
  } });
  const collision = { ...world, nodes: nodes.store };
  const absent = () => false;
  nodes.retain(0, 0, 1, absent);
  const adapter = new StaticVehicleWorld(collision), from = createVehicle(COMPACT, 40, 0, 47), to = { ...from, z: 49 };
  const first = { ...adapter.contact(from, to, COMPACT)! };
  expect(first.reason).toBe('node:0');
  nodes.set(0, 0, false); nodes.set(0, 0, true);
  expect(adapter.contact(from, to, COMPACT)).toEqual(first);
  nodes.retain(0, 0, -1, absent); expect(nodes.isLoaded(0)).toBe(false);
  nodes.retain(0, 0, 1, absent);
  expect(adapter.contact(from, to, COMPACT)).toEqual(first);
});
