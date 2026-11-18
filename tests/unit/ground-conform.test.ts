import { expect, test } from 'bun:test';
import { NO_CLIPS } from '../../shared/anim/clip.ts';
import { conformCreature, groundSpeedScale } from '../../shared/anim/ground-conform.ts';
import { CreatureAnim, rayCreature, advanceCreature, creaturePose, poseCreatureOn, creatureFootfallDomain } from '../../shared/anim/creature.ts';
import { Gait } from '../../shared/anim/gait.ts';
import { seatFrame, seatOn, SEAT_FLOATS } from '../../shared/anim/seat.ts';
import { zoneHit } from '../../shared/anim/skeleton.ts';
import { AnimState, CUE_DEAD, LAYER_FLINCH } from '../../shared/anim/pose.ts';
import { buildRig, type Rig } from '../../shared/anim/rigs.ts';
import { boneToModel, solve } from '../../shared/anim/skeleton.ts';
import { quatAxis } from '../../shared/math/quat.ts';
import type { PackRig } from '../../shared/pack/pack.ts';
import { MODE_SWIM } from '../../shared/sim/character.ts';
import { groundUnder } from '../../shared/world/collide.ts';
import { flatWorld } from '../fixtures/world.ts';
import { strider, FOOT_L, FOOT_R } from '../fixtures/strider.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { Corpses } from '../../client/core/ragdoll.ts';
import { RemoteSample } from '../../client/core/session.ts';
import { Details } from '../../client/core/details/details.ts';
import { Occasions } from '../../client/core/occasions.ts';
import { Camera } from '../../client/core/render/camera.ts';
import { FramePacket } from '../../client/core/render/packet.ts';
import { tierOf } from '../../client/core/assets/tiers.ts';
import { effectOf, type PackDetails } from '../../shared/pack/details.ts';

