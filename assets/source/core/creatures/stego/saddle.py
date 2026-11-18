"""Original practical Stego saddle. Reserved rider corridor precedes ornament.

The raised leather pad sits ahead of the main plates; girths follow the torso.
A wood bow, hand grips and metal rings explain the harness's construction.
"""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import rig
from model import Surface,tube,ellipsoid

S=Surface('stego_saddle',['stego_saddle'],transform=rig.layout)
W={'chest':1}

def pad(cx,cy,cz,width,length,depth,atlas,taper=0,dish=0):
 # Closed cushioned surface; rounded corners are actual geometry.
 outline=[]
 for x,z,start in [(width/2-.07,length/2-.07,0),(-width/2+.07,length/2-.07,90),(-width/2+.07,-length/2+.07,180),(width/2-.07,-length/2+.07,270)]:
  for j in range(5):
   a=math.radians(start+j*90/4);xx=x+.07*math.cos(a);zz=z+.07*math.sin(a)
   front=max(0,min(1,.5+zz/length));front=front*front*(3-2*front)
   outline.append((cx+xx*(1-taper*front),cz+zz))
 rings=[]
 for y,scale in [(cy-depth/2,.92),(cy,1),(cy+depth/2,.92)]:
  rings.append([S.v((cx+(x-cx)*scale,y-(dish*max(0,min(1,.5+(z-cz)/length))if y>cy else 0),cz+(z-cz)*scale),W)for x,z in outline])
 n=len(outline);u,v,uw,vh=atlas
 for k in range(2):
  for j in range(n):
   ids=[rings[k][j],rings[k][(j+1)%n],rings[k+1][(j+1)%n],rings[k+1][j]];S.face(ids,[(u+uw*j/n,v),(u+uw*(j+1)/n,v),(u+uw*(j+1)/n,v+vh),(u+uw*j/n,v+vh)])
 for k in [0,2]:
  c=S.v((cx,cy+(-1 if k==0 else 1)*depth*.43-(dish*.5 if k==2 else 0),cz),W)
  for j in range(n):S.face([c,rings[k][j],rings[k][(j+1)%n]],[(u+uw/2,v+vh/2),(u+uw*(.5+(outline[j][0]-cx)/width),v+vh*(.5+(outline[j][1]-cz)/length)),(u+uw*(.5+(outline[(j+1)%n][0]-cx)/width),v+vh*(.5+(outline[(j+1)%n][1]-cz)/length))])

# Contact is fitted against the actual finished back, not an approximate ellipse.
body=bpy.data.objects['stego_body']
tree=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
def contact(x,z):
 origin=rig.B(rig.layout((x,6,z)))
 hit,normal,_,_=tree.ray_cast(origin,Vector((0,0,-1)),8)
 if hit is None:raise RuntimeError('saddle panel missed the back')
 return rig.E(hit).y

