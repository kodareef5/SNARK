"""Original SNARK Stegosaurus. Engine-space metres: x left, y up, z forward.

This file owns proportions, bones and contact sockets. No library geometry or
animation is imported. Authoring tools use Blender x/-y/z through B().
"""
import math
from pathlib import Path
import bpy
from mathutils import Vector, Matrix, Quaternion

FPS=30
LENGTH=9.0
TRIANGLES=[32000,14000,6200,2600,1000,340]
WALK_FRAMES=60
RUN_FRAMES=36
WALK_STRIDE=1.8
RUN_STRIDE=2.4
ROOT=Path(__file__).resolve().parent

def B(p): return Vector((p[0],-p[2],p[1]))
def E(p): return Vector((p[0],p[2],-p[1]))
def mirror(p,s): return (p[0]*s,p[1],p[2])
def layout(p):
 """Authored proportions for the already measured rigid saddle hardware."""
 x,y,z=p
 if z>1.5:z=1.5+(z-1.5)*.67
 elif z< -1.4:z=-1.4+(z+1.4)*1.20
 return (x,y,z)

def shape(p):
 """Anatomical proportions with a C1 cervical transition.

 The old abrupt 1-to-.67 longitudinal scale change made a tangent break at
 the shoulder. The 30 cm Hermite band keeps the outside measurements and
 slopes; every skeletal joint lies outside it. Rigid control hardware retains
 its separately measured layout instead of following a soft-tissue reshape.
 """
 x,y,z=p
 if 1.35<z<1.65:
  t=(z-1.35)/.30;t2=t*t;t3=t2*t
  z=(2*t3-3*t2+1)*1.35+(t3-2*t2+t)*.30+(-2*t3+3*t2)*1.6005+(t3-t2)*.30*.67
  return (x,y,z)
 return layout(p)

BODY=[
 (-5.24,1.36,.025,.035,.030),(-4.95,1.34,.055,.065,.055),(-4.64,1.30,.085,.095,.080),
 (-4.30,1.24,.115,.12,.10),(-3.94,1.20,.15,.15,.13),(-3.58,1.19,.19,.18,.17),
 (-3.20,1.22,.24,.23,.21),(-2.82,1.30,.29,.28,.25),(-2.44,1.41,.35,.36,.32),
 (-2.08,1.58,.45,.45,.40),(-1.75,1.76,.59,.57,.53),(-1.45,1.90,.79,.69,.75),
 (-1.12,1.91,.93,1.04,.86),(-.72,1.88,1.04,1.12,.98),(-.28,1.82,1.08,.96,1.04),
 (.18,1.73,1.06,.87,1.03),(.58,1.64,.96,.79,.92),(.92,1.57,.86,.68,.75),
 (1.20,1.59,.78,.64,.64),(1.47,1.48,.49,.55,.43),(1.75,1.35,.32,.42,.29),
 (2.02,1.30,.255,.34,.245),(2.28,1.36,.23,.27,.205),(2.53,1.34,.205,.21,.165),
 (2.76,1.30,.215,.18,.175),(2.99,1.29,.230,.155,.185),(3.17,1.23,.195,.145,.125),
 (3.36,1.20,.150,.125,.095),(3.55,1.16,.092,.105,.055),(3.71,1.14,.020,.055,.050),
 (3.75,1.095,.010,.028,.020),
]

def back_height(x,z):
 for a,b in zip(BODY,BODY[1:]):
  if a[0]<=z<=b[0]:
   t=(z-a[0])/(b[0]-a[0]);cy=a[1]*(1-t)+b[1]*t;rx=a[2]*(1-t)+b[2]*t;up=a[3]*(1-t)+b[3]*t
   return cy+up*math.sqrt(max(0,1-(x/rx)**2))
 raise ValueError("plate root outside authored body")

