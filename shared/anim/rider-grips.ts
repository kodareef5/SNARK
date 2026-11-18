// Load-authored native hand contact tables. Only changed mesh/look/hardware recomputes a cached pose.
import type {PackGrip} from "../pack/pack.ts";
import {B_HAND_L,B_HAND_R,HUMAN_BONES} from "./human.ts";
import {defaultLook,LOOK_BYTES,lookScales} from "./look.ts";

const PLAIN=defaultLook();
export const GRIP_POSE_FLOATS=12;
export function validGrip(profile:PackGrip):boolean {
  if(!Number.isFinite(profile.start+profile.step)||profile.start<=0||profile.step<=0||profile.step>.01||
    profile.poses.length<24||profile.poses.length>129*GRIP_POSE_FLOATS||profile.poses.length%GRIP_POSE_FLOATS!==0||
    profile.span.length!==2||!profile.span.every(Number.isFinite)||profile.span[0]>=profile.span[1]||Math.abs(profile.span[0])>.3||Math.abs(profile.span[1])>.3)return false;
  for(let i=0;i<profile.poses.length;i++){
    const n=profile.poses[i]!,part=i%6;
    if(!Number.isFinite(n)||(part<2?Math.abs(n)>.08:part===2?n<.2||n>1.5:part===3?n<.15||n>2:part===4?n<-.4||n>1.4:n<0||n>1.8))return false;
  }
  return true;
}

/** Output per hand: marker X/Z correction in rider coordinates, followed by four native joint angles; left then right. */
export function gripPose(profile:PackGrip,radius:number,low:number,high:number,scale:Float32Array|null,out:Float64Array):boolean {
  const size=scale?.[B_HAND_L*3]??1;
  if(!(size>0)||!Number.isFinite(radius+low+high+size)||low>=0||high<=0||
    (scale&&(scale[B_HAND_L*3+1]!==size||scale[B_HAND_L*3+2]!==size||scale[B_HAND_R*3]!==size||scale[B_HAND_R*3+1]!==size||scale[B_HAND_R*3+2]!==size))||
    profile.span[0]*size<low||profile.span[1]*size>high)return false;
  const row=(radius/size-profile.start)/profile.step,last=profile.poses.length/GRIP_POSE_FLOATS-1;
  if(row<0||row>last||!Number.isFinite(row))return false;
  const a=Math.min(last-1,Math.floor(row)),t=row-a;
  for(let i=0;i<GRIP_POSE_FLOATS;i++) {
    const x=profile.poses[a*GRIP_POSE_FLOATS+i]!,y=profile.poses[(a+1)*GRIP_POSE_FLOATS+i]!;
    out[i]=(x+(y-x)*t)*(i%6<2?size:1);
  }
  return true;
}

export class RiderGrips {
  readonly pose=new Float64Array(GRIP_POSE_FLOATS);
  revision=0;
  private readonly look=new Uint8Array(LOOK_BYTES);
  private readonly scale=new Float32Array(HUMAN_BONES*3);
  private profile:PackGrip|null=null;
  private radius=0;
  private low=0;
  private high=0;
  private alignment=0;
  private ready=false;
  private valid=false;
  private profileValid=false;
  update(profile:PackGrip|null,look:Uint8Array|null,radius:number,low:number,high:number,at=0,alignment=0):Float64Array|null {
    const view=look??PLAIN,from=look?at:0;
    let same=this.ready&&this.profile===profile&&this.radius===radius&&this.low===low&&this.high===high&&this.alignment===alignment;
    for(let i=0;same&&i<LOOK_BYTES;i++)same=this.look[i]===view[from+i];
    if(same)return this.valid?this.pose:null;
    if(this.profile!==profile||!this.ready)this.profileValid=profile!==null&&validGrip(profile);
    this.profile=profile;this.radius=radius;this.low=low;this.high=high;this.alignment=alignment;this.ready=true;this.revision++;
    for(let i=0;i<LOOK_BYTES;i++)this.look[i]=view[from+i]!;
    lookScales(this.look,this.scale);
    this.valid=Number.isFinite(alignment)&&alignment>=0&&alignment<=90&&this.profileValid&&profile!==null&&gripPose(profile,radius,low,high,this.scale,this.pose);
    return this.valid?this.pose:null;
  }
}
