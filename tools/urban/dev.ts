import { writeAirYard } from "./air-yard.ts";
import { writeVehicleYard } from "./tanker-yard.ts";
// The ordinary game with a local test drive near spawn. --fleet parks the road fleet in their own save.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEV_CONFIG, liveFileOf, startServer } from "../../server/main.ts";
import { formatReport, loadConfigFolder } from "../../server/settings/config.ts";
import { stopOnSignals } from "../../server/signals.ts";
import type { Host } from "../../server/host.ts";
import { seedRoadFleet, seedUrbanRoads } from "./fixtures.ts";
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
  const fleet = args.includes("--fleet"), tanker=args.includes("--tanker"), freight=args.includes("--freight"), cars=args.includes("--cars");
  const clientDir=resolve(value("--dist")??resolve(root,"client/dist"));
  if (!args.includes("--built")) console.log(JSON.stringify(await buildClient({quick:true,dist:clientDir})));
  else if (!existsSync(resolve(clientDir, "assets/manifest.json"))) throw new Error("Run without --built to prepare the client.");
  const folder=value("--config")??DEV_CONFIG,{rules,report}=loadConfigFolder(folder,args);
  for(const line of formatReport(report,rules))console.log(line);
  const air = args.includes("--air-support");
  const layout = cars ? "cars" : freight ? "freight" : tanker ? "tanker" : undefined;
  const yard = air ? "air-freight" : cars ? "street-yard" : freight ? "freight-yard" : tanker ? "tanker-yard" : fleet ? "road-fleet" : "urban-v1";
  const dbPath = resolve(value("--db") ?? resolve(root, "var", yard, "world.db"));
  mkdirSync(dirname(dbPath), { recursive: true });
  const live = liveFileOf(folder);
  const course = resolve(root, "var", yard, "course.snmp");
  const map = value("--map") ?? (air ? writeAirYard(course) : layout ? writeVehicleYard(course, layout) : undefined);
  const server=startServer({clientDir,dev:true,hostname:value("--host")??"127.0.0.1",port:Number(value("--port")??process.env.PORT??8787),dbPath,config:rules,...(live?{live}:{}),...(map?{map:resolve(map)}:{})});
  try {
    if (freight || cars) {
      const {world,records}=server.host;
      const bays = cars ? [["core:monster_truck",-5,5],["core:muscle_car",0,7],["core:taxi",5,5]] as const :
        [["core:bus",-3.3,4],["core:semi",4.5,6]] as const;
      for (const [id,dx,dz] of bays) {
        if (![...records.byPid.values()].some(r=>r.kind===world.reg.index.get(id)) &&
            server.host.spawnVehicle(id,world.spawn.x+dx,world.spawn.z+dz,0,0)<0)
          throw new Error("Could not park "+id+" in the test yard");
      }
    } else if (tanker) {
      const {world,records}=server.host, kind=world.reg.index.get("core:tanker");
      if(![...records.byPid.values()].some(r=>r.kind===kind) && server.host.spawnVehicle("core:tanker",world.spawn.x-2.8,world.spawn.z+3,0,0)<0)
        throw new Error("Could not park the tanker beside the yard entrance");
    } else if (fleet) console.log(`Parked ${seedRoadFleet(server.host)} fleet models near spawn.`);
    else if (!air) seedUrbanVehicles(server.host);
    // The freight yard is for trying the feature: its calls are free.
    if (air) server.host.setSetting("AirSupportOrderRequired", "False");
    const roads = seedUrbanRoads(server.host);
    if (roads) console.log(`Added ${roads} native paving pieces southeast of spawn.`);
  } catch (error) {
    server.stop();
    throw error;
  }
  stopOnSignals(()=>server.stop());
  console.log(`SNARK with road vehicles: http://localhost:${server.port}`);
  console.log(`Isolated save: ${dbPath}`);
}
