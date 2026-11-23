// A creature that does not strafe carries its turn in its motion word (shared/anim/pose.ts, TURN_STEPS), and bends, leads,
// swings its tail and leans into the turn by it (shared/anim/carriage.ts): the same on the server and every client.
import { expect, test } from "bun:test";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { BEND, LEAD, ROLL_FAST, ROLL_WALK, SWING } from "../../shared/anim/carriage.ts";
import { FOOTFALL_REVERSE, creatureAnims, creatureFootfallDomain, creaturePose, poseCreatureOn, type CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState, ANIM_FLYING, DIR_STEPS, SPEED_STEP, TURN_STEPS, backward, turnOf, turnSteps } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatMul, quatMulConj } from "../../shared/math/quat.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { JET_LIFT, MODE_FLYER, MODE_SWIM, MODE_WALK, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND } from "../../shared/sim/character.ts";
import { EntityStore, F_GROUNDED, carriageRate } from "../../shared/sim/entities.ts";
import { camp, pilot, ride, screen, tame, until } from "../kit/kit.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack, frozenPack } from "../fixtures/pack.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const DEG = Math.PI / 180;
const reg = coreRegistry();

/** A state moving at `speed` steps, forward or backward, turning `steps` toward its left. */
function moving(speed: number, back: boolean, steps: number): AnimState {
  const st = new AnimState();
  st.speed = speed;
  st.dir = back ? DIR_STEPS / 2 : 0;
  st.setTurn(steps);
  return st;
}

test("the motion word carries a turn and comes back whole in every mode", () => {
  const back = new AnimState();
  for (const [mode, grounded, stance] of [[MODE_WALK, true, STANCE_STAND], [MODE_WALK, false, STANCE_STAND], [MODE_SWIM, true, STANCE_STAND], [MODE_WALK, true, STANCE_CROUCH], [MODE_WALK, true, STANCE_PRONE]] as const) {
    for (const reverse of [false, true]) for (let steps = -TURN_STEPS; steps <= TURN_STEPS; steps++) for (const speed of [0, 5, 15]) {
      const st = moving(speed, reverse, steps);
      st.mode = mode;
      st.grounded = grounded;
      st.stance = stance;
      st.setAction(1, 2, 77);
      const word = st.pack();
      back.unpack(word);
      expect([back.mode, back.grounded, back.stance, back.speed, back.action, back.actionStart]).toEqual([mode, grounded, stance, speed, st.action, 77]);
      expect([turnOf(back.dir), backward(back.dir), back.pack()]).toEqual([steps, reverse, word]);
    }
  }
  // In flight the bank says the turn: setTurn leaves a flyer's word as it was.
  const flyer = new AnimState();
  flyer.mode = MODE_FLYER;
  flyer.setMotion(0, 10, 5 * Math.PI / 32, 0.2, -4);
  const flown = flyer.pack();
  flyer.setTurn(3);
  expect(flyer.pack()).toBe(flown);
  back.unpack(flown);
  expect([(flown >>> 8) & 3, back.mode, back.bank, back.dir]).toEqual([ANIM_FLYING, MODE_FLYER, flyer.bank, 0]);
  // A survivor's air layouts keep their own direction bits.
  for (const jet of [true, false]) {
    const air = new AnimState();
    air.grounded = false;
    air.setMotion(3, 1, 0, 0);
    air.setJet(jet ? JET_LIFT : 0, 0);
    air.setGlide(!jet, 0);
    back.unpack(air.pack(), air.packCue());
    expect([back.jet, back.glide, back.dir, back.speed]).toEqual([jet, !jet, air.dir, air.speed]);
  }
});

test("a turn is the yaw's change against the turn rate, a step a tick", () => {
  const rate = 300;
  expect([turnSteps(300, rate, 3), turnSteps(-300, rate, -3), turnSteps(150, rate, 2), turnSteps(40, rate, 0)]).toEqual([3, -3, 2, 0]);
  // From straight on into a full turn, one step a tick.
  expect([turnSteps(300, rate, 0), turnSteps(300, rate, 1), turnSteps(-300, rate, 2)]).toEqual([1, 2, 1]);
  expect(turnSteps(300, rate, 0, 3)).toBe(3);
  // Set straight past twice its rate, as a teleport turns it: no turn.
  expect([turnSteps(5000, rate, 0), turnSteps(65536 - 300, rate, -3)]).toEqual([0, -3]);
});

