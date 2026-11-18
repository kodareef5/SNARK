"""Original anatomical Stego surfaces: lofted trunk, articulated limbs,
individually shaped vascular plates, thagomizer, face, and contact pads.
All dimensions are authored here. Source library models are never imported.
The finished surface is unwrapped into connected anatomical islands; original
paint fields are baked onto those UVs by tex/paint_fields.py.
"""
import math
import bpy
import numpy as np
from mathutils import Vector
import rig

TAU=2*math.pi
SKIN=0;HORN=1

def smooth(t): return t*t*(3-2*t)
def blend(a,b,t): return a*(1-t)+b*t

def sample(table,sub=3,spatial=0):
 """C1 loft: centripetal centreline, monotone positive section dimensions.

 Component-clamping a Catmull-Rom sample breaks its tangent at an extremum.
 The centreline now keeps its continuous tangents; widths/depths instead use
 monotone Hermite derivatives, so they never need a post-evaluation clamp.
 """
 a=np.asarray(table,dtype=float);out=[]
 h=np.maximum(1e-8,np.sqrt(np.linalg.norm(np.diff(a[:,:spatial],axis=0),axis=1)))if spatial else np.ones(len(a)-1)
 d=np.diff(a,axis=0)/h[:,None];m=np.empty_like(a);m[0]=d[0];m[-1]=d[-1]
 for i in range(1,len(a)-1):
  m[i]=(h[i]*d[i-1]+h[i-1]*d[i])/(h[i-1]+h[i])
  for k in range(spatial,a.shape[1]):
   before,after=d[i-1,k],d[i,k]
   if before*after<=0:m[i,k]=0
   else:
    w0=2*h[i]+h[i-1];w1=h[i]+2*h[i-1]
    m[i,k]=(w0+w1)/(w0/before+w1/after)
 for i in range(len(a)-1):
  for j in range(sub):
   t=j/sub;t2=t*t;t3=t2*t
   out.append((2*t3-3*t2+1)*a[i]+(t3-2*t2+t)*h[i]*m[i]+(-2*t3+3*t2)*a[i+1]+(t3-t2)*h[i]*m[i+1])
 out.append(a[-1]);return out

class Surface:
 def __init__(self,name,materials=None,transform=rig.shape): self.name=name;self.verts=[];self.weights=[];self.faces=[];self.uvs=[];self.mats=[];self.materials=materials or ['stego_skin','stego_horn'];self.charts=[];self.chart=0;self.chart_override=None;self.seams=set();self.transform=transform
 def v(self,p,w): self.verts.append(tuple(rig.B(self.transform(p))));self.weights.append(w);return len(self.verts)-1
 def face(self,ids,uv,mat=0): self.faces.append(ids);self.uvs.append(uv);self.mats.append(mat);self.charts.append(self.chart if self.chart_override is None else self.chart_override)
 def mesh(self):
  mesh=bpy.data.meshes.new(self.name);mesh.from_pydata(self.verts,[],self.faces);mesh.update()
  for edge in mesh.edges:
   if tuple(sorted(edge.vertices))in self.seams:edge.use_seam=True
  obj=bpy.data.objects.new(self.name,mesh);bpy.context.scene.collection.objects.link(obj)
  for name in self.materials: mesh.materials.append(material(name))
  # Preserve the true plate identity through the final joined UV unwrap.
  # The base rings blend to the trunk and cannot be identified by bone alone.
  if self.name=='stego_features':
   order=mesh.attributes.new(name='plate_order',type='INT',domain='FACE')
   for index,chart in enumerate(self.charts):
    if 1<=chart<=len(rig.PLATES):order.data[index].value=chart
  uv=mesh.uv_layers.new(name='Surface')
  for p,tex,mat in zip(mesh.polygons,self.uvs,self.mats):
   p.material_index=mat;p.use_smooth=True
   for li,co in zip(p.loop_indices,tex): uv.data[li].uv=co
  rig.bind(obj,self.weights)
  # Recalculate outside consistently after all closed parts are assembled.
  import bmesh
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
  # Consistency alone can orient a very thin warped blade inward. Every closed
  # anatomical component must also have positive signed volume; this fixes the
  # source winding rather than accepting an inward native LOD component.
  unseen=set(bm.faces)
  while unseen:
   seed=unseen.pop();part=[seed];todo=[seed]
   while todo:
    face=todo.pop()
    for edge in face.edges:
     for neighbour in edge.link_faces:
      if neighbour in unseen:unseen.remove(neighbour);part.append(neighbour);todo.append(neighbour)
   vertices={v for face in part for v in face.verts};origin=sum((v.co for v in vertices),Vector())/len(vertices)
   volume=0
   for face in part:
    points=[v.co-origin for v in face.verts]
    for j in range(1,len(points)-1):volume+=points[0].dot(points[j].cross(points[j+1]))/6
   if volume<0:bmesh.ops.reverse_faces(bm,faces=part)
  bm.to_mesh(mesh);bm.free()
  return obj

def material(name):
 m=bpy.data.materials.get(name)
 if m:return m
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF')
 bs.inputs['Roughness'].default_value=.68
 path=rig.ROOT/'tex'/f'{name}_preview.png'
 if path.exists():
  node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(path),check_existing=True);m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
  normal=m.node_tree.nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(rig.ROOT/'tex'/f'{name}_normal.png'),check_existing=True);normal.image.colorspace_settings.name='Non-Color'
  nm=m.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=1.0;m.node_tree.links.new(normal.outputs['Color'],nm.inputs['Color']);m.node_tree.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
  packed=m.node_tree.nodes.new('ShaderNodeTexImage');packed.image=bpy.data.images.load(str(rig.ROOT/'tex'/f'{name}_packed.png'),check_existing=True);packed.image.colorspace_settings.name='Non-Color'
  separate=m.node_tree.nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(packed.outputs['Color'],separate.inputs['Color']);m.node_tree.links.new(separate.outputs['Green'],bs.inputs['Roughness'])
 else: bs.inputs['Base Color'].default_value=(.23,.29,.19,1) if name=='stego_skin' else (.43,.25,.12,1)
 return m

# z, centre y, half width, upper depth, lower depth. Torso, neck and skull
# remain one uninterrupted surface; muscular tail tapers out of that surface.
BODY=rig.BODY

def axis_weights(z):
 if z < -1.22:
  knots=[(-5.5,'tail_7'),(-4.74,'tail_7'),(-4.18,'tail_6'),(-3.62,'tail_5'),(-3.03,'tail_4'),(-2.42,'tail_3'),(-1.80,'tail_2'),(-1.20,'tail_1')]
 else: knots=[(-1.22,'pelvis'),(-.45,'pelvis'),(.18,'spine'),(.95,'chest'),(1.45,'neck_1'),(2.00,'neck_2'),(2.55,'neck_3'),(2.9,'skull'),(4,'skull')]
 for (a,ba),(b,bb) in zip(knots,knots[1:]):
  if a<=z<=b:
   t=smooth((z-a)/(b-a));return {ba:1} if ba==bb else {ba:1-t,bb:t}
 return {knots[0 if z<knots[0][0] else -1][1]:1}

