import { readFileSync } from "node:fs";
import { RUIN_SHAPES, type RuinShape } from "../../content/ruins.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { reportPaths } from "./report-path.ts";
const p = reportPaths(); const map = parseMap(new Uint8Array(readFileSync(p.mapFile)));
const failures = JSON.parse(readFileSync(`${p.folder}/access-test.json`, "utf8")).failures as { part: number; message: string }[];
for (const f of failures.slice(0, 12)) {
  const xyz = f.message.split("reached ")[1]!.split(",").map(Number); const [x,y,z]=xyz as [number,number,number];
  const hits = map.statics.filter((p) => { const [w,h,d] = RUIN_SHAPES[p.kind.split("_")[1] as RuinShape]; if(p.y+h/2<=y+.38 || p.y-h/2>=y+2) return false; const a=p.yaw*Math.PI*2/65536,c=Math.cos(a),s=Math.sin(a),dx=x-p.x,dz=z-p.z; return Math.abs(dx*c-dz*s)<w/2+.8 && Math.abs(dx*s+dz*c)<d/2+.8; });
  console.log(f, hits.map((p)=>({kind:p.kind,x:p.x,y:p.y,z:p.z})));
}
