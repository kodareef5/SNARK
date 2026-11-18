import { expect, test } from 'bun:test';
import { Assets } from '../../client/core/assets/assets.ts';
import { Characters } from '../../client/core/render/characters.ts';
import { BONE_FLOATS, FramePacket } from '../../client/core/render/packet.ts';
import { AnimState, bodySeed } from '../../shared/anim/pose.ts';
import { SEAT_FLOATS } from '../../shared/anim/seat.ts';
import { quatRotate } from '../../shared/math/quat.ts';
import { RESULT_OK } from '../../shared/net/protocol.ts';
import { Body, BTN_JUMP, BTN_SPRINT, stepBody } from '../../shared/sim/character.ts';
import { capsuleFree, groundUnder } from '../../shared/world/collide.ts';
import { GroundMountFrame, groundMountFrame } from '../../shared/world/ground-mount.ts';
import { writeMap } from '../../shared/world/mapfile.ts';
import { castWorld, HIT_NONE, rayHit } from '../../shared/world/ray.ts';
import { flatMap } from '../fixtures/map.ts';
import { Harness } from '../fixtures/net.ts';
import { frozenPack } from '../fixtures/pack.ts';
import { flatWorld } from '../fixtures/world.ts';

test('walking and sprinting over real flat kerbs never fits their vertical step into a tilt, and a ledge stays level', () => {
  for (const species of ['raptor', 'parasaur']) for (const height of [.1, .2, .3, .4]) for (const buttons of [0, BTN_SPRINT]) {
    const w = flatWorld(4), kind = w.kind(`core:${species}`), p = w.reg.tamedMove[kind]!, frame = new GroundMountFrame();
    const slab = w.kind('core:ceiling');
    for (const z of [125, 128, 131]) w.structs.add(slab, 128, height - w.reg.halfY[slab]!, z, 0, 0, 1);
    const b = new Body(); b.x = 128; b.z = 120; b.grounded = true; b.staminaMax = 10000; b.stamina = 10000000;
    for (let tick = 0; tick < 210 && b.z < 135; tick++) {
      stepBody(w, b, 0, 127, 0, 0, buttons, p, 1 / 30);
      expect(b.grounded).toBe(true); expect(capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)).toBe(true);
      groundMountFrame(w, p, b.x, b.y, b.z, 0, frame);
      expect([...frame.rotation]).toEqual([0, 0, 0, 1]);
    }
    expect(b.z).toBeGreaterThan(135);
    const foundation = w.kind('core:foundation'); w.structs.add(foundation, 140, .5, 128, 0, 0, 1);
    const top = .5 + w.reg.halfY[foundation]!;
    groundMountFrame(w, p, 140, top, 129.25, 0, frame);
    expect(frame.supported).toBe(true); expect([...frame.rotation]).toEqual([0, 0, 0, 1]);
  }
});

