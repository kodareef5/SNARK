"""Native rigid-mesh primitive toolkit reused from the accepted Koru pipeline, engine metres until final Blender axis conversion.

Primitives are closed solids or explicitly paired sheets. Flat levels use semantic palette materials; both near candidates carry the shared atlas.
"""
import bpy,bmesh,json,math,struct
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
LOOK=json.loads((HERE/'materials.json').read_text())

def linear(x):
 x=x/255
 return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4

def material(name,rgb):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);color=(*[linear(c) for c in rgb],1);m.diffuse_color=color;m.use_nodes=True
 m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color
 return m
MATS={tag:material('flat_'+tag,p['rgb']) for tag,p in LOOK.items()}
SIGNS=json.loads((HERE/'signs.json').read_text())
SIGNMAT=material('signs',[255,255,255])
ATLAS=material('surfaces',[255,255,255]);ATLAS.use_nodes=True
if (HERE/'tex/surfaces_base.png').exists():
 node=ATLAS.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(HERE/'tex/surfaces_base.png'))
 ATLAS.node_tree.links.new(node.outputs['Color'],ATLAS.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

class Mesh:
 def __init__(self,level=0):
  self.v=[];self.f=[];self.tags=[];self.uv=[];self.level=level
  self.islands=[];self.convexes=[];self.owners=[];self.owner=0;self.textured=level<2;self.direct_uv=False;self.raw=None
 def face(self,points,tag='enamel',uv=None):
  start=len(self.v);self.v.extend([tuple(p) for p in points]);self.f.append(tuple(range(start,start+len(points))));self.tags.append(tag);self.uv.append(uv);self.owners.append(self.owner)
 def indexed(self,verts,faces,tag='enamel',convex=False):
  start=len(self.v);first=len(self.f);self.v.extend([tuple(p) for p in verts])
  for face in faces:self.f.append(tuple(start+i for i in face));self.tags.append(tag);self.uv.append(None);self.owners.append(self.owner)
  self.islands.append((start,len(self.v),first,len(self.f)))
  self.convexes.append(convex)
 def box(self,lo,hi,tag='enamel',bevel=0):
  if bevel>=.025 and self.level<2:
   x0,y0,z0=lo;x1,y1,z1=hi;b=min(bevel,(x1-x0)/4,(y1-y0)/4,(z1-z0)/4)
   rings=[]
   for y in(y0,y1):
    r=b;a=x0;c=x1;d=z0;e=z1
    rings.append([(a+r,y,d),(c-r,y,d),(c,y,d+r),(c,y,e-r),(c-r,y,e),(a+r,y,e),(a,y,e-r),(a,y,d+r)])
   self.loft(rings,tag);return
  x0,y0,z0=lo;x1,y1,z1=hi
  self.indexed([(x,y,z) for x in(x0,x1) for y in(y0,y1) for z in(z0,z1)],[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],tag,convex=True)
 def loft(self,rings,tag='enamel',caps=True):
  n=len(rings[0]);faces=[]
  for j in range(len(rings)-1):
   for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  if caps:faces.extend([tuple(reversed(range(n))),tuple((len(rings)-1)*n+i for i in range(n))])
  self.indexed([p for r in rings for p in r],faces,tag,convex=len(rings)==2)
 def tube(self,points,r,tag='steel',n=None,transport=False):
  n=n or [12,8,6,4,4,4][self.level];rings=[];previous=None
  for i,p in enumerate(points):
   p=Vector(p);direction=(Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])).normalized()
   if transport and len(points)>2 and previous is not None:
    # Project the preceding transverse axis into the new normal plane. A
    # per-station world-axis switch can reverse a curved tube's ring by180°.
    u=previous-direction*previous.dot(direction)
    if u.length_squared<1e-12:u=direction.cross(Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0)))
    u.normalize()
   else:u=direction.cross(Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0))).normalized()
   previous=u.copy();v=direction.cross(u).normalized()
   rings.append([p+r*(math.cos(k*math.tau/n)*u+math.sin(k*math.tau/n)*v) for k in range(n)])
  self.loft(rings,tag)
 def convex(self,points,tag='enamel'):
  bm=bmesh.new();vs=[bm.verts.new(p) for p in points];bmesh.ops.convex_hull(bm,input=vs,use_existing_faces=False)
  bmesh.ops.dissolve_limit(bm,angle_limit=1e-5,use_dissolve_boundaries=False,verts=list(bm.verts),edges=list(bm.edges))
  bm.verts.ensure_lookup_table();bm.verts.index_update()
  self.indexed([tuple(v.co) for v in bm.verts],[tuple(v.index for v in f.verts) for f in bm.faces],tag,convex=True);bm.free()
 def ring(self,center,u,v,rx,ry,r,tag='steel',n=None):
  n=n or [24,16,12,8,6,4][self.level];c=Vector(center);u=Vector(u);v=Vector(v);normal=u.cross(v).normalized();verts=[];faces=[];sides=6 if self.level<2 else 4
  for i in range(n):
   a=math.tau*i/n;rad=u*math.cos(a)+v*math.sin(a);p=c+u*(rx*math.cos(a))+v*(ry*math.sin(a))
   verts.extend([p+r*(rad*math.cos(k*math.tau/sides)+normal*math.sin(k*math.tau/sides)) for k in range(sides)])
  for i in range(n):
   for k in range(sides):faces.append((i*sides+k,((i+1)%n)*sides+k,((i+1)%n)*sides+(k+1)%sides,i*sides+(k+1)%sides))
  self.indexed(verts,faces,tag)
 def object(self,name,origin):
  # Convert engine (+Y up,+Z forward) to Blender (+Z up,-Y forward). Export restores engine coordinates.
  verts=[(p[0]-origin[0],-(p[2]-origin[2]),p[1]-origin[1]) for p in self.v]
  me=bpy.data.meshes.new(name);me.from_pydata(verts,[],self.f);me.update();obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj)
  if self.textured:
   me.materials.append(ATLAS);me.materials.append(SIGNMAT);layer=me.uv_layers.new(name='Surface')
   for poly,tag,custom in zip(me.polygons,self.tags,self.uv):
    sign=tag.startswith('sign:');poly.material_index=1 if sign else 0;cell=SIGNS[tag[5:]] if sign else LOOK[tag]['cell'];grid=8;cx=cell%grid;cy=cell//grid
    points=[Vector(self.v[i]) for i in self.f[poly.index]]
    normal=(points[1]-points[0]).cross(points[2]-points[0])
    axis=max(range(3),key=lambda k:abs(normal[k]));axes={0:[2,1],1:[0,2],2:[0,1]}[axis]
    lo=[min(p[k] for p in points) for k in axes];hi=[max(p[k] for p in points) for k in axes]
    for j,li in enumerate(poly.loop_indices):
     if self.direct_uv and custom:
      layer.data[li].uv=custom[j];continue
     uv=custom[j] if custom else [(.04+.92*(points[j][k]-lo[t])/max(hi[t]-lo[t],1e-7)) for t,k in enumerate(axes)]
     if sign:
      if axis in(0,2) and normal[axis]*(-1 if axis==0 else 1)<0:uv[0]=1-uv[0]
      uv=[.03+.94*(uv[0]-.04)/.92,.29+.42*(uv[1]-.04)/.92]
     layer.data[li].uv=((cx+uv[0])/grid,1-(cy+1-uv[1])/grid)
  else:
   tags=list(LOOK);[me.materials.append(MATS[t]) for t in tags]
   for poly,tag in zip(me.polygons,self.tags):poly.material_index=tags.index('steel' if tag.startswith('sign:') else tag)
  # Triangulate every solid without merging touching-but-independent parts; recalc its outward winding.
  bm=bmesh.new();bm.from_mesh(me)
  owners=bm.faces.layers.int.new('source_owner')
  for face,owner in zip(bm.faces,self.owners):face[owners]=owner
  clear=bm.faces.layers.int.new('source_clear')
  for face,tag in zip(bm.faces,self.tags):face[clear]=int(tag=='clear')
  # Every authored primitive already has its own indexed closed surface. Keep
  # touching solids as separate islands: merging their internal cap vertices
  # creates non-manifold edges and can reverse otherwise visible floor panels.
  if not self.direct_uv:bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
  bmesh.ops.triangulate(bm,faces=bm.faces,quad_method='BEAUTY',ngon_method='BEAUTY')
  if self.raw:
   with open(self.raw,'wb') as stream,open(str(self.raw)+'.clear','wb') as visibility:
    for face in bm.faces:
     assert len(face.verts)==3
     points=[(v.co.x,v.co.z,-v.co.y) for v in face.verts]
     stream.write(struct.pack('<I9f',face[owners],*(q for p in points for q in p)))
     visibility.write(bytes([face[clear]]))
  bm.to_mesh(me);bm.free();me.update()
  # Smoothness is restrained: manufactured planes stay plane, while cylindrical spars/rails receive smooth normals.
  for p in me.polygons:p.use_smooth=False
  return obj
