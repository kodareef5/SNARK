import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { writeBones } from "../../client/core/render/characters.ts";
import { STEGO_DYES } from "../../content/creatures/stego.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Lists } from "../../server/settings/lists.ts";
import { spawnTables } from "../../server/settings/spawns.ts";
import { refreshMods, torporMax } from "../../server/survival.ts";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { CreatureAnim, creaturePose } from "../../shared/anim/creature.ts";
import { AnimState, CUE_LAND, CUE_STARTLE, CUE_TORPOR, LAYER_NONE, LAYER_FLINCH, LAYER_EAT } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { riderTargets, SEAT_DROP } from "../../shared/anim/seat.ts";
import { RIDER_TARGET_FLOATS } from "../../shared/anim/rider-controls.ts";
import { boneToModel, rayZones, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { EntityStore, F_GROUNDED } from "../../shared/sim/entities.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { Genome, STAT_NAMES, TAMED_GAIN } from "../../shared/sim/genome.ts";
import { piecesNeeded, proneHunger, tameSeconds } from "../../shared/sim/taming.ts";
import { ACT_NONE, ACT_RELOAD, ACT_SWING } from "../../shared/sim/weapon.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), kind = reg.index.get("core:stego")!, stego = reg.defs[kind] as SpeciesDef;

test("the registered jungle spawner can draw the ASE Stego group with its population limit", () => {
  const { rules } = loadConfig({});
  const { tables } = spawnTables(reg, rules, new Lists(rules, reg));
  const jungle = tables.get(reg.index.get("core:spawns_jungle")!)!;
  expect(jungle.entries.find(entry => entry.kinds.includes(kind))).toEqual({
    kinds: [kind, kind], weight: .025, chances: [1, .5], offsets: [[0, 6.8], [0, -6.8]],
  });
  expect(jungle.limits.get(kind)).toBe(.1);
  for (const name of ["beach", "proving_herd", "proving_hunters"]) {
    const table = tables.get(reg.index.get(`core:spawns_${name}`)!)!;
    expect(table.entries.some(entry => entry.kinds.includes(kind))).toBe(false);
  }
});

artTest("registered Stego stats, taming and breeding match the pinned numerical reference", () => {
  const reference = JSON.parse(readFileSync(new URL("../../assets/source/core/creatures/stego/ref/reference-values.json", import.meta.url), "utf8")).sources["values.json"].entry as {
    fullStatsRaw: (number[] | null)[];
    taming: Record<string, number>;
    breeding: Record<string, number>;
  };
  const p = stego.taming!, t = reference.taming, b = reference.breeding;
  expect([p.a0, p.a1, p.foodBase, p.proneMult, p.k]).toEqual([t.affinityNeeded0!, t.affinityIncreasePL!, t.foodConsumptionBase!, t.foodConsumptionMult!, t.tamingIneffectiveness!]);
  expect(reg.incubateTicks[kind]).toBe(Math.round(b.incubationTime! * 30));
  expect(reg.matureTicks[kind]).toBe(Math.round(b.maturationTime! * 30));
  const map = { health: 0, stamina: 1, torpidity: 2, oxygen: 3, food: 4, weight: 7, melee: 8, speed: 9 } as const;
  for (const [name, rawIndex] of Object.entries(map)) {
    const stat = name as keyof typeof map, raw = reference.fullStatsRaw![rawIndex]!;
    const curve = stego.stats![stat]!;
    expect(curve[0]).toBe(raw[0]!); expect(curve[1]).toBe(raw[1]!);
    expect(curve[2]).toBeCloseTo(raw[2]! * (TAMED_GAIN[stat] ?? 1), 10);
  }
});

test("Stego wild torpor growth and inherited colour regions match its species defaults", () => {
  const g = new Genome(); g.wild[0] = 149;
  expect(torporMax(stego, g)).toBeCloseTo(500 * (1 + 149 * .06), 8);
  expect(stego.regions!.map(r => r!.colors![0]![0])).toEqual(STEGO_DYES);
});

test("fresh tame movement includes the source addition once while domestic points remain independent", () => {
  const ents = new EntityStore({ chunksX: 2, chunksZ: 2 }, 8);
  const e = ents.create(kind, 32, 0, 32, F_GROUNDED), g = new Genome();
  refreshMods(reg, ents, e, g);
  const p = reg.tamedMove[kind]!;
  expect([ents.speedQ[e], ents.swimQ[e]]).toEqual([1000, 1000]);
  expect(p.walkSpeed * ents.speedQ[e]! / 1000).toBeCloseTo(1.50246, 6);
  expect(p.walkSpeed * p.sprintMul * ents.speedQ[e]! / 1000).toBeCloseTo(4.132256, 6);
  expect(p.swimSpeed * ents.swimQ[e]! / 1000).toBeCloseTo(2.6514, 6);
  g.tamed[STAT_NAMES.indexOf("speed")] = 1;
  refreshMods(reg, ents, e, g);
  expect([ents.speedQ[e], ents.swimQ[e]]).toEqual([1020, 1000]);
  expect([reg.move[kind]!.jumpSpeed, p.jumpSpeed, p.staminaJump]).toEqual([0, 0, 0]);
});

test("Stego knockout eating and saddle crafting use the registered species values", () => {
  const p = stego.taming!;
  expect(proneHunger(p)).toBeCloseTo(1.1111111963, 9);
  const berry = stego.eats![0]!;
  expect([1, 150].map(level => {
    const pieces = piecesNeeded(p, level, berry.affinity, 1);
    return [pieces, tameSeconds(p, pieces, berry.food)];
  })).toEqual([[79, 1422], [638, 11484]]);
  const saddle = reg.index.get("core:saddle_stego")!;
  expect(reg.saddleFits[saddle]).toBe(kind);
  expect(reg.recipeOf[saddle]!.filter((_, i) => i % 2 === 1)).toEqual(new Uint16Array([200, 110, 35]));
});

function native() {
  const pack = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/creatures/stego/stego.snpk", import.meta.url))));
  const rig = buildRigs(pack.header.rigs, pack.clips).get("core:stego")!;
  return { pack, rig };
}

artTest("native cervical capsules do not mask the visible face during idle and tail attacks", () => {
  const { rig } = native(), anim = new CreatureAnim(rig, reg.runAt[kind]!, 3, stego.combat), state = new AnimState();
  state.grounded = true; state.seed = 0;
  // Independent finest-skin ray review found these visible skull/jaw contacts.
  // The former single broad neck capsule returned torso 20–34 cm before skin.
  for (const [action, tick, y, z] of [[ACT_NONE, 0, 1.45, 2.35], [ACT_SWING, 17, 1.15, 2.25], [ACT_RELOAD, 26, 1.15, 2.25], [ACT_RELOAD, 26, 1.5, 2.30], [ACT_NONE, 0, 1.15, 2.85]] as const) {
    state.setAction(action, 0, 0); creaturePose(anim, state, tick, rig.a); solve(rig, rig.a, rig.solved);
    expect(rayZones(rig, rig.solved, 10, y, z, -1, 0, 0, 20)).toBe(1);
    expect(["skull", "jaw"]).toContain(rig.names[zoneHit.bone]!);
  }
  state.setAction(ACT_NONE, 0, 0); creaturePose(anim, state, 0, rig.a); solve(rig, rig.a, rig.solved);
  expect(rayZones(rig, rig.solved, 10, 1.45, -4.2, -1, 0, 0, 20)).toBe(2);
});

artTest("the native dorsal hide, outer plate and hock have damage contacts at their measured silhouettes", () => {
  const { rig } = native(), anim = new CreatureAnim(rig, reg.runAt[kind]!, 3, stego.combat);
  const state = new AnimState();
  state.grounded = true; state.seed = 0;
  state.setAction(ACT_NONE, 0, 0);
  creaturePose(anim, state, 0, rig.a);
  solve(rig, rig.a, rig.solved);
  // Each line intersects a triangle on the finest posed body.
  for (const [x, y, z, dx, dz, bone] of [
    [-.3, 2.95, 10, 0, -1, "pelvis"], [-.3, 2.95, -10, 0, 1, "pelvis"],
    [10, .4, -.9, -1, 0, "hind_lower_l"], [10, 2.95, .75, -1, 0, "plate_03"],
  ] as const) {
    expect(rayZones(rig, rig.solved, x, y, z, dx, 0, dz, 20)).toBeGreaterThan(0);
    expect(rig.names[zoneHit.bone]).toBe(bone);
  }
});

artTest("the posed forefoot bearing edge and swept plate shoulders have native damage contacts", () => {
  const { rig } = native(), state = new AnimState();
  const anim = new CreatureAnim(rig, reg.runAt[kind]!, 3, stego.combat);
  state.grounded = true; state.seed = 0;
  for (const [action, tick, y, z, zone] of [
    [ACT_NONE, 0, .05, 1.5, 3], [ACT_NONE, 0, 1.95, -2.90, 2],
    [ACT_SWING, 17, 2.60, -2.00, 2], [ACT_RELOAD, 26, 2.55, -2.00, 2],
  ] as const) {
    state.setAction(action, 0, 0);
    creaturePose(anim, state, tick, rig.a);
    solve(rig, rig.a, rig.solved);
    expect(rayZones(rig, rig.solved, 10, y, z, -1, 0, 0, 20)).toBe(zone);
  }
});

artTest("native tail contacts sweep rear quarters on both sides inside the registered broad-phase reach", () => {
  const { rig } = native(), attack = stego.combat!.primary, pose = new Pose(rig.bones), socket = rig.sockets.get(attack.socket)!;
  const at = [0, 0, 0], positions: number[][][] = [];
  for (const name of [attack.clip, attack.alternateClip!]) {
    const clip = rig.clips.get(name)!; expect(clip.frames).toBe(attack.ticks);
    const side: number[][] = [];
    for (let tick = attack.lands; tick <= attack.through; tick++) {
      sampleClip(clip, tick, pose); solve(rig, pose, rig.solved);
      boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
      expect(at[2]!).toBeLessThan(-3); // A forward-eye bite cannot satisfy this contact contract.
      expect(Math.hypot(at[0]!, at[2]!) + attack.radius).toBeLessThan(attack.reach);
      side.push([...at]);
    }
    positions.push(side);
  }
  expect(positions[0]![0]![0]!).toBeLessThan(-.5); expect(positions[1]![0]![0]!).toBeGreaterThan(.5);
  for (let t = 0; t < positions[0]!.length; t++) {
    expect(positions[0]![t]![0]).toBeCloseTo(-positions[1]![t]![0]!, 3);
    expect(positions[0]![t]![2]).toBeCloseTo(positions[1]![t]![2]!, 3);
  }
});

artTest("native moving attacks retain all foot transforms and plate modes preserve the saddle frame", () => {
  const { rig } = native(), anim = new CreatureAnim(rig, reg.runAt[kind]!, 3, stego.combat);
  const st = new AnimState(), base = new Pose(rig.bones), action = new Pose(rig.bones);
  st.grounded = true; st.speed = 8;
  const points = (pose: Pose) => {
    solve(rig, pose, rig.solved);
    return rig.feet.flatMap(b => Array.from(rig.solved.pos.slice(b * 3, b * 3 + 3)));
  };
  for (const act of [ACT_SWING, ACT_RELOAD]) for (const tick of [8, 16, 24]) {
    st.setAction(ACT_NONE, 0, 0); creaturePose(anim, st, tick, base);
    st.setAction(act, 0, 0); creaturePose(anim, st, tick, action);
    expect(points(action)).toEqual(points(base));
  }
  const seat = reg.saddleSeats[reg.index.get("core:saddle_stego")!]![0]!, targets = new Float64Array(RIDER_TARGET_FLOATS);
  for (let mode = 0; mode < 3; mode++) {
    st.setAction(ACT_NONE, mode << 1, 0); creaturePose(anim, st, 20, action); solve(rig, action, rig.solved);
    expect(riderTargets(rig, rig.solved, seat, targets)).toBe(true);
    for (const [i, p] of [[0, [.17, .31, .27]], [1, [-.17, .31, .27]], [2, [.29, -.49, .30]], [3, [-.29, -.49, .30]]] as const) {
      for (let axis = 0; axis < 3; axis++) expect(targets[1 + i * 3 + axis]).toBeCloseTo(p[axis]! + (axis === 1 ? SEAT_DROP : 0), 4);
    }
  }
});

artTest("the damaging spike acquires at torso height and lifts from the same safe hold origin", () => {
  const { rig } = native(), attack = stego.combat!.secondary!, socket = rig.sockets.get(attack.socket)!;
  expect(attack.socket).toBe(attack.impale!.socket);
  const at = [0, 0, 0], points: number[][] = [];
  for (let tick = attack.lands; tick <= attack.through; tick++) {
    sampleClip(rig.clips.get(attack.clip)!, tick, rig.a); solve(rig, rig.a, rig.solved);
    boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
    expect(at[1]!).toBeGreaterThan(1); expect(at[1]!).toBeLessThan(1.3);
    expect(Math.hypot(at[0]!, at[2]!) + attack.radius).toBeLessThan(attack.reach);
    points.push([...at]);
  }
  const hold = rig.clips.get("impale_hold")!;
  expect(hold.loop).toBe(false);
  sampleClip(hold, 0, rig.a); solve(rig, rig.a, rig.solved);
  boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
  expect(Math.hypot(...at.map((x, i) => x - points[0]![i]!))).toBeLessThan(.01);
  let low = Infinity, high = -Infinity;
  for (let tick = 0; tick < 180; tick++) {
    sampleClip(hold, tick, rig.a); solve(rig, rig.a, rig.solved);
    boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
    low = Math.min(low, at[1]!); high = Math.max(high, at[1]!);
  }
  expect(low).toBeGreaterThan(1); expect(high).toBeGreaterThan(1.7); expect(high).toBeLessThan(1.8);
});

artTest("declared sole supports are the actual finite flat metal tread faces in the native saddle", () => {
  const { pack, rig } = native(), seat = reg.saddleSeats[reg.index.get("core:saddle_stego")!]![0]!;
  const support = seat.rider!.soles!, lod = unpackMeshes(pack).find(m => m.id === "core:saddle_stego/worn")!.lods[0]!;
  for (const name of support.sockets) {
    const socket = rig.sockets.get(name)!, c = [socket.x, socket.y, socket.z].map((v, a) => v + rig.rest[socket.bone * 3 + a]!);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const corner = [c[0]! + support.half[0] * x, c[1]!, c[2]! + support.half[1] * z];
      let error = Infinity;
      for (let i = 0; i < lod.positions.length; i += 3) error = Math.min(error, Math.hypot(...corner.map((v, a) => v - lod.positions[i + a]!)));
      expect(error).toBeLessThan(.0001);
    }
  }
});