test("a survivor's word is unchanged; a turning body's differs only in direction", () => {
  const dims = { chunksX: 2, chunksZ: 2 };
  const legacy = new EntityStore(dims, 8), ents = new EntityStore(dims, 8, 8, reg.vehicle, reg.move.map(carriageRate));
  const kinds = ["core:survivor", "core:civilian", "core:raptor", "core:rex"].map((id) => reg.index.get(id)!);
  expect(kinds.map((k) => carriageRate(reg.move[k]) > 0)).toEqual([false, false, true, true]);
  let seed = 7;
  const rand = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (const kind of kinds) {
    const a = legacy.create(kind, 20, 0, 20, 0), b = ents.create(kind, 20, 0, 20, 0);
    let turned = 0;
    for (let tick = 1; tick < 2000; tick++) {
      const speed = rand() < 0.2 ? 0 : rand() * 9;
      const way = rand() * TAU, yaw = Math.floor(rand() * 65536), vy = rand() < 0.1 ? -3 : 0;
      for (const s of [legacy, ents]) {
        const e = s === legacy ? a : b;
        s.vx[e] = Math.sin(way) * speed; s.vz[e] = Math.cos(way) * speed; s.vy[e] = vy;
        // The yaw mostly creeps, as a step turns it, and now and then jumps.
        s.yaw[e] = tick % 50 === 0 ? yaw : (s.yaw[e]! + ((tick >> 4) % 3 - 1) * 250) & 0xffff;
        s.mode[e] = tick % 97 === 0 ? MODE_SWIM : MODE_WALK;
        s.flags[e] = tick % 13 === 0 ? s.flags[e]! & ~F_GROUNDED : s.flags[e]! | F_GROUNDED;
        s.stance[e] = kind === kinds[0] ? tick % 3 : 0;
        s.pitch[e] = (tick * 977) % 32768 - 16384;
        s.jetThrust[e] = kind === kinds[0] && tick % 11 === 0 ? JET_LIFT : 0;
        s.glide[e] = kind === kinds[0] && tick % 17 === 0 ? 1 : 0;
        s.act[e] = tick % 5; s.actTicks[e] = tick % 7;
        s.pose(e, tick);
      }
      const was = legacy.anim[a]!, now = ents.anim[b]!;
      if (kind === kinds[0] || kind === kinds[1]) expect(now).toBe(was);
      else {
        expect((now & ~0xf0) >>> 0).toBe((was & ~0xf0) >>> 0);
        // Moving, it still goes forward or backward as it did.
        if ((was & 15) !== 0) expect(backward((now >>> 4) & 15)).toBe(backward((was >>> 4) & 15));
        if (turnOf((now >>> 4) & 15) !== 0) turned++;
      }
    }
    if (kind === kinds[2] || kind === kinds[3]) expect(turned).toBeGreaterThan(100);
  }
});

test("a creature backing off as it retreats still packs backward, with its turn", () => {
  const ents = new EntityStore({ chunksX: 2, chunksZ: 2 }, 4, 4, reg.vehicle, reg.move.map(carriageRate));
  const kind = reg.index.get("core:trike")!, rate = carriageRate(reg.move[kind]);
  const e = ents.create(kind, 20, 0, 20, 0);
  const st = new AnimState();
  ents.pose(e, 0);
  for (let tick = 1; tick <= 6; tick++) {
    // Facing its foe as it backs off: it turns right at its full rate, moving away along its facing.
    ents.yaw[e] = (ents.yaw[e]! - rate) & 0xffff;
    const yaw = (ents.yaw[e]! * TAU) / 65536;
    ents.vx[e] = -Math.sin(yaw) * 1.4; ents.vz[e] = -Math.cos(yaw) * 1.4;
    ents.pose(e, tick);
    st.unpack(ents.anim[e]!);
    expect([backward(st.dir), turnOf(st.dir)]).toEqual([true, -Math.min(tick, TURN_STEPS)]);
  }
});

