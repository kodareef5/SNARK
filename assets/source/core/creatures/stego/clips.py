"""Original authored Stego motion at 30 Hz.

Four-foot gaits solve the limb chains to planted world-space contacts. Ground
combat keys only the tail and neck; runtime blends these named bones over the
locomotion pose. There is no sampled library animation.
"""
import math
import numpy as np
from functools import lru_cache
import bpy
from mathutils import Vector, Matrix, Quaternion
import rig

ARM=rig.armature()
FPS=30
TAU=2*math.pi

def ease(t): t=max(0,min(1,t));return t*t*(3-2*t)
def pulse(t,a,b,c):return ease((t-a)/(b-a)) if t<b else 1-ease((t-b)/(c-b))
def axis_rotation(pitch=0,yaw=0,roll=0):
 # Engine forward is Blender -Y: a positive anatomical pitch raises the head.
 return Quaternion((0,0,1),math.radians(yaw))@Quaternion((1,0,0),math.radians(-pitch))@Quaternion((0,-1,0),math.radians(roll))
def reset():
 for p in ARM.pose.bones:p.location=(0,0,0);p.rotation_quaternion=(1,0,0,0);p.scale=(1,1,1)

def turn(name,pitch=0,yaw=0,roll=0):
 p=ARM.pose.bones[name];r=p.bone.matrix_local.to_quaternion();p.rotation_quaternion=r.inverted()@axis_rotation(pitch,yaw,roll)@r

def root(height=0,pitch=0,roll=0):
 p=ARM.pose.bones['pelvis'];rest=p.bone.matrix_local
 p.matrix=Matrix.Translation(rest.translation+rig.B((0,height,0)))@axis_rotation(pitch,0,roll).to_matrix().to_4x4()@rest.to_quaternion().to_matrix().to_4x4()
 bpy.context.view_layer.update()

def segment(name,start,end):
 p=ARM.pose.bones[name];rest=p.bone;direction=(rest.tail_local-rest.head_local).normalized();q=direction.rotation_difference((end-start).normalized())
 p.matrix=Matrix.Translation(start)@q.to_matrix().to_4x4()@rest.matrix_local.to_quaternion().to_matrix().to_4x4()
 bpy.context.view_layer.update()

def foot(kind,side,zshift=0,lift=0,xshift=0,heading=0):
 up=ARM.pose.bones[f'{kind}_upper_{side}'];low=ARM.pose.bones[f'{kind}_lower_{side}'];end=ARM.pose.bones[f'{kind}_foot_{side}']
 h=up.matrix.translation.copy();rest=end.bone.matrix_local;target=rest.translation+rig.B((xshift,lift,zshift));delta=target-h;d=delta.length;a=up.bone.length;b=low.bone.length
 if d>a+b-.001:target=h+delta.normalized()*(a+b-.001);delta=target-h;d=delta.length
 direction=delta.normalized();along=(a*a-b*b+d*d)/(2*d);rise=math.sqrt(max(0,a*a-along*along))
 pole=rig.B((0,0,1 if kind=='hind'else -1));pole=(pole-direction*pole.dot(direction)).normalized();knee=h+direction*along+pole*rise
 segment(up.name,h,knee);segment(low.name,knee,target)
 end.matrix=Matrix.Translation(target)@axis_rotation(yaw=heading).to_matrix().to_4x4()@rest.to_quaternion().to_matrix().to_4x4();bpy.context.view_layer.update()

def ground_skin():
 # Authored collapse support uses the actual finished, weighted skin. A capsule
 # fit cannot stand in for feet/plates/spikes when deciding where a pose rests.
 body=bpy.data.objects.get('stego_body')
 if body is None:raise ValueError('grounded collapse requires finished stego_body')
 bpy.context.view_layer.update()
 evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
 points=np.empty(len(evaluated.data.vertices)*3,dtype=np.float32)
 evaluated.data.vertices.foreach_get('co',points)
 low=float(points.reshape(-1,3)[:,2].min())
 pelvis=ARM.pose.bones['pelvis'];matrix=pelvis.matrix.copy()
 # Support the actual source surface exactly; the native regression measures
 # quantization/interpolation against the existing one-millimetre envelope.
 matrix.translation.z-=low;pelvis.matrix=matrix
 bpy.context.view_layer.update()

def key(frame):
 for p in ARM.pose.bones:
  p.keyframe_insert('rotation_quaternion',frame=frame,group=p.name)
  p.keyframe_insert('location',frame=frame,group=p.name)

