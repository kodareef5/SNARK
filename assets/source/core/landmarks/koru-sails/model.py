"""Five original sail surfaces on deterministic accordion bones; no imported photo pixels or mesh."""
import bpy,bmesh,json,math
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
CONTRACT=json.loads((HERE.parents[4]/'content/landmarks/koru-sails.json').read_text())
def linear(v):
 v/=255
 return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
MATS=[]
for name,rgb in [('cloth',(226,225,215)),('reinforcement',(202,204,198)),('spar',(232,232,224))]:
 mat=bpy.data.materials.new(name);mat.diffuse_color=(*map(linear,rgb),1);mat.use_nodes=True
 mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=mat.diffuse_color;MATS.append(mat)
def clip(poly,axis,value,sign):
 out=[]
 for p,q in zip(poly,poly[1:]+poly[:1]):
  ip=sign*(p[axis]-value)>=-1e-8;iq=sign*(q[axis]-value)>=-1e-8
  if ip:out.append(p)
  if ip!=iq:
   t=(value-p[axis])/(q[axis]-p[axis]);out.append([p[k]+t*(q[k]-p[k]) for k in range(2)])
 clean=[]
 for p in out:
  if not clean or math.dist(p,clean[-1])>1e-7:clean.append(p)
 if len(clean)>1 and math.dist(clean[0],clean[-1])<1e-7:clean.pop()
 return clean
class Mesh:
 def __init__(self,sail,level):self.s=sail;self.level=level;self.v=[];self.faces=[];self.material=[];self.weights=[]
 def weight(self,p,band,gaff=False):
  if gaff:return {'gaff':1}
  if 'gaff' not in self.s:return {band['bone']:1}
  g=self.s['gaff'];y,z=p[1:];ht=self.s['polygon'][-1][0];hp=g['peak'][1];zp=g['peak'][2]
  # Distance to the finite head edge stays continuous around its peak; a chord cutoff would tear neighboring leech strips.
  dy=hp-ht;t=max(0,min(1,((y-ht)*dy+z*zp)/(dy*dy+zp*zp)))
  distance=math.hypot(y-(ht+t*dy),z-t*zp)
  w=max(0,min(1,1-distance/2));w=w*w*(3-2*w)
  # Flat levels retain a single decisive owner on shared seams, exactly as the native pack does.
  if self.level and w>0:w=1 if w>=.5 else 0
  return {band['bone']:1-w,'gaff':w} if w else {band['bone']:1}
 def indexed(self,verts,faces,mat,band=None,gaff=False):
  n=len(self.v);self.v.extend(verts);self.weights.extend([self.weight(p,band,gaff) for p in verts]);self.faces.extend([[n+i for i in f] for f in faces]);self.material.extend([mat]*len(faces))
 def billow(self,p,band):
  coordinate=p[0 if self.s['bandAxis']=='y' else 1];t=(coordinate-band['lower'])/(band['upper']-band['lower'])
  return self.s['billow']*math.sin(math.pi*max(0,min(1,t)))
 def panel(self,poly,band):
  if len(poly)<3:return
  # A fan with a shallow interior crown preserves straight fold hinges at all six levels.
  edge=[];spacing=[1.5,3,5,8,12,1000][self.level]
  for p,q in zip(poly,poly[1:]+poly[:1]):
   n=max(1,math.ceil(math.dist(p,q)/spacing))
   edge.extend([[p[k]+(q[k]-p[k])*i/n for k in range(2)] for i in range(n)])
  center=[sum(p[k] for p in edge)/len(edge) for k in range(2)];n=len(edge);points=edge+[center]
  thick=.0015;verts=[]
  for side in(-1,1):verts.extend([[self.billow(p,band)+side*thick,p[0],p[1]] for p in points])
  faces=[]
  for i in range(n):
   j=(i+1)%n;faces.extend([[i,j,n],[n+1+i,2*n+1,n+1+j],[i,n+1+i,n+1+j,j]])
  self.indexed(verts,faces,0,band)
  if self.level<3:
   # Sewn vertical panels and occasional full-width battens, represented in real metres.
   # Strong border tapes and reinforced clew/head/tack fans are visible on both sides.
   for p,q in zip(poly,poly[1:]+poly[:1]):
    mid=[(p[k]+q[k])/2 for k in range(2)]
    axis=0 if self.s['bandAxis']=='y' else 1
    if abs(mid[axis]-band['lower'])<1e-6 or abs(mid[axis]-band['upper'])<1e-6:continue
    self.tube([[0,p[0],p[1]],[0,q[0],q[1]]],.035 if self.level==0 else .045,1,band,n=6 if self.level==0 else 4)
   if self.s['kind']=='main' and band['index']%8==0:
    z0=min(p[1] for p in poly);z1=max(p[1] for p in poly);y=band['lower']+.07
    if z1-z0>2:
     for side in(-1,1):self.tube([[side*.025,y,z0+.05],[side*.025,y,z1-.10]],.033,1,band,n=4)
  if self.level<2:
   for corner in self.s['polygon']:
    near=[p for p in poly if math.dist(p,corner)<2.4]
    if len(near)>=2:
     # Radial stitched reinforcement lines; their band ownership follows the surrounding cloth.
     cy,cz=corner
     for p in near:
      for side in(-1,1):self.tube([[side*.022,p[0],p[1]],[side*.022,cy,cz]],.012,1,band,n=4) if math.dist(p,corner)>.03 else None
 def tube(self,points,r,mat,band=None,gaff=False,n=None):
  n=n or [12,8,6,5,4,4][self.level];a,b=map(Vector,points);d=(b-a).normalized()
  if d.length<.5:return
  u=d.cross(Vector((1,0,0)) if abs(d.x)<.9 else Vector((0,1,0))).normalized();v=d.cross(u).normalized()
  verts=[list(p+r*(math.cos(k*math.tau/n)*u+math.sin(k*math.tau/n)*v)) for p in(a,b) for k in range(n)]
  faces=[list(reversed(range(n))),list(range(n,2*n))]+[[i,(i+1)%n,(i+1)%n+n,i+n] for i in range(n)]
  self.indexed(verts,faces,mat,band,gaff)
 def object(self,name,rig):
  me=bpy.data.meshes.new(name);me.from_pydata([(x,-z,y) for x,y,z in self.v],[],self.faces);me.update();obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj)
  for mat in MATS:me.materials.append(mat)
  for f,m in zip(me.polygons,self.material):f.material_index=m;f.use_smooth=False
  for bone in self.s['bones']:obj.vertex_groups.new(name=bone)
  for i,weights in enumerate(self.weights):
   for bone,w in weights.items():
    if w>1e-8:obj.vertex_groups[bone].add([i],w,'REPLACE')
  if self.level==0:
   uv=me.uv_layers.new(name='Sailcloth')
   for face in me.polygons:
    axis=max(range(3),key=lambda k:abs(face.normal[k]));axes={0:[2,1],1:[0,1],2:[2,0]}[axis]
    for li in face.loop_indices:
     p=self.v[me.loops[li].vertex_index];uv.data[li].uv=(p[axes[0]]/2,p[axes[1]]/2)
  bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bmesh.ops.triangulate(bm,faces=bm.faces,quad_method='BEAUTY',ngon_method='BEAUTY');bm.to_mesh(me);bm.free()
  obj.parent=rig;obj.modifiers.new('Sail rig','ARMATURE').object=rig
  return obj