test("a body left unposed for a tick, as one at rest is, keeps no turn from before", () => {
  const ents = new EntityStore({ chunksX: 2, chunksZ: 2 }, 4, 4, reg.vehicle, reg.move.map(carriageRate));
  const kind = reg.index.get("core:rex")!, rate = carriageRate(reg.move[kind]);
  const e = ents.create(kind, 20, 0, 20, 0);
  const st = new AnimState();
  const shown = (tick: number): number => (ents.pose(e, tick), st.unpack(ents.anim[e]!), turnOf(st.dir));
  ents.vz[e] = 2;
  const turning: number[] = [];
  for (let tick = 0; tick <= 5; tick++) {
    if (tick > 0) ents.yaw[e] = (ents.yaw[e]! + rate) & 0xffff;
    turning.push(shown(tick));
  }
  expect(turning).toEqual([0, 1, 2, 3, 3, 3]);
  // Stopped and skipped for a few ticks, then off again straight, and then turning.
  expect(shown(9)).toBe(0);
  ents.yaw[e] = (ents.yaw[e]! + rate) & 0xffff;
  expect([shown(10), shown(10)]).toEqual([1, 1]);
});

const rigs = buildRigs(corePack().header.rigs, corePack().clips);
/** What each modelled species plays, as the server makes it. */
const anims = (): CreatureAnim[] => creatureAnims(reg, (d) => rigs.get(d.mesh)).filter((a) => a !== null);

/** `a` posed at `tick` in state `st`, solved. */
function posed(a: CreatureAnim, st: AnimState, tick = 1000.5): Solved {
  creaturePose(a, st, tick, a.rig.a, null);
  const out = new Solved(a.rig.bones);
  solve(a.rig, a.rig.a, out);
  return out;
}

const was = new Float64Array(4), now = new Float64Array(4), d = new Float64Array(4);

/**
 * How far bone `b` turned from `from` to `to` in the root's frame, as a turn about that frame's x, y or z (`axis` 0, 1
 * or 2), in radians; NaN where it turned about another axis too. The root itself is measured in the model's frame.
 */
function turnedAbout(from: Solved, to: Solved, b: number, axis: number): number {
  if (b === 0) for (let k = 0; k < 4; k++) [was[k], now[k]] = [from.rot[k]!, to.rot[k]!];
  else {
    quatMulConj(was, 0, from.rot, 0, from.rot, b * 4);
    quatMulConj(now, 0, to.rot, 0, to.rot, b * 4);
  }
  // The turn between them, now * conj(was), the short way round.
  for (let k = 0; k < 3; k++) was[k] = -was[k]!;
  quatMul(d, 0, now, 0, was, 0);
  if (d[3]! < 0) for (let k = 0; k < 4; k++) d[k] = -d[k]!;
  for (let k = 0; k < 3; k++) if (k !== axis && Math.abs(d[k]!) > 1e-4) return NaN;
  return 2 * Math.atan2(d[axis]!, d[3]!);
}

artTest("a creature at full turn bends, leads, swings its tail and leans, bounded", () => {
  const all = anims();
  expect(all.filter((a) => a.carriage).length).toBe(10);
  const near = (x: number, want: number): boolean => Math.abs(x - want) < 0.02 * DEG;
  for (const a of all) {
    if (!a.carriage) continue;
    const s = a.rig.sections, id = a.rig.id, walk = a.carriage.walk;
    const chest = s.spine[s.spine.length - 1]!, tail = s.tail[s.tail.length - 1]!;
    // Below a walk all of it grows with speed; from a walk the bend and lead are whole, and the roll grows to a sprint.
    for (const speed of [1, Math.ceil(walk / SPEED_STEP), 15]) {
      const x = (speed * SPEED_STEP) / walk, k = x >= 1 ? 1 : x * x * (3 - 2 * x), fast = Math.min(1, Math.max(0, (x - 1) / 2));
      const roll = k * (ROLL_WALK + (ROLL_FAST - ROLL_WALK) * fast);
      const straight = posed(a, moving(speed, false, 0));
      for (const side of [1, -1]) {
        const turning = posed(a, moving(speed, false, side * TURN_STEPS));
        // About the trunk's up: the chest and the head to the side it turns to, the tail the same way, so out behind it.
        // A spine of one bone, the carbonemys's shell, has nothing to bend.
        const bend = s.spine.length > 1 ? side * turnedAbout(straight, turning, chest, 1) : 0, lead = side * turnedAbout(straight, turning, s.head, 1);
        const swing = side * turnedAbout(straight, turning, tail, 1);
        // About the facing, the root leans in: to the turn's side is a negative turn about +Z.
        const lean = -side * turnedAbout(straight, turning, 0, 2);
        const bent = s.spine.length > 1 ? k * BEND : 0;
        expect([id, speed, side, near(bend, bent), near(lead, bent + k * LEAD), near(swing, k * SWING), near(lean, roll)]).toEqual([id, speed, side, true, true, true, true]);
        const over = 0.02 * DEG;
        expect([id, bend <= BEND + over && lead <= BEND + LEAD + over && swing <= SWING + over && lean <= ROLL_FAST + over]).toEqual([id, true]);
      }
    }
    // Standing, falling or out cold it does not, and with no turn it is as it was.
    const still = moving(0, false, TURN_STEPS), falling = moving(10, false, TURN_STEPS), cold = moving(10, false, TURN_STEPS);
    falling.grounded = false;
    cold.out = true;
    for (const st of [still, falling, cold]) {
      const plain = new AnimState();
      plain.unpack(st.pack(), st.packCue());
      plain.dir = 0;
      expect([id, Array.from(posed(a, st).rot)]).toEqual([id, Array.from(posed(a, plain).rot)]);
    }
  }
});

