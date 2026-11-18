// Shared spatial pose placement: collision support, a bounded body plane and rotation-only leg fitting.
// The caller solves the authored pose first. Flat ground preserves it; unsupported limbs never stretch to a ledge.
import { TAU, detCos, detSin } from '../math/scalar.ts';
import { quatMul, quatMulConj, quatNlerp, quatNormalize, quatRotate, quatUnrotate } from '../math/quat.ts';
import { MODE_WALK } from '../sim/character.ts';
import type { CollisionWorld } from '../world/collide.ts';
import { castWorld, HIT_NONE, rayHit } from '../world/ray.ts';
import type { Pose } from './clip.ts';
import type { AnimState } from './pose.ts';
import { CUE_TORPOR, DIR_STEPS } from './pose.ts';
import type { Rig } from './rigs.ts';
import { boneToModel, solve, type Solved } from './skeleton.ts';

const point = new Float64Array(3), rotated = new Float64Array(3);
const q = new Float64Array(4), normal = new Float64Array(4), targetRot = new Float64Array(32);
const originalFoot = new Float64Array(24), originalEnd = new Float64Array(32), terrain = new Float64Array(8);
const goals = new Float64Array(24), bends = new Float64Array(24), active = new Uint8Array(8);
const support = new Float64Array(8);
const originalLeg = new Float32Array(96), influence = new Float64Array(8);
let surface = 0, nx = 0, ny = 1, nz = 0, castTop = 0;
const length = (x: number, y: number, z: number): number => Math.sqrt(x*x+y*y+z*z);

function toward(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const a=length(ax,ay,az), b=length(bx,by,bz);
  ax/=a; ay/=a; az/=a; bx/=b; by/=b; bz/=b;
  const dot=ax*bx+ay*by+az*bz;
  if(dot<-.999999) { const x=Math.abs(ax)<.9?1:0,y=1-x; q[0]=-az*y; q[1]=az*x; q[2]=ax*y-ay*x; q[3]=0; }
  else { q[0]=ay*bz-az*by; q[1]=az*bx-ax*bz; q[2]=ax*by-ay*bx; q[3]=1+dot; }
  quatNormalize(q,0);
}

/** Downward casts only accept walkable outward faces. Their normals are returned in the body's yaw frame. */
function sample(world: CollisionWorld, x: number, y: number, z: number, probe: number, co: number, sn: number, originX: number, originZ: number, clearance: number): boolean {
  if(castWorld(world,x,castTop,z,0,-1,0,castTop-y+probe)===HIT_NONE || !(rayHit.ny>=.65) || rayHit.t<clearance*.1) return false;
  surface=castTop-rayHit.t;
  nx=co*rayHit.nx-sn*rayHit.nz; ny=rayHit.ny; nz=sn*rayHit.nx+co*rayHit.nz;
  if (!Number.isFinite(surface+nx+ny+nz)) return false;
  // Reach this surface from the body's supported floor, first lifting and then moving across. A roof
  // over the animal is not its floor; an ordinary step remains reachable without crossing its riser.
  const up=Math.max(y,surface)+clearance, rise=up-y-clearance*.5;
  if(rise>0 && castWorld(world,originX,y+clearance*.5,originZ,0,1,0,rise)!==HIT_NONE)return false;
  const dx=x-originX,dz=z-originZ,distance=length(dx,0,dz);
  return distance<1e-8 || castWorld(world,originX,up,originZ,dx/distance,0,dz/distance,distance)===HIT_NONE;
}

