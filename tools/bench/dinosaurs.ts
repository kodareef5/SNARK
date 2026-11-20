// Native rider/creature crowd costs. Run alone with bun tools/bench/dinosaurs.ts after the final packs are built.
import { cpus } from "node:os";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { creatureAnims } from "../../shared/anim/creature.ts";
import { layCorpse } from "../../shared/anim/corpse.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { defaultLook, LOOK_BYTES, LOOK_SEX } from "../../shared/anim/look.ts";
import { F_AWAKE, F_GROUNDED, F_PLAYER, GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ACT_DRAW, ACT_HOLD, ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { corePack, corePackBytes } from "../../tests/fixtures/pack.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { asTextured } from "./base.ts";
import { ART } from "../art/source.ts";

type Row = (name: string, value: number, unit: string, budget?: number | null) => void;
const quantile = (values: number[], q: number): number => values.sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*q))]!;

export function benchDinosaurs(section: (name: string) => void, record: Row): void {
  if (!ART) throw new Error("This benchmark requires the original creature packs under assets/source.");
  const reg = coreRegistry(), kinds = [reg.index.get("core:trike"), reg.index.get("core:stego")].filter((k): k is number => k !== undefined);
  if (!kinds.length) return;
  section("Native dinosaur crowd: sixteen moving saddled animals and sixteen fitted riders");
  const pack = corePack();
  for (const terrain of ["level", "grade"]) for (const tier of ["lowpoly", "medium"]) {
    const hf = new Heightfield({ chunksX: 4, chunksZ: 4 }, 2, -32, 1/256);
    for (let z=0; z<hf.nz; z++) for (let x=0; x<hf.nx; x++) hf.setSample(x,z,1+(terrain==="grade" ? .18*(z*hf.cell-94)+.07*(x*hf.cell-128) : 0));
    const scene = new Scene({ dims:hf.dims, hf, structs:new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) }, reg, pack);
    scene.assets.tier = tierOf(tier); scene.viewHeight = 720; scene.hour = 12; asTextured(scene);
    for (const kind of kinds) if (terrain==="grade" && !scene.characters.creature(kind)?.rig.ground) throw new Error(`Native grade benchmark requires authored ground metadata for ${reg.ids[kind]}`);
    const cam = new Camera(); cam.x=128; cam.y=6; cam.z=56; cam.yaw=0; cam.pitch=-.08; cam.aspect=16/9;
    const remote = new RemoteSample(), st = new AnimState(), human=reg.index.get("core:survivor")!, look=defaultLook();
    for (let k=0; k<16; k++) {
      const mount=k*2, rider=mount+1, kind=kinds[k%kinds.length]!;
      for (const i of [mount,rider]) { remote.id[i]=100+i; remote.gen[i]=1; remote.x[i]=107+(k%8)*6; remote.y[i]=1; remote.z[i]=94+Math.floor(k/8)*18; remote.flags[i]=1; }
      remote.kind[mount]=kind; remote.gear[mount*GEAR_COUNT+GEAR_WORN]=reg.saddleFits.indexOf(kind);
      remote.kind[rider]=human; remote.seat[rider]=remote.id[mount]!+1; remote.seatSlot[rider]=1; remote.seatGen[rider]=1;
      remote.hasLook[rider]=1; remote.look.set(look,rider*LOOK_BYTES); remote.look[rider*LOOK_BYTES+LOOK_SEX]=k%2;
    }
    remote.count=32;
    const times:number[]=[], visible=new Uint8Array(32); let dropped=0, bones=0, triangles=0, posed=0, missing=0;
    for (let frame=0; frame<420; frame++) {
      remote.tick=frame*.5; scene.now=frame*1000/60;
      for (let k=0; k<16; k++) {
        const i=k*2, kind=remote.kind[i]!, age=frame%60;
        st.unpack(0); st.grounded=true; st.speed=4;
        st.setAction(age<24 ? ACT_SWING : ACT_NONE,0,Math.floor(remote.tick-age*.5));
        remote.anim[i]=st.pack(); remote.cue[i]=st.packCue();
        remote.z[i]=94+Math.floor(k/8)*18+Math.sin(frame/90)*2;
        remote.yaw[i]=(k%2 ? -.15:.15)+Math.sin(frame/120)*.1;
        remote.y[i]=groundUnder(hf,remote.x[i]!,remote.z[i]!,reg.move[kind]!.radius);
        remote.x[i+1]=remote.x[i]!; remote.y[i+1]=remote.y[i]!; remote.z[i+1]=remote.z[i]!;
        if (!reg.combat[kind]) throw new Error("Native crowd requires an authored combat species");
      }
      const t=performance.now(), p=scene.build(cam,remote);
      if (frame>=120) {
        times.push(performance.now()-t); dropped=Math.max(dropped,p.dropped); bones=Math.max(bones,p.boneCount); triangles=Math.max(triangles,p.triangles); posed=Math.max(posed,scene.characters.posed);
        // Validate every measured frame outside the timed scene call: no speed-up through quietly omitted animals/riders.
        visible.fill(0);
        for(let at=0;at<p.transientCount;at++) { const id=p.transientIds[at]!-100; if(id>=0&&id<32) visible[id]=1; }
        let absent=0; for(const drawn of visible) absent+=1-drawn;
        missing=Math.max(missing,absent);
      }
    }
    record(`${tier} ${terrain}: native crowd frame median`,quantile(times,.5),"ms",4);
    record(`${tier} ${terrain}: native crowd frame p99`,quantile(times,.99),"ms",8);
    record(`${tier} ${terrain}: visible bodies posed, maximum`,posed,"bodies");
    record(`${tier} ${terrain}: bones, maximum`,bones,"bones",scene.assets.tier.bones);
    record(`${tier} ${terrain}: triangles, maximum`,triangles,"triangles");
    record(`${tier} ${terrain}: dropped draws/bodies`,dropped,"",0);
    record(`${tier} ${terrain}: missing crowd identities in any measured frame`,missing,"bodies",0);
  }
  benchDinosaurFalls(kinds, section, record);
  benchDinosaurCombat(kinds.map(k => reg.ids[k]!), section, record);
}

