// Original sport compact. Metres, +Y up, +Z forward, +X driver-left.
// Rigid authored parts, smooth bevels and measured openings; no licensed mesh or all-asset build.
import type { PackMaterial, PackRig } from "../../../../../shared/pack/pack.ts";
import { MATERIAL_TWO_SIDED } from "../../../../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../../../../shared/pack/palette.ts";
import { spanOf } from "../../../../../tools/pack/surface.ts";
import type { SourceLod, SourceMesh } from "../../../../../tools/pack/write.ts";
import { COMPACT } from "./contract.ts";

type V=readonly [number,number,number];
const PAINT=0, RUBBER=1, BLACK=2, ALLOY=3, LIGHT=4, TAIL=5, LEATHER=6, DARKMETAL=7, SCREEN=9, PIPING=10, WHITE=11, BRAKE=12, GASKET=13, GLASS=14, BADGE=15;
export const DETAIL_COLORS=[[76,135,126],[22,24,27],[13,18,22],[174,184,191],[211,236,255],[233,25,29],[42,43,45],[64,75,83],[255,146,24],[37,112,132],[144,85,54],[196,201,202],[166,52,34],[31,34,35],[56,84,89],[202,184,144]] as const;
export const DETAIL_ROUGHNESS=[70,224,130,72,76,76,212,122,76,82,164,115,156,225,50,90] as const;
const PALETTE=defaultPalette(), COLORS=DETAIL_COLORS.map(([r,g,b])=>nearestColour(PALETTE,r,g,b));
const add=(a:V,b:V):V=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a:V,s:number):V=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:V):V=>mul(a,1/Math.hypot(...a));
class Mesh {
  positions:number[]=[];normals:number[]=[];uvs:number[]=[];colors:number[]=[];bones:number[]=[];indices:number[]=[];sections:number[]=[];
  smooth=new Map<string,{normal:number[];vertices:number[]}>(); serial=0;
  face(points:readonly V[],outward:V,material:number,bone=0,group=0):void {
    let p=[...points],n=cross(sub(p[1]!,p[0]!),sub(p[2]!,p[0]!));
    if(n[0]*outward[0]+n[1]*outward[1]+n[2]*outward[2]<0){p.reverse();n=mul(n,-1);}
    if(Math.hypot(...n)<1e-9)return;
    n=unit(n);const first=this.positions.length/3;
    const dominant=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
    for(const v of p){
      const index=this.positions.length/3;this.positions.push(...v);this.normals.push(...n);
      if(material===PAINT||material===LEATHER){const repeat=material===LEATHER?3: .5;this.uvs.push((dominant===0?v[2]:v[0])*repeat,(dominant===1?v[2]:-v[1])*repeat);}
      else this.uvs.push((material+.5)/16,.5);
      this.colors.push(COLORS[material]!);this.bones.push(bone);
      if(group){const key=`${group}/${bone}/${v.map(x=>x.toFixed(6)).join('/')}`;let s=this.smooth.get(key);if(!s){s={normal:[0,0,0],vertices:[]};this.smooth.set(key,s);}for(let k=0;k<3;k++)s.normal[k]!+=n[k]!;s.vertices.push(index);}
    }
    for(let i=1;i<p.length-1;i++){this.indices.push(first,first+i,first+i+1);this.sections.push(material===PAINT?0:material===LEATHER?2:1);}
  }
  box(lo:V,hi:V,mat:number,bone=0):void {
    const [x,y,z]=lo,[X,Y,Z]=hi;
    this.face([[x,y,z],[x,Y,z],[x,Y,Z],[x,y,Z]],[-1,0,0],mat,bone);
    this.face([[X,y,z],[X,Y,z],[X,Y,Z],[X,y,Z]],[1,0,0],mat,bone);
    this.face([[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],[0,-1,0],mat,bone);
    this.face([[x,Y,z],[X,Y,z],[X,Y,Z],[x,Y,Z]],[0,1,0],mat,bone);
    this.face([[x,y,z],[X,y,z],[X,Y,z],[x,Y,z]],[0,0,-1],mat,bone);
    this.face([[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],[0,0,1],mat,bone);
  }
  /** Cube with rounded shoulders; the grid's common vertices share smooth normals. */
  bevel(lo:V,hi:V,r:number,mat:number,bone=0,detail=true):void {
    if(!detail){this.box(lo,hi,mat,bone);return;}
    const c=mul(add(lo,hi),.5),h=mul(sub(hi,lo),.5);r=Math.min(r,...h)*.95;
    const inner=h.map(v=>v-r),grid=h.map(v=>[-v,-v+r,v-r,v]),group=++this.serial;
    const project=(p:V):V=>{const q=p.map((v,k)=>Math.max(-inner[k]!,Math.min(inner[k]!,v))) as unknown as V;const d=sub(p,q);return add(c,add(q,mul(unit(d),r)));};
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const a=(axis+1)%3,b=(axis+2)%3,out=[0,0,0];out[axis]=sign;
      for(let i=0;i<3;i++)for(let j=0;j<3;j++){const points:V[]=[];for(const [u,v]of[[i,j],[i+1,j],[i+1,j+1],[i,j+1]]){const p=[0,0,0];p[axis]=sign*h[axis]!;p[a]=grid[a]![u!]!;p[b]=grid[b]![v!]!;points.push(project(p as unknown as V));}this.face(points,out as unknown as V,mat,bone,group);}}
  }
  beam(a:V,b:V,r:number,mat:number,bone=0,segments=6):void {
    const axis=unit(sub(b,a)),u=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[0,0,1])),v=cross(axis,u),group=++this.serial;
    const ring=(c:V):V[]=>Array.from({length:segments},(_,i)=>add(c,add(mul(u,Math.cos(i*2*Math.PI/segments)*r),mul(v,Math.sin(i*2*Math.PI/segments)*r))));
    const left=ring(a),right=ring(b);this.face(left,mul(axis,-1),mat,bone);this.face(right,axis,mat,bone);
    for(let i=0;i<segments;i++){const j=(i+1)%segments;this.face([left[i]!,right[i]!,right[j]!,left[j]!],sub(left[i]!,a),mat,bone,group);}
  }
  /** Closed radial section swept about wheel X. */
  wheelProfile(c:V,profile:readonly (readonly [number,number])[],segments:number,mat:number,bone:number):void {
    const group=++this.serial;
    const signed=profile.reduce((sum,a,i)=>{const b=profile[(i+1)%profile.length]!;return sum+a[0]*b[1]-b[0]*a[1];},0),w=signed<0?-1:1;
    for(let p=0;p<profile.length;p++){const a=profile[p]!,b=profile[(p+1)%profile.length]!;
      for(let i=0;i<segments;i++){const angles=[i*2*Math.PI/segments,(i+1)*2*Math.PI/segments];const point=(q:readonly[number,number],t:number):V=>[c[0]+q[0],c[1]+Math.cos(t)*q[1],c[2]+Math.sin(t)*q[1]];
        const mid=(angles[0]!+angles[1]!)/2;this.face([point(a,angles[0]!),point(b,angles[0]!),point(b,angles[1]!),point(a,angles[1]!)],[w*(b[1]-a[1]),-w*(b[0]-a[0])*Math.cos(mid),-w*(b[0]-a[0])*Math.sin(mid)],mat,bone,group);}}
  }
  lod(error:number):SourceLod {
    for(const s of this.smooth.values()){const n=unit(s.normal as unknown as V);for(const v of s.vertices)for(let k=0;k<3;k++)this.normals[v*3+k]=n[k]!;}
    return {positions:Float32Array.from(this.positions),normals:Float32Array.from(this.normals),uvs:Float32Array.from(this.uvs),colors:Uint8Array.from(this.colors),bones:Uint8Array.from(this.bones),indices:Uint32Array.from(this.indices),sections:Uint8Array.from(this.sections),error};
  }
}