artTest("both actual nostrils clear the water through native swim blends and awake water reactions", () => {
  const { rig } = native(), anim = new CreatureAnim(rig, reg.runAt[kind]!, 3, stego.combat);
  const st = new AnimState(), at = [0, 0, 0]; st.mode = MODE_SWIM; st.grounded = false;
  const nostrils = [rig.sockets.get("breath_l")!, rig.sockets.get("breath_r")!];
  let minimum = Infinity;
  for (const speed of [0, 1, 8, 20]) for (const cue of [0, CUE_STARTLE, CUE_LAND, CUE_TORPOR]) for (const layer of [LAYER_NONE, LAYER_FLINCH, LAYER_EAT]) {
    st.speed = speed; st.cue = cue; st.cueStart = 0; st.layer = layer; st.layerStart = 0;
    for (let tick = 0; tick <= 90; tick += .5) {
      creaturePose(anim, st, tick, rig.a); solve(rig, rig.a, rig.solved);
      for (const socket of nostrils) {
        boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
        minimum = Math.min(minimum, at[1]!);
      }
    }
  }
  expect(minimum - stego.swimDepth!).toBeGreaterThan(.12);
  expect(stego.swimEyeHeight!).toBeLessThanOrEqual(minimum + .002);
  st.out = true; st.cue = 0; st.layer = LAYER_NONE;
  creaturePose(anim, st, 90, rig.a); solve(rig, rig.a, rig.solved);
  const nose = nostrils[0]!; boneToModel(rig.solved, nose.bone, nose.x, nose.y, nose.z, at);
  expect(at[1]!).toBeLessThan(stego.swimDepth!);
  expect(stego.eyeHeight).toBe(1.32);
});

