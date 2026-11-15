"""Deterministic, metre-based concept models and orthographic render passes.
Run: blender -b --factory-startup --python build_concepts.py -- [view names]
No downloaded geometry, image references, or textures are used.
"""
import bpy, math, json, sys, os, time
from pathlib import Path
from mathutils import Vector, Matrix
from math import sin, cos, pi
ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
START=time.time()
ATLAS_PATH=ROOT/'material_atlas.png'
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in bpy.data.materials: bpy.data.materials.remove(d)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=48
scene.cycles.use_denoising=False
scene.render.threads_mode='FIXED'; scene.render.threads=8
scene.render.resolution_x=1254; scene.render.resolution_y=1254; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.color_depth='8'; scene.render.film_transparent=True
scene.view_settings.view_transform='Standard'; scene.view_settings.look='None'
scene.view_settings.exposure=0; scene.view_settings.gamma=1
scene.world.color=(.7,.7,.7)
scene.render.image_settings.compression=35
bpy.context.preferences.filepaths.save_version=0
GROUPS={}; CURRENT=''
PALETTE={'wood':'A4784C','cord':'B09858','flint':'4A484C','flint_edge':'9C9890','stone':'807E78','hide':'7A5638','steel':'404044','steel_edge':'969696','brass':'A8884A'}
def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def rgb(s): return tuple(linear(int(s[i:i+2],16)/255) for i in (0,2,4))
def mat(name, color, grain=0.13, scales=(1,1,1), size=1000):
 m=bpy.data.materials.new(name); m.diffuse_color=(*rgb(color),1); m.use_nodes=True
 n=m.node_tree.nodes; l=m.node_tree.links; n.clear()
 out=n.new('ShaderNodeOutputMaterial'); emit=n.new('ShaderNodeEmission'); l.new(emit.outputs[0],out.inputs['Surface'])
 tex=n.new('ShaderNodeTexCoord'); mult=n.new('ShaderNodeVectorMath'); mult.operation='MULTIPLY'; mult.inputs[1].default_value=scales
 l.new(tex.outputs['Object'],mult.inputs[0])
 noise=n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=size; noise.inputs['Detail'].default_value=3; noise.inputs['Roughness'].default_value=.75; l.new(mult.outputs[0],noise.inputs[0])
 ramp=n.new('ShaderNodeValToRGB'); c=rgb(color)
 ramp.color_ramp.elements[0].position=.1; ramp.color_ramp.elements[0].color=(*(a*(1-grain) for a in c),1)
 ramp.color_ramp.elements[1].position=.9; ramp.color_ramp.elements[1].color=(*(min(1,a*(1+grain)) for a in c),1)
 l.new(noise.outputs['Fac'],ramp.inputs[0])
 geo=n.new('ShaderNodeNewGeometry'); bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.23; bump.inputs['Distance'].default_value=.00014
 l.new(noise.outputs['Fac'],bump.inputs['Height']); l.new(geo.outputs['Normal'],bump.inputs['Normal'])
 trans=n.new('ShaderNodeVectorTransform'); trans.vector_type='NORMAL'; trans.convert_from='WORLD'; trans.convert_to='CAMERA'; l.new(bump.outputs['Normal'],trans.inputs[0])
 dot=n.new('ShaderNodeVectorMath'); dot.operation='DOT_PRODUCT'; dot.inputs[1].default_value=(-.16,.22,.96); l.new(trans.outputs[0],dot.inputs[0])
 ma=n.new('ShaderNodeMath'); ma.operation='MULTIPLY_ADD'; ma.inputs[1].default_value=.35; ma.inputs[2].default_value=.68; l.new(dot.outputs['Value'],ma.inputs[0])
 mix=n.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1; l.new(ramp.outputs[0],mix.inputs[1]); l.new(ma.outputs[0],mix.inputs[2]); l.new(mix.outputs[0],emit.inputs[0])
 diffuse=n.new('ShaderNodeBsdfDiffuse'); diffuse.inputs['Roughness'].default_value=.7
 l.new(ramp.outputs[0],diffuse.inputs['Color']);l.new(bump.outputs[0],diffuse.inputs['Normal']);l.new(diffuse.outputs[0],out.inputs['Surface'])
 if name in ['steel','brass']:
  bev=n.new('ShaderNodeBevel');bev.inputs['Radius'].default_value=.00025;bev.samples=4;l.new(bev.outputs[0],bump.inputs['Normal'])
 # Painted albedo is sampled from one saved eight-tile atlas. UVs are shared by all cameras.
 tile={'wood':(0,1),'hide':(1,1),'flint':(2,1),'flint flake scar':(2,1),'steel':(3,1),'brass':(0,0),'cord':(1,0),'stone':(2,0),'hide cut edge':(3,0)}.get(name)
 if tile and ATLAS_PATH.exists():
  uv=n.new('ShaderNodeTexCoord');scale=n.new('ShaderNodeVectorMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=(.24,.48,1);l.new(uv.outputs['UV'],scale.inputs[0])
  offset=n.new('ShaderNodeVectorMath');offset.operation='ADD';offset.inputs[1].default_value=(tile[0]/4+.005,tile[1]/2+.01,0);l.new(scale.outputs[0],offset.inputs[0])
  img=n.new('ShaderNodeTexImage');img.image=bpy.data.images.load(str(ATLAS_PATH),check_existing=True);img.interpolation='Linear';l.new(offset.outputs[0],img.inputs['Vector'])
  blend=n.new('ShaderNodeMixRGB');blend.blend_type='MIX';blend.inputs[0].default_value=.72 if name in ['wood','hide','brass'] else .60;l.new(ramp.outputs[0],blend.inputs[1]);l.new(img.outputs['Color'],blend.inputs[2]);l.new(blend.outputs[0],diffuse.inputs['Color'])
  detail=n.new('ShaderNodeRGBToBW');l.new(img.outputs['Color'],detail.inputs[0]);l.new(detail.outputs[0],bump.inputs['Height']);bump.inputs['Distance'].default_value=.00009
 return m
M={k:mat(k,v, .22 if k in ['wood','hide','stone'] else .13, (5,5,.085) if k=='wood' else (1,1,1), 450 if k=='wood' else 1600) for k,v in PALETTE.items()}
M['flint_scar']=mat('flint flake scar','57535A',.18)
M['steel_wear']=mat('steel rubbed arris','737374',.11)
M['hide_cut']=mat('hide cut edge','956A45',.18)
M['hide_dark']=mat('hide recessed seam','503A2B',.15)
M['brass_edge']=mat('brass worn edges','B99A5A',.1)
M['cord_dark']=mat('cord twist recess','857645',.12)
def group(name):
 global CURRENT
 CURRENT=name; GROUPS.setdefault(name,[])
def add(obj,name,material):
 obj.name=name
 if material: obj.data.materials.append(M[material] if isinstance(material,str) else material)
 GROUPS[CURRENT].append(obj)
 return obj
def mesh(name,verts,faces,material,indices=None):
 me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
 # Per-face planar UVs, formed before any pose transforms. Surface images never affect geometry.
 uv=me.uv_layers.new(name='painted_albedo')
 lo=[min(v[i] for v in verts) for i in range(3)];hi=[max(v[i] for v in verts) for i in range(3)]
 for face in me.polygons:
  ax=max(range(3),key=lambda j:abs(face.normal[j]));axes=(1,2) if ax==0 else ((0,2) if ax==1 else (0,1))
  for li in face.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co
   uv.data[li].uv=tuple((v[a]-lo[a])/max(hi[a]-lo[a],.00001) for a in axes)
 o=bpy.data.objects.new(name,me); scene.collection.objects.link(o); add(o,name,material)
 if indices:
  for m in indices[0]: o.data.materials.append(M[m])
  for f,i in zip(o.data.polygons,indices[1]): f.material_index=i
 return o
def lathe(name, profile, material, n=12, phase=0, centre=(0,0,0), axis=(0,0,1)):
 verts=[]
 q=Vector((0,0,1)).rotation_difference(Vector(axis).normalized()); c=Vector(centre)
 for z,r in profile:
  for j in range(n): verts.append(tuple(c+q@Vector((r*cos(phase+2*pi*j/n),r*sin(phase+2*pi*j/n),z))))
 faces=[tuple(reversed(range(n)))]
 for k in range(len(profile)-1):
  for j in range(n): faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
 faces.append(tuple(range((len(profile)-1)*n,len(profile)*n)))
 return mesh(name,verts,faces,material)
def tube(name, pts, radius, material, sides=6, closed=False, smooth=False):
 pts=[Vector(p) for p in pts]; verts=[]
 for i,p in enumerate(pts):
  tangent=(pts[(i+1)%len(pts)]-pts[i-1 if i else (-1 if closed else 0)]) if closed or (0<i<len(pts)-1) else (pts[1]-pts[0] if i==0 else pts[-1]-pts[-2])
  tangent.normalize(); u=tangent.cross(Vector((0,1,0)))
  if u.length<.1: u=tangent.cross(Vector((1,0,0)))
  u.normalize(); v=tangent.cross(u).normalized()
  for j in range(sides): verts.append(tuple(p+radius*(u*cos(j*2*pi/sides)+v*sin(j*2*pi/sides))))
 faces=[]
 for i in range(len(pts) if closed else len(pts)-1):
  for j in range(sides): faces.append((i*sides+j,i*sides+(j+1)%sides,((i+1)%len(pts))*sides+(j+1)%sides,((i+1)%len(pts))*sides+j))
 if not closed: faces.extend([tuple(reversed(range(sides))),tuple(range((len(pts)-1)*sides,len(pts)*sides))])
 o=mesh(name,verts,faces,material)
 if smooth:
  for f in o.data.polygons: f.use_smooth=True
 return o
def ring(name, center, radius, thickness, material, normal=(0,0,1), n=48):
 q=Vector((0,0,1)).rotation_difference(Vector(normal)); c=Vector(center)
 return tube(name,[c+q@Vector((radius*cos(t*2*pi/n),radius*sin(t*2*pi/n),0)) for t in range(n)],thickness/2,material,8,True,True)
def bezier(a,b,c,d,n=100):
 return [tuple((1-t)**3*Vector(a)+3*(1-t)**2*t*Vector(b)+3*(1-t)*t*t*Vector(c)+t**3*Vector(d)) for t in [i/(n-1) for i in range(n)]]
def rope(name, pts, diameter=.007):
 # Three separately modelled twisted fibre lays inside a precise outer diameter.
 p=[Vector(x) for x in pts]; arcl=[0.0]
 for a,b in zip(p,p[1:]): arcl.append(arcl[-1]+(a-b).length)
 rr=diameter*.265; orbit=diameter/2-rr
 for k in range(3):
  out=[]
  for i,c in enumerate(p):
   t=(p[min(i+1,len(p)-1)]-p[max(0,i-1)]).normalized(); u=t.cross(Vector((0,1,0)))
   if u.length<.1: u=t.cross(Vector((1,0,0)))
   u.normalize(); v=t.cross(u).normalized(); a=arcl[i]/(diameter*2.3)*2*pi+k*2*pi/3
   out.append(c+orbit*(cos(a)*u+sin(a)*v))
  tube(name+'_lay'+str(k),out,rr,'cord',6,False,True)
 return arcl[-1]
def bevel(o,w=.00025):
 mod=o.modifiers.new('small handmade edge chamfer','BEVEL'); mod.width=w; mod.segments=1
 mod.affect='EDGES'
 return o
def ribbon(name, sections, width, thick, material):
 # sections (z,y), ribbon runs down Z and width is X.
 vs=[]
 # Offset the folded strip normal to each segment, so thickness stays 2 mm
 # on sloping sections as well as straight ones. Mitred joins preserve it.
 normals=[]
 for (za,ya),(zb,yb) in zip(sections,sections[1:]):
  dz=zb-za;dy=yb-ya;length=math.hypot(dz,dy);normals.append(Vector((-dy/length,dz/length)))
 for i,(z,y) in enumerate(sections):
  if i==0:offset=Vector((0,thick/normals[0].y))
  elif i==len(sections)-1:offset=Vector((0,thick/normals[-1].y))
  else:offset=(normals[i-1]+normals[i])*(thick/(1+normals[i-1].dot(normals[i])))
  vs.extend([(-width/2,y,z),(width/2,y,z),(-width/2,y+offset.y,z+offset.x),(width/2,y+offset.y,z+offset.x)])
 fs=[(0,2,3,1)]
 for i in range(len(sections)-1):
  a=i*4;b=a+4;fs.extend([(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,b+2,a+2),(a+1,a+3,b+3,b+1)])
 a=(len(sections)-1)*4;fs.append((a,a+1,a+3,a+2))
 return mesh(name,vs,fs,material)

# GRENADE: eight longitudinal faces; ring and pin are purely visual fittings.
group('grenade')
GR_PROFILE=[(-.045,0),(-.042,.012),(-.035,.024),(-.023,.034),(-.005,.038),(.015,.0355),(.032,.026),(.045,.013)]
body=lathe('iron_body',[(z,r/cos(pi/8)) for z,r in GR_PROFILE],'steel',8,pi/8)
body.data.materials.append(M['steel_wear']);mod=body.modifiers.new('worn cast arrises','BEVEL');mod.width=.00022;mod.segments=1;mod.material=1
bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=mod.name)
def grad(z):
 for (a,r),(b,s) in zip(GR_PROFILE,GR_PROFILE[1:]):
  if a<=z<=b: return r+(s-r)*(z-a)/(b-a)
 return .013