/** Native compound contacts, stepped and posed for every body. This measures physics CPU, not rasterization. */
function benchDinosaurFalls(kinds: readonly number[], section: (name: string) => void, record: Row): void {
  section("Native dinosaur falls: sixteen actual compound ragdolls");
  const reg = coreRegistry(), pack = corePack(), rigs = buildRigs(pack.header.rigs, pack.clips);
  const anims = creatureAnims(reg, d => rigs.get(d.mesh));
  for (const terrain of ["level", "grade"]) {
    const hf = new Heightfield({ chunksX: 4, chunksZ: 4 }, 2, -32, 1/256);
    for (let z=0; z<hf.nz; z++) for (let x=0; x<hf.nx; x++) hf.setSample(x,z,1+(terrain==="grade" ? .18*(z*hf.cell-94)+.07*(x*hf.cell-128) : 0));
    const world = { hf, structs:new StructureStore(hf.dims,reg.halfX,reg.halfY,reg.halfZ,null,reg.parts) };
    const drop = () => Array.from({ length:16 }, (_,i) => {
      const kind=kinds[i%kinds.length]!, anim=anims[kind];
      if(!anim?.death || !anim.rig.ragdoll) throw new Error(`Native falling benchmark requires death and ragdoll data for ${reg.ids[kind]}`);
      const x=72+i%4*36, z=72+Math.floor(i/4)*36, size=i%4===3 ? .5:1, solved=new Solved(anim.rig.bones);
      const doll=layCorpse(anim,false,false,x,groundUnder(hf,x,z,reg.move[kind]!.radius*size),z,i*.7,size,solved);
      if(!doll) throw new Error(`Native falling benchmark did not initialize ${reg.ids[kind]}`);
      return { doll,solved };
    });
    // Warm two complete falls, then measure the same unskipped first second and eventual sleep cost of a fresh set.
    for(let warm=0;warm<2;warm++) {
      const set=drop();
      for(let frame=0;frame<180;frame++) for(const d of set) if(d.doll.step(world,1/60)) d.doll.pose(d.solved);
    }
    const set=drop(), falling:number[]=[], resting:number[]=[];
    let sleepingAtThree=0;
    for(let frame=0;frame<240;frame++) {
      const t=performance.now();
      for(const d of set) if(d.doll.step(world,1/60)) d.doll.pose(d.solved);
      const elapsed=performance.now()-t;
      if(frame<60) falling.push(elapsed);
      if(frame>=180) resting.push(elapsed);
      if(frame===179) for(const d of set) if(!d.doll.awake) sleepingAtThree++;
    }
    let bodies=0,contacts=0,nonfinite=0;
    for(const d of set) {
      bodies+=d.doll.n; contacts+=d.doll.def.contacts?.length ?? 0;
      for(const value of d.solved.pos) if(!Number.isFinite(value)) nonfinite++;
      for(const value of d.solved.rot) if(!Number.isFinite(value)) nonfinite++;
    }
    record(`${terrain}: sixteen native falls, frame median`,quantile(falling,.5),"ms",1);
    record(`${terrain}: sixteen native falls, frame p99`,quantile(falling,.99),"ms");
    record(`${terrain}: sixteen native rests, frame median`,quantile(resting,.5),"ms",.05);
    record(`${terrain}: native articulated masses`,bodies,"bodies");
    record(`${terrain}: native rigid contact capsules`,contacts,"capsules");
    record(`${terrain}: native falls still awake after three seconds`,16-sleepingAtThree,"animals",0);
    record(`${terrain}: nonfinite native fallen pose values`,nonfinite,"",0);
  }
}

