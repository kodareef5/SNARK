import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import type { CreatureAsset, MaterialSpec, ZoneSpec } from "../../../../../tools/art/spec.ts";

const material = (name: string, dyed = true): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`,
  packed: `tex/${name}_packed.png`, height: `tex/${name}_height.png`,
  ...(dyed ? { regions: { mask: `tex/${name}_mask.png`, mask2: `tex/${name}_mask2.png` },
    hurt: `tex/${name}_hurt.png`, decay: `tex/${name}_decay.png` } : {}),
});
const palette = defaultPalette();
const samples = [0x586345,0x8e713e,0x6f482e,0xa28c51,0x453a31,0xbcaa7b]
  .map(rgb => nearestColour(palette,rgb>>16,(rgb>>8)&255,rgb&255));
const looped = new Set(["idle","walk","run","swim","swim_idle","fall","torpor_idle"]);
const limb: ZoneSpec[] = [];
for (const [side,arm,hand,leg,foot] of [["l","armL","handL","legL","footL"],["r","armR","handR","legR","footR"]] as const) {
  for (const [kind,shaft,pad] of [["fore",arm,hand],["hind",leg,foot]] as const) {
    for (const part of ["upper","lower","foot"]) {
      const bone = kind+"_"+part+"_"+side;
      limb.push({zone:part==="foot" ? pad : shaft,on:bone,covers:[bone]});
    }
  }
}
export default {
  kind:"creature",source:{scripts:["rig.py","model.py","saddle.py","clips.py"]},scale:1,
  skeleton:{id:"carbonemys",root:"shell",bones:23},
  zones:[
    {zone:"torso",on:"shell",a:[0,.405,-.86],b:[0,.405,.72],radius:.592},
    {zone:"torso",on:"shell_l",a:[.019,.060,-.68],b:[.019,.060,.70],radius:.535},
    {zone:"torso",on:"shell_r",a:[-.019,.060,-.68],b:[-.019,.060,.70],radius:.535},
    {zone:"torso",on:"plastron",a:[0,.075,-1.01],b:[0,.075,1.00],radius:.231},
    ...["neck_1","neck_2","neck_3","skull","jaw"].map(on=>({zone:"head" as const,on,covers:[on]})),
    ...["tail_1","tail_2"].map(on=>({zone:"tail" as const,on,covers:[on]})),...limb,
  ],
  sockets:[
    {name:"head",bone:"skull",offset:[0,.10,.22]},
    {name:"mouth",bone:"skull",offset:[0,-.055,.608]}, {name:"beak_tip",bone:"skull",offset:[0,-.055,.608]},
    {name:"overhead",bone:"shell",offset:[0,1.40,0]}, {name:"vent",bone:"tail_1",offset:[0,-.11,-.095]},
    {name:"seat",bone:"shell",offset:[0,1.186,.73]},
    {name:"grip_l",bone:"shell",offset:[.224,1.377,1.042]}, {name:"grip_r",bone:"shell",offset:[-.224,1.377,1.042]},
    {name:"rest_l",bone:"shell",offset:[.270,.562,1.260]}, {name:"rest_r",bone:"shell",offset:[-.270,.562,1.260]},
    ...["l","r"].flatMap(side=>["fore","hind"].map(kind=>({name:kind+"_foot_"+side,bone:kind+"_foot_"+side,
      offset:[(side==="l"?1:-1)*.083,-.100,.199] as [number,number,number]}))),
  ],
  regions:["Body","Hide markings","Shell base","Shell growth","Shell margins","Underside"].map((name,i)=>({name,material:"region_"+i,sample:samples[i]!})),
  materials:{carapace:material("carapace"),turtle_hide:material("turtle_hide")},
  clips:["idle","idle_look","walk","run","turn","swim","swim_idle","attack","retract","call","startled","flinch","fall","land","torpor_in","torpor_idle","torpor_eat","torpor_out","death"]
    .map(name=>({name,source:name,loop:looped.has(name)})),
  feet:["fore_foot_l","fore_foot_r","hind_foot_l","hind_foot_r"],
  gaits:{walk:{stride:1.26},run:{stride:1.26},swim:{stride:3.20,stated:"Webbed feet paddle freely in water at 3.2 metres per second."}},
  budgets:{triangles:[21500,7200,3000,1250,500,400],texture:{top:1024,megabytes:45,layer:256}},flat:3,
  ragdoll:{limp:43,bodies:[{bone:"shell",mass:.86},{bone:"skull",mass:.1,swing:105,twist:69},{bone:"tail_1",mass:.04,swing:65,twist:40}]},
  worn:[{item:"core:saddle_carbonemys",object:"saddle",materials:{turtle_saddle:material("turtle_saddle",false)},budgets:{triangles:[4800,1500,600,170]}}],
} satisfies CreatureAsset;
