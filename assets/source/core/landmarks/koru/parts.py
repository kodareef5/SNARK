"""Small original rigid-mesh authoring toolkit, engine metres until final Blender axis conversion.

Every primitive is a closed solid. Flat levels use semantic palette materials; only level0 carries the shared atlas.
"""
import bpy,bmesh,json,math
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
LOOK=json.loads((HERE/'materials.json').read_text())

def linear(x):
 x=x/255
 return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4

def material(name,rgb):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.diffuse_color=(*[linear(c) for c in rgb],1)
 return m
MATS={tag:material('flat_'+tag,p['rgb']) for tag,p in LOOK.items()}
SIGNS=json.loads((HERE/'signs.json').read_text())
SIGNMAT=material('signs',[255,255,255])
ATLAS=material('surfaces',[255,255,255]);ATLAS.use_nodes=True
if (HERE/'tex/surfaces_base.png').exists():
 node=ATLAS.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(HERE/'tex/surfaces_base.png'))
 ATLAS.node_tree.links.new(node.outputs['Color'],ATLAS.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

class Mesh:
 def __init__(self,level=0):self.v=[];self.f=[];self.tags=[];self.uv=[];self.level=level
 def face(self,points,tag='cream',uv=None):
  start=len(self.v);self.v.extend([tuple(p) for p in points]);self.f.append(tuple(range(start,start+len(points))));self.tags.append(tag);self.uv.append(uv)
 def indexed(self,verts,faces,tag='cream'):
  start=len(self.v);self.v.extend([tuple(p) for p in verts])
  for face in faces:self.f.append(tuple(start+i for i in face));self.tags.append(tag);self.uv.append(None)
 def box(self,lo,hi,tag='cream',bevel=0):
  if bevel>0 and self.level<3:
   x0,y0,z0=lo;x1,y1,z1=hi;b=min(bevel,(x1-x0)/4,(y1-y0)/4,(z1-z0)/4)
   rings=[]
   for y,inset in[(y0,b),(y0+b,0),(y1-b,0),(y1,b)]:
    r=b if inset==0 else max(.002,b*.15);a=x0+inset;c=x1-inset;d=z0+inset;e=z1-inset
    rings.append([(a+r,y,d),(c-r,y,d),(c,y,d+r),(c,y,e-r),(c-r,y,e),(a+r,y,e),(a,y,e-r),(a,y,d+r)])
   self.loft(rings,tag);return
  x0,y0,z0=lo;x1,y1,z1=hi
  self.indexed([(x,y,z) for x in(x0,x1) for y in(y0,y1) for z in(z0,z1)],[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],tag)
 def loft(self,rings,tag='cream',caps=True):
  n=len(rings[0]);faces=[]
  for j in range(len(rings)-1):
   for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  if caps:faces.extend([tuple(reversed(range(n))),tuple((len(rings)-1)*n+i for i in range(n))])
  self.indexed([p for r in rings for p in r],faces,tag)
 def tube(self,points,r,tag='steel',n=None):
  n=n or [12,8,6,4,4,4][self.level];rings=[]
  for i,p in enumerate(points):
   p=Vector(p);direction=(Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])).normalized()
   u=direction.cross(Vector((0,1,0)) if abs(direction.y)<.9 else Vector((1,0,0))).normalized();v=direction.cross(u).normalized()
   rings.append([p+r*(math.cos(k*math.tau/n)*u+math.sin(k*math.tau/n)*v) for k in range(n)])
  self.loft(rings,tag)
 def convex(self,points,tag='cream'):
  bm=bmesh.new();vs=[bm.verts.new(p) for p in points];bmesh.ops.convex_hull(bm,input=vs,use_existing_faces=False);bm.verts.ensure_lookup_table();bm.verts.index_update()
  self.indexed([tuple(v.co) for v in bm.verts],[tuple(v.index for v in f.verts) for f in bm.faces],tag);bm.free()
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
  if self.level==0:
   me.materials.append(ATLAS);me.materials.append(SIGNMAT);layer=me.uv_layers.new(name='Surface')
   for poly,tag,custom in zip(me.polygons,self.tags,self.uv):
    sign=tag.startswith('sign:');poly.material_index=1 if sign else 0;cell=SIGNS[tag[5:]] if sign else LOOK[tag]['cell'];grid=8 if sign else 4;cx=cell%grid;cy=cell//grid
    points=[Vector(self.v[i]) for i in self.f[poly.index]]
    normal=(points[1]-points[0]).cross(points[2]-points[0])
    axis=max(range(3),key=lambda k:abs(normal[k]));axes=[k for k in range(3) if k!=axis]
    if axis==1:axes=[0,2]
    lo=[min(p[k] for p in points) for k in axes];hi=[max(p[k] for p in points) for k in axes]
    for j,li in enumerate(poly.loop_indices):
     uv=custom[j] if custom else [(.04+.92*(points[j][k]-lo[t])/max(hi[t]-lo[t],1e-7)) for t,k in enumerate(axes)]
     if sign:uv=[.03+.94*(uv[0]-.04)/.92,.29+.42*(uv[1]-.04)/.92]
     layer.data[li].uv=((cx+uv[0])/grid,1-(cy+1-uv[1])/grid)
  else:
   tags=list(LOOK);[me.materials.append(MATS[t]) for t in tags]
   for poly,tag in zip(me.polygons,self.tags):poly.material_index=tags.index('brass' if tag.startswith('sign:') else tag)
  # Triangulate every solid without merging touching-but-independent parts; recalc its outward winding.
  bm=bmesh.new();bm.from_mesh(me)
  # face() writes disconnected quads intentionally; merge coincident vertices only where their primitive surface meets.
  bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-7)
  bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
  bmesh.ops.triangulate(bm,faces=bm.faces,quad_method='BEAUTY',ngon_method='BEAUTY')
  bm.to_mesh(me);bm.free();me.update()
  # Smoothness is restrained: manufactured planes stay plane, while cylindrical spars/rails receive smooth normals.
  for p in me.polygons:p.use_smooth=False
  return obj