/** Metres along a walkable support plane per horizontal metre, also used by the server's stateless gait phase. */
export function groundSpeedScale(rig: Rig, st: AnimState, world: CollisionWorld | null | undefined, x: number, y: number, z: number, yaw: number, size = 1): number {
  const g = rig.ground;
  if (!g || !world || st.mode !== MODE_WALK || !st.grounded || st.out || st.dead || st.held || st.cue === CUE_TORPOR || !(size > 0)) return 1;
  const probe = g.probe * size, clearance = .02 * size;
  castTop = y + probe;
  if (castWorld(world, x, y + clearance, z, 0, 1, 0, probe - clearance) !== HIT_NONE) castTop = y + rayHit.t;
  if (!sample(world, x, y, z, probe, detCos(yaw), detSin(yaw), x, z, clearance)) return 1;
  const direction = st.dir * TAU / DIR_STEPS;
  const rise = Math.max(-1, Math.min(1, -(nx * detSin(direction) + nz * detCos(direction)) / ny));
  return Math.sqrt(1 + rise * rise);
}

/**
 * Ground-fit an already solved authored pose, in model units. Body origin/yaw and size are world units/radians.
 * Use this same calculation for rendering, seats, authoritative sockets and hit zones. It changes pose and solved
 * together, has no retained per-body history, and makes no allocations. Invalid/missing support preserves the pose.
 */
