// Examine actual native gait deformation at the four limb-to-trunk junctions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";

const bytes = readFileSync(process.argv[2] ?? "assets/source/core/creatures/stego/stego.snpk");
const pack = parsePack(bytes);
const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
// With a level argument, compare the region on that mesh's own edges. The
// legacy two-argument invocation also locates the exact source18 walk tears.
const level = Number(process.argv[3] ?? 0);
const mesh = unpackMeshes(pack).find(m => m.id === "core:stego")!.lods[level];
if (!mesh) throw new Error(`Unknown native Stego level ${level}`);
const { positions, weights, joints, bones } = mesh;
if (!bones) throw new Error("Stego gait review requires bone assignments");

function length(points: Float32Array, a: number, b: number) {
  return Math.hypot(points[a*3]! - points[b*3]!, points[a*3+1]! - points[b*3+1]!, points[a*3+2]! - points[b*3+2]!);
}

type Edge = { a: number; b: number; rest: number };
const groups = new Map<string, Edge[]>();
const seen = new Set<number>();
const vertices = positions.length / 3;
const witnessSource = [
  { frame: 45, original: [[.57503635,.87140918,.47824085],[.58743817,.86047852,.48717585]],
    fitted: [[.59422326,.88711989,.45785785],[.57089287,.89059782,.48061422]] },
  { frame: 35, original: [[1.03306317,1.45414972,-.23614155],[1.02775908,1.45570230,-.22790457]],
    fitted: [[.99220073,1.45489323,-.25498885],[.98431057,1.45961332,-.24256359]] },
];
for (let t = 0; t < mesh.indices.length; t += 3) {
  for (let j = 0; j < 3; j++) {
    const a = mesh.indices[t+j]!, b = mesh.indices[t+(j+1)%3]!;
    const key = Math.min(a,b) * vertices + Math.max(a,b);
    if (seen.has(key)) continue;
    seen.add(key);
    const x = (positions[a*3]! + positions[b*3]!)/2;
    const y = (positions[a*3+1]! + positions[b*3+1]!)/2;
    const z = (positions[a*3+2]! + positions[b*3+2]!)/2;
    if (Math.abs(x)<.25 || Math.abs(x)>1.3 || y<.65 || y>1.95) continue;
    const limb = z>.3 && z<1.25 ? "fore" : z>-1.3 && z<-.15 ? "hind" : null;
    const rest = length(positions,a,b);
    if (!limb || rest < .005) continue;
    const name = limb + (x>0 ? "_l" : "_r");
    if (!groups.has(name)) groups.set(name,[]);
    groups.get(name)!.push({a,b,rest});
  }
}

// UV seams and influence sorting can renumber packed vertices. Locate the
// actual triangle edge by both rest endpoints within 0.1 mm in either order.
const edges = [...groups.values()].flat();
function at(vertex: number, point: number[]) {
  return Math.hypot(...point.map((n,axis)=>n-positions[vertex*3+axis]!)) < .0001;
}
const witnesses = (process.argv[3] === undefined ? witnessSource : []).map(({frame,original,fitted}) => {
  const match = edges.find(({a,b}) => [original,fitted].some(([p,q]) =>
    at(a,p!) && at(b,q!) || at(a,q!) && at(b,p!)));
  if (!match) throw new Error(`Could not match historical triangle edge at walk ${frame}`);
  return {frame,...match};
});

const matrix = new Float32Array(rig.bones*12);
const posed = new Float32Array(positions.length);
const rows = [];
const historical = [];
for (const name of ["walk","run"]) {
  const clip = rig.clips.get(name)!;
  for (let frame = 0; frame < clip.frames; frame++) {
    sampleClip(clip,frame,rig.a);
    solve(rig,rig.a,rig.solved);
    writeBones(matrix,0,rig.solved,rig.rest,null,0,0,0,0);
    for (let v=0; v<vertices; v++) for (let axis=0; axis<3; axis++) {
      let value=0;
      for (let k=0; k<(weights ? 4 : 1); k++) {
        const index=(joints?.[v*4+k] ?? bones[v]!) * 12 + axis*4;
        value+=(weights?.[v*4+k] ?? 1) *(matrix[index]!*positions[v*3]!+matrix[index+1]!*positions[v*3+1]!+matrix[index+2]!*positions[v*3+2]!+matrix[index+3]!);
      }
      posed[v*3+axis]=value;
    }
    for (const edge of witnesses) if (name==="walk" && frame===edge.frame) {
      historical.push({...edge,posed:length(posed,edge.a,edge.b)});
    }
    for (const [region,local] of groups) {
      const ratios = local.map(({a,b,rest})=>length(posed,a,b)/rest);
      const max = Math.max(...ratios);
      const edge = local[ratios.indexOf(max)]!;
      ratios.sort((a,b)=>a-b);
      const point = (v:number)=>Array.from(positions.slice(v*3,v*3+3));
      rows.push({name,frame,region,edges:local.length,p01:ratios[Math.floor(ratios.length*.01)],p99:ratios[Math.floor(ratios.length*.99)],max,worst:{...edge,restPoints:[point(edge.a),point(edge.b)]}});
    }
  }
}
console.log(JSON.stringify({level,sha256:createHash("sha256").update(bytes).digest("hex"),historical,rows},null,2));