def plate_root_skin(x,z):
 # The plate bed is a pair of low, unequal longitudinal folds in the dorsal
 # skin. They converge behind the insertion and continue gradually into the
 # smooth back. They are part of this surface in every plate mode.
 lift=0
 for i,(root_z,_,height,width,_,root_x,_) in enumerate(rig.PLATES):
  dz=(z-root_z)/width
  if abs(dz)>.75:continue
  sign=1 if root_x>0 else -1
  dx=(x-root_x)*sign
  field=math.exp(-((dz+.025)/.48)**4)
  fork=.055+.065*max(0,1-(dz/.60)**2)
  outside=math.exp(-((dx-fork+.036*dz)/(.086+.018*height))**2)
  inside=math.exp(-((dx+fork*.73+.022*dz)/.075)**2)
  shoulder=1+.19*math.sin(4.2*dz+.65*i)
  lift+=min(.073,.065*height)*field*shoulder*(outside+.63*inside)
 return lift

def body(s):
 s.chart+=1
 table=sample(BODY,6,2);rings=[];n=96
 for row in table:
  z,cy,rx,up,down=row;ids=[]
  for j in range(n):
   theta=TAU*j/n;side=math.sin(theta);height=math.cos(theta)
   # Rounded flank, a real ventral keel and restrained rib/costal contour.
   x=rx*side*(1+.035*max(0,-height));y=cy+(up if height>=0 else down)*height
   band=math.exp(-((z-.15)/1.15)**4)*max(0,1-height*height)
   x*=1+.010*math.sin(z*23+height*3)*band
   # Separate the pelvic boss, abdomen and shoulder blade on the upper flank.
   flank=max(0,1-height*height)*max(0,height+.45)
   x*=1+.065*math.exp(-((z+.90)/.28)**2)*flank
   # Scapula and iliac ridge are broad secondary forms, with a shallow groove
   # behind the shoulder and the flank gathered above the hind limb.
   scapula=math.exp(-((z-(.59+.57*(y-1.25)))/.15)**2)*math.exp(-((y-1.80)/.55)**4)
   hip=math.exp(-((z+.93-.10*(y-1.7))/.27)**2)*math.exp(-((y-1.96)/.47)**2)
   crease=math.exp(-((z-(.55+.18*(y-1.5)))/.095)**2)*math.exp(-((y-1.57)/.44)**2)
   x+=math.copysign((.065*scapula+.10*hip-.035*crease)*abs(side)**2,x)
   # The cervical crest is narrower than the sternum: this is one continuous
   # anatomical section, not a pair of notches around a rider's boots.
   x*=1-.14*smooth(max(0,min(1,(height-.30)/.65)))*math.exp(-((z-1.45)/.36)**4)
   # Eye socket is carved into the skull instead of putting eyes on its skin.
   socket=math.exp(-((z-3.025)/.09)**2-((y-1.32)/.065)**2)
   if z>2.8:x-=math.copysign(.018*socket*abs(side)**4,x)
   # The nasal fossa is a depression in the continuous muzzle; a small closed
   # cavity is carved after retopology so its rounded inner rim stays resolved.
   nasal=math.exp(-((z-3.35)/.073)**4-((y-1.255)/.034)**4)
   if z>3.15:x-=math.copysign(.027*nasal*abs(side)**5,x)
   if height<-.35 and -.9<z<1.2:y+=.025*math.sin(z*14)*(-height-.35)
   if z>2.7:
    # Flat zygomatic cheek and a firm dorsal brow rather than a spherical head.
    cheek=math.exp(-((z-2.98)/.22)**4)
    x=blend(x,math.copysign(rx*.91,x),cheek*abs(side)**8*.55)
    y+=.022*max(0,height)*math.exp(-((z-2.95)/.18)**2)
    # The skull's roof and lower cheek are flatter bony planes. Broad orbital
    # and jugal relief belongs to the continuous skull, never detached hoods.
    if 2.78<z<3.37:
     if height<0:
      y=blend(y,cy-down*math.sqrt(-height),.72)
      x=blend(x,math.copysign(rx*math.sqrt(abs(side)),x),.72)
     else:y=min(y,cy+up*.89+.012*abs(side))
     brow=math.exp(-((z-3.005)/.135)**4-((y-1.397)/.048)**2)
     cheek_boss=math.exp(-((z-2.90)/.17)**4-((y-1.19)/.055)**2)
     suborbital=math.exp(-((z-2.96)/.125)**4-((y-1.267)/.047)**2)
     jaw_hinge=math.exp(-((z-2.805)/.085)**4-((y-1.18)/.075)**2)
     x+=math.copysign((.032*brow+.024*cheek_boss-.026*suborbital+.022*jaw_hinge)*abs(side)**3,x)
   # Directional loose throat skin converges toward the jaw hinge. These folds
   # are part of the continuous skin and survive a neutral clay review.
   throat=math.exp(-((z-2.20)/.68)**4)*max(0,1-height*height)*max(0,.85-height)
   # Loose skin runs from the mandibular hinge toward the sternum. Its folds
   # follow that diagonal tension, rather than evenly ringing a neck tube.
   fold=0
   for base,amplitude,width in [(1.10,.042,.065),(1.205,.060,.065),(1.315,.030,.055)]:
    tension=base+.065*(z-1.5)+.018*math.sin(z*3+base*4)
    fold+=amplitude*math.exp(-((y-tension)/width)**2)
    fold-=amplitude*.55*math.exp(-((y-tension-.040)/(width*.8))**2)
   fold*=throat*(1-smooth(max(0,min(1,(z-2.55)/.24))))
   x+=math.copysign(fold*abs(side),x);y+=fold*height
   # An oblique cervical tendon enters the scapular shelf above a deeper loose
   # throat. Two wider compression folds gather into the shoulder rather than
   # encircling a uniformly cylindrical neck.
   cervical=math.exp(-((z-1.75)/.62)**4)*abs(side)**3
   tendon=math.exp(-((y-(1.58-.20*(z-1.5)))/.085)**2)
   fold_base=math.exp(-((z-(1.37+.24*(y-1.3)))/.075)**2)*math.exp(-((y-1.43)/.30)**4)
   x+=math.copysign(.042*tendon*cervical-.038*fold_base*abs(side)**3,x)
   if height>.43:y+=plate_root_skin(x,z)*smooth(min(1,(height-.43)/.35))
   ids.append(s.v((x,y,z),axis_weights(z)))
  rings.append(ids)
 for k in range(len(rings)-1):
  # 74% of the skin atlas is reserved for this continuous anatomical shell.
  u0=.03+.94*(table[k][0]+5.24)/8.95;u1=.03+.94*(table[k+1][0]+5.24)/8.95
  for j in range(n):
   a=j/n;b=(j+1)/n
   is_beak=False  # One UV/material surface carries the rooted keratin transition.
   uv=[(u0,.03+.70*a),(u0,.03+.70*b),(u1,.03+.70*b),(u1,.03+.70*a)]
   if is_beak:uv=[(.1+(u-.93)*6,.04+(v-.03)*.18)for u,v in uv]
   s.face([rings[k][j],rings[k][(j+1)%n],rings[k+1][(j+1)%n],rings[k+1][j]],uv,HORN if is_beak else SKIN)
 for k,rev in [(0,True),(-1,False)]:
  row=table[k];c=s.v((0,row[1],row[0]),axis_weights(row[0]));u=.03+.94*(row[0]+5.24)/8.95
  for j in range(n):
   ids=[c,rings[k][(j+1)%n],rings[k][j]] if rev else [c,rings[k][j],rings[k][(j+1)%n]]
   angles=[TAU*(j+1)/n,TAU*j/n] if rev else [TAU*j/n,TAU*(j+1)/n]
   cap_uv=[(u,.38)]+[(u+.006*math.cos(t),.38+.006*math.sin(t))for t in angles]
   if k==-1:cap_uv=[(.35,.08),(.36,.08),(.35,.09)]
   s.face(ids,cap_uv,SKIN)