function quadruped(): Rig {
  const raw: PackRig={id:'test:quadruped',skeleton:'test',names:['body'],parent:[-1],rest:[0,1.5,0],sockets:[{name:'seat',bone:0,x:0,y:.3,z:0}],caps:[0,1,0,0,0,0,0,0,.2],
    ground:{maxTilt:35,maxStep:.45,probe:1.5,legs:[]}};
  for(const z of [-.8,.8])for(const x of [-.6,.6]) {
    const upper=raw.names!.length,lower=upper+1,end=upper+2,socket=`sole${upper}`;
    raw.names!.push(`upper${upper}`,`lower${upper}`,`end${upper}`);raw.parent!.push(0,upper,lower);
    raw.rest.push(x,1.4,z,x,.72,z+.25,x,.1,z);
    raw.sockets!.push({name:socket,bone:end,x:0,y:-.1,z:0});
    raw.ground!.legs.push({upper,lower,end,socket});
  }
  return buildRig(raw,NO_CLIPS)!;
}
function slope(deg:number,heading:number) {
  const world=flatWorld(),grad=Math.tan(deg*Math.PI/180),co=Math.cos(heading),sn=Math.sin(heading);
  for(let z=0;z<world.hf.nz;z++)for(let x=0;x<world.hf.nx;x++)world.hf.setSample(x,z,grad*((x*world.hf.cell-64)*sn+(z*world.hf.cell-64)*co));
  return world;
}
const point=new Float64Array(3);
function checkLengths(rig:Rig):void {
  for(let b=1;b<rig.bones;b++) {
    const p=rig.parent[b]!;
    const before=Math.hypot(rig.rest[b*3]!-rig.rest[p*3]!,rig.rest[b*3+1]!-rig.rest[p*3+1]!,rig.rest[b*3+2]!-rig.rest[p*3+2]!);
    const after=Math.hypot(rig.solved.pos[b*3]!-rig.solved.pos[p*3]!,rig.solved.pos[b*3+1]!-rig.solved.pos[p*3+1]!,rig.solved.pos[b*3+2]!-rig.solved.pos[p*3+2]!);
    expect(after).toBeCloseTo(before,5);
  }
}
test('ground fitting plants a quadruped on longitudinal, side and diagonal grades at adult and juvenile scales without stretching',()=>{
  for(const size of [.25,1])for(const deg of [-30,-15,15,30])for(const heading of [0,Math.PI/2,2.3]) {
    const rig=quadruped(),st=new AnimState(),world=slope(deg,heading),y=groundUnder(world.hf,64,64,.6*size);
    solve(rig,rig.a,rig.solved);
    conformCreature(rig,st,rig.a,rig.solved,world,64,y,64,0,size);
    for(const leg of rig.ground!.legs) {
      boneToModel(rig.solved,leg.foot.bone,leg.foot.x,leg.foot.y,leg.foot.z,point);
      const gap=y+point[1]!*size-world.hf.heightAt(64+point[0]!*size,64+point[2]!*size);
      expect(Math.abs(gap)).toBeLessThan(.001);
    }
    checkLengths(rig);
  }
});
test('a supported level floor preserves authored flat poses, and water, air, knockout, death and held poses are untouched',()=>{
  const rig=quadruped(),st=new AnimState(),world=flatWorld();
  quatAxis(rig.a.rot,rig.ground!.legs[0]!.lower*4,1,0,0,.25);solve(rig,rig.a,rig.solved);
  const positions=rig.solved.pos.slice(),rotations=rig.a.rot.slice(),root=rig.a.root.slice();
  conformCreature(rig,st,rig.a,rig.solved,world,64,0,64,0);
  expect(rig.solved.pos).toEqual(positions);expect(rig.a.rot).toEqual(rotations);expect(rig.a.root).toEqual(root);
  const grade=slope(25,0);
  for(const mode of ['water','air','out','dead','held']) {
    const state=new AnimState();
    if(mode==='water')state.mode=MODE_SWIM;
    if(mode==='air')state.grounded=false;
    if(mode==='out')state.out=true;
    if(mode==='dead')state.dead=true;
    if(mode==='held')state.held=true;
    conformCreature(rig,state,rig.a,rig.solved,grade,64,0,64,0);
    expect(rig.solved.pos).toEqual(positions);expect(rig.a.rot).toEqual(rotations);expect(rig.a.root).toEqual(root);
  }
});
test('unsupported ground keeps a finite authored pose; identical spatial inputs give identical placement',()=>{
  const rig=quadruped(),st=new AnimState(),world=slope(20,1);
  solve(rig,rig.a,rig.solved);const original=rig.solved.pos.slice();
  conformCreature(rig,st,rig.a,rig.solved,world,64,100,64,0);
  expect(rig.solved.pos).toEqual(original);
  conformCreature(rig,st,rig.a,rig.solved,world,64,0,64,0);
  const expected=rig.solved.pos.slice();rig.a.rest();solve(rig,rig.a,rig.solved);
  conformCreature(rig,st,rig.a,rig.solved,world,64,0,64,0);
  expect(rig.solved.pos).toEqual(expected);checkLengths(rig);
});

test('seat placement and authoritative hit zones follow the same ground-fitted body frame',()=>{
  const rig=quadruped(),anim=new CreatureAnim(rig,5,2),st=new AnimState(),world=slope(25,0),y=groundUnder(world.hf,64,64,.6);
  solve(rig,rig.a,rig.solved);conformCreature(rig,st,rig.a,rig.solved,world,64,y,64,0);
  const expected=new Float64Array(SEAT_FLOATS),actual=new Float64Array(SEAT_FLOATS);
  seatFrame(rig.solved,rig.sockets.get('seat')!,64,y,64,0,expected);
  const cx=64+rig.solved.pos[0]!,cy=y+rig.solved.pos[1]!,cz=64+rig.solved.pos[2]!;
  seatOn(anim,{id:'driver',driver:true,anchor:[0,1.8,0],entry:[1,0,0],socket:'seat'},st,0,64,y,64,0,actual,world);
  expect(actual).toEqual(expected);
  expect(rayCreature(anim,st,0,64,y,64,0,cx,cy,cz-3,0,0,1,6,0,world)).toBe(1);
  expect(zoneHit.t).toBeCloseTo(2.8,5);
});