artTest("the native quarter-turn counter-rotates planted soles instead of sliding a forward walk", () => {
  const { rig } = native(), clip = rig.clips.get("turn")!, at = [0, 0, 0];
  for (const name of ["hind_foot_l", "fore_foot_r", "hind_foot_r", "fore_foot_l"]) {
    const socket = rig.sockets.get(name)!; let previous: number[] | null = null, maximum = 0, contacts = 0;
    for (let frame = 0; frame < clip.frames; frame++) {
      sampleClip(clip, frame, rig.a); solve(rig, rig.a, rig.solved);
      boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
      const t = frame / (clip.frames - 1), angle = Math.PI / 2 * t * t * (3 - 2 * t), c = Math.cos(angle), s = Math.sin(angle);
      const world = [at[0]! * c + at[2]! * s, at[1]!, at[2]! * c - at[0]! * s];
      // The socket now witnesses the actual sole at zero, not the old nominal
      // pad point 45 mm above it. Count contact within 5 mm of the ground.
      if (world[1]! < .005) {
        contacts++;
        if (previous && previous[1]! < .005) maximum = Math.max(maximum, Math.hypot(world[0]! - previous[0]!, world[2]! - previous[2]!));
      }
      previous = world;
    }
    expect(contacts).toBeGreaterThan(70);
    expect(maximum).toBeLessThan(.015);
  }
});