# Long bones rest visibly bent; measured two-segment slack is saved by preview.py.
BONES=[
 ('pelvis',None,(0,1.76,-.82),(0,1.82,-.28)),
 ('spine','pelvis',(0,1.82,-.28),(0,1.70,.42)),
 ('chest','spine',(0,1.70,.42),(0,1.46,1.17)),
 ('neck_1','chest',(0,1.46,1.17),(0,1.28,1.78)),
 ('neck_2','neck_1',(0,1.28,1.78),(0,1.39,2.35)),
 ('neck_3','neck_2',(0,1.39,2.35),(0,1.24,2.85)),
 ('skull','neck_3',(0,1.24,2.85),(0,1.17,3.40)),
 ('jaw','skull',(0,1.12,2.96),(0,1.04,3.58)),
 ('lid_l','skull',(.196,1.30,3.02),(.196,1.31,3.12)),
 ('lid_r','skull',(-.196,1.30,3.02),(-.196,1.31,3.12)),
]
TAIL=[(0,1.81,-1.20),(0,1.63,-1.80),(0,1.40,-2.42),(0,1.23,-3.03),(0,1.18,-3.62),(0,1.23,-4.18),(0,1.31,-4.74),(0,1.36,-5.18)]
for i in range(len(TAIL)-1): BONES.append((f'tail_{i+1}','pelvis' if i==0 else f'tail_{i}',TAIL[i],TAIL[i+1]))
LEGS={
 'hind':[(.70,1.70,-.80),(.84,.96,-.38),(.77,.275,-.68),(.77,.13,-.40)],
 'fore':[(.69,1.28,1.05),(.73,.75,.78),(.71,.24,1.08),(.71,.12,1.35)],
}
for kind,points in LEGS.items():
 for side,s in [('l',1),('r',-1)]:
  for i,part in enumerate(['upper','lower','foot']):
   name=f'{kind}_{part}_{side}';parent=('pelvis' if kind=='hind' else 'chest') if i==0 else f'{kind}_{["upper","lower"][i-1]}_{side}'
   BONES.append((name,parent,mirror(points[i],s),mirror(points[i+1],s)))
# Individual plate attachment; pair staggering is biological, not mirrored twins.
# z, body surface height, plate height, base length, lean, x, parent.
PLATES=[
 (2.28,1.68,.28,.36,16,.12,'neck_2'),(1.92,1.88,.40,.43,-16,-.16,'neck_2'),
 (.64,2.53,.90,.76,-20,-.37,'chest'),(.29,2.69,1.10,.86,20,.40,'spine'),
 (-.08,2.80,1.22,.93,-21,-.42,'spine'),(-.47,2.87,1.25,.99,23,.43,'pelvis'),
 (-.84,2.83,1.28,1.00,-23,-.43,'pelvis'),(-1.21,2.65,1.13,.92,24,.40,'pelvis'),
 (-1.57,2.35,.96,.78,-23,-.34,'tail_1'),(-1.93,2.04,.80,.67,23,.29,'tail_2'),
 (-2.28,1.78,.68,.59,-24,-.24,'tail_2'),(-2.64,1.54,.54,.51,25,.19,'tail_3'),
 (-2.97,1.42,.43,.43,-25,-.15,'tail_3'),(-3.29,1.33,.33,.35,24,.12,'tail_4'),
 (-3.61,1.31,.25,.29,-23,-.09,'tail_4'),(-3.92,1.34,.19,.24,24,.07,'tail_5'),
]
PLATES=[(z,back_height(x,z)+.08,h,w,lean,x,parent)for z,y,h,w,lean,x,parent in PLATES]
for i,(z,y,h,w,lean,x,parent) in enumerate(PLATES): BONES.append((f'plate_{i:02d}',parent,(x,y-.10,z),(x+math.sin(math.radians(lean))*.45,y+.35,z-.05)))
# Each rigid spike has its own honest narrow hit/contact capsule. These are
# rigid children of the tail, never additional articulated ragdoll masses.
for pair,z,spread,parent in [('front',-4.48,.82,'tail_6'),('rear',-4.94,.75,'tail_7')]:
 for side,sign in [('l',1),('r',-1)]:
  BONES.append((f'spike_{pair}_{side}',parent,(sign*.025,1.29,z+.025),(sign*(spread+.03),1.35,z-.41)))