function shape(level:number):SourceLod {
  if(level===3)return distantShape();
  const m=new Mesh(),fine=level===0,near=level<2,far=false,round=level===0,segments=[32,16,10,6][level]!;
  // Thin floor never enters either seated character's foot capsule (minimum y .187).
  m.box([-.77,.12,-1.62],[.77,.15,1.62],BLACK);
  // A curved hood uses cross-sections instead of a box; the cabin is intentionally empty.
  const hood=[[.72,.80,.91],[.97,.84,.91],[1.37,.87,.86],[1.75,.84,.79],[1.96,.75,.74]];
  const across=far?[-1,0,1]:[-1,-.88,-.70,-.54,0,.54,.70,.88,1],smooth=++m.serial;
  for(let i=0;i<hood.length-1;i++)for(let j=0;j<across.length-1;j++){
    const point=(row:number,col:number):V=>{const [z,w,y]=hood[row]!,t=across[col]!;return[t*w!,y!+hoodCrown(t,z!),z!];};
    m.face([point(i,j),point(i,j+1),point(i+1,j+1),point(i+1,j)],[0,1,.2],PAINT,0,smooth);
  }
  if(near)for(const side of[-1,1]){
    // Recessed charcoal hood gills sit on the crowned panel, bounded by a painted shoulder ridge.
    const point=(x:number,z:number):V=>{
      let row=0;while(row<hood.length-2&&hood[row+1]![0]!<z)row++;
      const a=hood[row]!,b=hood[row+1]!,t=(z-a[0]!)/(b[0]!-a[0]!),w=a[1]!+(b[1]!-a[1]!)*t,y=a[2]!+(b[2]!-a[2]!)*t;
      return[side*x,y+hoodCrown(x/w,z)+.002,z];
    };
    m.face([point(.48,1.02),point(.61,1.02),point(.58,1.42),point(.49,1.42)],[0,1,0],BLACK);
    for(let i=0;i<5;i++)m.beam(point(.49,1.06+i*.069),point(.595-i*.005,1.06+i*.069),.006,DARKMETAL,0,4);
  }
  // A low rounded nose and rear bumper fit the original immutable envelope.
  m.bevel([-.86,.22,1.70],[.86,.31,2],.035,PAINT,0,round);
  m.bevel([-.82,.54,1.75],[.82,.67,1.985],.045,PAINT,0,round);
  for(const side of[-1,1])m.bevel([side>0?.55:-.86,.30,1.72],[side>0?.86:-.55,.55,1.99],.065,PAINT,0,round);
  // Upper nose connects bonnet to the lamps; the grille has a real open recess.
  m.face([[-.75,.74,1.96],[.75,.74,1.96],[.78,.65,1.982],[-.78,.65,1.982]],[0,0,1],PAINT);
  m.bevel([-.86,.22,-2],[.86,.34,-1.67],.04,PAINT,0,round);
  m.bevel([-.84,.49,-1.995],[.84,.70,-1.70],.055,PAINT,0,round);
  for(const side of[-1,1])m.bevel([side>0?.23:-.86,.32,-1.995],[side>0?.86:-.23,.51,-1.72],.045,PAINT,0,round);
  m.bevel([-.23,.34,-1.986],[.23,.49,-1.94],.02,BLACK,0,near);
  m.bevel([-.17,.365,-1.991],[.17,.465,-1.988],.01,WHITE,0,near);
  m.face([[-.78,.71,-1.97],[.78,.71,-1.97],[.75,.77,-1.96],[-.75,.77,-1.96]],[0,0,-1],PAINT);
  m.bevel([-.75,.15,1.72],[.75,.23,1.98],.025,BLACK,0,near);
  m.bevel([-.77,.15,-1.99],[.77,.24,-1.70],.025,BLACK,0,near);
  m.bevel([-.54,.30,1.987],[.54,.53,1.999],.035,BLACK,0,near);
  if(near){
    // Recessed layered grille and splitter. Geometric slats hold up without a fake decal.
    for(let i=0;i<6;i++)m.box([-.48,.325+i*.031,1.997],[.48,.335+i*.031,2],DARKMETAL);
    m.box([-.013,.34,1.999],[.013,.48,2],BADGE);
    for(const side of[-1,1]){const x=side*.69;m.bevel([x-.105,.32,1.957],[x+.105,.52,1.987],.025,BLACK,0,round);}
    for(let i=0;i<6;i++)m.box([-.12+i*.041,.395,-1.993],[-.10+i*.041,.438,-1.991],DARKMETAL);
    for(const x of[-.145,.145])m.beam([x,.45,-1.993],[x,.45,-1.991],.004,ALLOY,0,6);
    m.face([[-.56,.155,-1.99],[.56,.155,-1.99],[.49,.31,-1.955],[-.49,.31,-1.955]],[0,.3,-1],BLACK);
    for(const x of[-.48,-.24,0,.24,.48])m.box([x-.012,.17,-1.985],[x+.012,.27,-1.77],DARKMETAL);
  }
  // Rear shoulder/deck and actual wheel arches. No continuous body box cuts through the tyres.
  const rear=[[-1.96,.75,.77],[-1.73,.82,.85],[-1.12,.83,.94],[-.84,.78,.94]],rearGroup=++m.serial;
  for(let i=0;i<rear.length-1;i++)for(let j=0;j<across.length-1;j++){
    const p=(a:number,b:number):V=>{const[z,w,y]=rear[a]!,t=across[b]!;return[t*w!,y!+.025*(1-t*t),z!];};
    m.face([p(i,j),p(i,j+1),p(i+1,j+1),p(i+1,j)],[0,1,0],PAINT,0,rearGroup);
  }
  // Closing shoulder strips join the hood/deck to the side arches; no visible daylight seams.
  for(const rows of[hood,rear])for(const side of[-1,1])for(let i=0;i<rows.length-1;i++){
    const[z,w,y]=rows[i]!,[Z,W,Y]=rows[i+1]!;
    m.face([[side*w!,y!,z!],[side*W!,Y!,Z!],[side*.828,topAt(Z!),Z!],[side*.828,topAt(z!),z!]],[side,.5,0],PAINT);
  }
  for(const side of[-1,1]){
    const x=side*.855,bone=side===1?5:6;
    for(const z of[-1.25,1.25]){
      const n=far?4:near?12:6,r=.349;
      for(let i=0;i<n;i++){
        const a=i*Math.PI/n,b=(i+1)*Math.PI/n;
        const A:V=[x,.30+Math.sin(a)*r,z+Math.cos(a)*r],B:V=[x,.30+Math.sin(b)*r,z+Math.cos(b)*r];
        const top=topAt;
        m.face([A,B,[side*.828,top(B[2]),B[2]],[side*.828,top(A[2]),A[2]]],[side,.15,0],PAINT);
        if(!far){const lipA:V=[side*.866,A[1],A[2]],lipB:V=[side*.866,B[1],B[2]];m.face([A,B,lipB,lipA],[side,-.2,0],BLACK);if(near)m.beam([side*.863,A[1]+.018,A[2]],[side*.863,B[1]+.018,B[2]],.012,PAINT,0,fine?5:4);}
      }
      const front=z+.349,back=z-.349;
      m.face([[x,.27,front],[x,.30,front],[side*.828,topAt(front),front],[side*.79,topAt(z+.65),z+.65],[side*.79,.27,z+.65]],[side,0,0],PAINT);
      m.face([[side*.79,.27,z-.65],[side*.79,topAt(z-.65),z-.65],[side*.828,topAt(back),back],[x,.30,back],[x,.27,back]],[side,0,0],PAINT);
    }
    // Door is one sculpted rigid part, with a rolled-down open aperture above its belt.
    const outer:V[]=[[side*.81,.25,-.82],[side*.85,.46,-.82],[side*.835,.91,-.74],[side*.82,.91,.65],[side*.85,.46,.65],[side*.81,.25,.65]];
    const doorRows=[[.25,.81],[.46,.835],[.77,.873],[.91,.835]],doorZ=[-.80,-.59,.47,.65],doorSmooth=++m.serial;
    for(let r=0;r<doorRows.length-1;r++)for(let z=0;z<doorZ.length-1;z++){
      const p=(a:number,b:number):V=>[side*(doorRows[a]![1]!-(b===0?.012:0)),doorRows[a]![0]!,doorZ[b]!];
      m.face([p(r,z),p(r+1,z),p(r+1,z+1),p(r,z+1)],[side,0,0],PAINT,bone,doorSmooth);
    }
    const inner=outer.map(p=>[p[0]-side*.045,p[1],p[2]] as V);
    m.face(inner,[-side,0,0],LEATHER,bone);
    for(let i=0;i<outer.length;i++)m.face([outer[i]!,inner[i]!,inner[(i+1)%outer.length]!,outer[(i+1)%outer.length]!],[0,1,0],i===2?BLACK:PAINT,bone);
    if(!far){m.beam([side*.837,.924,-.74],[side*.825,.924,.64],.013,GASKET,bone,6);m.beam([side*.843,.70,-.73],[side*.843,.69,.63],.007,PAINT,bone,4);}
    m.bevel([side>0?.78:-.85,.17,-.84],[side>0?.85:-.78,.24,.78],.025,BLACK,0,near);
    if(near){
      m.bevel([side>0?.838:-.855,.79,-.58],[side>0?.855:-.838,.825,-.36],.01,DARKMETAL,bone,round);
      m.beam([side*.79,.79,.51],[side*.855,.96,.52],.023,BLACK,bone,6);
      m.bevel([side>0?.836:-.9,.92,.42],[side>0?.9:-.836,1.005,.61],.03,PAINT,bone,round);
      m.face([[side*.848,.938,.425],[side*.894,.938,.425],[side*.887,.985,.425],[side*.85,.985,.425]],[0,0,-1],ALLOY,bone);
      // Interior armrest, handle and warm accent welt follow the same door hinge.
      m.bevel([side>0?.74:-.81,.60,-.37],[side>0?.81:-.74,.66,.34],.018,BLACK,bone,round);
      m.beam([side*.785,.79,-.52],[side*.785,.79,-.28],.011,ALLOY,bone,6);
    }
    // Narrow pillars/frame; the windscreen and side-window center remain OPEN in the opaque pipeline.
    m.beam([side*.79,.91,.70],[side*.68,1.455,.25],far?.035:.028,PAINT,0,far?4:8);
    m.beam([side*.79,.94,-1.05],[side*.68,1.455,-.68],far?.05:.043,PAINT,0,far?4:8);
    if(near)m.beam([side*.827,.94,-.70],[side*.685,1.45,-.63],.019,BLACK,0,6);
    // Segmented LED signatures, encased lamps, no oversized glowing body surfaces.
    const frontX=side*.61;
    m.bevel([frontX-.18,.66,1.955],[frontX+.18,.745,1.982],.023,BLACK,0,near);
    m.beam([side*.43,.728,1.985],[side*.765,.728,1.975],far?.022:.012,LIGHT,0,far?4:6);
    m.beam([side*.765,.728,1.975],[side*.745,.675,1.983],.012,LIGHT,0,far?4:6);
    if(near)for(let j=0;j<3;j++){const c=side*(.49+j*.07);m.bevel([c-.024,.675,1.982],[c+.024,.708,1.988],.009,LIGHT,0,round);}
    m.beam([side*.19,.71,-1.982],[side*.78,.71,-1.96],far?.023:.015,TAIL,0,far?4:6);
    if(near){m.beam([side*.77,.71,-1.96],[side*.77,.64,-1.98],.014,TAIL,0,6);m.beam([side*.57,.255,-1.89],[side*.57,.255,-1.998],.052,ALLOY,0,10);m.beam([side*.57,.255,-1.99],[side*.57,.255,-2],.038,BLACK,0,10);}
    // Tailored bucket seat: generated perforated leather on cushion, back and bolsters.
    const s=side*.42;
    m.bevel([s-.235,.43,-.24],[s+.235,.57,.39],.055,LEATHER,0,near);
    m.bevel([s-.225,.56,-.36],[s+.225,1.10,-.19],.055,LEATHER,0,near);
    if(!far){
      m.bevel([s-.14,1.06,-.34],[s+.14,1.27,-.18],.045,LEATHER,0,near);
      for(const hand of[-1,1]){const sx=s+hand*.20;m.bevel([sx-.045,.52,-.20],[sx+.045,.66,.31],.035,LEATHER,0,round);m.beam([sx,.62,-.17],[sx,1.04,-.17],.014,PIPING,0,6);}
      if(fine)for(let j=0;j<5;j++)m.beam([s-.13,.58,-.13+j*.085],[s+.13,.58,-.13+j*.085],.0035,PIPING,0,4);
    }
  }
  // Domed roof has a continuous inner ceiling at y1.44, preserving measured survivor clearance.
  const roofZ=far?[-.72,.27]:[-.72,-.58,.12,.27],roofX=far?[-1,0,1]:[-1,-.8,0,.8,1],roofGroup=++m.serial;
  for(let i=0;i<roofZ.length-1;i++)for(let j=0;j<roofX.length-1;j++){
    const p=(a:number,b:number):V=>{const t=roofX[b]!,z=roofZ[a]!;return[t*.70,1.45+.05*(1-t*t)-.004*Math.abs(z+.2),z];};
    m.face([p(i,j),p(i+1,j),p(i+1,j+1),p(i,j+1)],[0,1,0],PAINT,0,roofGroup);
  }
  m.face([[-.68,1.44,-.72],[.68,1.44,-.72],[.68,1.44,.27],[-.68,1.44,.27]],[0,-1,0],BLACK);
  m.beam([-.69,1.452,.27],[.69,1.452,.27],.023,GASKET,0,far?4:8);
  m.beam([-.79,.925,.705],[.79,.925,.705],.018,GASKET,0,far?4:8);
  m.beam([-.69,1.452,-.72],[.69,1.452,-.72],.022,GASKET,0,far?4:8);
  // Slim tinted perimeter strips hint at the windshield without hiding actual characters.
  if(near)for(const s of[-1,1])m.face([[s*.765,.95,.69],[s*.665,1.43,.28],[s*.637,1.43,.28],[s*.737,.95,.69]],[0,.5,1],GLASS);
  // Visible dash, binnacle, center console and steering wheel (semantic rigid bone7).
  m.bevel([-.72,.66,.65],[.72,.82,.80],.035,BLACK,0,near);
  m.bevel([-.105,.30,-.18],[.105,.57,.53],.035,BLACK,0,near);
  if(near){
    m.bevel([.24,.79,.66],[.60,.96,.76],.025,BLACK,0,round);
    m.face([[.29,.83,.654],[.55,.83,.654],[.55,.91,.654],[.29,.91,.654]],[0,0,-1],SCREEN);
    m.bevel([-.135,.76,.625],[.135,.93,.654],.015,DARKMETAL,0,round);
    m.face([[-.11,.78,.622],[.11,.78,.622],[.11,.91,.622],[-.11,.91,.622]],[0,0,-1],SCREEN);
    m.beam([0,.54,.22],[0,.65,.20],.024,ALLOY,0,8);m.bevel([-.035,.63,.17],[.035,.68,.23],.02,BLACK,0,round);
    m.beam([.42,.86,.70],[.42,.89,.55],.036,BLACK,0,8);
    for(const x of[-.60,-.26,.64])for(let y=0;y<3;y++)m.box([x-.06,.73+y*.018,.642],[x+.06,.735+y*.018,.649],DARKMETAL);
  }
  const wheelSegments=far?6:near?24:10;
  for(let i=0;i<wheelSegments;i++){
    const a=i*2*Math.PI/wheelSegments,b=(i+1)*2*Math.PI/wheelSegments;
    m.beam([.42+Math.cos(a)*.191,.89+Math.sin(a)*.191,.55],[.42+Math.cos(b)*.191,.89+Math.sin(b)*.191,.55],far?.015:.017,RUBBER,7,far?3:fine?6:4);
  }
  for(const angle of[0,Math.PI,Math.PI*1.5])m.beam([.42,.89,.55],[.42+Math.cos(angle)*.18,.89+Math.sin(angle)*.18,.55],.022,DARKMETAL,7,far?3:6);
  m.bevel([.365,.85,.53],[.475,.93,.57],.02,BLACK,7,round);
  if(fine)m.face([[.401,.88,.529],[.439,.88,.529],[.439,.90,.529],[.401,.90,.529]],[0,0,-1],BADGE,7);
  // Tyre shoulders, inner barrel, brake disc and ten sculpted alloy spokes are true geometry.
  for(let bone=1;bone<=4;bone++){
    const c=COMPACT.pivots[bone]!,side=Math.sign(c[0]);
    m.wheelProfile(c,!near?[[-.112,.20],[-.112,.30],[.112,.30],[.112,.20]]:[[-.112,.206],[-.112,.252],[-.089,.285],[-.055,.30],[.055,.30],[.089,.285],[.112,.252],[.112,.206]],segments,RUBBER,bone);
    const out=side*.116;
    m.wheelProfile(c,[[out-side*.035,.178],[out-side*.035,.207],[out,.214],[out,.185]],segments,ALLOY,bone);
    if(near)m.wheelProfile(c,[[side*.075,.025],[side*.075,.165],[side*.083,.165],[side*.083,.025]],segments,DARKMETAL,bone);
    const spokes=far?5:10;
    for(let i=0;i<spokes;i++){
      const a=i*Math.PI*2/spokes+(i%2===0?.045:-.045),b=a+.055;
      const p=(r:number,t:number,x=out):V=>[c[0]+x,c[1]+Math.cos(t)*r,c[2]+Math.sin(t)*r];
      m.face([p(.042,a-.14),p(.19,b-.055),p(.20,b+.055),p(.05,a+.14)],[side,0,0],ALLOY,bone);
      if(near)m.face([p(.05,a+.14),p(.20,b+.055),p(.20,b+.055,out-side*.025),p(.05,a+.14,out-side*.025)],[side,0,0],DARKMETAL,bone);
    }
    if(near)m.wheelProfile(c,[[out-.004*side,.001],[out-.004*side,.053],[out+.002*side,.053],[out+.002*side,.001]],12,BLACK,bone);
    else m.face(Array.from({length:6},(_,i):V=>[c[0]+out+side*.002,c[1]+Math.cos(i*Math.PI/3)*.053,c[2]+Math.sin(i*Math.PI/3)*.053]),[side,0,0],BLACK,bone);
    if(fine){
      for(let i=0;i<5;i++){const a=i*2*Math.PI/5;const y=c[1]+Math.cos(a)*.034,z=c[2]+Math.sin(a)*.034;m.beam([c[0]+out,y,z],[c[0]+out+side*.003,y,z],.007,ALLOY,bone,6);}
      m.bevel([c[0]+side*.065-.012,c[1]-.11,c[2]+.10],[c[0]+side*.065+.012,c[1]+.07,c[2]+.16],.016,BRAKE,bone,true);
      // Restrained shoulder grooves: narrow dark ridges, small enough to disappear in the next LOD.
      for(let i=0;i<16;i++){const a=i*2*Math.PI/16;m.beam([c[0]-.057,c[1]+Math.cos(a)*.295,c[2]+Math.sin(a)*.295],[c[0]+.057,c[1]+Math.cos(a+.035)*.295,c[2]+Math.sin(a+.035)*.295],.0035,BLACK,bone,4);}
    }
  }
  return m.lod([0,.055,.14,.34][level]!);
}
function hoodCrown(t:number,z:number):number{const amplitude=z<.8?.023:z>1.8?.035:.067;return amplitude*(1-t*t)+(Math.abs(t)>.54&&Math.abs(t)<.9?.008:0);}
function topAt(z:number):number{return z>0?.91-(z-.75)*.13:.90+(z+1.25)*.07;}