def tube(s,path,radii,weights,mat=SKIN,atlas=(.04,.77,.93,.19),sides=20,sub=3,flatten=1,across_axis=(1,0,0),sculpt=None,section=None):
 """Closed varying section along an authored curve; capsule ends are buried or rounded."""
 s.chart+=1
 table=sample([(*p,*r) for p,r in zip(path,radii)],sub,3);rings=[];length=[0]
 for a,b in zip(table,table[1:]):length.append(length[-1]+np.linalg.norm(b[:3]-a[:3]))
 for i,row in enumerate(table):
  p=Vector(row[:3]);t=Vector(table[min(i+1,len(table)-1)][:3])-Vector(table[max(i-1,0)][:3]);t.normalize()
  across=Vector(across_axis);across-=t*across.dot(t)
  if across.length_squared<1e-8:
   across=min([Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))],key=lambda a:abs(a.dot(t)));across-=t*across.dot(t)
  across.normalize();normal=t.cross(across).normalized()
  ring=[]
  for j in range(sides):
   theta=TAU*j/sides;c=math.cos(theta);v=math.sin(theta)
   if section:c,v=section(p,c,v)
   q=p+across*(row[3]*c)+normal*(row[4]*v)
   if sculpt:q=sculpt(q,p)
   if flatten:
    if q.y<.045:q.y=.045+(q.y-.045)*.08
    # The plantar pad rests on the authored ground plane. Ease its measured
    # 37.5 mm rest clearance out through the ankle, leaving knees and the whole
    # torso/seat/neck rig untouched. This also plants every idle variation.
    q.y-=.0375*(1-smooth(max(0,min(1,(q.y-.12)/.35))))
   w=weights(q,length[i]/max(.001,length[-1])) if callable(weights) else weights
   ring.append(s.v(q,w))
  rings.append(ring)
 x,y,w,h=atlas
 for k in range(len(rings)-1):
  u0=x+w*length[k]/length[-1];u1=x+w*length[k+1]/length[-1]
  for j in range(sides):
   v0=y+h*j/sides;v1=y+h*(j+1)/sides
   s.face([rings[k][j],rings[k][(j+1)%sides],rings[k+1][(j+1)%sides],rings[k+1][j]],[(u0,v0),(u0,v1),(u1,v1),(u1,v0)],mat)
 for k in [0,len(table)-1]:
  p=Vector(table[k][:3]);cw=weights(p,k/(len(table)-1)) if callable(weights) else weights;c=s.v(p,cw)
  for j in range(sides):
   ids=[c,rings[k][(j+1)%sides],rings[k][j]] if k==0 else [c,rings[k][j],rings[k][(j+1)%sides]]
   angles=[TAU*(j+1)/sides,TAU*j/sides] if k==0 else [TAU*j/sides,TAU*(j+1)/sides]
   s.face(ids,[(x+.015,y+.015)]+[(x+.015+.012*math.cos(t),y+.015+.012*math.sin(t))for t in angles],mat)


def ellipsoid(s,center,radii,bone,mat=SKIN,atlas=(.82,.77,.15,.18),around=20,rows=12):
 s.chart+=1
 c=Vector(center);rings=[];x,y,w,h=atlas
 # Real pole vertices prevent collapsed quads at either end.
 bot=s.v(c+Vector((0,-radii[1],0)),{bone:1})
 for i in range(1,rows):
  latitude=-math.pi/2+math.pi*i/rows;ring=[]
  for j in range(around):
   theta=TAU*j/around;ring.append(s.v(c+Vector((radii[0]*math.cos(latitude)*math.sin(theta),radii[1]*math.sin(latitude),radii[2]*math.cos(latitude)*math.cos(theta))),{bone:1}))
  rings.append(ring)
 top=s.v(c+Vector((0,radii[1],0)),{bone:1})
 for i in range(len(rings)-1):
  for j in range(around):
   s.face([rings[i][j],rings[i][(j+1)%around],rings[i+1][(j+1)%around],rings[i+1][j]],[(x+w*j/around,y+h*(i+1)/rows),(x+w*(j+1)/around,y+h*(i+1)/rows),(x+w*(j+1)/around,y+h*(i+2)/rows),(x+w*j/around,y+h*(i+2)/rows)],mat)
 for j in range(around):
  s.face([bot,rings[0][(j+1)%around],rings[0][j]],[(x+w*(j+.5)/around,y),(x+w*(j+1)/around,y+h/rows),(x+w*j/around,y+h/rows)],mat)
  s.face([top,rings[-1][j],rings[-1][(j+1)%around]],[(x+w*(j+.5)/around,y+h),(x+w*j/around,y+h*(rows-1)/rows),(x+w*(j+1)/around,y+h*(rows-1)/rows)],mat)