# Open hide band on -Y with a narrow laced gap, full 3 mm shell thickness.
vs=[]; fs=[]; angles=[-pi/2+.10]+[pi/8+i*pi/4 for i in range(-2,7) if -pi/2+.1<pi/8+i*pi/4<3*pi/2-.10]+[3*pi/2-.10]
def oct_radius(a,flat): return flat/cos(((a+pi/8)%(pi/4))-pi/8)
for z in [-.015,-.005,.015]:
 for outward in [0,.003]:
  for a in angles:
   rr=oct_radius(a,grad(z)+outward); vs.append((rr*cos(a),rr*sin(a),z))
N=len(angles)
for k in range(2):
 a=2*N*k;b=a+2*N
 for i in range(N-1):fs.extend([(a+N+i,a+N+i+1,b+N+i+1,b+N+i),(a+i,b+i,b+i+1,a+i+1)])
 fs.extend([(a,a+N,b+N,b),(a+N-1,b+N-1,b+2*N-1,a+2*N-1)])
for i in range(N-1):fs.extend([(i,i+1,N+i+1,N+i),(4*N+i,5*N+i,5*N+i+1,4*N+i+1)])
mesh('hide_grip_band',vs,fs,'hide')
for i,z in enumerate([-.012,-.006,0,.006,.012]):
 y=-grad(z)-.0034
 for sign in [-1,1]:
  zz=z+.004 if i<4 else z-.004
  tube('band_lacing_%s_%s'%(i,sign),[(sign*.0045,y,z),(0,y-.0012,(z+zz)/2),(-sign*.0045,y,zz)],.0008,'cord',6)