/** The whole authoritative tick, including tactical movement, posed contacts, ordinary damage and snapshot work. */
function benchDinosaurCombat(species: readonly string[], section: (name: string) => void, record: Row): void {
  section("Native dinosaur authority: sixteen hunting animals with persistent living targets");
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap()) });
  try {
    const ada = h.join("observer"); h.run(300);
    h.host.survival.gods.add(h.client(ada)!.pid);
    const ents = h.world.ents, attackers: number[] = [], acting = new Set<number>();
    for (let i=0; i<16; i++) {
      const x=72+i%4*36, z=72+Math.floor(i/4)*36, id=species[i%species.length]!;
      const e=h.host.spawnCreature(id,x,z,1);
      if(e<0) throw new Error(`Native combat benchmark could not place ${id}`);
      attackers.push(e);
      const combat=h.reg.combat[ents.kind[e]!]!, ai=combat.ai!.primary;
      if(!ai) throw new Error(`Native combat benchmark requires tactical primary data for ${id}`);
      const bearing=ai.bearing*Math.PI/180, distance=combat.charge && i%4===0 ? 12 : ai.distance;
      const target=h.host.records.create(h.reg.index.get("core:survivor")!);
      target.x=x+Math.sin(bearing)*distance; target.y=0; target.z=z+Math.cos(bearing)*distance;
      const victim=ents.create(target.kind,target.x,0,target.z,F_PLAYER|F_AWAKE|F_GROUNDED);
      ents.pid[victim]=target.pid; h.host.records.entOf.set(target.pid,victim); h.host.survival.init(target);
      // Keep the same sixteen targets alive throughout; contacts still execute normal health/damage accounting.
      target.vitals!.max[V_HEALTH]=target.vitals!.value[V_HEALTH]=10000*1e6;
      ents.pose(victim,h.world.tick);
      h.host.creatures.provoke(e,target.x,target.z,victim);
    }
    const times:number[]=[], original=h.server.tick.bind(h.server), hits=h.host.combat.hits;
    let ticks=0;
    h.server.tick=()=>{
      const t=performance.now(); original(); const elapsed=performance.now()-t;
      if(ticks++>=90) times.push(elapsed);
      for(const e of attackers) if(ents.act[e]===ACT_SWING || ents.act[e]===ACT_DRAW || ents.act[e]===ACT_HOLD) acting.add(e);
    };
    h.run(15000);
    h.server.tick=original;
    record("sixteen native hunters: server tick median",quantile(times,.5),"ms",8);
    record("sixteen native hunters: server tick p99",quantile(times,.99),"ms",16);
    record("native hunters without an observed attack",16-acting.size,"animals",0);
    record("native combat contacts resolved",h.host.combat.hits-hits,"hits");
    record("native combat scenario produced no contacts",h.host.combat.hits===hits ? 1 : 0,"",0);
  } finally { h.host.shutdown(); }
}

if (import.meta.main) {
  const rows:{name:string;value:number;unit:string;budget:number|null}[]=[];
  benchDinosaurs(console.log, (name,value,unit,budget=null)=>{ rows.push({name,value,unit,budget}); console.log(`${name}: ${value.toFixed(3)} ${unit}${budget===null ? "" : ` / ${budget}`}`); });
  const corePackSha256=createHash("sha256").update(corePackBytes()).digest("hex"), contentSha256=createHash("sha256").update(JSON.stringify(CORE_CONTENT)).digest("hex");
  mkdirSync("artifacts",{recursive:true}); writeFileSync("artifacts/bench-dinosaurs.json",JSON.stringify({machine:cpus()[0]?.model,bun:Bun.version,corePackSha256,contentSha256,rows},null,2)+"\n");
  if(rows.some(r=>r.budget!==null&&r.value>r.budget)) process.exitCode=1;
}
