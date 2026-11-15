// The HUD's CPU layout and exported assets, independent of the world sizing run.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ui } from "../../client/core/ui/ui.ts";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { skinPixels } from "../../client/core/ui/skin.ts";
import { buildUiAssets } from "../ui/assets.ts";

type RecordRow = (name:string,value:number,unit:string,budget?:number)=>void;
export function benchUi(section:(title:string)=>void, record:RecordRow):void {
  section("HUD: shared sheet, ten slots, six vitals and layered menus (CPU only)");
  const start=performance.now(), sheet=skinPixels();
  record("HUD primitive fallback, first creation",performance.now()-start,"ms");
  record("HUD sheet decoded",sheet.data.byteLength,"bytes",1048576);
  const dir=mkdtempSync(join(tmpdir(),"snark-ui-bench-"));
  try { const assets=buildUiAssets(dir); record("HUD sheet + font transferred (Brotli font)",assets.bytes,"bytes",98304); }
  finally { rmSync(dir,{recursive:true,force:true}); }
  const ui=new Ui(), hud=new HudModel();
  hud.hotbar.push(...Array.from({length:10},(_,i)=>({ tint:0x88aabb, label:`Item ${i}`, number:"100" })));
  for (const vital of hud.vitals) vital.fraction=.5;
  const car=new VehicleTelemetry();
  car.active=true; car.speed=12; car.gear=3; car.rpm=3400; car.fuel=.72;
  for (const mode of ["play", "drive", "menu", "settings", "audio", "controls", "controller"] as const) {
    hud.vehicle=mode==="drive"?car:null;
    ui.menu=mode!=="play"&&mode!=="drive"; ui.options=mode==="settings"||mode==="audio"; ui.settings.tab=mode==="audio"?1:0; ui.help=mode==="controls"||mode==="controller"; ui.helpDevice=mode==="controller"?1:0;
    for (let i=0;i<200;i++) { hud.vitals[0]!.fraction=(i%100)/100; ui.build(16/9,hud,null); }
    const allocated=ui.frame.nodes.length, times:number[]=[];
    for (let i=0;i<2000;i++) {
      hud.vitals[0]!.fraction=(i%100)/100; car.speed=i%40;
      const t=performance.now(); ui.build(16/9,hud,null); times.push(performance.now()-t);
    }
    times.sort((a,b)=>a-b);
    record(`HUD ${mode} layout median`,times[1000]!,"ms",.25);
    record(`HUD ${mode} layout p99`,times[1980]!,"ms",1);
    record(`HUD ${mode} nodes`,ui.frame.count,"",500);
    record(`HUD ${mode} node growth after warmup`,ui.frame.nodes.length-allocated,"",0);
  }
}