export function conformCreature(rig: Rig, st: AnimState, pose: Pose, solved: Solved, world: CollisionWorld | null | undefined, x: number, y: number, z: number, yaw: number, size=1): void {
  const g=rig.ground;
  if(!g || !world || st.mode!==MODE_WALK || !st.grounded || st.out || st.dead || st.held || st.cue===CUE_TORPOR || !(size>0) || !Number.isFinite(x+y+z+yaw+size)) return;
  const co=detCos(yaw),sn=detSin(yaw),probe=g.probe*size,n=g.legs.length;
  const clearance=.02*size;
  castTop=y+probe;
  if(castWorld(world,x,y+clearance,z,0,1,0,probe-clearance)!==HIT_NONE) castTop=y+rayHit.t;
  if(!sample(world,x,y,z,probe,co,sn,x,z,clearance))return;
  const centerA=-nx/ny,centerB=-nz/ny,centerC=(surface-y)/size;
  // The movement-supported origin remains a real support even as feet leave a ledge. A small prior on its
  // surface normal prevents a nearly weightless third foot from dictating an otherwise singular body plane.
  let weight=1,mx=0,mz=0,mh=centerC,spreadX=0,spreadZ=0;
  for(let i=0;i<n;i++) {
    const leg=g.legs[i]!,at=i*3,er=leg.end*4;
    spreadX+=leg.x*leg.x;spreadZ+=leg.z*leg.z;
    boneToModel(solved,leg.foot.bone,leg.foot.x,leg.foot.y,leg.foot.z,point);
    for(let j=0;j<3;j++) originalFoot[at+j]=point[j]!;
    for(let j=0;j<4;j++) originalEnd[i*4+j]=solved.rot[er+j]!;
    support[i]=sample(world,x+size*(co*leg.x+sn*leg.z),y,z+size*(co*leg.z-sn*leg.x),probe,co,sn,x,z,clearance)?1:0;
    if(!support[i])continue;
    terrain[i]=(surface-y)/size;
    // A cliff below a foot must not drag the body plane down and then pop off at the ray's range.
    // Fade support continuously as it leaves the reachable layer around the body's own floor.
    const residual=Math.abs(terrain[i]!-(centerA*leg.x+centerB*leg.z+centerC));
    const share=Math.max(0,1-residual/g.maxStep);support[i]=share*share;
    if(support[i]!<1e-8){support[i]=0;continue;}
    const w=support[i]!;mx+=leg.x*w; mz+=leg.z*w; mh+=terrain[i]!*w; weight+=w;
  }
  mx/=weight; mz/=weight; mh/=weight;
  const priorX=Math.max(.0001,spreadX/n*.05),priorZ=Math.max(.0001,spreadZ/n*.05);
  let xx=mx*mx+priorX,zz=mz*mz+priorZ,xz=mx*mz;
  let xh=-mx*(centerC-mh)+priorX*centerA,zh=-mz*(centerC-mh)+priorZ*centerB;
  for(let i=0;i<n;i++)if(support[i]) {
    const leg=g.legs[i]!,dx=leg.x-mx,dz=leg.z-mz,dh=terrain[i]!-mh;
    const w=support[i]!;xx+=dx*dx*w;zz+=dz*dz*w;xz+=dx*dz*w;xh+=dx*dh*w;zh+=dz*dh*w;
  }
  const determinant=xx*zz-xz*xz;
  if(!(determinant>1e-8))return;
  let a=(xh*zz-zh*xz)/determinant,b=(zh*xx-xh*xz)/determinant;
  const tilt=length(a,0,b),limit=detSin(g.maxTilt)/detCos(g.maxTilt);
  if(tilt>limit && tilt>0){a*=limit/tilt;b*=limit/tilt;}
  const c=Math.max(-g.maxStep,Math.min(g.maxStep,mh-a*mx-b*mz));
  // A perfectly level supported floor leaves every authored bone bit-for-bit unchanged.
  if(Math.abs(a)+Math.abs(b)+Math.abs(c)<1e-8) {
    let level=true;
    for(let i=0;i<n;i++)if(support[i] && Math.abs(terrain[i]!)>1e-8)level=false;
    if(level)return;
  }
  const inv=1/Math.sqrt(1+a*a+b*b);
  normal[0]=-b*inv; normal[1]=0; normal[2]=a*inv; normal[3]=1+inv;quatNormalize(normal,0);
  quatRotate(normal,0,solved.pos[0]!,solved.pos[1]!,solved.pos[2]!,rotated,0);
  pose.root[0]=rotated[0]!-rig.rest[0]!;pose.root[1]=rotated[1]!+c-rig.rest[1]!;pose.root[2]=rotated[2]!-rig.rest[2]!;
  quatMul(pose.rot,0,normal,0,pose.rot,0);
  solve(rig,pose,solved);
  active.fill(0);
  for(let i=0;i<n;i++) {
    const leg=g.legs[i]!,at=i*3,rot=i*4,upper=leg.upper*3,lower=leg.lower*3,end=leg.end*3;
    boneToModel(solved,leg.foot.bone,leg.foot.x,leg.foot.y,leg.foot.z,point);
    const fx=point[0]!,fy=point[1]!,fz=point[2]!;
    if(!sample(world,x+size*(co*fx+sn*fz),y,z+size*(co*fz-sn*fx),probe,co,sn,x,z,.02*size))continue;
    const floor=(surface-y)/size,plane=a*fx+b*fz+c;
    // Retain the authored clearance, including toe articulation and body bounce, above the local support plane.
    const targetY=floor+originalFoot[at+1]!/ny;
    const residual=Math.max(Math.abs(floor-plane),Math.abs(targetY-fy));
    if(residual>=g.maxStep)continue;
    // Release an increasingly unsupported foot continuously. A hard range cutoff snaps the whole knee back
    // when a ledge moves just beyond the step limit; the last quarter of that range returns to the authored pose.
    const edge=Math.min(1,(g.maxStep-residual)/(g.maxStep*.25));
    influence[i]=edge*edge*(3-2*edge);
    for(let j=0;j<4;j++) {
      originalLeg[i*12+j]=pose.rot[leg.upper*4+j]!;
      originalLeg[i*12+4+j]=pose.rot[leg.lower*4+j]!;
      originalLeg[i*12+8+j]=pose.rot[leg.end*4+j]!;
    }
    normal[0]=nz;normal[1]=0;normal[2]=-nx;normal[3]=1+ny;quatNormalize(normal,0);
    quatMul(targetRot,rot,normal,0,originalEnd,rot);
    // The sole may be on a descendant toe. Carry that authored offset with the chosen ankle orientation.
    quatUnrotate(solved.rot,leg.end*4,fx-solved.pos[end]!,fy-solved.pos[end+1]!,fz-solved.pos[end+2]!,rotated,0);
    quatRotate(targetRot,rot,rotated[0]!,rotated[1]!,rotated[2]!,rotated,0);
    const gx=fx-rotated[0]!,gy=targetY-rotated[1]!,gz=fz-rotated[2]!;
    const sx=solved.pos[upper]!,sy=solved.pos[upper+1]!,sz=solved.pos[upper+2]!;
    const ux=rig.rest[lower]!-rig.rest[upper]!,uy=rig.rest[lower+1]!-rig.rest[upper+1]!,uz=rig.rest[lower+2]!-rig.rest[upper+2]!;
    const lx=rig.rest[end]!-rig.rest[lower]!,ly=rig.rest[end+1]!-rig.rest[lower+1]!,lz=rig.rest[end+2]!-rig.rest[lower+2]!;
    const first=length(ux,uy,uz),second=length(lx,ly,lz);
    let dx=gx-sx,dy=gy-sy,dz=gz-sz,reach=length(dx,dy,dz);
    if(!(first>1e-6 && second>1e-6 && reach>1e-8))continue;
    dx/=reach;dy/=reach;dz/=reach;
    reach=Math.max(Math.abs(first-second)+.0001,Math.min(first+second-.0001,reach));
    goals[at]=sx+dx*reach;goals[at+1]=sy+dy*reach;goals[at+2]=sz+dz*reach;
    let px=solved.pos[lower]!-sx,py=solved.pos[lower+1]!-sy,pz=solved.pos[lower+2]!-sz;
    const along=px*dx+py*dy+pz*dz;
    px-=dx*along;py-=dy*along;pz-=dz*along;
    let plen=length(px,py,pz);
    if(plen<1e-6) {px=0;py=-dz;pz=dy;plen=length(px,py,pz);}
    if(plen<1e-6)continue;
    const forward=(first*first-second*second+reach*reach)/(2*reach),bend=Math.sqrt(Math.max(0,first*first-forward*forward));
    bends[at]=sx+dx*forward+px/plen*bend;bends[at+1]=sy+dy*forward+py/plen*bend;bends[at+2]=sz+dz*forward+pz/plen*bend;
    // Turn the authored segment toward its target, retaining its existing axial twist.
    toward(solved.pos[lower]!-sx,solved.pos[lower+1]!-sy,solved.pos[lower+2]!-sz,bends[at]!-sx,bends[at+1]!-sy,bends[at+2]!-sz);
    quatMul(q,0,q,0,solved.rot,leg.upper*4);
    quatMulConj(pose.rot,leg.upper*4,solved.rot,rig.parent[leg.upper]!*4,q,0);
    active[i]=1;
  }
  solve(rig,pose,solved);
  for(let i=0;i<n;i++)if(active[i]) {
    const leg=g.legs[i]!,at=i*3,lower=leg.lower*3,end=leg.end*3;
    toward(solved.pos[end]!-solved.pos[lower]!,solved.pos[end+1]!-solved.pos[lower+1]!,solved.pos[end+2]!-solved.pos[lower+2]!,goals[at]!-bends[at]!,goals[at+1]!-bends[at+1]!,goals[at+2]!-bends[at+2]!);
    quatMul(q,0,q,0,solved.rot,leg.lower*4);
    quatMulConj(pose.rot,leg.lower*4,solved.rot,leg.upper*4,q,0);
  }
  solve(rig,pose,solved);
  for(let i=0;i<n;i++)if(active[i]) {
    const leg=g.legs[i]!;quatMulConj(pose.rot,leg.end*4,solved.rot,leg.lower*4,targetRot,i*4);
    // Fade the whole fitted chain, rather than its reach target: near full extension a tiny change in reach
    // otherwise makes a large knee bend. Interpolating local rotations also preserves every bone length.
    if(influence[i]!<1) {
      quatNlerp(pose.rot,leg.upper*4,originalLeg,i*12,pose.rot,leg.upper*4,influence[i]!);
      quatNlerp(pose.rot,leg.lower*4,originalLeg,i*12+4,pose.rot,leg.lower*4,influence[i]!);
      quatNlerp(pose.rot,leg.end*4,originalLeg,i*12+8,pose.rot,leg.end*4,influence[i]!);
    }
  }
  solve(rig,pose,solved);
}