for sign in [-1,1]: tube('lacing_cut_tail',[(0,-.042,-.003),(sign*.005,-.043,-.009),(sign*.007,-.042,-.012)],.0008,'cord',6)
lathe('brass_fuse_cap',[(.045,.012),(.046,.013),(.0645,.013),(.066,.0115)],'brass',16)
lathe('cap_base_lip',[(.045,.0129),(.046,.013)],'brass_edge',16)
lathe('steel_pin',[(-.017,.002),(.016,.002)],'steel',10,centre=(0,0,.065),axis=(1,0,0))
# Ring outer diameter 28 mm, wire 4 mm, far edge z=.092; tangent hooks into pin.
ring('steel_pull_ring',(-.017,0,.078),.012,.004,'steel',normal=(0,1,0),n=48)
lever_sections=[(-.020,grad(-.020)+.003),(-.005,grad(-.005)+.006),(.015,grad(.015)+.006),(.034,grad(.034)+.003),(.051,.016),(.064,.012)]
# At band overlap: clear leather by 3 mm; away from band: clear iron by 3 mm.
ribbon('steel_spoon_lever',lever_sections,.014,.002,'steel')

# POUCH template reused by both bola poses; local +Z is gathered mouth.
def pouch(name,center,axis):
 q=Vector((0,0,1)).rotation_difference(Vector(axis).normalized()); c=Vector(center)
 start=len(GROUPS[CURRENT])
 lathe(name+'_stone',[(-.032,0),(-.028,.016),(-.015,.028),(0,.031),(.016,.026),(.029,.012),(.032,0)],'stone',12,pi/12)
 # Eight broad leather panels with folds at their gathered mouth. Diameter = 68 mm.
 prof=[(-.034,0),(-.030,.015),(-.023,.025),(-.011,.032),(0,.034),(.014,.031),(.026,.022),(.034,.012),(.040,.007),(.046,.0085)]
 vs=[]
 for z,r in prof:
  for j in range(16):
   rr=r*(1-(.15 if z>.026 else .02)*(j%2)); a=j*2*pi/16
   vs.append((rr*cos(a),rr*sin(a),z))
 fs=[]
 for k in range(len(prof)-1):
  for j in range(16): fs.append((k*16+j,k*16+(j+1)%16,(k+1)*16+(j+1)%16,(k+1)*16+j))
 mesh(name+'_hide_pouch',vs,fs,'hide')
 # Fold seam sewn with the same plant fibre cord; no rivets or added material.
 for seamangle in [pi/4,5*pi/4]:
  seam=[]
  for z,r in prof[1:-2]: seam.append((r*1.008*cos(seamangle),r*1.008*sin(seamangle),z))
  tube(name+'_seam',seam,.00035,'hide_dark',5)
  for z,r in prof[2:-3]:
   a=seamangle; da=.055
   tube(name+'_stitch',[(r*1.015*cos(a-da),r*1.015*sin(a-da),z-.0012),(r*1.018*cos(a),r*1.018*sin(a),z),(r*1.015*cos(a+da),r*1.015*sin(a+da),z+.0012)],.00045,'cord',5)
 for z in [.0375,.0405,.0435]: ring(name+'_gathered_tie',(0,0,z),.0076,.0016,'cord',n=24)
 tube(name+'_tie_knot',[(.008,0,.039),(.010,.002,.041),(.008,.003,.043),(.007,0,.041),(.010,-.002,.039)],.0011,'cord',6)
 tube(name+'_cut_tail_a',[(.009,0,.041),(.014,.002,.037),(.016,.002,.032)],.0008,'cord',6)
 tube(name+'_cut_tail_b',[(.009,0,.041),(.014,-.002,.043),(.017,-.001,.041)],.0008,'cord',6)
 for o in GROUPS[CURRENT][start:]:
  for v in o.data.vertices: v.co=c+q@v.co
 return c+q@Vector((0,0,.043))