def limbs(s):
 for kind,points in rig.LEGS.items():
  for side,sign in [('l',1),('r',-1)]:
   if kind=='hind':
    path=[(.37,2.16,-1.03),(.76,1.64,-.82),(.85,1.26,-.49),(.84,.98,-.38),(.80,.67,-.51),(.77,.33,-.68),(.77,.18,-.61),(.77,.13,-.33)]
    radii=[(.40,.45),(.48,.51),(.34,.38),(.25,.26),(.185,.21),(.205,.205),(.29,.23),(.25,.15)]
   else:
    path=[(.30,1.85,.85),(.62,1.55,.95),(.72,1.28,.88),(.73,.98,.76),(.73,.87,.72),(.73,.74,.79),(.71,.49,.98),(.71,.27,1.10),(.71,.15,1.21),(.71,.12,1.41)]
    radii=[(.20,.22),(.22,.26),(.18,.24),(.18,.21),(.18,.205),(.17,.185),(.135,.155),(.175,.17),(.255,.20),(.20,.13)]
   path=[(p[0]*sign,p[1],p[2])for p in path]
   def weights(p,t,kind=kind,side=side):
    knots=[(0,'pelvis' if kind=='hind' else 'chest'),(.15,'pelvis' if kind=='hind' else 'chest'),(.40,f'{kind}_upper_{side}'),(.63,f'{kind}_lower_{side}'),(.88,f'{kind}_foot_{side}'),(1,f'{kind}_foot_{side}')]
    for (a,ba),(b,bb) in zip(knots,knots[1:]):
     if a<=t<=b:
      f=smooth((t-a)/(b-a));return {ba:1}if ba==bb else {ba:1-f,bb:f}
    return {f'{kind}_foot_{side}':1}
   def sculpt(q,center,kind=kind,sign=sign):
    q=q.copy();outward=max(0,min(1,(sign*(q.x-center.x)+.08)/.25))
    if kind=='fore':
     # Caudal triceps mass, a flatter ulna and an actual anterior elbow fold.
     q.z-=.055*math.exp(-((q.y-1.10)/.22)**2)*max(0,min(1,(center.z-q.z)/.15))
     # Separate the deltoid/triceps masses on the outside of the humerus, then
     # flatten the anterior radius into a firmer weight-bearing forearm plane.
     deltoid=math.exp(-((q.z-(center.z+.10+.18*(q.y-1.1)))/.060)**2)*math.exp(-((q.y-1.22)/.30)**4)
     q.x-=sign*.026*deltoid*outward
     # The lateral humerus is a broad oblique plane continuous with the ribs,
     # not the outside of an oval capsule glued onto the shoulder.
     upper=math.exp(-((q.y-1.30)/.32)**4)
     q.x=center.x+(q.x-center.x)*(1-.13*upper*outward)
     anterior=math.exp(-((q.y-.50)/.20)**4)
     q.z=center.z+(q.z-center.z)*(1-.08*anterior*max(0,min(1,(q.z-center.z)/.15)))
     ridge=math.exp(-((q.y-.50)/.23)**4)*outward
     q.x+=sign*.023*ridge;q.z+=.018*ridge
     olecranon=math.exp(-((q.y-.86)/.085)**2)*max(0,min(1,(center.z-q.z)/.12))
     q.z-=.096*olecranon
     # The ulna flares below its caudal point, then narrows through the
     # shaft and broadens again at the load-bearing carpus.
     shaft=math.exp(-((q.y-.49)/.17)**4)
     carpus=math.exp(-((q.y-.255)/.070)**2)
     q.x=center.x+(q.x-center.x)*(1-.10*shaft+.12*carpus)
     q.z+=.027*carpus*max(0,min(1,(q.z-center.z)/.12))*outward
    else:
     # The anterior quadriceps and patella break into a narrower shin; an
     # oblique lateral groove separates that mass from the posterior thigh.
     groove=math.exp(-((q.z-(-.58+.30*(q.y-1.3)))/.075)**2)*math.exp(-((q.y-1.38)/.38)**4)
     q.x-=sign*.050*groove*outward
     q.z-=.08*math.exp(-((q.y-1.0)/.14)**4)*max(0,q.z-center.z)
     shin=math.exp(-((q.y-.58)/.23)**4)*max(0,min(1,(q.z-center.z+.02)/.16))
     q.z+=.038*shin
     stifle=math.exp(-((q.y-.99)/.13)**2)
     front=max(0,min(1,(q.z-center.z)/.14))
     q.z+=.044*stifle*front
     q.x+=sign*.036*stifle*outward
     hock=math.exp(-((q.y-.37)/.09)**2)
     q.z-=.047*hock*max(0,min(1,(center.z-q.z)/.13))
    # Metapodial folds sit above the broad weight-bearing pad. Their scale is
    # deliberately much larger than a texture scute and remains visible in clay.
    ankle=math.exp(-((q.y-.29)/.075)**4)*outward
    q.x+=sign*.012*math.sin(q.y*105)*ankle
    return q
   def section(center,c,v,kind=kind):
    if kind!='fore':return c,v
    # Broad radial plane and a fuller caudal ulna give an asymmetric section.
    # A continuous section-power profile replaces clipped elliptical rings.
    amount=math.exp(-((center.y-.65)/.45)**4)
    cc=math.copysign(abs(c)**.82,c);vv=math.copysign(abs(v)**.82,v)
    vv*=1+(.10 if v<0 else -.06)*abs(v)
    return blend(c,cc,amount*.8),blend(v,vv,amount*.8)
   tube(s,path,radii,weights,sides=28,sub=4,sculpt=sculpt,section=section)
   foot=points[3];footbone=f'{kind}_foot_{side}'
   # Pes: three broad blunt hoof-shaped unguals. Manus: compact semitubular
   # support, with only the two medial hoof caps distinct; the outer digits
   # remain in the pad. See Maidment2015, Senter2010 and Gilmore1918 in ref.
   digits=[(-.16,-.008,-.16),(0,.039,0),(.16,-.016,.18)] if kind=='hind' else [(-.145,-.026,-.20),(.005,.014,.025)]
   for digit,(lateral,advance,splay) in enumerate(digits):
    x=foot[0]+lateral;z=foot[2]+.095+advance
    width=(.095 if kind=='hind' else .086)*(1-.06*abs(splay))
    # Flattened dorsal keratin arches above a broader bearing rim. The tip
    # rounds into a blunt bevel; the proximal phalanx disappears into the pad.
    dorsal=[(-.132,.086,.53,.43),(-.057,.088,.91,.77),(.004,.086,1,.86),(.054,.072,.96,.67),(.095,.052,.78,.44),(.114,.042,.47,.25),(.118,.042,.10,.07)]
    digit_path=[(sign*(x+splay*dz),cy,z+dz) for dz,cy,_,_ in dorsal]
    def sole(q,center):
     q=q.copy();q.y=max(.004,q.y);return q
    def ungual(center,c,v):
     # Broader ventral shoulders and a flatter sole than a circular claw.
     return c*(1+.13*max(0,-v)),math.copysign(abs(v)**.78,v)
    tube(s,digit_path,[(width*rx,.083*ry)for _,_,rx,ry in dorsal],{footbone:1},HORN,(.52,.03,.18,.15),sides=16,sub=2,flatten=0,sculpt=sole,section=ungual)


def dermal_roots(s):
 # These are part of the one trunk/head skin, not disconnected UV sleeves.
 s.chart_override=1
 # The broad plate bases penetrate the continuous back skin. Separate flattened
 # ellipsoids still showed as little pale collars on the descending flank;
 # basal flesh is represented by directional folds in that same body surface.
 for z in [-4.48,-4.94]:
  bone='tail_6'if z>-4.7 else'tail_7'
  for sign in [-1,1]:
   tube(s,[(sign*.025,1.29,z+.015),(sign*.12,1.30,z-.01),(sign*.21,1.31,z-.055)],[(.13,.12),(.12,.10),(.085,.070)],{bone:1},SKIN,sides=16,sub=3,flatten=0)
 s.chart_override=None