artTest("the weighted plantar contacts stay planted while the resting trunk breathes", () => {
  const { rig } = native(), at = [0, 0, 0];
  for (const clipName of ["idle", "idle_look", "idle_graze", "call", "startled"]) {
    const clip = rig.clips.get(clipName)!;
    for (const name of ["hind_foot_l", "fore_foot_l", "hind_foot_r", "fore_foot_r"]) {
      const socket = rig.sockets.get(name)!; let start: number[] | undefined, drift = 0;
      for (let tick = 0; tick < clip.frames; tick += .5) {
        sampleClip(clip, tick, rig.a); solve(rig, rig.a, rig.solved);
        boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, at);
        start ??= [...at];
        drift = Math.max(drift, Math.hypot(...at.map((v, a) => v - start![a]!)));
      }
      // Source witnesses are actual fully foot-weighted pad vertices. Native
      // quaternion interpolation/quantization gets a submillimetre allowance.
      expect(Math.abs(start![1]!)).toBeLessThan(.001);
      expect(drift).toBeLessThan(.001);
    }
  }
});


artTest("native collapse and recovery keep the actual weighted skin on the floor throughout the transition", () => {
  const {pack,rig}=native(), mesh=unpackMeshes(pack).find(m=>m.id==="core:stego")!.lods[0]!, matrix=new Float32Array(rig.bones*12);
  for(const name of ["torpor_in","torpor_idle","torpor_out","death"]){
    const clip=rig.clips.get(name)!,end=name==="death"?rig.ragdoll!.limp:clip.frames-1;
    let deepest=Infinity,highestContact=-Infinity;
    for(let frame=0;frame<=end;frame+=.5){
      sampleClip(clip,frame,rig.a);solve(rig,rig.a,rig.solved);writeBones(matrix,0,rig.solved,rig.rest,null,0,0,0,0);
      let low=Infinity;
      for(let v=0;v<mesh.positions.length/3;v++){
        let y=0;
        for(let k=0;k<4;k++){const w=mesh.weights![v*4+k]!,m=mesh.joints![v*4+k]!*12+4;
          y+=w*(matrix[m]!*mesh.positions[v*3]!+matrix[m+1]!*mesh.positions[v*3+1]!+matrix[m+2]!*mesh.positions[v*3+2]!+matrix[m+3]!);
        }
        low=Math.min(low,y);
      }
      deepest=Math.min(deepest,low);highestContact=Math.max(highestContact,low);
    }
    // Both burial and hovering matter. Collision capsules alone previously
    // passed while a folded far foot was 72 cm beneath the actual floor.
    expect([name,deepest>-.001,highestContact<.001]).toEqual([name,true,true]);
  }
});