def knot():
 # A compact cord knot, 30 mm overall in X.
 for k in range(3):
  pts=[]
  for j in range(140):
   t=2*pi*j/139; pts.append((.0115*cos(t),.008*sin(t+k*2*pi/3),.008*sin(2*t+k*2*pi/3)))
  rope('central_knot_'+str(k),pts,.007)
def holding_loop(lying=False):
 pts=[]
 for i in range(91):
  a=2*pi*i/90
  # Extent -50 mm from knot; rounded doubled loop.
  pts.append((.010*sin(a),.0035 if lying else 0,-.025+.0215*cos(a)))
 rope('holding_loop',pts,.007)
BOLA_DATA={}
group('bola_held'); knot(); holding_loop()
heldcenters=[]
for i,a in enumerate([pi/2,pi/2+2*pi/3,pi/2+4*pi/3]):
 c=Vector((.1/math.sqrt(3)*cos(a),.1/math.sqrt(3)*sin(a),.4)); heldcenters.append(list(c))
 mouth=pouch('weight_'+str(i+1),c,-c)
 start=Vector((.004*cos(a),.004*sin(a),.005))
 # Small sine drape folded sideways lengthens 355 mm straight line to 420 mm cord.
 p=[]
 for j in range(201):
  t=j/200; v=start.lerp(mouth,t); v.x+=.063*sin(pi*t)*sin(2*pi*t); v.y-=.025*sin(pi*t)
  p.append(tuple(v))
 length=rope('held_cord_'+str(i+1),p)
 BOLA_DATA['held_cord_'+str(i+1)]={'centerline_length_m':length,'pouch_center_m':list(c)}