artTest("a creature backing up plays its gait in reverse whatever its turn", () => {
  for (const a of anims()) {
    if (!a.carriage) continue;
    const s = a.rig.sections, id = a.rig.id, speed = Math.ceil(a.carriage.walk / SPEED_STEP);
    const legs = s.legs.flat();
    const local = (st: AnimState): number[] => {
      creaturePose(a, st, 1000.5, a.rig.a, null);
      return legs.flatMap((b) => Array.from(a.rig.a.rot.subarray(b * 4, b * 4 + 4)));
    };
    const reverse = local(moving(speed, true, 0));
    expect([id, local(moving(speed, false, 0))]).not.toEqual([id, reverse]);
    for (let steps = -TURN_STEPS; steps <= TURN_STEPS; steps++) {
      const st = moving(speed, true, steps);
      expect([id, steps, creatureFootfallDomain(a, st, 1000.5), local(st)]).toEqual([id, steps, FOOTFALL_REVERSE, reverse]);
    }
  }
});

test("the server and a client pose a turning creature alike, bit for bit", () => {
  const world = flatWorld(), pack = frozenPack(), scene = new Scene(world, world.reg, pack);
  const frozen = buildRigs(pack.header.rigs, pack.clips);
  const served = creatureAnims(reg, (d) => frozen.get(d.mesh));
  for (const id of ["core:raptor", "core:parasaur"]) {
    const kind = reg.index.get(id)!, server = served[kind]!, client = scene.characters.creature(kind)!;
    expect([id, server.turns, client.turns, client.carriage !== null]).toEqual([id, true, true, true]);
    for (const [speed, back, steps] of [[6, false, 3], [9, false, -2], [3, true, 1], [6, false, 0]] as const) {
      const st = moving(speed, back, steps);
      st.seed = 41;
      const at = (a: CreatureAnim): number[] => {
        poseCreatureOn(a, st, 1234.25, world, 64, 0, 64, 0.6);
        return [...a.rig.solved.rot, ...a.rig.solved.pos];
      };
      const bent = at(server);
      expect([id, steps, at(client)]).toEqual([id, steps, bent]);
      const plain = moving(speed, back, 0);
      plain.seed = 41;
      if (steps !== 0) {
        poseCreatureOn(server, plain, 1234.25, world, 64, 0, 64, 0.6);
        expect([...server.rig.solved.rot]).not.toEqual(bent.slice(0, server.rig.solved.rot.length));
      }
    }
  }
});

artTest("a ridden raptor shows the same turn to its rider as the server sends everyone", () => {
  const { h, ada } = camp({ screen: true });
  const mount = tame(h, ada, "raptor", { saddled: true });
  ride(h, ada, mount.e);
  const p = pilot(h, ada), own = screen(h, ada).app.director.own.state, word = new AnimState();
  const yaw = (): number => (h.world.ents.yaw[mount.e]! / 65536) * TAU;
  const shown = (): number[] => {
    word.unpack(h.world.ents.anim[mount.e]!);
    return [turnOf(word.dir), turnOf(own.dir)];
  };
  p.moveZ = 1;
  // Looking ever a radian to its left, then to its right, then ahead: it turns at its full rate each way, then not.
  for (const [look, steps] of [[1, TURN_STEPS], [-1, -TURN_STEPS], [0, 0]] as const) {
    const ahead = yaw();
    until(h, () => ((p.yaw = look === 0 ? ahead : yaw() + look), false), 1);
    expect([look, ...shown()]).toEqual([look, steps, steps]);
  }
  p.moveZ = 0;
});