test('the emitted head eases through a real uphill and cross-slope jump and landing instead of switching the whole tilt', () => {
  const pack = frozenPack();
  for (const species of ['raptor', 'parasaur']) for (const yaw of [0, Math.PI / 2]) {
    const w = flatWorld(4), grade = Math.tan(35 * Math.PI / 180);
    for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) w.hf.setSample(i, j, 40 + (j * w.hf.cell - 128) * grade);
    const kind = w.kind(`core:${species}`), p = w.reg.tamedMove[kind]!;
    const chars = new Characters(w.reg, pack, new Assets(w.reg, pack), w), rig = chars.creature(kind)!.rig;
    const head = rig.names.indexOf('Head'); expect(head).toBeGreaterThanOrEqual(0);
    const b = new Body(); b.x = b.z = 128; b.y = groundUnder(w.hf, b.x, b.z, p.radius); b.grounded = true;
    b.yaw = Math.round(yaw * 65536 / (2 * Math.PI)) & 65535;
    const packet = new FramePacket(), st = new AnimState();
    let previous: number[] | null = null, largest = 0, airborne = 0, landed = false;
    for (let tick = 0; tick < 100; tick++) {
      const beforeY = b.y;
      stepBody(w, b, 0, 0, b.yaw, 0, tick === 40 ? BTN_JUMP : 0, p, 1 / 30);
      if (!b.grounded) airborne++; else if (airborne) landed = true;
      for (const half of [.5, 1]) {
        const y = beforeY + (b.y - beforeY) * half;
        st.grounded = b.grounded; st.setMotion(b.vx, b.vz, yaw, 0, b.vy); st.seed = 2;
        packet.beginFrame(); chars.begin(packet);
        expect(chars.add(packet, kind, b.x, y, b.z, yaw, st, tick + half, null, 0, new Uint8Array(6), 0, null, 0, 3, false, false)).toBe(true);
        const at = head * BONE_FLOATS, local = rig.rest.subarray(head * 3, head * 3 + 3);
        const point = [0, 1, 2].map(axis => packet.bones[at + axis * 4]! * local[0]! + packet.bones[at + axis * 4 + 1]! * local[1]! + packet.bones[at + axis * 4 + 2]! * local[2]! + packet.bones[at + axis * 4 + 3]! - (axis === 0 ? b.x : axis === 1 ? y : b.z));
        if (previous && tick > 30) largest = Math.max(largest, Math.hypot(...point.map((v, axis) => v - previous![axis]!)));
        previous = point;
      }
    }
    expect(airborne).toBeGreaterThan(8); expect(landed).toBe(true);
    expect(largest).toBeLessThan(.08);
  }
});

test('a real ramp lip blends its finite face into the support frame at walk and sprint without a head-height snap', () => {
  const pack = frozenPack();
  for (const species of ['raptor', 'parasaur']) for (const buttons of [0, BTN_SPRINT]) {
    const w = flatWorld(4), kind = w.kind(`core:${species}`), p = w.reg.tamedMove[kind]!;
    const chars = new Characters(w.reg, pack, new Assets(w.reg, pack), w), rig = chars.creature(kind)!.rig;
    const head = rig.names.indexOf('Head'), point = rig.rest.subarray(head * 3, head * 3 + 3);
    const ramp = w.kind('core:zslope_ramp'); w.structs.add(ramp, 128, w.reg.halfY[ramp]!, 128, 0, 0, 1);
    const b = new Body(); b.x = 128; b.z = 120; b.grounded = true; b.staminaMax = 10000; b.stamina = 10000000;
    const frame = new GroundMountFrame(), at = new Float64Array(3), previous = new Float64Array(3);
    let greatest = 0, samples = 0, greatestTilt = 0;
    for (let tick = 0; tick < 180 && b.z < 130; tick++) {
      stepBody(w, b, 0, 127, 0, 0, buttons, p, 1 / 30); expect(b.grounded).toBe(true);
      groundMountFrame(w, p, b.x, b.y, b.z, 0, frame);
      quatRotate(frame.rotation, 0, point[0]!, point[1]!, point[2]!, at, 0); at[1]! += frame.lift;
      if (samples++) greatest = Math.max(greatest, Math.hypot(at[0]! - previous[0]!, at[1]! - previous[1]!, at[2]! - previous[2]!));
      previous.set(at); greatestTilt = Math.max(greatestTilt, Math.abs(frame.nz));
    }
    expect(b.z).toBeGreaterThan(130); expect(greatestTilt).toBeGreaterThan(.1);
    expect(greatest).toBeLessThan(.16);
  }
});

