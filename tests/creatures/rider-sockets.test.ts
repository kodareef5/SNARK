import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { riderTargets, SEAT_DROP } from "../../shared/anim/seat.ts";
import { RIDER_TARGET_FLOATS, RIDER_HANDS, RIDER_FEET, RIDER_KNEES, RIDER_SOLES, RIDER_GRIPS } from "../../shared/anim/rider-controls.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { validateSeats, type Seat } from "../../shared/sim/seats.ts";

const contacts = [[.19, .31, .27], [-.19, .31, .27], [.42, -.4, .38], [-.42, -.4, .38], [.48, -.08, .27], [-.48, -.08, .27]] as const;
const names = ["palm_l", "palm_r", "ankle_l", "ankle_r", "knee_l", "knee_r"];
const source: PackRig = { id: "test:saddle", skeleton: "test:saddle", names: ["root"], parent: [-1], rest: [0, 0, 0], caps: [],
  sockets: [{ name: "seat", bone: 0, x: 0, y: 3, z: 0 }, ...contacts.map((p, i) => ({ name: names[i]!, bone: 0, x: p[0], y: p[1] + 3, z: p[2] }))],
};
const seat: Seat = { id: "driver", driver: true, anchor: [0, 3, 0], entry: [2, 0, 0], socket: "seat",
  rider: { hands: ["palm_l", "palm_r"], feet: ["ankle_l", "ankle_r"], knees: ["knee_l", "knee_r"] },
};

test("named saddle contacts retain the rider origin drop and move with the complete seat frame", () => {
  const rig = buildRigs([source], NO_CLIPS).get(source.id)!, out = new Float64Array(RIDER_TARGET_FLOATS);
  for (const angle of [0, -.5, .6]) {
    quatAxis(rig.a.rot, 0, 1, 0, 0, angle); rig.a.root.set([1, .2, -.4]);
    solve(rig, rig.a, rig.solved);
    expect(riderTargets(rig, rig.solved, seat, out)).toBe(true);
    expect(out[0]).toBe(RIDER_HANDS | RIDER_FEET | RIDER_KNEES);
    for (let i = 0; i < contacts.length; i++) for (let axis = 0; axis < 3; axis++) expect(out[1 + i * 3 + axis]).toBeCloseTo(contacts[i]![axis]! + (axis === 1 ? SEAT_DROP : 0), 5);
  }
  expect(riderTargets(rig, rig.solved, { ...seat, rider: { ...seat.rider!, feet: ["missing", "ankle_r"] } }, out)).toBe(false);
  expect(out[0]).toBe(0);
});

test("rider contacts are opt-in saddle geometry and require paired named points and a seat socket", () => {
  expect(() => validateSeats([seat], 0, "saddle")).not.toThrow();
  expect(() => validateSeats([seat], 0, "vehicle")).toThrow("rider sockets");
  expect(() => validateSeats([{ ...seat, socket: undefined }], 0, "saddle")).toThrow("rider sockets");
  expect(() => validateSeats([{ ...seat, rider: { ...seat.rider!, hands: ["same", "same"] } }], 0, "saddle")).toThrow("rider sockets");
});