def sculpt_plate_beds(mesh):
 # The mobile keratin blade enters a broad load-bearing base. Follow the
 # existing back surface out onto the flank with two unequal swept buttresses.
 # Work on the finished dorsal skin after anatomical remeshing, preserving
 # the retopologized head, the saddle region and the grounded sole.
 for v in mesh.vertices:
  q=rig.E(v.co)
  if q.y<1.45 or q.z>2.22 or q.z< -4.55:continue
  dx=dy=0.
  for i,(z,y,height,width,_,x,_) in enumerate(rig.PLATES):
   root_z=rig.shape((0,0,z))[2]
   dz=(q.z-root_z)/width
   if abs(dz)>.76 or abs(q.y-y)>.50:continue
   side=1 if x>0 else -1
   across=(q.x-x)*side
   if across<-.23 or across>.47:continue
   top=smooth(max(0,min(1,(q.y-y+.48)/.28)))
   front=math.exp(-((dz-.15+.66*across)/.23)**2)
   rear=math.exp(-((dz+.18-.30*across)/.31)**2)
   base=math.exp(-((across-.09)/.18)**2)
   flare=math.exp(-((across-.18)/.19)**2)
   amount=min(1,height/.84)*top
   dy+=amount*(.068*base*front+.043*flare*rear)
   dx+=side*amount*flare*(.050*front+.032*rear)
  if dx or dy:
   q.x+=dx;q.y+=dy;v.co=rig.B(q)
 mesh.update()

