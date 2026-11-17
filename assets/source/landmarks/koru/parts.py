"""Koru's mesh toolkit. Shapes are closed solids in ship metres (+Y up, +Z bow, +X port), each face in a finish of one of
the pictures (materials.json) or a plaque (signs.json). A vertex given a normal is smooth; the rest are flat."""
import bpy,bmesh,json,math
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
LOOK=json.loads((HERE/'materials.json').read_text());PICTURES=LOOK['pictures'];FINISH=LOOK['finishes']
SIGNS=json.loads((HERE/'signs.json').read_text())
INSET=LOOK['inset']
AVG='avg'  # a vertex smoothed over the faces it is on

def linear(c):
 c=c/255;return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def material(name,rgb):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
 colour=(*[linear(c) for c in rgb],1);m.diffuse_color=colour;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=colour
 return m
# A Blender material for each picture, which the asset names.
DRAWN={name:material(name,[255,255,255]) for name in PICTURES}
def blender(p):return (p[0],-p[2],p[1])
def engine(p):return (p[0],p[2],-p[1])
def unit(v):
 l=math.sqrt(sum(a*a for a in v));return [a/l for a in v]
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def sub(a,b):return [x-y for x,y in zip(a,b)]

def newell(pts):
 n=[0,0,0]
 for a,b in zip(pts,pts[1:]+pts[:1]):
  n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1])
 return n