test('a real rider and mount stay behind a downhill flank wall, including target hit geometry and a ride along it', () => {
  const pack = frozenPack();
  for (const species of ['raptor', 'parasaur']) for (const degrees of [35, 50]) {
    const map = flatMap(4, { minY: -128 }), grade = Math.tan(degrees * Math.PI / 180);
    for (let j = 0; j < 129; j++) for (let i = 0; i < 129; i++) map.heights[j * 129 + i] = Math.round(Math.max(0, Math.min(65535, (128 + (j * 2 - 128) * grade) * 256)));
    const h = new Harness({}, 5, 60, { dev: true, clips: pack.clips, rigs: pack.header.rigs, map: writeMap(map) });
    try {
      const session = h.join('rider'); h.run(400);
      const c = h.client(session)!, ents = h.world.ents, owner = h.host.records.byPid.get(c.pid)!;
      const e = h.host.spawnCreature(`core:${species}`, 128, 128, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!, p = h.reg.tamedMove[ents.kind[e]!]!;
      rec.team = owner.team; rec.saddle = h.reg.index.get(`core:saddle_${species}`)!; ents.setTeam(e, rec.team);
      h.host.refreshBody(rec); h.host.creatures.claimed(e); h.host.creatures.mind.stay(e, 0xffffffff);
      ents.setPosition(c.ent, 126 - p.radius, .5, 128); h.run(300);
      expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
      h.pilots[0]!.yaw = Math.PI / 2;
      h.run((Math.ceil(32768 / Math.max(1, p.turnRate)) + 6) * 1000 / 30);
      expect(c.drive).toBe(e); expect(ents.yaw[e]).toBe(16384);
      const y = ents.y[e]!, face = ents.z[e]! - p.radius - .02, wall = h.reg.index.get('core:wall')!;
      for (let x = 122; x <= 140; x += 3) for (let tier = 0; tier < 3; tier++) h.world.structs.add(wall, x, y - .5 + tier * 3, face - .1, 0, 0, 10000);
      h.run(400);
      const chars = new Characters(h.reg, pack, new Assets(h.reg, pack), h.world), packet = new FramePacket(), st = new AnimState(), drawnSeat = new Float64Array(SEAT_FLOATS);
      st.unpack(ents.anim[e]!, ents.cue[e]!); st.seed = bodySeed(e); chars.begin(packet);
      expect(chars.seat(ents.kind[e]!, ents.x[e]!, ents.y[e]!, ents.z[e]!, Math.PI / 2, st, h.world.tick, drawnSeat, 1, undefined, rec.saddle)).toBe(true);
      expect(drawnSeat[2]!).toBeGreaterThan(face);
      let exposed = 0, unobstructedHits = 0;
      for (let x = 125; x <= 131; x += .12) for (let height = y; height < y + 5; height += .12) {
        const origin = face - 2.5;
        const reach = castWorld(h.world, x, height, origin, 0, 0, 1, 8) === HIT_NONE ? 8 : rayHit.t;
        const target = h.host.combat.castBodies(-1, x, height, origin, 0, 0, 1, reach);
        if (target === e || target === c.ent) exposed++;
        const clear = h.host.combat.castBodies(-1, x, height, 132, 0, 0, -1, 8);
        if (clear === e || clear === c.ent) unobstructedHits++;
      }
      expect(exposed).toBe(0); expect(unobstructedHits).toBeGreaterThan(30);
      const eye = new Float64Array(3), start = ents.x[e]!;
      h.pilots[0]!.moveZ = 127;
      for (let tick = 0; tick < 45; tick++) {
        h.run(1000 / 30); expect(c.drive).toBe(e);
        h.host.combat.eye(c.ent, eye, h.world.tick, false);
        expect(ents.z[c.ent]!).toBeGreaterThan(face); expect(eye[2]!).toBeGreaterThan(face);
        st.unpack(ents.anim[e]!, ents.cue[e]!); st.seed = bodySeed(e); packet.beginFrame(); chars.begin(packet);
        expect(chars.seat(ents.kind[e]!, ents.x[e]!, ents.y[e]!, ents.z[e]!, Math.PI / 2, st, h.world.tick, drawnSeat, 1, undefined, rec.saddle)).toBe(true);
        expect(drawnSeat[2]!).toBeGreaterThan(face);
      }
      expect(ents.x[e]! - start).toBeGreaterThan(3);
    } finally { h.host.shutdown(); }
  }
});
