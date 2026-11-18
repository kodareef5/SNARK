// Offline calibration of a real native hand around an upright cylinder. Runtime interpolates the resulting small table.
import {Pose} from "../../shared/anim/clip.ts";
import {B_FINGERS_L,B_FINGERTIPS_L,B_HAND_L,B_PROP_L,B_THUMB_L,HUMAN,HUMAN_BONES} from "../../shared/anim/human.ts";
import {solve,Solved} from "../../shared/anim/skeleton.ts";
import {quatAxis,quatMul,quatRotate} from "../../shared/math/quat.ts";
import type {SourceMesh} from "./write.ts";
import type {PackGrip} from "../../shared/pack/pack.ts";

export type GripCalibration = PackGrip;
export interface GripMeasurement {clearance:number;contacts:number[];gap:number;span:[number,number]}
/** params: outward/forward marker offset, proximal/distal curl, thumb Z curl and Y opposition. All are normalized to hand size 1. */
export class HandSurface {
  private readonly pose=new Pose(HUMAN_BONES);
  private readonly solved=new Solved(HUMAN_BONES);
  private readonly q=new Float64Array(4);
  private readonly v=new Float64Array(3);
  private readonly points:Float64Array;
  private readonly triangles:number[]=[];
  private readonly groups:number[]=[];
  private readonly min=new Float64Array(4);
  private readonly wx=new Float64Array(4);
  private readonly wz=new Float64Array(4);
  private readonly wy=new Float64Array(4);
  private radius=0;
  private contactGap=0;
  readonly mesh:SourceMesh;
  readonly rest:Float32Array;
  constructor(mesh:SourceMesh,rest:Float32Array,right=false){
    // Source clothing is not perfectly symmetric. Reflect the real right-hand mesh/joints into the left solver frame;
    // this changes only calibration coordinates, never exported mesh geometry or ordinary skinning.
    if(right){
      const mirror=[0,1,2,3,4,5,10,11,12,13,6,7,8,9,17,18,19,14,15,16,21,20,24,25,22,23,27,26,29,28];
      const original=rest;rest=new Float32Array(rest.length);
      for(let b=0;b<HUMAN_BONES;b++)for(let a=0;a<3;a++)rest[b*3+a]=original[mirror[b]!*3+a]!*(a===0?-1:1);
      mesh={...mesh,lods:mesh.lods.map(l=>({...l,positions:Float32Array.from(l.positions,(v,i)=>i%3===0?-v:v),bones:Uint8Array.from(l.bones!,b=>mirror[b]!)}))};
    }
    this.mesh=mesh;this.rest=rest;
    const lod=mesh.lods[0]!;this.points=new Float64Array(lod.positions.length);
    const active=(bone:number)=>bone===B_HAND_L||bone===B_FINGERS_L||bone===B_FINGERTIPS_L||bone===B_THUMB_L;
    let thumbTip=-Infinity,fingerTip=-Infinity;
    for(let v=0;v<lod.bones!.length;v++){if(lod.bones![v]===B_THUMB_L)thumbTip=Math.max(thumbTip,lod.positions[v*3]!);if(lod.bones![v]===B_FINGERTIPS_L)fingerTip=Math.max(fingerTip,lod.positions[v*3]!);}
    for(let i=0;i<lod.indices.length;i+=3){
      const a=lod.indices[i]!,b=lod.indices[i+1]!,c=lod.indices[i+2]!,bones=[lod.bones![a]!,lod.bones![b]!,lod.bones![c]!];
      if(!bones.every(active))continue;
      this.triangles.push(a,b,c);
      const thumbs=bones.filter(n=>n===B_THUMB_L).length;
      const centre=(lod.positions[a*3]!+lod.positions[b*3]!+lod.positions[c*3]!)/3;
      // Simplified glove triangles can bridge a whole palm with only one hand-bone corner; classify the anatomical
      // region by its native rest position rather than requiring a wholly rigid three-corner palm triangle.
      // Requiring distal fingertip/thumb-tip contact prevents an open hand from passing on a knuckle/base witness.
      this.groups.push(thumbs>=2?(centre>thumbTip-.025?2:-1):centre<rest[B_FINGERS_L*3]!-.008?0:centre>fingerTip-.03?1:-1);
    }
    quatAxis(this.pose.rot,B_HAND_L*4,0,1,0,-Math.PI/2);quatAxis(this.q,0,0,0,1,-Math.PI/2);quatMul(this.pose.rot,B_HAND_L*4,this.q,0,this.pose.rot,B_HAND_L*4);
  }
  private measure(p:ArrayLike<number>,radius:number):void{
    const lod=this.mesh.lods[0]!,q=this.q;
    quatAxis(this.pose.rot,B_FINGERS_L*4,0,0,1,-p[2]!);quatAxis(this.pose.rot,B_FINGERTIPS_L*4,0,0,1,-p[3]!);
    quatAxis(this.pose.rot,B_THUMB_L*4,0,0,1,-p[4]!);quatAxis(q,0,0,1,0,p[5]!);quatMul(this.pose.rot,B_THUMB_L*4,this.pose.rot,B_THUMB_L*4,q,0);
    solve(HUMAN,this.pose,this.solved,this.rest);
    for(let i=0;i<lod.positions.length/3;i++){
      const bone=lod.bones![i]!;
      quatRotate(this.solved.rot,bone*4,lod.positions[i*3]!-this.rest[bone*3]!,lod.positions[i*3+1]!-this.rest[bone*3+1]!,lod.positions[i*3+2]!-this.rest[bone*3+2]!,this.v,0);
      for(let a=0;a<3;a++)this.points[i*3+a]=this.v[a]!+this.solved.pos[bone*3+a]!-this.solved.pos[B_PROP_L*3+a]!+(a===0?p[0]!:a===2?p[1]!:0);
    }
    this.min.fill(Infinity);
    const close:number[]=[];
    for(let i=0;i<this.triangles.length;i+=3){
      const a=this.triangles[i]!*3,b=this.triangles[i+1]!*3,c=this.triangles[i+2]!*3,group=this.groups[i/3]!;
      let closest=Infinity,cx=0,cy=0,cz=0,inside=false;
      for(let edge=0;edge<3;edge++){
        const from=edge===0?a:edge===1?b:c,to=edge===0?b:edge===1?c:a;
        const ax=this.points[from]!,az=this.points[from+2]!,bx=this.points[to]!,bz=this.points[to+2]!,dx=bx-ax,dz=bz-az,n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,-(ax*dx+az*dz)/n)):0,x=ax+t*dx,z=az+t*dz,r=x*x+z*z;
        if(r<closest){closest=r;cx=x;cy=this.points[from+1]!+t*(this.points[to+1]!-this.points[from+1]!);cz=z;}if((az>0)!==(bz>0)&&0<(bx-ax)*(-az)/(bz-az)+ax)inside=!inside;
      }
      const distance=inside?0:Math.sqrt(closest);
      if(distance<radius+.002)close.push(Math.atan2(cz,cx));
      if(group>=0&&distance<this.min[group]!){this.min[group]=distance;this.wx[group]=cx;this.wy[group]=cy;this.wz[group]=cz;}
      this.min[3]=Math.min(this.min[3]!,distance);
    }
    const angles=close.length>1?close:[0,1,2].map(i=>Math.atan2(this.wz[i]!,this.wx[i]!));angles.sort((a,b)=>a-b);
    this.contactGap=angles[0]!+Math.PI*2-angles[angles.length-1]!;
    for(let i=1;i<angles.length;i++)this.contactGap=Math.max(this.contactGap,angles[i]!-angles[i-1]!);this.radius=radius;
  }
  score(p:readonly number[],radius:number,prior:readonly number[]|null=null):number{
    if(p[2]!<.2||p[2]!>1.5||p[3]!<.15||p[3]!>2||p[4]!<-.4||p[4]!>1.4||(p[5]!<0||p[5]!>1.8)||Math.abs(p[0]!)>.08||Math.abs(p[1]!)>.08)return 1000+p.reduce((s,v)=>s+v*v,0);
    this.measure(p,radius);
    const collision=Math.max(0,radius+.0002-this.min[3]!);
    let score=collision*collision*1e9+Math.max(0,this.contactGap-3.3)**2*.1;
    for(let i=0;i<3;i++){const gap=Math.max(0,this.min[i]!-radius);score+=gap*gap*1e4+Math.max(0,gap-.0015)**2*1e6;}
    if(prior)for(let i=0;i<6;i++)score+=(p[i]!-prior[i]!)**2*(i<2?1e4:1);
    return score;
  }
  inspect(p:ArrayLike<number>,radius:number):GripMeasurement{
    this.measure(p,radius);return{clearance:this.min[3]!-this.radius,contacts:Array.from(this.min.slice(0,3),d=>d-radius),gap:this.contactGap,span:[Math.min(this.wy[0]!,this.wy[1]!,this.wy[2]!),Math.max(this.wy[0]!,this.wy[1]!,this.wy[2]!)]};
  }
}