test("finite sole supports follow the complete seat frame and missing supports preserve ordinary ankle targets", () => {
  const spec = structuredClone(source);
  spec.sockets!.push({name:"sole_l",bone:0,x:.42,y:2.627,z:.51},{name:"sole_r",bone:0,x:-.42,y:2.627,z:.51});
  const supported: Seat = {...seat,rider:{...seat.rider!,soles:{sockets:["sole_l","sole_r"],half:[.15,.13]}}};
  const rig = buildRigs([spec],NO_CLIPS).get(spec.id)!, out = new Float64Array(RIDER_TARGET_FLOATS);
  for (const angle of [-.8,0,.8]) {
    quatAxis(rig.a.rot,0,0,0,1,angle); solve(rig,rig.a,rig.solved);
    expect(riderTargets(rig,rig.solved,supported,out)).toBe(true); expect(out[0]! & RIDER_SOLES).toBe(RIDER_SOLES);
    expect(out[19]).toBeCloseTo(.42,5); expect(out[20]).toBeCloseTo(.55-.373,5); expect(out[21]).toBeCloseTo(.51,5);
    expect([...out.slice(25,27)]).toEqual([.15,.13]);
  }
  (rig.sockets as Map<string,unknown>).delete("sole_l");
  expect(riderTargets(rig,rig.solved,supported,out)).toBe(true); expect(out[0]! & RIDER_SOLES).toBe(0);
  for (const half of [[0,.1],[Infinity,.1],[-.1,.1],[1.01,.1]]) expect(() => validateSeats([{...supported,rider:{...supported.rider!,soles:{...supported.rider!.soles!,half:half as [number,number]}}}],0,"saddle")).toThrow("sole supports");
});


test("upright native grip hardware follows the seat frame and rejects invalid dimensions or independently moving bars", () => {
  const supported:Seat={...seat,rider:{...seat.rider!,grips:{radius:.018,span:[-.11,.11]}}};
  expect(()=>validateSeats([supported],0,"saddle")).not.toThrow();
  const rig=buildRigs([source],NO_CLIPS).get(source.id)!,out=new Float64Array(RIDER_TARGET_FLOATS);
  for(const angle of [-.8,0,.8]){
    quatAxis(rig.a.rot,0,0,0,1,angle);solve(rig,rig.a,rig.solved);
    expect(riderTargets(rig,rig.solved,supported,out)).toBe(true);expect(out[0]!&RIDER_GRIPS).toBe(RIDER_GRIPS);expect([...out.slice(27,30)]).toEqual([.018,-.11,.11]);
  }
  for(const radius of [0,-.02,Infinity,.051])expect(()=>validateSeats([{...supported,rider:{...supported.rider!,grips:{radius,span:[-.11,.11]}}}],0,"saddle")).toThrow("grips");
  for(const span of [[0,.1],[-.1,0],[-.31,.1],[-.1,Infinity]])expect(()=>validateSeats([{...supported,rider:{...supported.rider!,grips:{radius:.018,span:span as[number,number]}}}],0,"saddle")).toThrow("grips");
  const moving=structuredClone(source);moving.names!.push("lever");moving.parent!.push(0);moving.rest.push(0,3,0);moving.sockets!.find(s=>s.name==="palm_l")!.bone=1;
  const independent=buildRigs([moving],NO_CLIPS).get(moving.id)!;solve(independent,independent.a,independent.solved);
  expect(riderTargets(independent,independent.solved,supported,out)).toBe(true);expect(Number.isNaN(out[27])).toBe(true);
});


test("forearm alignment is explicit bounded saddle metadata and reused targets cannot retain it",()=>{
 const rig=buildRigs([source],NO_CLIPS).get(source.id)!,out=new Float64Array(RIDER_TARGET_FLOATS);solve(rig,rig.a,rig.solved);
 for(const forearmAlignment of [0,75,90]){
  const aligned:Seat={...seat,rider:{...seat.rider!,grips:{radius:.017,span:[-.12,.13],forearmAlignment}}};
  expect(()=>validateSeats([aligned],0,"saddle")).not.toThrow();expect(riderTargets(rig,rig.solved,aligned,out)).toBe(true);expect(out[30]).toBe(forearmAlignment);
 }
 for(const forearmAlignment of [-.01,90.01,NaN,Infinity])expect(()=>validateSeats([{...seat,rider:{...seat.rider!,grips:{radius:.017,span:[-.12,.13],forearmAlignment}}}],0,"saddle")).toThrow("forearm alignment");
 expect(riderTargets(rig,rig.solved,seat,out)).toBe(true);expect(out[30]).toBe(0);
});