test('a roof over a lower floor never becomes foot support, while a reachable raised tread supports one leg',()=>{
  const base=flatWorld(),sizes=new Float32Array([0,4,.3]),heights=new Float32Array([0,.1,.125]);
  const world={...base,structs:new StructureStore(base.dims,sizes,heights,sizes)};
  // A floor and a roof occupy the same footprint. The body is supported on the lower surface.
  world.structs.add(1,64,.9,64,0,0,1);
  const rig=quadruped(),st=new AnimState();solve(rig,rig.a,rig.solved);const before=rig.solved.pos.slice();
  conformCreature(rig,st,rig.a,rig.solved,world,64,0,64,0);
  expect(rig.solved.pos).toEqual(before);
  // A separate quarter-metre step under one foot remains reachable below that roof.
  world.structs.add(2,64.6,.125,64.8,0,0,1);
  rig.a.rest();solve(rig,rig.a,rig.solved);conformCreature(rig,st,rig.a,rig.solved,world,64,0,64,0);
  for(const leg of rig.ground!.legs) {
    boneToModel(rig.solved,leg.foot.bone,leg.foot.x,leg.foot.y,leg.foot.z,point);
    const floor=point[0]!>.3 && point[2]!>.5?.25:0;
    expect(Math.abs(point[1]!-floor)).toBeLessThan(.002);
  }
  checkLengths(rig);
});

test('a three-foot-supported body does not pop when an unsupported fourth foot crosses the probe limit',()=>{
  const positions:Float32Array[]=[];
  for(const depth of [1.499,1.501]) {
    const base=flatWorld();
    for(let z=0;z<base.hf.nz;z++)for(let x=0;x<base.hf.nx;x++)base.hf.setSample(x,z,-depth);
    const sizes=new Float32Array([0,.29]),heights=new Float32Array([0,.1]);
    const world={...base,structs:new StructureStore(base.dims,sizes,heights,sizes)};
    // Three foot treads and the movement-supported origin remain at zero, one foot hangs over the drop.
    for(const [x,z]of [[0,0],[-.6,-.8],[.6,-.8],[-.6,.8]])world.structs.add(1,64+x!,-.1,64+z!,0,0,1);
    const rig=quadruped();solve(rig,rig.a,rig.solved);conformCreature(rig,new AnimState(),rig.a,rig.solved,world,64,0,64,0);
    positions.push(rig.solved.pos.slice());checkLengths(rig);
  }
  expect(positions[0]).toEqual(positions[1]);
});

test('an unsupported leg releases continuously at the step limit instead of snapping its knee back', () => {
  const poses: Float32Array[] = [];
  for (const depth of [.449, .451]) {
    const base = flatWorld();
    for (let z = 0; z < base.hf.nz; z++) for (let x = 0; x < base.hf.nx; x++) base.hf.setSample(x, z, -depth);
    const sizes = new Float32Array([0, .29]), heights = new Float32Array([0, .1]);
    const world = { ...base, structs: new StructureStore(base.dims, sizes, heights, sizes) };
    for (const [x, z] of [[0, 0], [-.6, -.8], [.6, -.8], [-.6, .8]]) world.structs.add(1, 64 + x!, -.1, 64 + z!, 0, 0, 1);
    const rig = quadruped(); solve(rig, rig.a, rig.solved);
    conformCreature(rig, new AnimState(), rig.a, rig.solved, world, 64, 0, 64, 0);
    poses.push(rig.solved.pos.slice()); checkLengths(rig);
  }
  for (let i = 0; i < poses[0]!.length; i += 3) {
    const a = poses[0]!, b = poses[1]!;
    expect(Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!)).toBeLessThan(.002);
  }
});