def make(name,frames,func,loop=False):
 reset();ARM.animation_data_create();action=bpy.data.actions.new(name);ARM.animation_data.action=action
 for f in range(frames+1):
  reset();func(f/frames,f)
  # Breathing moves the trunk over fixed contacts, never the weight-bearing
  # pads through the floor. Combat layers and water/air clips keep their own
  # authored semantics; only the stationary grounded full-body clips solve.
  if name in {'idle','idle_look','idle_graze','call','startled'}:
   for kind in ['hind','fore']:
    for side in ['l','r']:foot(kind,side)
  if name in {'torpor_in','torpor_idle','torpor_out','death'}:ground_skin()
  key(f)
 action.use_frame_range=True;action.frame_start=0;action.frame_end=frames
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for curve in bag.fcurves:
     for k in curve.keyframe_points:k.interpolation='LINEAR'
 action['loop']=loop
 ARM.animation_data.action=None;reset();return action

def breath(t):
 turn('spine',pitch=.25*math.sin(t*TAU));turn('neck_1',pitch=.7*math.sin(t*TAU-.7));turn('neck_2',pitch=-.5*math.sin(t*TAU-.7))
 for i in range(1,8):turn(f'tail_{i}',yaw=1.1*math.sin(t*TAU-i*.35))

def idle(t,f):breath(t)

def gait(t,f,run=False):
 stride=2.4 if run else 1.8;stance=.58 if run else .66;period=TAU*t
 root(-.13 if run else -.08,pitch=.35*math.sin(period*2),roll=.45*math.sin(period))
 for kind,side,phase in [('hind','l',0),('fore','l',.25),('hind','r',.5),('fore','r',.75)]:
  p=(t+phase)%1
  if p<stance:z=stride*stance/2-stride*p;lift=0
  else:
   q=(p-stance)/(1-stance);z=-stride*stance/2+stride*stance*ease(q);lift=(.23 if run else .14)*math.sin(math.pi*q)
  foot(kind,side,z,lift)
 turn('neck_1',pitch=.8*math.sin(period*2));turn('neck_2',pitch=-.65*math.sin(period*2));turn('skull',pitch=-.15*math.sin(period*2))
 for i in range(1,8):turn(f'tail_{i}',yaw=(1.5 if run else .8)*math.sin(period-i*.3),pitch=.4*math.sin(period*2-i*.2))

def tail_pose(amount,side=1,hold=False,pitch=None):
 for i in range(1,8):
  # Broad arc through a muscular tail base, delayed distal follow-through.
  turn(f'tail_{i}',yaw=side*amount*(10 if i<3 else 13),pitch=((-1.1 if hold else 1)if pitch is None else pitch)*amount)
 turn('neck_1',yaw=-side*amount*9);turn('neck_2',yaw=-side*amount*10);turn('skull',yaw=-side*amount*6)

def attack(t,f,side=1):
 # 34 ticks. Anticipation winds away; contact crosses the rear quarter at 14–21.
 value=-.35*ease(t/.27) if t<.27 else (-.35+1.65*ease((t-.27)/.34) if t<.61 else 1.30*(1-ease((t-.61)/.39)))
 tail_pose(value,side)

def impale_in(t,f):tail_pose(ease(t/.70),1,True,pitch=.55)
def impale_hold(t,f):
 # Acquire at torso height, then lift without moving the victim through soil.
 # This six-second non-looping action begins at the identical strike pose.
 lift=ease(f/15);pitch=.55+(-1.1-.55)*lift
 tail_pose(1,1,True,pitch=pitch);turn('tail_7',yaw=13,pitch=pitch+.25*math.sin(f/30*TAU)*lift)
def impale_out(t,f):tail_pose(1-ease(t),1,True)

def plate_pose(t,f,kind):
 for i,plate in enumerate(rig.PLATES):
  sign=1 if plate[5]>0 else -1
  turn(f'plate_{i:02d}',roll=sign*({'hardened':-18,'heavy':8,'sharpened':-3}[kind]),pitch={'hardened':-3,'heavy':6,'sharpened':-8}[kind])
def plate_switch(t,f):
 for i,p in enumerate(rig.PLATES):turn(f'plate_{i:02d}',roll=(1 if p[5]>0 else -1)*3*math.sin(t*TAU)*math.sin(math.pi*t))

def call(t,f):
 a=pulse(t,0,.32,1);turn('neck_1',pitch=4*a);turn('neck_2',pitch=6*a);turn('skull',pitch=5*a);turn('jaw',pitch=-26*a)
def look(t,f):
 a=math.sin(math.pi*t)**2;turn('neck_1',yaw=8*a);turn('neck_2',yaw=13*a);turn('skull',yaw=9*a)
def graze(t,f):
 a=pulse(t,0,.35,1);turn('neck_1',pitch=-12*a);turn('neck_2',pitch=-10*a);turn('skull',pitch=12*a);turn('jaw',pitch=-4*a*(.5+.5*math.sin(t*TAU*4)))
def flinch(t,f):
 a=math.sin(math.pi*t)**2;turn('neck_1',pitch=3*a,yaw=-3*a);turn('skull',yaw=5*a);turn('jaw',pitch=-4*a)