def build(name):
 s=next(v for v in CONTRACT['sails'] if v['id']==name);arm=bpy.data.armatures.new(s['skeleton']);rig=bpy.data.objects.new(s['skeleton'],arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
 for name in s['bones']:
  b=arm.edit_bones.new(name);b.head=(0,0,0);b.tail=(0,0,.1)
  if name!='root':b.parent=arm.edit_bones['root']
 bpy.ops.object.mode_set(mode='OBJECT');report=[]
 for level in range(6):
  m=Mesh(s,level);axis=0 if s['bandAxis']=='y' else 1
  for band in s['bands']:
   poly=clip(clip(s['polygon'],axis,band['lower'],1),axis,band['upper'],-1);m.panel(poly,band)
   if s['kind']=='main' and level<3 and band['index']%8==1 and band['lower']<s['polygon'][-1][0]:
    # Compact sail cars bridge the real mast track to the outboard cloth, rather than leaving a floating luff.
    y=band['lower'];m.tube([[.25,y,-.06],[0,y,0]],.018,2,band,n=6 if level<2 else 4)
  if 'gaff'in s:
   g=s['gaff'];m.tube([g['throat'],g['peak']],.145,2,gaff=True)
   if level<3:m.tube([[0,s['polygon'][-1][0],0],g['throat']],.025,2,gaff=True,n=6 if level<2 else 4)
   # A closed flexible halyard joins a fixed masthead fairlead to the moving peak, using the existing root/gaff bones.
   h=s['peakHalyard'];start=len(m.v);sides=[8,6,6,4,4,4][level];m.tube([h['fixed'],h['moving']],h['radius'],1,gaff=True,n=sides)
   for v in range(start,start+sides):m.weights[v]={'root':1}
  elif level<3:
   # Small luff straps stay on the fixed forestay axis while the first panel hinges from this line.
   for y in range(0,math.floor(max(p[0] for p in s['polygon'])),8):m.tube([[0,y,0],[s['anchor'][0],y,0]],.012,1,{'bone':'root'},n=6 if level<2 else 4)
  obj=m.object(s['mesh'][5:]+('' if level==0 else '_LOD'+str(level)),rig)
  report.append({'level':level,'triangles':len(obj.data.polygons),'vertices':len(obj.data.vertices)})
 (HERE/'ref'/('geometry-'+s['id']+'.json')).write_text(json.dumps(report,indent=2)+'\n')
 print('authored',s['id'],report,flush=True)