/** Traffic silhouette: no hidden interiors, inner tyre barrel, mirrors, stitching or steering spokes. */
function distantShape():SourceLod {
  const m=new Mesh();
  m.box([-.80,.15,-1.80],[.80,.25,1.80],BLACK);
  m.box([-.84,.25,1.68],[.84,.65,1.98],PAINT);m.box([-.84,.25,-1.98],[.84,.70,-1.68],PAINT);
  m.face([[-.80,.91,.72],[.80,.91,.72],[.76,.74,1.96],[-.76,.74,1.96]],[0,1,0],PAINT);
  m.face([[-.78,.94,-.84],[.78,.94,-.84],[.76,.77,-1.96],[-.76,.77,-1.96]],[0,1,0],PAINT);
  m.box([-.70,1.44,-.72],[.70,1.49,.27],PAINT);
  for(const side of[-1,1]){
    const bone=side===1?5:6,x=side*.84;
    m.face([[x,.25,-.84],[x,.91,-.84],[x,.91,.68],[x,.25,.68]],[side,0,0],PAINT,bone);
    m.beam([side*.79,.91,.70],[side*.68,1.455,.25],.035,PAINT,0,4);
    m.beam([side*.79,.94,-1.05],[side*.68,1.455,-.68],.045,PAINT,0,4);
    for(const z of[-1.25,1.25]){
      const n=4,r=.35;
      for(let i=0;i<n;i++){
        const a=i*Math.PI/n,b=(i+1)*Math.PI/n,A:V=[x,.3+Math.sin(a)*r,z+Math.cos(a)*r],B:V=[x,.3+Math.sin(b)*r,z+Math.cos(b)*r];
        m.face([A,B,[x,topAt(B[2]),B[2]],[x,topAt(A[2]),A[2]]],[side,0,0],PAINT);
      }
    }
    const frontX=side*.61;
    m.face([[frontX-.16,.68,1.99],[frontX+.16,.68,1.99],[frontX+.16,.73,1.99],[frontX-.16,.73,1.99]],[0,0,1],LIGHT);
    m.face([[side*.18,.70,-1.99],[side*.78,.70,-1.99],[side*.78,.73,-1.99],[side*.18,.73,-1.99]],[0,0,-1],TAIL);
    // Seat back is the only interior silhouette retained through the open window.
    m.box([side*.42-.20,.57,-.31],[side*.42+.20,1.10,-.20],LEATHER);
  }
  // Four six-sided solid wheels and simple silver hub faces; rigid bone identity remains stable.
  for(let bone=1;bone<=4;bone++){
    const c=COMPACT.pivots[bone]!,side=Math.sign(c[0]),a:V[]=[];const b:V[]=[];
    for(let i=0;i<6;i++){const angle=i*Math.PI/3;a.push([c[0]-.112,c[1]+Math.cos(angle)*.30,c[2]+Math.sin(angle)*.30]);b.push([c[0]+.112,c[1]+Math.cos(angle)*.30,c[2]+Math.sin(angle)*.30]);}
    m.face(a,[-1,0,0],RUBBER,bone);m.face(b,[1,0,0],RUBBER,bone);
    for(let i=0;i<6;i++){const j=(i+1)%6;m.face([a[i]!,b[i]!,b[j]!,a[j]!],[0,a[i]![1]-.3,a[i]![2]-c[2]],RUBBER,bone);}
    m.face(Array.from({length:6},(_,i):V=>[c[0]+side*.116,c[1]+Math.cos(i*Math.PI/3)*.19,c[2]+Math.sin(i*Math.PI/3)*.19]),[side,0,0],ALLOY,bone);
  }
  // One small wheel hub retains the optional semantic bone without costly invisible spokes.
  m.face([[.38,.85,.55],[.46,.85,.55],[.46,.93,.55],[.38,.93,.55]],[0,0,-1],BLACK,7);
  return m.lod(.34);
}