def startled(t,f):
 a=pulse(t,0,.22,1);turn('neck_1',pitch=6*a);turn('neck_2',pitch=3*a);turn('skull',yaw=8*a)
 for i in range(1,8):turn(f'tail_{i}',pitch=2*a,yaw=-2*a)
def swim(t,f):
 for k,side,phase in [('hind','l',0),('fore','l',.25),('hind','r',.5),('fore','r',.75)]:
  p=TAU*(t+phase);turn(f'{k}_upper_{side}',pitch=15*math.sin(p));turn(f'{k}_lower_{side}',pitch=10+10*math.cos(p));turn(f'{k}_foot_{side}',pitch=-8)
 turn('neck_1',pitch=20);turn('neck_2',pitch=18);turn('neck_3',pitch=-6);turn('skull',pitch=-10)
 for i in range(1,8):turn(f'tail_{i}',yaw=1.5*math.sin(t*TAU-i*.4))
def swim_idle(t,f):
 swim(t,f)
 for k in ['fore','hind']:
  for side in ['l','r']:turn(f'{k}_upper_{side}',pitch=4*math.sin(t*TAU))
def startled_swim(t,f):
 swim(t,f);a=math.sin(math.pi*t)**2
 turn('neck_1',pitch=20+3*a,yaw=-5*a);turn('skull',pitch=-10,yaw=8*a)
def land_swim(t,f):
 swim(t,f);a=math.sin(math.pi*t)**2
 root(-.045*a);turn('neck_1',pitch=20+4*a)
 for kind in ['hind','fore']:
  for side in ['l','r']:turn(f'{kind}_upper_{side}',pitch=-9*a)
def torpor_out_swim(t,f):
 # Awake water recovery starts from the swimming breathing pose. The shared
 # controller blends it from awake swim; actual unconscious poses stay low.
 swim_idle(t,f);a=math.sin(math.pi*t)**2
 root(-.025*a,roll=2.5*math.sin(t*TAU)*a)
 turn('neck_1',pitch=20+2*a,yaw=3*math.sin(t*TAU)*a)
 turn('jaw',pitch=-3*a)
def fall(t,f):
 # A heavy quadruped braces in free fall: forefeet search forward while hind
 # feet tuck closer. Small asynchronous corrections avoid a frozen air pose.
 for kind in ['fore','hind']:
  for side,phase in [('l',0),('r',math.pi)]:
   correction=math.sin(t*TAU+phase+(0 if kind=='fore'else .7))
   turn(f'{kind}_upper_{side}',pitch=(-12 if kind=='fore'else 7)+3*correction)
   turn(f'{kind}_lower_{side}',pitch=(22 if kind=='fore'else -17)+2*correction)
   turn(f'{kind}_foot_{side}',pitch=-5-2*correction)
 turn('neck_1',pitch=6+1.1*math.sin(t*TAU));turn('neck_2',pitch=-.7*math.sin(t*TAU))
 for i in range(1,8):turn(f'tail_{i}',pitch=-1.1+.35*math.sin(t*TAU-i*.4))
def land(t,f):
 a=math.sin(math.pi*t)**2;root(-.20*a)
 for kind in ['fore','hind']:
  for side in ['l','r']:foot(kind,side)
 turn('neck_1',pitch=-3*a);turn('neck_2',pitch=3*a)
def down_pose(a):
 root(-.76*a,pitch=1*a,roll=87*a)
 for kind in ['fore','hind']:
  for side in ['l','r']:
   turn(f'{kind}_upper_{side}',pitch=(35 if kind=='hind'else -24)*a,roll=(8 if side=='l'else 30)*a)
   turn(f'{kind}_lower_{side}',pitch=(-35 if kind=='hind'else 42)*a)
 for i in range(1,8):turn(f'tail_{i}',yaw=-3*a,pitch=1*a)
 turn('neck_1',pitch=-5*a);turn('neck_2',pitch=-4*a)
@lru_cache(None)
def support_switches():
 # A foot-to-flank support transfer is a cusp in the grounded root path. If it
 # lands between 30Hz keys, linear root interpolation makes the whole body
 # hover. Locate the actual skin transfer and put it on a key, preserving the
 # authored clip length and smooth angular velocity rather than adding a gap.
 body=bpy.data.objects['stego_body'];groups={g.index:g.name for g in body.vertex_groups}
 labels=np.array([groups[max(v.groups,key=lambda g:g.weight).group]for v in body.data.vertices])
 points=np.empty(len(body.data.vertices)*3,dtype=np.float32);result=[]
 def heights(amount):
  reset();down_pose(amount);bpy.context.view_layer.update()
  evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
  evaluated.data.vertices.foreach_get('co',points)
  return points.reshape(-1,3)[:,2]
 # Discover support pairs on the fitted skin, including the transfer from
 # the outer foot onto the hip. Their times change with the sculpt.
 lo=.015
 first=labels[heights(lo).argmin()]
 for hi in np.linspace(lo,1,65)[1:]:
  second=labels[heights(hi).argmin()]
  if first!=second:
   left,right=lo,hi
   for _ in range(22):
    mid=(left+right)/2;h=heights(mid)
    if h[labels==first].min()<h[labels==second].min():left=mid
    else:right=mid
   result.append((left+right)/2)
  first,lo=second,hi
 reset();print('COLLAPSE_SUPPORT_TRANSFERS',result,flush=True);return tuple(result)