def strap(path,width=.065,thickness=.014,axis=(1,0,0)):
 """Closed rectangular leather webbing with a constant useful section."""
 rings=[];S.chart+=1
 for i,point in enumerate(path):
  p=Vector(point);t=(Vector(path[min(i+1,len(path)-1)])-Vector(path[max(i-1,0)])).normalized()
  across=Vector(axis);across-=t*across.dot(t)
  if across.length_squared<1e-8:across=Vector((0,0,1));across-=t*across.dot(t)
  across.normalize();normal=t.cross(across).normalized()
  ring=[]
  for a,b in [(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]:ring.append(S.v(p+across*(width*a)+normal*(thickness*b),W))
  rings.append(ring)
 for i in range(len(rings)-1):
  for j in range(4):
   S.face([rings[i][j],rings[i][(j+1)%4],rings[i+1][(j+1)%4],rings[i+1][j]],[(.04+.60*i/(len(rings)-1),.07+j*.16),(.04+.60*i/(len(rings)-1),.07+(j+1)*.16),(.04+.60*(i+1)/(len(rings)-1),.07+(j+1)*.16),(.04+.60*(i+1)/(len(rings)-1),.07+j*.16)])
 for i in [0,len(rings)-1]:S.face(rings[i],[(.05,.05),(.10,.05),(.10,.10),(.05,.10)])

def tread(sign):
 # The declared finite support is the real flat top, .23 x .20 engine metres.
 # Its lower bevel extends beyond it, and the open arch leaves room for boots.
 rings=[]
 for y,width,depth in [(2.003,.25,.22),(2.015,.25,.22),(2.025,.23,.20)]:
  rings.append([S.v((sign*.29+x*width/2,y,1.65+z*depth/(2*.67)),W)for x,z in [(-1,-1),(-1,1),(1,1),(1,-1)]])
 uv=[(.74,.79),(.94,.79),(.94,.96),(.74,.96)]
 for k in range(2):
  for j in range(4):S.face([rings[k][j],rings[k][(j+1)%4],rings[k+1][(j+1)%4],rings[k+1][j]],uv)
 S.face(rings[0][::-1],uv);S.face(rings[-1],uv)

# Two independent padded tree panels leave a spinal relief channel. Their
# lower surface follows the actual shoulder while the rider's seat stays level.
for sign in [-1,1]:
 path=[];radii=[]
 for i in range(13):
  z=.77+i*.65/12;bottom=contact(sign*.105,z)+.006;top=2.415
  if bottom>top-.02:top=bottom+.025
  path.append((sign*.105,(top+bottom)/2,z));radii.append((.070,(top-bottom)/2+.012))
 tube(S,path,radii,W,0,(.03,.05,.62,.70),sides=12,sub=1,flatten=0)
pad(0,2.46,1.17,.59,.75,.14,(.03,.05,.62,.70),taper=.6,dish=.03)
pad(0,2.39,1.10,.56,.68,.07,(.03,.05,.62,.70),taper=.5)
# Rounded hardwood cantle and pommel are linked to the leather-covered tree.
for z,height in [(.86,2.63),(1.53,2.63)]:
 tube(S,[(-.27,2.43,z),(-.26,height-.04,z),(-.17,height,z),(0,height+.025,z),(.17,height,z),(.26,height-.04,z),(.27,2.43,z)],[(.028,.028)]*7,W,0,(.72,.04,.25,.65),sides=10,sub=2,flatten=0)
for sign in [-1,1]:
 # Explicit finite grasp cylinder: radius18 mm, socket±110 mm vertically.
 # Its lower support bends behind the hand; the grasp itself stays upright.
 tube(S,[(sign*.17,2.49,1.50),(sign*.17,2.75,1.44),(sign*.17,2.80,1.44)],[(.018,.018),(.018,.018),(.016,.016)],W,0,(.72,.04,.25,.65),sides=12,sub=2,flatten=0)
 tube(S,[(sign*.17,2.79,1.44),(sign*.17,3.01,1.44)],[(.018,.018)]*2,W,0,(.72,.04,.25,.65),sides=12,sub=2,flatten=0)
 # Stirrup leather hangs from the tree underside to the inner arch. The
 # rider's calf stays outside this full-width load-bearing leather band.
 strap([(sign*.16,2.40,1.32),(sign*.16,2.25,1.58),(sign*.16,2.15,1.65)],.045,.012)
 tread(sign)
 path=[(sign*.29-.13,2.025,1.65),(sign*.29-.13,2.15,1.65),(sign*.29-.08,2.22,1.65),(sign*.29,2.23,1.65),(sign*.29+.08,2.22,1.65),(sign*.29+.13,2.15,1.65),(sign*.29+.13,2.025,1.65)]
 tube(S,path,[(.011,.011)]*7,W,0,(.72,.77,.25,.20),sides=8,sub=2,flatten=0)
 # Diagonal billets connect the tree to the barrel girth behind the forelegs.
 strap([(sign*.28,2.43,1.03),(sign*.55,2.27,.83),(sign*.86,1.98,.60),(sign*1.04,1.60,.42)],.060,.015)
# The load-bearing girth is a complete band of leather, fitted by radial rays.
path=[];z=.42;cy=1.68
for i in range(65):
 a=i*2*math.pi/64;direction=rig.B((math.sin(a),math.cos(a),0));origin=rig.B((0,cy,z))
 hit,normal,_,_=tree.ray_cast(origin,direction,4)
 if hit is None:raise RuntimeError('girth missed torso')
 q=rig.E(hit+normal*.015);path.append(tuple(q))
strap(path,.12,.018,axis=(0,0,1))
for sign in [-1,1]:
 # Buckles are closed iron frames with a central tongue, never dangling tips.
 path=[(sign*1.06,1.59+.065*math.sin(i*2*math.pi/12),.42+.048*math.cos(i*2*math.pi/12))for i in range(13)]
 tube(S,path,[(.010,.010)]*13,W,0,(.72,.77,.25,.20),sides=6,sub=1,flatten=0)
 tube(S,[(sign*1.065,1.535,.42),(sign*1.065,1.65,.42)],[(.008,.008)]*2,W,0,(.72,.77,.25,.20),sides=6,sub=1,flatten=0)
obj=S.mesh()