function minimize(surface:HandSurface,radius:number,seed:readonly number[],iterations:number,prior:readonly number[]|null):number[]{
  const simplex=[Array.from(seed),...seed.map((_,i)=>seed.map((v,j)=>v+(i===j?[.0015,.0015,.06,.06,.06,.06][i]!:0)))].map(p=>({p,s:surface.score(p,radius,prior)}));
  for(let n=0;n<iterations;n++){
    simplex.sort((a,b)=>a.s-b.s);const best=simplex[0]!,worst=simplex[6]!,centroid=seed.map((_,i)=>simplex.slice(0,6).reduce((s,v)=>s+v.p[i]!,0)/6);
    const candidate=(f:number)=>{const p=centroid.map((v,i)=>v+f*(v-worst.p[i]!));return{p,s:surface.score(p,radius,prior)}};
    const reflected=candidate(1);
    if(reflected.s<best.s){const e=candidate(2);simplex[6]=e.s<reflected.s?e:reflected;}
    else if(reflected.s<simplex[5]!.s)simplex[6]=reflected;
    else{const c=candidate(reflected.s<worst.s?.5:-.5);if(c.s<Math.min(worst.s,reflected.s))simplex[6]=c;else for(let k=1;k<7;k++){const p=simplex[k]!.p.map((v,i)=>(v+best.p[i]!)*.5);simplex[k]={p,s:surface.score(p,radius,prior)};}}
  }
  simplex.sort((a,b)=>a.s-b.s);return simplex[0]!.p;
}