group('bola_lying'); knot(); holding_loop(True)
for i,a in enumerate([0,2*pi/3,4*pi/3]):
 c=Vector((.4*sin(a),.034,.4*cos(a))); axis=Vector((-c.x,0,-c.z)).normalized()
 mouth=pouch('weight_'+str(i+1),c,axis)
 start=Vector((.006*sin(a),.0035,.006*cos(a))); p=[]
 for j in range(201):
  t=j/200; v=start.lerp(mouth,t); bend=.067*sin(pi*t)*sin(2*pi*t)
  v.x+=cos(a)*bend;v.z-=sin(a)*bend
  # Cord rises to tied mouth only near the pouch.
  v.y=.0035+(.034-.0035)*t**5;p.append(tuple(v))
 length=rope('lying_cord_'+str(i+1),p)
 BOLA_DATA['lying_cord_'+str(i+1)]={'centerline_length_m':length,'pouch_center_m':list(c)}
group('bola_pouch');pouch('weight_closeup',(0,0,0),(0,0,-1))
# Short entering cord in the close-up is explicitly cut by the frame, not a new fitting.
rope('entering_cord',[(0,0,-.043-i*.0006) for i in range(100)],.007)

# ARROW: carved wood, knapped flint and leather only.
group('arrow')
shaft=lathe('wood_shaft',[(-.720,.0055),(-.713,.0055),(-.705,.0045),(-.035,.0045),(-.012,.0045),(0,.0045)],'wood',12)
# Slots are real subtractive geometry, not painted marks.
def cut_box(obj,name,loc,scale):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);c=bpy.context.object;c.name=name;c.dimensions=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=obj.modifiers.new(name,'BOOLEAN');mod.operation='DIFFERENCE';mod.object=c
 bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(c,do_unlink=True)
