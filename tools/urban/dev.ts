// The actual SNARK app/server with two compact cars and paved strips seeded near spawn, on the ordinary client build:
// the car is in the core pack like any other asset. The development save stays inside this checkout.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEV_CONFIG, liveFileOf, startServer } from "../../server/main.ts";
import { formatReport, loadConfigFolder } from "../../server/settings/config.ts";
import { stopOnSignals } from "../../server/signals.ts";
import type { Host } from "../../server/host.ts";
import { seedUrbanRoads } from "./fixtures.ts";
import { buildClient } from "../build-client.ts";

/** Place a small development fixture in the real map, once per isolated save. Normal players/dinos/resources remain. */
export function seedUrbanVehicles(host:Host):void {
  const kind=host.world.reg.index.get("core:compact");
  if(kind===undefined)throw new Error("the real content registry does not contain core:compact");
  if([...host.records.byPid.values()].some((record)=>record.kind===kind))return;
  const spawn=host.world.spawn;
  const car=host.spawnVehicle("core:compact",spawn.x-3,spawn.z+6,0,0);
  const free=host.spawnVehicle("core:compact",spawn.x+4,spawn.z+6,0,0);
  if(car<0||free<0)throw new Error("could not place the development cars near the map spawn");
  const name=(entity:number,label:string):void=>{
    const record=host.records.byPid.get(host.world.ents.pid[entity]!);if(!record)return;
    record.name=label;host.records.dirty.add(record.pid);
    host.world.ents.setLook(entity,record.genome?.level??1,record.genome?.colors??null,label);
  };
  name(car,"Mara's compact");name(free,"Spare compact");
  if(host.world.reg.index.has("core:civilian")){
    for(const [seat,side,label]of[["driver",1,"Mara"],["passenger",-1,"Eli"]]as const){
      const actor=host.spawnCreature("core:civilian",spawn.x-3+side*1.25,spawn.z+6+.12,1);
      if(actor>=0){name(actor,label);console.log(`${label} ${seat} request: ${host.urban.seatNpc(actor,car,seat)}`);}
    }
  }
  console.log(`Compact cars added to ${host.world.mapId} near its existing spawn (${spawn.x}, ${spawn.z}).`);
}

if(import.meta.main){
  const args=process.argv.slice(2);
  const value=(key:string):string|undefined=>{const at=args.indexOf(key);return at>=0?args[at+1]:undefined;};
  const root=resolve(import.meta.dir,"../..");
  console.log(JSON.stringify(await buildClient({quick:true})));
  const folder=value("--config")??DEV_CONFIG,{rules,report}=loadConfigFolder(folder,args);
  for(const line of formatReport(report,rules))console.log(line);
  const dbPath=resolve(value("--db")??resolve(root,"var/urban-v1/world.db"));mkdirSync(dirname(dbPath),{recursive:true});
  const live=liveFileOf(folder),map=value("--map");
  const server=startServer({dev:true,hostname:value("--host")??"127.0.0.1",port:Number(value("--port")??process.env.PORT??8787),dbPath,config:rules,...(live?{live}:{}),...(map?{map:resolve(map)}:{})});
  try{seedUrbanVehicles(server.host);const roads=seedUrbanRoads(server.host);if(roads)console.log(`Added ${roads} native paving pieces southeast of spawn: asphalt, gravel, mud.`);}catch(error){server.stop();throw error;}
  stopOnSignals(()=>server.stop());
  console.log(`SNARK with compact vehicles: http://localhost:${server.port}`);
  console.log(`Isolated save: ${dbPath}`);
}