class Mesh:
 """Every face is wound outward as it is added: away from `away`, a point inside its solid, or along `out`."""
 def __init__(self,flat=None):
  self.v=[];self.n=[];self.f=[];self.tags=[];self.uv=[];self.flat=flat;self.level=0
 def add(self,points,normals=None):
  start=len(self.v);self.v.extend(tuple(p) for p in points);self.n.extend(normals or [None]*len(points));return start
 def faces(self,start,faces,tag,uvs=None,out=None,away=None):
  for i,face in enumerate(faces):
   f=[start+k for k in face];uv=uvs[i] if uvs else None;pts=[self.v[k] for k in f];n=newell(pts)
   ref=out(i) if callable(out) else out
   if ref is None:
    a=away(i) if callable(away) else away;c=[sum(p[k] for p in pts)/len(pts) for k in range(3)];ref=sub(c,a)
   if sum(x*y for x,y in zip(n,ref))<0:
    f.reverse()
    if uv:uv=list(reversed(uv))
   self.f.append(tuple(f));self.tags.append(tag[i] if isinstance(tag,list) else tag);self.uv.append(uv)
 def poly(self,points,tag,uv=None,out=None,away=None,normals=None):
  self.faces(self.add(points,normals),[range(len(points))],tag,[uv] if uv else None,out,away)
 def box(self,lo,hi,tag,top=None,bottom=None):
  """Faces -x, +x, -y, +y, -z, +z; `tag` may be a list of six."""
  x0,y0,z0=lo;x1,y1,z1=hi
  if min(x1-x0,y1-y0,z1-z0)<=1e-6:return
  tags=list(tag) if isinstance(tag,list) else [tag]*6
  if top:tags[3]=top
  if bottom:tags[2]=bottom
  self.faces(self.add([(x,y,z) for x in(x0,x1) for y in(y0,y1) for z in(z0,z1)]),[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],tags,away=[(a+b)/2 for a,b in zip(lo,hi)])
 def loft(self,rings,tag,caps=True,smooth=False):
  n=len(rings[0]);mid=[[sum(p[k] for p in r)/n for k in range(3)] for r in rings]
  self.faces(self.add([p for r in rings for p in r],[AVG]*(n*len(rings)) if smooth else None),[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)],tag,
   away=lambda i:[(a+b)/2 for a,b in zip(mid[i//n],mid[i//n+1])])
  if caps:
   self.poly(rings[0],tag,away=mid[1]);self.poly(rings[-1],tag,away=mid[-2])
 def tube(self,points,r,tag,n=6,caps=True,across=None):
  """Rings round a line of points. `across`, a way the line never runs, keeps every ring turned alike, for a line that curls."""
  rings=[]
  for i,p in enumerate(points):
   d=Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)]);d.normalize()
   if across:a=Vector(across);u=(a-a.dot(d)*d).normalized()
   else:u=d.cross(Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))).normalized()
   w=d.cross(u).normalized()
   rings.append([tuple(Vector(p)+r*(math.cos(k*math.tau/n)*u+math.sin(k*math.tau/n)*w)) for k in range(n)])
  self.loft(rings,tag,caps,True)
 def convex(self,points,tag,smooth=False):
  bm=bmesh.new();vs=[bm.verts.new(p) for p in points];bmesh.ops.convex_hull(bm,input=vs,use_existing_faces=False)
  bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS');bm.verts.index_update()
  pts=[tuple(v.co) for v in bm.verts]
  self.faces(self.add(pts,[AVG]*len(pts) if smooth else None),[tuple(v.index for v in f.verts) for f in bm.faces],tag,away=[sum(p[k] for p in points)/len(points) for k in range(3)]);bm.free()
 def rbox(self,lo,hi,tag,r=.02,smooth=False):
  """A box with its edges and corners rounded off by `r`, as joinery and upholstery are; smooth, it is shaded soft all
  over, as a cushion is."""
  r=min(r,*[(b-a)/2.05 for a,b in zip(lo,hi)])
  if r<.004:return self.box(lo,hi,tag)
  pts=[]
  for cx,sx in((lo[0]+r,-1),(hi[0]-r,1)):
   for cy,sy in((lo[1]+r,-1),(hi[1]-r,1)):
    for cz,sz in((lo[2]+r,-1),(hi[2]-r,1)):
     for dx,dy,dz in((1,0,0),(0,1,0),(0,0,1))+(((.58,.58,.58),) if smooth else ()):pts.append((cx+sx*r*dx,cy+sy*r*dy,cz+sz*r*dz))
  self.convex(pts,tag,smooth)
 def object(self,name,origin):
  """The mesh in the frame of a static at `origin`, faces in their finishes on the pictures, or in flat colours."""
  bm=bmesh.new();vs=[bm.verts.new(blender(sub(p,origin))) for p in self.v];fs=[bm.faces.new([vs[i] for i in f]) for f in self.f]
  bm.verts.index_update();bm.normal_update()
  # A smooth vertex takes the mean of its faces, or the normal it was given.
  smooth={}
  for face,f in zip(fs,self.f):
   for i in f:
    if self.n[i]==AVG:smooth[i]=smooth.get(i,Vector())+face.normal*face.calc_area()
  for i,n in enumerate(self.n):
   if n is not None and n!=AVG:smooth[i]=Vector(blender(n))
  if self.flat:
   mats=list(self.flat);me=bpy.data.meshes.new(name)
   for face,tag in zip(fs,self.tags):face.material_index=mats.index(tag)
  else:
   mats=None;layer=bm.loops.layers.uv.new('Surface');pics=[]
   for face,f,tag,custom in zip(fs,self.f,self.tags,self.uv):
    pts=[self.v[i] for i in f];normal=engine(face.normal);axis=max(range(3),key=lambda k:abs(normal[k]))
    ua,va={0:(2,1),1:(0,2),2:(0,1)}[axis];mirror=(axis==0 and normal[0]>0) or (axis==2 and normal[2]<0)
    order={v.index:j for j,v in enumerate(face.verts)}
    a=[p[ua] for p in pts];b=[p[va] for p in pts];lo=(min(a),min(b));ext=(max(a)-lo[0],max(b)-lo[1])
    if tag.startswith('sign:') and min(ext)>.05:
     x,y,w,h=SIGNS[tag[5:]];inset=6;pic='signs'
     fr=[((ai-lo[0])/max(ext[0],1e-6),(bi-lo[1])/max(ext[1],1e-6)) for ai,bi in zip(a,b)]
     if mirror:fr=[(1-u,v) for u,v in fr]
    else:
     if tag.startswith('sign:'):tag='brass'
     fin=FINISH[tag];x,y,w,h=fin['rect'];tile=fin.get('tile');inset=w/4 if 'tile' not in fin else INSET;pic=fin.get('picture','surfaces')
     if custom:fr=custom
     else:
      span=tile or ext;fr=[((ai-lo[0])/max(ext[0],span[0],1e-6),(bi-lo[1])/max(ext[1],span[1],1e-6)) for ai,bi in zip(a,b)]
    if pic not in pics:pics.append(pic)
    face.material_index=pics.index(pic);size=PICTURES[pic]
    for loop in face.loops:
     u,v=fr[f.index(loop.vert.index)]
     loop[layer].uv=((x+inset+u*(w-2*inset))/size,1-(y+h-inset-v*(h-2*inset))/size)
   me=bpy.data.meshes.new(name)
  bmesh.ops.triangulate(bm,faces=bm.faces[:],quad_method='BEAUTY',ngon_method='BEAUTY')
  bm.to_mesh(me);bm.free()
  if mats is None:
   for pic in pics:me.materials.append(DRAWN[pic])
  else:
   for tag in mats:me.materials.append(material('flat_'+tag,self.flat[tag]))
  normals=[]
  for poly in me.polygons:
   soft=all(i in smooth for i in poly.vertices)
   for li in poly.loop_indices:normals.append(tuple(smooth[me.loops[li].vertex_index].normalized()) if soft else tuple(poly.normal))
  me.normals_split_custom_set(normals);me.update()
  obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj)
  return obj
