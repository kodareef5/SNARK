// The authoritative seated pose resolves the same native hand mesh and actual look as the renderer.
import {HUMAN,SLOT_HANDS} from "../shared/anim/human.ts";
import {LOOK_SEX,SEX_IDS} from "../shared/anim/look.ts";
import {RiderGrips} from "../shared/anim/rider-grips.ts";
import {RIDER_GRIPS,RIDER_GRIP_RADIUS,RIDER_GRIP_LOW,RIDER_GRIP_HIGH,RIDER_FOREARM_ALIGNMENT} from "../shared/anim/rider-controls.ts";
import type {Registry} from "../shared/content/registry.ts";
import {fillSlot,slotsOf} from "../shared/content/slots.ts";
import type {PackGrip,PackRig} from "../shared/pack/pack.ts";
import {GEAR_WORN} from "../shared/sim/entities.ts";
import type {EntityRecord} from "./records.ts";

interface Body {bare:PackGrip|null;worn:Map<number,PackGrip|null>}
export class SeatedGrips {
  private readonly bodies=new Map<number,Body>();
  private readonly cache=new WeakMap<EntityRecord,RiderGrips>();
  constructor(reg:Registry,rigs:readonly PackRig[]){
    const meshes=new Map<string,PackGrip>();
    for(const rig of rigs)if(rig.skeleton===HUMAN.id)for(const grip of rig.grips??[])meshes.set(grip.mesh,grip);
    if(meshes.size===0)return;
    const slots=slotsOf(reg.defs.filter(d=>d!==null)),has=(_:unknown,id:string):boolean=>meshes.has(id);
    for(let kind=0;kind<reg.defs.length;kind++){
      const d=reg.defs[kind];if(d?.type!=="species"||d.skeleton!==HUMAN.id)continue;
      for(let sex=0;sex<SEX_IDS.length;sex++){
        const use=slots.find(u=>u.owner===d.id&&u.slot==="body"&&u.key===`${SEX_IDS[sex]}/hands`),bare=use?meshes.get(fillSlot(use,has).id):undefined;
        const body=`${d.mesh}_${SEX_IDS[sex]}`.replace(/^[^:]*:/,""),worn=new Map<number,PackGrip|null>();
        for(let item=0;item<reg.defs.length;item++){
          const def=reg.defs[item];if(def?.type!=="item"||def.wear?.slot!=="hands")continue;
          const use=slots.find(u=>u.owner===def.id&&u.slot==="worn"&&u.key===body),grip=use?meshes.get(use.id):undefined;
          // An uncalibrated worn hand must not borrow the bare hand's offsets.
          worn.set(item,grip??null);
        }
        this.bodies.set(kind*2+sex,{bare:bare??null,worn});
      }
    }
  }
  of(rec:EntityRecord,gear:Uint16Array|undefined,targets:Float64Array):Float64Array|null {
    if((targets[0]!&RIDER_GRIPS)===0)return null;
    const sex=rec.look?.[LOOK_SEX]??0,body=this.bodies.get(rec.kind*2+(sex<2?sex:0));if(!body)return null;
    const item=gear?.[GEAR_WORN+SLOT_HANDS]??0,profile=body.worn.has(item)?body.worn.get(item)!:body.bare;
    let cached=this.cache.get(rec);if(!cached)this.cache.set(rec,cached=new RiderGrips());
    return cached.update(profile,rec.look,targets[RIDER_GRIP_RADIUS]!,targets[RIDER_GRIP_LOW]!,targets[RIDER_GRIP_HIGH]!,0,targets[RIDER_FOREARM_ALIGNMENT]??0);
  }
}