test('the body plane remains continuous when a fading third foot leaves only two limb supports', () => {
  const poses: Float32Array[] = [];
  for (const depth of [.449, .451]) {
    const base = flatWorld();
    for (let z = 0; z < base.hf.nz; z++) for (let x = 0; x < base.hf.nx; x++) base.hf.setSample(x, z, -2);
    const half = new Float32Array([0, .29]), height = new Float32Array([0, .1]);
    const world = { ...base, structs: new StructureStore(base.dims, half, height, half) };
    for (const [x, z] of [[0, 0], [-.6, -.8], [.6, -.8]]) world.structs.add(1, 64 + x!, -.1, 64 + z!, 0, 0, 1);
    world.structs.add(1, 63.4, -depth - .1, 64.8, 0, 0, 1);
    const rig = quadruped(); solve(rig, rig.a, rig.solved);
    conformCreature(rig, new AnimState(), rig.a, rig.solved, world, 64, 0, 64, 0);
    poses.push(rig.solved.pos.slice()); checkLengths(rig);
  }
  for (let i = 0; i < poses[0]!.length; i += 3) {
    const a = poses[0]!, b = poses[1]!;
    expect(Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!)).toBeLessThan(.002);
  }
});

test('distance-driven walking follows the surface arc so planted feet hold on grades, including sub-step juveniles',()=>{
  for(const deg of [30,45])for(const size of [.25,1]) {
    const rig=strider(),anim=new CreatureAnim(rig,99,0),st=new AnimState(),g=new Gait(),world=slope(deg,0);
    const supportRig=quadruped(),co=Math.cos(deg*Math.PI/180),sn=Math.sin(deg*Math.PI/180),velocity=.6*size;
    st.speed=Math.round(velocity/.6);
    let checked=0,worst=0;const tracks:{h:number;y:number;z:number;localZ:number}[][]=[[],[]];
    for(let frame=0;frame<240;frame++) {
      const z=velocity*frame/60,y=world.hf.heightAt(64,64+z),metric=groundSpeedScale(supportRig,st,world,64,y,64+z,0,size);
      expect(metric).toBeCloseTo(1/co,2);
      advanceCreature(anim,g,st,1000+frame/2,64,64+z,0,size,metric);
      creaturePose(anim,st,1000+frame/2,rig.a,g);solve(rig,rig.a,rig.solved);
      for(const [i,bone]of [FOOT_L,FOOT_R].entries()) {
        const localY=rig.solved.pos[bone*3+1]!,localZ=rig.solved.pos[bone*3+2]!;
        tracks[i]!.push({h:localY,y:y+size*(co*localY+sn*localZ),z:z+size*(co*localZ-sn*localY),localZ});
      }
    }
    for(const track of tracks) {
      // The synthetic backstroke is its support phase. Idle blending bows it slightly below the plane.
      const down=(i:number)=>track[i]!.h<=.003 && track[i]!.localZ<=track[i-1]!.localZ;
      for(let i=61;i<track.length-1;i++)if(down(i-1)&&down(i)&&down(i+1)) {
        worst=Math.max(worst,Math.hypot(track[i]!.y-track[i-1]!.y,track[i]!.z-track[i-1]!.z));checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);expect(worst).toBeLessThan(.004);
  }
});

test('a watched death begins from the terrain-fitted living pose without an upright snap', () => {
  const rig = quadruped(), world = slope(25, 0), st = new AnimState();
  const rotations = new Float32Array(rig.bones * 4 * 10);
  for (let i = 3; i < rotations.length; i += 4) rotations[i] = 1;
  const clips = new Map(rig.clips);
  clips.set('death', { id: 'test:quadruped/death', frames: 10, bones: rig.bones, loop: false, rot: rotations, root: new Float32Array(30) });
  const anim = new CreatureAnim({ ...rig, clips }, 5, 2), corpses = new Corpses([anim]), remote = new RemoteSample();
  remote.count = 1; remote.id[0] = 1; remote.kind[0] = 0;
  remote.x[0] = 64; remote.y[0] = 0; remote.z[0] = 64; remote.yaw[0] = 0;
  remote.tick = 100; remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
  corpses.update(remote, world, 64, 60, new Map());
  poseCreatureOn(anim, st, 101, world, 64, 0, 64, 0);
  const expected = rig.solved.pos.slice();
  remote.tick = 101; remote.died = new Map([[1, 101]]); remote.id[0] = 2; remote.cue[0] = CUE_DEAD;
  corpses.update(remote, world, 64, 60, new Map());
  expect(corpses.list.length).toBe(1);
  expect(corpses.list[0]!.watched).toBe(true);
  expect(corpses.list[0]!.solved.pos).toEqual(expected);
  expect(Math.abs(expected[2]!)).toBeGreaterThan(.3);
});

test('native socket particles originate on the terrain-fitted body', () => {
  const rig = quadruped(), world = slope(25, 0), anim = new CreatureAnim(rig, 5, 2), st = new AnimState();
  const kind = world.reg.index.get('core:dodo')!, details: PackDetails = {
    atlas: { offset: 0, side: 128 }, inputs: '',
    pictures: [{ id: 'test:mark', cell: 0, regions: [-1, -1], grey: 1, flat: 0 }],
    effects: [effectOf('test:mark', { pictures: ['mark'], count: 1, gravity: 0, speed: 0, colour: [255, 255, 255] }, () => 0)],
    sheets: [{ owner: 'core:dodo', cues: { struck: { effects: [{ effect: 0, from: 'seat', at: 'now' }] } } }],
  };
  const effects = new Details(world.reg, details, new Uint8Array(256 * 3), k => k === kind ? anim : null);
  const remote = new RemoteSample(), packet = new FramePacket(), camera = new Camera();
  camera.x = 64; camera.y = 2; camera.z = 60;
  remote.count = 1; remote.id[0] = 1; remote.kind[0] = kind;
  remote.x[0] = 64; remote.y[0] = 0; remote.z[0] = 64;
  remote.tick = 100; remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
  effects.frame(packet, camera, remote, [], [], null, world.hf, tierOf('medium'), 100 * 1000 / 30, world);
  st.layer = LAYER_FLINCH; st.layerStart = 101;
  remote.tick = 101; remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
  poseCreatureOn(anim, st, 101, world, 64, 0, 64, 0);
  const seat = rig.sockets.get('seat')!;
  boneToModel(rig.solved, seat.bone, seat.x, seat.y, seat.z, point);
  const expected = [64 + point[0]!, point[1]!, 64 + point[2]!];
  effects.frame(packet, camera, remote, [], [], null, world.hf, tierOf('medium'), 101 * 1000 / 30, world);
  expect(effects.pool.count).toBe(1);
  expect([effects.pool.x[0], effects.pool.y[0], effects.pool.z[0]]).toEqual(expected);
});

test('footfall occasions follow the visible gait and retain juvenile size instead of running a second clock', () => {
  const rig = strider(), anim = new CreatureAnim(rig, .1, 0), drawn = Object.assign(new Gait(), { domain: creatureFootfallDomain(anim, new AnimState(), 0) });
  const occasions = new Occasions([anim], new Uint16Array([1]), o => o === 'step' ? 1 : 0, new Float32Array([.25]), () => drawn);
  const remote = new RemoteSample(), st = new AnimState(), feet: number[] = [];
  remote.count = 1; remote.id[0] = 1; remote.kind[0] = 0;
  remote.x[0] = 64; remote.z[0] = 64; remote.span[0] = 1000; remote.grown[0] = 1100;
  remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
  // A small body's replicated speed may round to zero while its visible legs are moving.
  drawn.speed = 2;
  for (const [frame, phase] of [.45, .51, .57, .99, .02].entries()) {
    remote.tick = drawn.tick = 100 + frame; drawn.phase = phase;
    occasions.update(remote, [], [], null, 64, 2, 60, remote.tick * 1000 / 30);
    expect(drawn.phase).toBe(phase);
    for (const h of occasions.happened) {
      expect(h.occasion).toBe('step'); expect(h.size).toBeGreaterThanOrEqual(.25); expect(h.size).toBeLessThan(.26);
      feet.push(h.foot);
    }
  }
  expect(feet).toEqual([FOOT_R, FOOT_L]);
});