def plates(s):
 # Original living outlines informed by the varied plate sequence in Maidment
 # et al. 2015, figs 78–83. Each row gives anterior/posterior half-widths at
 # seven heights. Broad fans, offset crowns and swept low tail blades replace
 # one repeated pointed shield. Fossil fractures are not living serration.
 levels=[0,.12,.34,.58,.80,.94,1]
 outlines=[
  ([.17,.31,.48,.47,.30,.12,.004],[.13,.28,.39,.33,.19,.06,.004]),
  ([.20,.37,.52,.48,.29,.10,.004],[.17,.33,.47,.38,.20,.06,.004]),
  ([.24,.44,.62,.50,.26,.08,.003],[.18,.31,.47,.43,.30,.12,.003]),
  ([.24,.49,.62,.58,.37,.13,.003],[.19,.36,.49,.47,.30,.10,.003]),
  ([.27,.48,.59,.53,.34,.10,.003],[.24,.45,.60,.58,.36,.12,.003]),
  ([.20,.39,.57,.56,.31,.09,.003],[.28,.47,.59,.51,.31,.10,.003]),
  ([.29,.50,.65,.60,.37,.11,.003],[.25,.43,.54,.49,.28,.08,.003]),
  ([.27,.45,.61,.55,.28,.08,.003],[.30,.50,.65,.56,.31,.09,.003]),
  ([.24,.41,.51,.40,.21,.055,.003],[.31,.54,.68,.60,.34,.10,.003]),
  ([.22,.38,.49,.39,.21,.06,.003],[.34,.57,.71,.62,.35,.10,.003]),
  ([.23,.38,.46,.34,.16,.04,.003],[.37,.62,.76,.63,.35,.10,.003]),
  ([.24,.39,.45,.31,.14,.04,.003],[.41,.67,.79,.62,.32,.09,.003]),
  ([.24,.37,.42,.29,.13,.03,.003],[.44,.69,.80,.59,.29,.08,.003]),
  ([.25,.38,.43,.27,.12,.03,.003],[.48,.74,.85,.60,.30,.08,.003]),
  ([.26,.38,.42,.25,.10,.025,.003],[.48,.76,.87,.61,.30,.08,.003]),
  ([.27,.39,.40,.24,.09,.02,.003],[.50,.79,.90,.62,.30,.075,.003]),
 ]
 for i,(z,y,height,width,lean,x,parent) in enumerate(rig.PLATES):
  bone=f'plate_{i:02d}';s.chart+=1;rings=[];sides=16 if height>.7 else 12;steps=22 if height>.7 else 12
  anterior,posterior=outlines[i]
  for j in range(steps):
   t=j/(steps-1)
   front=width*float(np.interp(t,levels,anterior));back=width*float(np.interp(t,levels,posterior))
   # Plate shoulders occupy different vertical fractions along the series.
   # Keep the cervical plates narrow, fan the mid-back forward, and draw the
   # trailing half of each caudal blade into a recurved apex.
   blade=min(1.,height/.82)
   side=1 if x>0 else -1
   rise=math.sin(math.pi*t)
   front*=1+blade*(.12*np.cos(i*1.7)-.06)*rise
   back*=1+blade*.13*np.sin(.8+i*1.35)*rise
   # A strut at the insertion spreads into living skin. Its cross-section
   # narrows rapidly, then the broad blade converges slowly to a thin rim.
   basal=(1-smooth(min(1,t/.48)))**1.6
   thick=.002+.051*(1-t)**2.4+height*(.024*(1-t)**3+.075*basal)
   # The plate grows from a thick embedded base into a thin warped blade. Each
   # crown curls in its own direction; the distal edge is not a roof-tile bevel.
   warp=(.040+.018*math.sin(i*1.3))*math.sin(math.pi*t)*math.sin(i*1.8)
   sweep=(.10 if i<2 else .09+.015*i)*height*t
   sweep+=height*(.13+.07*math.cos(i*1.73))*t**2.7
   sweep-=height*.075*rise*(1-t)
   offset=.045*math.sin(i*2.3)*t*t
   center=Vector((x+math.sin(math.radians(lean))*height*t+warp,y-.17+height*t,z-sweep+offset))
   ring=[]
   for k in range(sides):
    angle=TAU*k/sides;c=math.cos(angle);si=math.sin(angle)
    # The median keel is firm; edges feather to a thin angular blade.
    crest=.07*math.sin(i*1.42)+(.21*math.sin(.9*i)-.07)*t
    keel=(.035+.042*blade)*(1 if c*side>=0 else .56)*math.exp(-((si-crest)/.30)**2)*rise**.75
    branches=0
    for vein in [-.68,-.34,.30,.63]:
     path=vein*(.38+.62*t)+.025*math.sin(t*8+i+vein*3)
     branches+=.012*math.exp(-((si-path)/.08)**2)*math.sin(math.pi*t)**.6
    # The blade face curves between a thick strut and two swept margins.
    # A little torsion exposes each asymmetrical shoulder from side views.
    camber=side*height*(.062*(1-si*si)+.041*si*(1-si*si))*rise
    camber+=height*.051*si*t*math.sin(.7*i+.8)
    strut=height*basal*(.066*math.exp(-((si-.32+.09*math.sin(i))/.27)**2)
                         +.045*math.exp(-((si+.47)/.34)**2))
    xx=(thick*(.25+.75*c*c)+keel+branches+strut)*c+camber
    zz=(front if si>=0 else back)*si
    twist=.024*si*math.sin(math.pi*t)*math.sin(i*.9)
    # Start each blade below the local curved back along its whole width.
    # Its low transitional rings track the anatomical insertion in pose.
    surface=rig.back_height(x,z+zz)
    base_curve=(surface-rig.back_height(x,z))*(1-smooth(min(1,t/.42)))
    base_curve+=height*.065*side*si*rise+height*.035*(si*si)*rise
    # The two shoulders of the root descend into the dorsal mantle at
    # different angles. The central keel continues farther onto the back.
    inset=height*basal*(.058+.025*side*si+.020*math.cos(i+.6))
    q=center+Vector((xx,twist+base_curve-inset,zz))
    rigid=smooth(max(0,min(1,(t-.025)/.22)))
    ws={name:value*(1-rigid) for name,value in axis_weights(z+zz).items() if value*(1-rigid)>1e-8}
    if rigid>1e-8:ws[bone]=rigid
    ring.append(s.v(q,ws))
   rings.append(ring)
  # Open the thin blade along its two physical edges. A single cylindrical UV
  # strip wraps both broad faces and collapses the swept tail-plate root. These
  # are connected anatomical panel charts, never independent triangle islands.
  for k in [sides//4,3*sides//4]:
   for j in range(steps-1):s.seams.add(tuple(sorted((rings[j][k],rings[j+1][k]))))
  for j in range(steps-1):
   for k in range(sides):
    ids=[rings[j][k],rings[j][(k+1)%sides],rings[j+1][(k+1)%sides],rings[j+1][k]]
    s.face(ids,[(.03+.94*j/(steps-1),.23+.73*k/sides),(.03+.94*j/(steps-1),.23+.73*(k+1)/sides),(.03+.94*(j+1)/(steps-1),.23+.73*(k+1)/sides),(.03+.94*(j+1)/(steps-1),.23+.73*k/sides)],HORN)
  for j in [0,steps-1]:
   # Average the actual warped ring and its influences: an unwarped cap centre can sit outside a
   # narrow crown and fold its fan through the blade.
   c=len(s.verts);s.verts.append(tuple(sum((Vector(s.verts[v])for v in rings[j]),Vector())/sides));s.weights.append({n:sum(s.weights[v].get(n,0)for v in rings[j])/sides for n in {n for v in rings[j] for n in s.weights[v]}})
   for k in range(sides):
    angles=[TAU*(k+1)/sides,TAU*k/sides]if j==0 else[TAU*k/sides,TAU*(k+1)/sides]
    ids=[c,rings[j][(k+1)%sides],rings[j][k]]if j==0 else[c,rings[j][k],rings[j][(k+1)%sides]]
    s.face(ids,[(.04,.25)]+[(.04+.01*math.cos(a),.25+.01*math.sin(a))for a in angles],HORN)
 # Four defensive spikes sit in broad embedded dermal roots. A root follows
 # the tail surface into the horn, avoiding a cylinder cuff at the junction.
 for pair,(z,length,spread) in enumerate([(-4.48,.90,.82),(-4.94,.80,.75)]):
  for sign in [-1,1]:
   bone=f'spike_{"front" if pair==0 else "rear"}_{"l" if sign==1 else "r"}'
   path=[(sign*.025,1.29,z+.025),(sign*.18,1.30,z-.035),(sign*.32,1.31,z-.08),(sign*.55,1.32,z-.17),(sign*spread,1.34,z-.35),(sign*(spread+.03),1.35,z-.41)]
   tube(s,path,[(.115,.11),(.12,.10),(.093,.075),(.065,.052),(.024,.021),(.003,.003)],{bone:1},HORN,(.04,.04,.69,.15),sides=16,sub=2,flatten=0)

def jaw(s):
 """Closed dentary shell with real sidewalls and a concave oral floor."""
 s.chart+=1
 section=[(-1,.8),(-1,.05),(-.84,-.65),(-.44,-.94),(0,-1),(.44,-.94),(.84,-.65),(1,.05),(1,.8),(.79,.72),(.66,.12),(.36,-.20),(0,-.28),(-.36,-.20),(-.66,.12),(-.79,.72)]
 table=sample([(2.57,1.205,.008,.008),(2.67,1.162,.090,.048),(2.80,1.104,.180,.100),(2.95,1.059,.168,.095),(3.10,1.048,.145,.083),(3.28,1.0608,.125,.070),(3.48,1.085,.080,.034),(3.65,1.088,.032,.020),(3.70,1.090,.010,.008)],3,2)
 rings=[]
 for z,y,rx,ry in table:
  # The posterior ramus rises toward the hinge; the inner floor has its own
  # small return instead of scaling an identical bowl all the way to the neck.
  ramus=math.exp(-((z-2.78)/.18)**4);ids=[]
  for u,v in section:
   # The posterior upper wall follows the cheek while the oral floor follows
   # the mandible. This makes the commissure part of the dentary skin surface,
   # rather than a separate triangular membrane hovering in the gape.
   anchor=smooth(max(0,min(1,(3.12-z)/.35)))*smooth(max(0,min(1,(v+.25)/1.05)))
   ids.append(s.v((u*rx,y+v*ry+ramus*(.055*max(v,0)+.012*(1-abs(u))),z),{'skull':anchor,'jaw':1-anchor}))
  rings.append(ids)
 n=len(section)
 for j in range(len(rings)-1):
  a=.81+.16*j/(len(rings)-1);b=.81+.16*(j+1)/(len(rings)-1)
  for k in range(n):
   following=(k+1)%n
   s.face([rings[j][k],rings[j][following],rings[j+1][following],rings[j+1][k]],[(a,.77+.19*k/n),(a,.77+.19*(k+1)/n),(b,.77+.19*(k+1)/n),(b,.77+.19*k/n)],HORN if k>=8 else SKIN)
 for j in [0,len(rings)-1]:
  order=list(range(n))if j else list(reversed(range(n)))
  from mathutils.geometry import tessellate_polygon
  planar=[Vector((section[k][0],section[k][1],0))for k in order]
  for triangle in tessellate_polygon([planar]):
   corners=[order[k]for k in triangle]
   s.face([rings[j][k]for k in corners],[(.84+.03*section[k][0],.83+.03*section[k][1])for k in corners],SKIN)


def face(s):
 # The dentary has a deep posterior hinge and a tapered opposing keratin edge.
 # Its ventral volume stays distinct from the tongue/oral floor when opened.
 jaw(s)
 # Oral floor and a separate muscular tongue have volume, rather than painting
 # the same external skin on a thin lower tray. Their closed roots are buried.
 tube(s,[(0,1.105,2.78),(0,1.064,3.00),(0,1.067,3.20),(0,1.071,3.37),(0,1.072,3.42),(0,1.071,3.445)],[(.070,.050),(.092,.045),(.078,.040),(.055,.030),(.040,.024),(.008,.007)],{'jaw':1},HORN,(.78,.05,.18,.13),sides=20,sub=3,flatten=0)
 for side,sign in [('l',1),('r',-1)]:
  # Sculpted socket/brow, colored sclera, pupil and black nostril cavity.
  ellipsoid(s,(sign*.206,1.32,3.025),(.014,.027,.038),'skull',HORN,(.02,.975,.20,.020),around=24,rows=12)
  ellipsoid(s,(sign*.219,1.32,3.035),(.002,.019,.012),'skull',HORN,(.27,.975,.20,.020),around=16,rows=10)
  tube(s,[(sign*.199,1.319,2.968),(sign*.215,1.339,2.995),(sign*.218,1.346,3.025),(sign*.216,1.338,3.056),(sign*.200,1.319,3.082)],[(.005,.004),(.007,.006),(.008,.006),(.006,.005),(.004,.004)],{f'lid_{side}':1},SKIN,(.82,.77,.15,.18),sides=12,sub=2,flatten=0)
  tube(s,[(sign*.195,1.319,2.968),(sign*.209,1.303,2.995),(sign*.212,1.299,3.025),(sign*.210,1.304,3.056),(sign*.196,1.319,3.082)],[(.0015,.0015),(.003,.003),(.004,.003),(.003,.0025),(.0015,.0015)],{'skull':1},SKIN,(.82,.77,.15,.18),sides=10,sub=2,flatten=0)


def fuse_anatomy(s):
 """Unify authored muscle masses, transferring weights and paint coordinates.

 The visible shoulder and ankle have no intersecting cylinder cuffs. This is
 an authoring remesh, applied once before export, not a runtime construction.
 Old UVs here are only field coordinates; unwrap.py parameterizes the actual
 finished surface after connected seams have been marked.
 """
 import bmesh
 from mathutils.bvhtree import BVHTree
 from mathutils.geometry import barycentric_transform
 source=s.mesh();source.data.calc_loop_triangles()
 verts=[v.co.copy() for v in source.data.vertices]
 tris=list(source.data.loop_triangles)
 tree=BVHTree.FromPolygons(verts,[t.vertices[:] for t in tris],all_triangles=True)
 uv=source.data.uv_layers.active
 chart_tris={}
 for i,t in enumerate(tris):chart_tris.setdefault(s.charts[t.polygon_index],[]).append(i)
 chart_trees={c:BVHTree.FromPolygons(verts,[tris[i].vertices[:]for i in ids],all_triangles=True)for c,ids in chart_tris.items()}
 target=source.copy();target.data=source.data.copy();bpy.context.scene.collection.objects.link(target)
 target.name='stego_anatomy';target.parent=None;target.modifiers.clear()
 bpy.ops.object.select_all(action='DESELECT');target.select_set(True);bpy.context.view_layer.objects.active=target
 target.data.remesh_voxel_size=.014;target.data.remesh_voxel_adaptivity=0
 bpy.ops.object.voxel_remesh()
 mod=target.modifiers.new('soft tissue junctions','SMOOTH');mod.factor=.40;mod.iterations=2;bpy.ops.object.modifier_apply(modifier=mod.name)
 # Blend the muscle-to-ribcage intersection across a finite soft-tissue region.
 # Whole-limb smoothing would erase the elbow/ulna; only vertices near BOTH
 # original surfaces participate, so a visible capsule seam cannot survive.
 limb_ids=[i for i,t in enumerate(tris)if s.charts[t.polygon_index]!=1]
 limb_tree=BVHTree.FromPolygons(verts,[tris[i].vertices[:]for i in limb_ids],all_triangles=True)
 junction=target.vertex_groups.new(name='scapular_blend')
 for vertex in target.data.vertices:
  p=rig.E(vertex.co)
  if not(.7<p.y<1.85 and .3<p.z<1.25):continue
  trunk_distance=chart_trees[1].find_nearest(vertex.co)[3];limb_distance=limb_tree.find_nearest(vertex.co)[3]
  weight=math.exp(-(trunk_distance/.055)**2-(limb_distance/.055)**2)
  if weight>.001:junction.add([vertex.index],weight,'REPLACE')
 mod=target.modifiers.new('continuous scapular insertion','SMOOTH');mod.factor=.55;mod.iterations=12;mod.vertex_group=junction.name;bpy.ops.object.modifier_apply(modifier=mod.name)
 target.data.calc_loop_triangles();count=len(target.data.loop_triangles)
 def topology(stage):
  bm=bmesh.new();bm.from_mesh(target.data);bad=[e for e in bm.edges if not e.is_manifold]
  if bad:print('TOPOLOGY',stage,[(len(e.link_faces),[tuple(rig.E(v.co))for v in e.verts])for e in bad[:12]],flush=True)
  bm.free()
 topology('voxel-smooth')
 # Spend source topology where cheek/orbit/throat planes are small. Blender's
 # collapse implementation adds the weighted edge length to its error cost.
 # A small nonzero bias retains facial planes without protecting every tiny
 # voxel and starving the neck/limbs. This reallocates the same total budget.
 priority=target.vertex_groups.new(name='anatomical_reduction')
 for vertex in target.data.vertices:
  z=rig.E(vertex.co).z;weight=min(1-.70*smooth(max(0,min(1,(z-2.04)/.28))),1-.50*math.exp(-((z-1.94)/.43)**4))
  priority.add([vertex.index],weight,'REPLACE')
 dec=target.modifiers.new('anatomical surface','DECIMATE');dec.ratio=min(1,16450/count);dec.use_collapse_triangulate=True;dec.vertex_group=priority.name;dec.vertex_group_factor=.002
 bpy.ops.object.modifier_apply(modifier=dec.name)
 topology('collapse')
 # Finish the load-bearing plantar surface on its actual y=0 plane after the
 # union and simplification. The compressed pad blends C1 into the unflattened
 # sidewall over15mm; joints, ankle reach and the dorsal foot remain unchanged.
 for vertex in target.data.vertices:
  point=rig.E(vertex.co)
  if point.y<.018:
   t=max(0,min(1,(point.y-.003)/.015))
   point.y=(-2*t*t*t+3*t*t)*.018+(t*t*t-t*t)*.015
   vertex.co=rig.B(point)
 # Closed concave nasal pockets are carved into the finished skin. The dark
 # aperture is therefore inside actual anatomy, with a real rim and inner wall.
 # The recess remains manifold; it is not a separate black sphere or decal.
 for sign in [-1,1]:
  # The orbit is a real recessed socket around the eye, not a tiny lid pushed
  # through an otherwise flat cheek. Carve it after voxel union so the rim is
  # not erased by the trunk's coarser sculpt sampling.
  bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=rig.B(rig.shape((sign*.223,1.322,3.025))))
  cutter=bpy.context.object;cutter.name='temporary_orbit';cutter.scale=(.033,.037,.031)
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  cut=target.modifiers.new('recessed orbit','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
  cutter.select_set(False);target.select_set(True);bpy.context.view_layer.objects.active=target
  bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
  bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=rig.B((sign*.140,1.255,rig.shape((0,0,3.35))[2])))
  cutter=bpy.context.object;cutter.name='temporary_nasal_pocket';cutter.scale=(.055,.043,.024)
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  cut=target.modifiers.new('closed nasal recess','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
  cutter.select_set(False);target.select_set(True);bpy.context.view_layer.objects.active=target
  bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
 # A closed recessed upper palate gives the opening real depth. It opens from
 # the ventral skull while retaining the cheek, beak and nasal bone wall.
 oral_center=rig.B(rig.shape((0,1.055,3.17)))
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=oral_center)
 cutter=bpy.context.object;cutter.name='temporary_oral_cavity';cutter.scale=(.128,.225,.105)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 cut=target.modifiers.new('recessed upper palate','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
 cutter.select_set(False);target.select_set(True);bpy.context.view_layer.objects.active=target
 bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
 topology('nasal-booleans')
 # Collapse triangulates its own topology before the nasal boolean. Re-cutting
 # the collapse's non-planar ngons afterwards can choose an existing adjacent
 # diagonal at a tight ankle fold and create four incident faces. Only the new
 # nasal polygons still need triangulation here, before connected UV unwrap.
 clean=bmesh.new();clean.from_mesh(target.data)
 # Exact booleans can return two copies of one intersection 45 nanometres
 # apart. Weld only submicrometre duplicates before triangulating; the native
 # manifold and signed-area checks still apply to the resulting real surface.
 bmesh.ops.remove_doubles(clean,verts=list(clean.verts),dist=1e-6)
 bmesh.ops.triangulate(clean,faces=[f for f in clean.faces if len(f.verts)>3],quad_method='BEAUTY',ngon_method='EAR_CLIP')
 if any(not e.is_manifold for e in clean.edges):raise RuntimeError('anatomy triangulation is not manifold')
 clean.to_mesh(target.data);clean.free();target.data.update()
 target.vertex_groups.clear();weights=[];chart_cache={}
 def weight_field(hit,index):
  tri=tris[index];a,b,c=[verts[v]for v in tri.vertices]
  bc=barycentric_transform(hit,a,b,c,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))
  ws={}
  for idx,factor in zip(tri.vertices,bc):
   for bone,value in s.weights[idx].items():ws[bone]=ws.get(bone,0)+max(0,factor)*value
  return ws
 for vertex in target.data.vertices:
  hit,_,index,_=tree.find_nearest(vertex.co)
  ws=weight_field(hit,index)
  total=sum(ws.values())
  weights.append({bone:value/total for bone,value in ws.items() if value>0})
 from skin_weights import junction_weights
 weights=junction_weights(target.data,weights,rig.E)
 def mapped(vertex,chart):
  key=(vertex,chart)
  if key not in chart_cache:
   p=target.data.vertices[vertex].co
   hit,_,index,_=chart_trees[chart].find_nearest(p);tri=tris[chart_tris[chart][index]]
   a,b,c=[verts[v]for v in tri.vertices];ta,tb,tc=[Vector((*uv.data[i].uv,0))for i in tri.loops]
   q=barycentric_transform(hit,a,b,c,ta,tb,tc);chart_cache[key]=(q.x,q.y)
  return chart_cache[key]
 while target.data.uv_layers: target.data.uv_layers.remove(target.data.uv_layers[0])
 dest=target.data.uv_layers.new(name='Surface')
 for poly in target.data.polygons:
  center=sum((target.data.vertices[v].co for v in poly.vertices),Vector())/len(poly.vertices)
  hit,normal,index,distance=tree.find_nearest(center);tri=tris[index]
  chart=s.charts[tri.polygon_index]
  ec=rig.E(center);cavity=((ec.x/.128)**2+((ec.z-rig.shape((0,0,3.17))[2])/.225)**2+((ec.y-1.055)/.105)**2)
  oral=.84<cavity<1.01 and ec.y>1.055 and abs(ec.x)<.128 and abs(ec.z-rig.shape((0,0,3.17))[2])<.225
  # The hoof wall and pad share a continuous skin chart. The coronet curves
  # across triangles while the toe's actual section sets its blunt silhouette.
  poly.material_index=HORN if oral else (SKIN if ec.y<.24 else source.data.polygons[tri.polygon_index].material_index)
  poly.use_smooth=True
  values=[mapped(v,chart)for v in poly.vertices]
  # The longitudinal shell has one deliberate ventral cylindrical seam.
  body_seam=chart==1 and max(q[1]for q in values)-min(q[1]for q in values)>.35
  for loop,t in zip(poly.loop_indices,values):
   if body_seam and t[1]>.38:t=(t[0],t[1]-.70)
   dest.data[loop].uv=t
 labels=target.data.attributes.new(name='anatomical_chart',type='INT',domain='FACE')
 for poly in target.data.polygons:
  center=sum((target.data.vertices[v].co for v in poly.vertices),Vector())/len(poly.vertices)
  _,_,index,_=tree.find_nearest(center);labels.data[poly.index].value=s.charts[tris[index].polygon_index]
 from unwrap import seam_anatomy,seam_orbits
 seam_anatomy(target);seam_orbits(target.data)
 # Shape the finished pad and digits together. The plantar face remains on
 # its support plane. Each distal phalanx becomes lower and broader toward
 # its bearing edge, with the coronary skin passing continuously over it.
 for vertex in target.data.vertices:
  q=rig.E(vertex.co)
  if q.y>.20 or abs(q.x)<.37:continue
  strength=0.
  for cx,cz,width,splay in [( .565,1.411,.085,-.20),(.715,1.450,.088,.025),(.61,-.313,.094,-.16),(.77,-.266,.096,0),(.93,-.321,.094,.18)]:
   along=q.z-cz
   if along<-.065 or along>.17:continue
   lateral=(abs(q.x)-cx-splay*along)/width
   broad=1-smooth(max(0,min(1,(abs(lateral)-.72)/.58)))
   advance=smooth(max(0,min(1,(along+.065)/.16)))
   strength=max(strength,broad*advance)
  strength*=1-smooth(max(0,min(1,(q.y-.125)/.075)))
  q.y*=1-.31*strength;q.z+=.015*strength
  vertex.co=rig.B(q)
 sculpt_plate_beds(target.data)
 target.data.update()
 rig.bind(target,weights);bpy.data.objects.remove(source,do_unlink=True)
 return target

def build():
 s=Surface('stego_skin_source');body(s);limbs(s);dermal_roots(s);anatomy=fuse_anatomy(s)
 detail=Surface('stego_features');plates(detail);face(detail);features=detail.mesh()
 bpy.ops.object.select_all(action='DESELECT');anatomy.select_set(True);features.select_set(True);bpy.context.view_layer.objects.active=anatomy;bpy.ops.object.join()
 anatomy.name='stego_body'
 from unwrap import unwrap_and_bake_fields
 unwrap_and_bake_fields(anatomy)
 return anatomy

if __name__=='__main__':build()