artTest("walking retains the small neighboring skin edges at the shoulder and hip", () => {
  const {pack, rig} = native();
  const mesh = unpackMeshes(pack).find(m => m.id === "core:stego")!.lods[0]!;
  const matrix = new Float32Array(rig.bones * 12);
  // The source18 skin expanded 19 mm to 457 mm at the armpit and 10 mm
  // to 202 mm at the hip. Look for a local tear independent of vertex order.
  for (const [frame, x, y, z] of [[45, .581, .866, .483], [35, 1.030, 1.455, -.232]] as const) {
    sampleClip(rig.clips.get("walk")!, frame, rig.a);
    solve(rig, rig.a, rig.solved);
    writeBones(matrix, 0, rig.solved, rig.rest, null, 0, 0, 0, 0);
    const points = new Map<number, number[]>();
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const px = mesh.positions[v*3]!, py = mesh.positions[v*3+1]!, pz = mesh.positions[v*3+2]!;
      if (Math.hypot(px-x, py-y, pz-z) > .07) continue;
      const point = [0, 0, 0];
      for (let k = 0; k < 4; k++) for (let axis = 0; axis < 3; axis++) {
        const m = mesh.joints![v*4+k]!*12+axis*4;
        point[axis]! += mesh.weights![v*4+k]!*(matrix[m]!*px+matrix[m+1]!*py+matrix[m+2]!*pz+matrix[m+3]!);
      }
      points.set(v, point);
    }
    let samples = 0, maxGrowth = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = mesh.indices[t+k]!, b = mesh.indices[t+(k+1)%3]!;
      const p = points.get(a), q = points.get(b);
      if (!p || !q) continue;
      const base = Math.hypot(...p.map((_,i) => mesh.positions[a*3+i]!-mesh.positions[b*3+i]!));
      if (base < .005 || base > .035) continue;
      maxGrowth = Math.max(maxGrowth, Math.hypot(...p.map((n,i) => n-q[i]!))-base);
      samples++;
    }
    expect(samples).toBeGreaterThan(0);
    expect(maxGrowth).toBeLessThan(.035);
  }
});