export function compactRig():PackRig {
  return{id:COMPACT.id,skeleton:COMPACT.id,names:[...COMPACT.bones],parent:COMPACT.bones.map((_,i)=>i===0?-1:0),rest:COMPACT.pivots.flatMap(v=>[...v]),sockets:Object.entries(COMPACT.anchors).map(([name,v])=>({name,bone:0,x:v[0],y:v[1],z:v[2]}))};
}
export interface CompactVisual{id:string;paintTint:[number,number,number];flatPaint:[number,number,number]}
export const COPPER_COMPACT:CompactVisual={id:"core:compact/copper",paintTint:[3.1,.62,.34],flatPaint:[132,108,75]};
export function compactMesh(visual?:CompactVisual):SourceMesh {
  const lods=[0,1,2,3].map(shape);
  if(visual){const color=nearestColour(PALETTE,...visual.flatPaint);for(const lod of lods)for(let t=0;t<lod.indices.length/3;t++)if(lod.sections![t]===0)for(let c=0;c<3;c++)lod.colors[lod.indices[t*3+c]!] = color;}
  const materials:PackMaterial[]=["paint","details","upholstery"].map((name,i)=>({id:`${i===0?visual?.id??COMPACT.id:COMPACT.id}/${name}`,base:i*2,normal:-1,mro:i*2+1,mask:-1,mask2:-1,tint:i===0&&visual?visual.paintTint:[1,1,1],grey:1,emissive:i===1?1.5:0,flags:i===1?MATERIAL_TWO_SIDED:0,cutoff:0,span:spanOf(lods[0]!,i)}));
  return{id:visual?.id??COMPACT.id,skeleton:COMPACT.id,rig:COMPACT.id,collider:[.9,.75,2],lods,flat:3,materials,textures:["paint","details","upholstery"].flatMap(name=>[{id:`${COMPACT.id}/${name}-base`,role:"base" as const,top:512},{id:`${COMPACT.id}/${name}-packed`,role:"mro" as const,top:512}])};
}