# The two broad plates have separate contact regions for their leading and
# trailing edges. Rigid child transforms follow the plate with no extra mass.
for n in ['plate_07','plate_10']:
 _,_,head,tip=next(b for b in BONES if b[0]==n)
 BONES.append(('edge_'+n,n,head,tip))
BONES=[(n,p,shape(a),shape(b)) for n,p,a,b in BONES]
JOINTS={n:Vector(a) for n,p,a,b in BONES}
PARENTS={n:p for n,p,a,b in BONES}
SOCKETS={
 'seat':('chest',(0,2.59,1.17)),
 'grip_l':('chest',(.17,2.90,1.44)), 'grip_r':('chest',(-.17,2.90,1.44)),
 'rest_l':('chest',(.29,2.10,1.47)), 'rest_r':('chest',(-.29,2.10,1.47)), 'mouth':('skull',(0,1.11,3.70)),
 'sole_l':('chest',(.29,2.025,1.65)), 'sole_r':('chest',(-.29,2.025,1.65)),
 'head':('skull',(0,1.31,3.10)), 'overhead':('spine',(0,4.35,-.25)),
 'nostril_l':('skull',(.125,1.255,3.35)), 'nostril_r':('skull',(-.125,1.255,3.35)),
 'breath_l':('skull',(.10119128,1.238,3.35)), 'breath_r':('skull',(-.10119128,1.238,3.35)),
 'tail_base':('tail_1',TAIL[0]), 'tail_mid':('tail_4',TAIL[3]),
 'tail_tip':('tail_7',(0,1.36,-5.14)), 'impale':('tail_7',(.78,1.35,-5.35)),
 'vent':('pelvis',(0,.93,-1.38)),
}
# Actual fully foot-weighted plantar triangles, measured by ref/measure-feet.py.
# Their central surface points witness the rest pad, not an ankle or imagined plane.
for name,p in {
 'hind_foot_l':(0.76999998,0.00000000,-0.54000002),
 'hind_foot_r':(-0.76999998,0.00000000,-0.54000002),
 'fore_foot_l':(0.71038485,0.00000000,1.21951067),
 'fore_foot_r':(-0.70999998,0.00000000,1.21500003),
}.items():SOCKETS[name]=(name,p)
SOCKETS={n:(b,(layout if n in {'seat','grip_l','grip_r','rest_l','rest_r','sole_l','sole_r'}else shape)(p))for n,(b,p)in SOCKETS.items()}

def socket_offsets(): return {n:(b,tuple(Vector(p)-JOINTS[b])) for n,(b,p) in SOCKETS.items()}

def build():
 data=bpy.data.armatures.new('stego');arm=bpy.data.objects.new('stego',data);bpy.context.scene.collection.objects.link(arm)
 bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,parent,a,b in BONES:
  eb=data.edit_bones.new(name);eb.head=B(a);eb.tail=B(b)
  if parent: eb.parent=data.edit_bones[parent]
  direction=(eb.tail-eb.head).normalized(); eb.align_roll(Vector((1,0,0)).cross(direction) if abs(direction.x)<.8 else Vector((0,-1,0)).cross(direction))
 bpy.ops.object.mode_set(mode='OBJECT')
 for pb in arm.pose.bones: pb.rotation_mode='QUATERNION'
 arm.show_in_front=True;data.display_type='STICK'
 return arm

def armature(): return bpy.data.objects['stego']

def bind(obj,weights):
 arm=armature();obj.parent=arm
 mod=obj.modifiers.new('skin','ARMATURE');mod.object=arm
 groups={}
 for idx,ws in enumerate(weights):
  top=sorted(ws.items(),key=lambda x:-x[1])[:4];total=sum(w for _,w in top)
  if total<=0: raise ValueError(f'unweighted {obj.name}:{idx}')
  for name,weight in top:
   if name not in groups: groups[name]=obj.vertex_groups.new(name=name)
   groups[name].add([idx],weight/total,'REPLACE')

if __name__=='__main__': build()