/** Native source build only. It does not run when a game/client loads or repacks an already calibrated pack. */
function calibrateSide(mesh:SourceMesh,rest:Float32Array,right:boolean):{calibration:GripCalibration;checks:GripMeasurement[]}{
  const surface=new HandSurface(mesh,rest,right),start=.014,step=.0000625,count=129,centre=64,rows:number[][]=new Array(count),checks:GripMeasurement[]=new Array(count);
  const forward=.02-(rest[B_FINGERS_L*3]!-rest[B_HAND_L*3]!-.079);
  let best:number[]|null=null,score=Infinity;
  for(const x of [.004,.012,.02])for(const thumb of [.2,.7,1.2,1.6])for(const curl of [.1,.7]){
    const p=minimize(surface,.018,[x,forward,.8,1.2,curl,thumb],1000,null),s=surface.score(p,.018);
    if(s<score){score=s;best=p;}
  }
  rows[centre]=best!;
  for(const direction of [-1,1])for(let i=centre+direction;i>=0&&i<count;i+=direction){
    const prior=rows[i-direction]!,radius=start+i*step;
    rows[i]=minimize(surface,radius,prior,850,prior);
    const report=surface.inspect(rows[i]!,radius);
    if(report.clearance<.00001||Math.max(...report.contacts)>.0015){
      const alt=minimize(surface,radius,[prior[0]!,prior[1]!,prior[2]!*.9,prior[3]!*.9,prior[4]!,prior[5]!],1800,prior);
      if(surface.score(alt,radius,prior)<surface.score(rows[i]!,radius,prior))rows[i]=alt;
    }
  }
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<count;i++){checks[i]=surface.inspect(rows[i]!,start+i*step);lo=Math.min(lo,checks[i]!.span[0]);hi=Math.max(hi,checks[i]!.span[1]);}
  return{calibration:{mesh:mesh.id,start,step,poses:rows.flat(),span:[lo,hi]},checks};
}

/** Two independently measured native hands. Each radius row stores left six values, then right six values. */
export function calibrateHand(mesh:SourceMesh,rest:Float32Array):{calibration:GripCalibration;checks:GripMeasurement[]}{
  const left=calibrateSide(mesh,rest,false),right=calibrateSide(mesh,rest,true),poses:number[]=[];
  for(let i=0;i<left.calibration.poses.length;i+=6)poses.push(...left.calibration.poses.slice(i,i+6),...right.calibration.poses.slice(i,i+6));
  const calibration={...left.calibration,poses,span:[Math.min(left.calibration.span[0],right.calibration.span[0]),Math.max(left.calibration.span[1],right.calibration.span[1])] as [number,number]},checks=[...left.checks,...right.checks];
  // Node-only checks miss curved interpolation into the cylinder. Validate each segment at eight subdivisions,
  // using the same linear parameters the shared cached resolver uses; retain all contact witness heights too.
  for(const side of [0,1]){
    const surface=new HandSurface(mesh,rest,side===1),p=new Float64Array(6),last=poses.length/12-1;
    for(let sample=0;sample<=last*8;sample++){
      const row=sample/8,a=Math.min(last-1,Math.floor(row)),t=row-a;
      for(let k=0;k<6;k++){const x=poses[a*12+side*6+k]!,y=poses[(a+1)*12+side*6+k]!;p[k]=x+(y-x)*t;}
      const report=surface.inspect(p,calibration.start+row*calibration.step);checks.push(report);
      calibration.span[0]=Math.min(calibration.span[0],report.span[0]);calibration.span[1]=Math.max(calibration.span[1],report.span[1]);
    }
  }
  return{calibration,checks};
}