cut_box(shaft,'carved_nock', (0,0,-.718),( .03,.003,.008))
cut_box(shaft,'split_head_socket',(0,0,-.005),(.03,.003,.014))
# Structured flake tessellation: two asymmetric ridge lines and a continuous fresh edge.
outline=[(0,-.005),(.006,-.002),(.010,.005),(.012,.012),(.0108,.022),(.0077,.033),(.0038,.043),(0,.050),(-.0038,.043),(-.0077,.033),(-.0108,.022),(-.012,.012),(-.010,.005),(-.006,-.002)]
vs=[]
for x,z in outline:vs.append((x,0,z))
for sign in [1,-1]:
 for x,z in outline:vs.append((x*.86,sign*.0009,z if z not in [-.005,.050] else z+(.0008 if z<0 else -.0008)))
# Per-side ridge points at the tang, belly, shoulder and point.
for sign in [1,-1]:
 for x,z,y in [(0,-.003,.001),(-.001,.010,.003),(.0008,.025,.0027),(0,.040,.0017),(0,.048,.0005)]:vs.append((x,sign*y,z))
N=len(outline); fs=[];ids=[]
for side in range(2):
 inner=N*(side+1); ridge=3*N+side*5
 for i in range(N):fs.append((i,(i+1)%N,inner+(i+1)%N,inner+i));ids.append(1)
 # segment face fan to nearest ridge, with connecting triangles at transitions
 ridges=[0,0,1,1,2,2,3,4,3,2,2,1,1,0]
 for i in range(N):
  j=(i+1)%N; a=ridges[i];b=ridges[j]
  fs.append((inner+i,inner+j,ridge+a));ids.append(0 if i%3 else 2)
  if a!=b:fs.append((inner+j,ridge+b,ridge+a));ids.append(0)