@lru_cache(None)
def collapse_knots(frames,reverse):
 knots=[(0,0)]
 for amount in support_switches():
  goal=1-amount if reverse else amount;lo=0;hi=1
  for _ in range(40):
   mid=(lo+hi)/2
   if ease(mid)<goal:lo=mid
   else:hi=mid
  original=(lo+hi)/2;key=round(original*frames)/frames
  knots.append((key,original))
 return sorted(knots+[(1,1)])

def collapse_amount(t,frames,reverse=False):
 t=max(0,min(1,t));knots=collapse_knots(frames,reverse)
 for (key0,time0),(key1,time1)in zip(knots,knots[1:]):
  if key0<=t<=key1:
   blend=ease((t-key0)/(key1-key0));mapped=t+(time0-key0)*(1-blend)+(time1-key1)*blend
   amount=ease(mapped);return 1-amount if reverse else amount
 raise ValueError('collapse time outside authored knots')

def torpor_in(t,f):down_pose(collapse_amount(t,65))
def torpor_idle(t,f):
 down_pose(1);turn('spine',pitch=.20*math.sin(t*TAU),roll=.18*math.sin(t*TAU))
 turn('neck_2',pitch=-4+.45*math.sin(t*TAU-.35));turn('jaw',pitch=-2-.25*math.sin(t*TAU-.35))
def torpor_out(t,f):down_pose(collapse_amount(t,80,True))
def torpor_eat(t,f):turn('jaw',pitch=-6*math.sin(math.pi*t)**2)
def death(t,f):
 down_pose(collapse_amount(min(1,t/.80),56));turn('jaw',pitch=-8*ease(t))
def turn_clip(t,f):
 # The native player supplies smooth 90-degree body yaw. Every planted foot
 # stays at its last world heading while this clip counter-turns it locally.
 root(-.14*math.sin(math.pi*t))
 angle=90*ease(t)
 for index,(kind,side)in enumerate([('hind','l'),('fore','r'),('hind','r'),('fore','l')]):
  rest=rig.JOINTS[f'{kind}_foot_{side}'];world_angle=0;lift=0
  centers=[.10+.08*index,.46+.08*index,.76+.06*index]
  for step,center in enumerate(centers):
   start,end=center-.04,center+.04;target=90 if step==2 else 90*ease(center+.14)
   if t>=end:world_angle=target
   elif t>start:
    q=(t-start)/(end-start);world_angle=world_angle+(target-world_angle)*ease(q);lift=.13*math.sin(math.pi*q);break
   else:break
  local=math.radians(world_angle-angle);x=rest.x*math.cos(local)+rest.z*math.sin(local);z=rest.z*math.cos(local)-rest.x*math.sin(local)
  foot(kind,side,z-rest.z,lift,x-rest.x,world_angle-angle)
 turn('neck_1',yaw=5*math.sin(math.pi*t));turn('neck_2',yaw=3*math.sin(math.pi*t))

make('idle',120,idle,True);make('idle_look',90,look);make('idle_graze',150,graze)
make('walk',60,gait,True);make('run',36,lambda t,f:gait(t,f,True),True);make('turn',120,turn_clip)
make('attack',34,attack);make('attack_right',34,lambda t,f:attack(t,f,-1))
make('impale_in',30,impale_in);make('impale_hold',180,impale_hold);make('impale_out',24,impale_out)
make('plate_switch',30,plate_switch)
for mode in ['hardened','heavy','sharpened']:make('plate_'+mode,1,lambda t,f,k=mode:plate_pose(t,f,k),True)
make('call',90,call);make('startled',30,startled);make('flinch',15,flinch)
make('swim',60,swim,True);make('swim_idle',120,swim_idle,True);make('fall',30,fall,True);make('land',30,land)
make('startled_swim',30,startled_swim);make('land_swim',30,land_swim);make('torpor_out_swim',60,torpor_out_swim)
make('torpor_in',65,torpor_in);make('torpor_idle',120,torpor_idle,True);make('torpor_eat',35,torpor_eat);make('torpor_out',80,torpor_out);make('death',70,death)
ARM.animation_data.action=None;reset()
