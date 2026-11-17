import { expect, test } from 'bun:test';
import { VehiclePrediction } from '../../client/core/vehicle-prediction.ts';
import { PredictedTrees } from '../../client/core/vehicle-trees.ts';
import { RemoteSample } from '../../client/core/session.ts';
import { COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { ContactSnapshot } from '../../shared/net/contact.ts';
import { Body } from '../../shared/sim/character.ts';
import { stepVehicleBody } from '../../shared/sim/vehicle-body.ts';
import { writeMap } from '../../shared/world/mapfile.ts';
import { flatMap } from '../fixtures/map.ts';
import { Harness } from '../fixtures/net.ts';

test('a nearby car predicts the same tree resistance on forward play and replay, without shared depletion or effects', () => {
  const first = new Uint32Array(17); for (let i = 7; i < 17; i++) first[i] = 1;
  const map = writeMap(flatMap(4, { nodes: [{ kinds: ['core:tree'], first, kind: new Uint8Array([0]),
    x: new Uint16Array([24 * 1024]), z: new Uint16Array([28 * 1024]), yaw: new Uint16Array([0]) }] }));
  const h = new Harness({}, 2, 60, { dev: true, clips: NO_CLIPS, rigs: [], map });
  try {
    h.host.harvest!.retain(6, 0, 1);
    const car = h.host.spawnVehicle('core:compact', 155.8, 89.7), target = h.host.spawnVehicle('core:compact', 152, 89.7);
    const ents = h.world.ents, snapshot = new ContactSnapshot(), own = new Body(), before = new Body();
    ents.vz[target] = 20; h.host.urban.contacts!.proxies(car, snapshot);
    expect(snapshot.count).toBe(1);
    const overlays: PredictedTrees[] = [];
    const prediction = new VehiclePrediction(h.world, h.reg, () => {
      const overlay = new PredictedTrees(h.world, h.reg, h.world.nodeField!); overlays.push(overlay); return overlay;
    });
    const draw = new RemoteSample(); draw.count = 1; draw.id[0] = target; draw.gen[0] = ents.gen[target]!;
    draw.kind[0] = ents.kind[target]!; draw.x[0] = 152; draw.z[0] = 89.7; draw.vehicleQw[0] = 1;
    prediction.accept(snapshot); prediction.draw(draw, 0, 1, snapshot.tick);
    ents.loadBody(car, own); before.copy(own);
    prediction.step(snapshot.tick + 1, before, own, COMPACT_VEHICLE); prediction.draw(draw, 0, 1, snapshot.tick + 1);
    const z = draw.z[0]!;
    expect(z).toBeGreaterThan(90); expect(overlays[0]!.omits(6 * 65536)).toBe(true);
    expect(h.world.nodeField!.store.chunks[6]!.kind[0]).toBeGreaterThan(0); expect(h.host.harvest!.goneCount).toBe(0);
    expect(overlays[0]!.presentationVersion).toBe(0); // Neighbour overlays never publish presentation.
    const solid = new Body(); solid.copy(snapshot.rows[0]!.body);
    stepVehicleBody(h.world, solid, 0, 0, 0, COMPACT_VEHICLE, undefined, 0, false);
    expect(solid.vz).toBeLessThan(1); expect(z - solid.z).toBeGreaterThan(.25);
    prediction.beginReplay(); own.copy(before);
    prediction.step(snapshot.tick + 1, before, own, COMPACT_VEHICLE); prediction.finishReplay();
    prediction.draw(draw, 0, 1, snapshot.tick + 1); expect(draw.z[0]).toBe(z);
    expect(h.host.harvest!.goneCount).toBe(0); expect(overlays[0]!.presentationVersion).toBe(0);
  } finally { h.host.shutdown(); }
});