mesh('flint_leaf',vs,fs,'flint',(['flint_edge','flint_scar'],ids))
# 13 mm thong wraps, endpoints exactly -35 to 0 mm.
for i in range(10):
 za=-.035+i*.0035;zb=za+.0035
 lathe('hide_head_binding_'+str(i),[(za,.0058),(za+.00035,.0065),(zb-.00035,.0065),(zb,.0058)],'hide',12,0)
# Continuous diagonal seam makes the wrapped thong legible.
pts=[]
for j in range(361):
 t=j/360; a=t*10*2*pi;pts.append((.00651*cos(a),.00651*sin(a),-.0348+t*.0346))
tube('binding_overlap_edge',pts,.00013,'hide_cut',4)
# Three shield-shaped vanes, extruded to exactly 2 mm tangential thickness.
shape=[(-.700,.0045),(-.696,.016),(-.683,.0225),(-.625,.0225),(-.600,.0045)]
for k,a in enumerate([0,2*pi/3,4*pi/3]):
 radial=Vector((sin(a),cos(a),0)); tang=Vector((cos(a),-sin(a),0));verts=[]
 for side in [-1,1]:
  for z,r in shape:verts.append(tuple(radial*r+tang*side*.001+Vector((0,0,z))))
 n=len(shape);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
 for i in range(n):faces.append((i,(i+1)%n,(i+1)%n+n,i+n))
 mesh('leather_vane_'+str(k+1),verts,faces,'hide',(['hide_cut'],[0,0]+[1]*n))

# DART: faceted brass cylinder, steel ends, eight flat hide ribbons.
group('dart')
lathe('brass_drug_barrel',[(-.09,.0059),(-.089,.0065),(-.011,.0065),(-.01,.0059)],'brass',12)
lathe('steel_needle_collar',[(-.01,.0067),(-.009,.0075),(-.001,.0075),(0,.0067)],'steel',12)
lathe('steel_tail_cap',[(-.100,.0062),(-.099,.007),(-.091,.007),(-.090,.0062)],'steel',12)
# Diagonal bevel point, 3 mm outer diameter, 14 mm total projection.
verts=[]
for z in [0,.0105]:
 for i in range(12):verts.append((.0015*cos(i*2*pi/12),.0015*sin(i*2*pi/12),z))
for i in range(12):
 a=i*2*pi/12;verts.append((.0015*cos(a),.0015*sin(a),.01225+.00175*cos(a)))
faces=[tuple(reversed(range(12)))]; ids=[0]
for k in range(2):
 for i in range(12):faces.append((k*12+i,k*12+(i+1)%12,(k+1)*12+(i+1)%12,(k+1)*12+i));ids.append(0)
faces.append(tuple(range(24,36)));ids.append(1)
mesh('bevelled_steel_needle',verts,faces,'steel',(['steel_edge'],ids))
for k in range(8):
 a=k*pi/4; radial=Vector((cos(a),sin(a),0));tang=Vector((-sin(a),cos(a),0));verts=[]
 for side in [-1,1]:
  for z,r,w in [(-.1,.0038,.0024),(-.116,.007,.0025),(-.14,.0118,.0024),(-.165,.0145,.002)]:
   for sign in [-1,1]: verts.append(tuple(radial*(r+side*.0005)+tang*w*sign+Vector((0,0,z))))
 fs=[];ix=[]
 for j in range(3):
  b=j*2; fs.extend([(b,b+1,b+3,b+2),(b+8,b+10,b+11,b+9),(b,b+2,b+10,b+8),(b+1,b+9,b+11,b+3)]);ix.extend([0,0,1,1])
 fs.extend([(0,8,9,1),(6,7,15,14)]);ix.extend([1,1])
 mesh('hide_fringe_strip_'+str(k+1),verts,fs,'hide',(['hide_cut'],ix))

# Fixed views. Projection columns are basis dot (point-center) * ppm + origin.
# Orthographic views contain form shading only, never cast shadows.
for objects in GROUPS.values():
 for obj in objects:obj.visible_shadow=False
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(1,1,1,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.32
ld=bpy.data.lights.new('broad neutral frontal softbox','AREA');light=bpy.data.objects.new('broad neutral frontal softbox',ld);scene.collection.objects.link(light)
ld.energy=15;ld.shape='DISK';ld.size=1.8
VIEWS=[]
def view(name,grp,axis,ppm,origin=(627,627),center=(0,0,0)):
 VIEWS.append(dict(name=name,group=grp,axis=axis,ppm=ppm,origin=origin,center=center))
for axis in ['side','top','front']:view('grenade_'+axis,'grenade',axis,6000)
for axis in ['side','top','front']:view('bola_held_'+axis,'bola_held',axis,1800,(627 if axis=='front' else 240,627))
view('bola_lying_top','bola_lying','top',1200)
view('bola_pouch','bola_pouch','side',6000)
for axis in ['side','top']:view('arrow_'+axis,'arrow',axis,1500,(1130,627))
for axis in ['side','top']:view('arrow_head_'+axis,'arrow',axis,6000)
view('arrow_tail_side','arrow','side',6000,center=(0,0,-.660))
view('arrow_front','arrow','front',6000)
for axis in ['side','top','front']:view('dart_'+axis,'dart',axis,6000,(627 if axis=='front' else 1000,627))
BASES={'side':((0,0,1),(0,1,0),(1,0,0)),'top':((0,0,1),(-1,0,0),(0,1,0)),'front':((-1,0,0),(0,1,0),(0,0,1))}
cam_data=bpy.data.cameras.new('Orthographic');cam=bpy.data.objects.new('Orthographic',cam_data);scene.collection.objects.link(cam);scene.camera=cam;cam.data.type='ORTHO';cam.data.clip_start=.001;cam.data.clip_end=100

def setup(v):
 right,up,normal=[Vector(x) for x in BASES[v['axis']]]
 origin=v['origin'];ppm=v['ppm']; center=Vector(v['center'])
 target=center+right*((627-origin[0])/ppm)+up*((origin[1]-627)/ppm)
 cam.location=target+normal*2
 light.location=target+normal*1.4+up*.40-right*.22;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
 cam.rotation_euler=Matrix((-right,up,normal)).transposed().to_euler();cam.data.ortho_scale=1254/ppm
 for g,obs in GROUPS.items():
  for o in obs:o.hide_render=g!=v['group']
 bpy.context.view_layer.update()

def bbox(obs):
 pts=[o.matrix_world@vert.co for o in obs for vert in o.data.vertices]
 return {'min_m':[min(p[i] for p in pts) for i in range(3)],'max_m':[max(p[i] for p in pts) for i in range(3)]}
meta={'palette':PALETTE,'views':VIEWS,'basis':BASES,'groups':{},'bola':BOLA_DATA,'notes':['Dimensions in metres. +Z length, +Y up, +X right.','Front right basis is -X; top up basis is -X.','Color alpha is also the source of the silhouette masks.','All orthographic surface illumination uses rough diffuse shaders, uniform ambient fill, and a broad near-frontal softbox. No reflective shaders or ground plane.']}
for g,obs in GROUPS.items():
 meta['groups'][g]={'bounds':bbox(obs),'parts':{o.name:bbox([o]) for o in obs}}
(ROOT/'checks'/'geometry.json').write_text(json.dumps(meta,indent=2))
# Save the exact shared source models, materials, and camera before rendering.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'concept_models.blend'))
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for v in VIEWS:
 if args and v['name'] not in args:continue
 setup(v); scene.render.filepath=str(ROOT/'renders'/(v['name']+'.png'));bpy.ops.render.render(write_still=True)
 print('VIEW_DONE',v['name'],round(time.time()-START,1),flush=True)
(ROOT/'checks'/'render_timing.json').write_text(json.dumps({'seconds':time.time()-START,'finished_unix':time.time(),'views_requested':args or 'all'},indent=2))
print('COMPLETE',time.time()-START)

# Renders and saves are synchronous; bypass a host audio shutdown hang.
import sys
sys.stdout.flush(); sys.stderr.flush(); os._exit(0)
