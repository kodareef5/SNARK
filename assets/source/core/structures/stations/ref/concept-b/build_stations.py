"""Deterministic modelling and orthographic rendering. Run with Blender --background --python."""
import bpy, bmesh, math, random, json, os, sys, time, hashlib
from mathutils import Vector
from math import sin, cos, pi
from pathlib import Path
ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
random.seed(2819)
S=1254; PPM=650; BG=(214,212,206)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials): bpy.data.materials.remove(m)
bpy.context.preferences.filepaths.save_version=0
bpy.context.preferences.filepaths.file_preview_type='NONE'
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.samples=16
scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED'; scene.render.threads=8
scene.render.resolution_x=S;scene.render.resolution_y=S;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.world.color=(.8,.8,.8)
scene.render.image_settings.color_depth='8'
scene.unit_settings.system='METRIC'

def lin(v):
 v=v/255
 return v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4

def rgb(v):return tuple(lin(x) for x in v)+(1,)
MATS={}; FIRE=[]; OBJS={}; STATION=''

def mat(name,colors,textures=None,fire=False):
 m=bpy.data.materials.new(name);m.use_nodes=True
 n=m.node_tree.nodes;l=m.node_tree.links;n.clear()
 out=n.new('ShaderNodeOutputMaterial');emit=n.new('ShaderNodeEmission');l.new(emit.outputs[0],out.inputs[0])
 if fire:
  attr=n.new('ShaderNodeAttribute');attr.attribute_name='fire_id'
  state=n.new('ShaderNodeValue');state.name='LIT';state.outputs[0].default_value=0;FIRE.append(state)
  # fire_id: 0 orange coal/metal, 1 yellow heart, 2 dark lump, 3 lens
  off=[(96,92,88),(96,92,88),(49,46,43),(58,62,64)]
  on=[(238,120,30),(255,210,80),(238,120,30),(255,186,70)]
  a=n.new('ShaderNodeValToRGB');b=n.new('ShaderNodeValToRGB')
  for ramp,cs in [(a,off),(b,on)]:
   ramp.color_ramp.interpolation='CONSTANT'
   while len(ramp.color_ramp.elements)>1:ramp.color_ramp.elements.remove(ramp.color_ramp.elements[-1])
   for i,c in enumerate(cs):
    e=ramp.color_ramp.elements[0] if i==0 else ramp.color_ramp.elements.new(i/3)
    e.position=max(0,(i-.5)/3);e.color=rgb(c)
   l.new(attr.outputs['Fac'],ramp.inputs[0])
  mix=n.new('ShaderNodeMixRGB');l.new(state.outputs[0],mix.inputs[0]);l.new(a.outputs[0],mix.inputs[1]);l.new(b.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],emit.inputs[0])
 else:
  attr=n.new('ShaderNodeAttribute');attr.attribute_name='surface'
  coord=n.new('ShaderNodeTexCoord')
  # UVs are metre-scaled and aligned with each constructed board.
  texout=[]
  for i,c in enumerate(colors):
   if textures and textures[i] and (ROOT/'textures'/textures[i]).exists():
    tx=n.new('ShaderNodeTexImage');tx.image=bpy.data.images.load(str(ROOT/'textures'/textures[i]),check_existing=True)
    tx.extension='REPEAT';l.new(coord.outputs['UV'],tx.inputs['Vector']);texout.append(tx.outputs['Color'])
   else:
    val=n.new('ShaderNodeRGB');val.outputs[0].default_value=rgb(c);texout.append(val.outputs[0])
  col=texout[0]
  for i in range(1,len(texout)):
   cmp=n.new('ShaderNodeMath');cmp.operation='GREATER_THAN';l.new(attr.outputs['Fac'],cmp.inputs[0]);cmp.inputs[1].default_value=i-.5
   mx=n.new('ShaderNodeMixRGB');l.new(cmp.outputs[0],mx.inputs[0]);l.new(col,mx.inputs[1]);l.new(texout[i],mx.inputs[2]);col=mx.outputs[0]
  tone=n.new('ShaderNodeAttribute');tone.attribute_name='tone'
  tint=n.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;l.new(col,tint.inputs[1]);l.new(tone.outputs['Fac'],tint.inputs[2])
  geom=n.new('ShaderNodeNewGeometry')
  dot=n.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';l.new(geom.outputs['Normal'],dot.inputs[0]);dot.inputs[1].default_value=(-.35,-.45,.82)
  scale=n.new('ShaderNodeMath');scale.operation='MULTIPLY_ADD';l.new(dot.outputs['Value'],scale.inputs[0]);scale.inputs[1].default_value=.18;scale.inputs[2].default_value=.88
  ao=n.new('ShaderNodeAmbientOcclusion');ao.inputs['Distance'].default_value=.065;ao.samples=8
  ao_mix=n.new('ShaderNodeMath');ao_mix.operation='MULTIPLY_ADD';l.new(ao.outputs['AO'],ao_mix.inputs[0]);ao_mix.inputs[1].default_value=.22;ao_mix.inputs[2].default_value=.78
  shade=n.new('ShaderNodeMath');shade.operation='MULTIPLY';l.new(ao_mix.outputs[0],shade.inputs[0]);l.new(scale.outputs[0],shade.inputs[1])
  mul=n.new('ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;l.new(tint.outputs[0],mul.inputs[1]);l.new(shade.outputs[0],mul.inputs[2]);l.new(mul.outputs[0],emit.inputs[0])
 MATS[name]=m;return m

mat('kiln',[(80,74,68),(168,132,100),(150,124,98)],['stone.png','clay.png','mortar.png'])
mat('boards',[(172,128,82)],['wood.png'])
mat('plate',[(98,110,100),(150,150,148)],['paint.png','steel.png'])
mat('iron',[(44,41,39)],['iron.png'])
mat('fire',[],fire=True)

def finish(ob, material, surface=0, tone=1, fireid=0, bevel=0):
 ob.data.materials.clear();ob.data.materials.append(MATS[material]);ob['station']=STATION;ob['material_family']=material
 for name,val in [('surface',surface),('tone',tone),('fire_id',fireid/3)]:
  a=ob.data.attributes.new(name,'FLOAT','FACE')
  for d in a.data:d.value=val
 # Stable planar face projection. Geometry remains faceted.
 uv=ob.data.uv_layers.new(name='Surface_metres');uv.active_render=True;ob.data.uv_layers.active=uv
 seed=hashlib.sha256(ob.name.encode()).digest();offu=seed[0]/255 if material=='kiln' else .137;offv=seed[1]/255 if material=='kiln' else .219
 for poly in ob.data.polygons:
  n=poly.normal;axis=max(range(3),key=lambda i:abs(n[i]))
  axes=[i for i in range(3) if i!=axis]
  for li in poly.loop_indices:
   v=ob.data.vertices[ob.data.loops[li].vertex_index].co
   uv.data[li].uv=(v[axes[0]]*2.4+offu,v[axes[1]]*2.4+offv)
   if material=='boards':
    long_axis=max(range(3),key=lambda i:ob.dimensions[i])
    cross=next((i for i in axes if i!=long_axis),axes[0])
    uv.data[li].uv=(v[cross]*2.4+.137,v[long_axis]*2.4+.219)
 if bevel:
  mod=ob.modifiers.new('small flat edge facets','BEVEL');mod.width=bevel;mod.segments=1
  mod.affect='EDGES'
  bpy.context.view_layer.objects.active=ob
  bpy.ops.object.modifier_apply(modifier=mod.name)
 OBJS.setdefault(STATION,[]).append(ob)
 return ob

def mesh(name,verts,faces,material,**kw):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
 ob=bpy.data.objects.new(name,me);scene.collection.objects.link(ob);return finish(ob,material,**kw)

def box(name,loc,size,material,bevel=.006,**kw):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);ob=bpy.context.object;ob.name=name
 ob.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 return finish(ob,material,bevel=bevel,**kw)

def cyl(name,loc,r,depth,material,vertices=12,axis='Z',r2=None,**kw):
 if r2 is None:bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc)
 else:bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r2,depth=depth,location=loc)
 ob=bpy.context.object;ob.name=name
 if axis=='Y':ob.rotation_euler[0]=pi/2
 if axis=='X':ob.rotation_euler[1]=pi/2
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
 return finish(ob,material,**kw)

def beam(name,a,b,width,depth,material,**kw):
 a=Vector(a);b=Vector(b)
 ob=box(name,(a+b)/2,(width,depth,(b-a).length),material,**kw)
 ob.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
 return ob

def ring(name,loc,ro,ri,height,material,vertices=12,axis='Z',**kw):
 v=[]
 for z,r in [(-height/2,ro),(height/2,ro),(-height/2,ri),(height/2,ri)]:
  for i in range(vertices):v.append((r*cos(2*pi*i/vertices),r*sin(2*pi*i/vertices),z))
 f=[]
 for i in range(vertices):
  j=(i+1)%vertices
  f.extend([(i,j,vertices+j,vertices+i),(2*vertices+i,3*vertices+i,3*vertices+j,2*vertices+j),(vertices+i,vertices+j,3*vertices+j,3*vertices+i),(i,2*vertices+i,2*vertices+j,j)])
 ob=mesh(name,v,f,material,**kw);ob.location=loc
 if axis=='Y':ob.rotation_euler[0]=pi/2
 return ob

def boolean(ob,cutter):
 bpy.context.view_layer.objects.active=ob
 mod=ob.modifiers.new('mouth / interior','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
 bpy.ops.object.modifier_apply(modifier=mod.name)

def arch(name,cx,width,bottom,spring,top,y0,y1,material=None):
 pts=[(cx-width/2,bottom),(cx+width/2,bottom),(cx+width/2,spring)]
 for i in range(1,9):
  t=i*pi/8;pts.append((cx+width/2*cos(t),spring+(top-spring)*sin(t)))
 v=[(x,y,z) for y in (y0,y1) for x,z in pts];n=len(pts)
 f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 if material:return mesh(name,v,f,material)
 me=bpy.data.meshes.new(name);me.from_pydata(v,[],f);me.update();bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free();ob=bpy.data.objects.new(name,me);scene.collection.objects.link(ob);return ob

def forge():
 global STATION;STATION='forge';cx=-.1
 # Six courses, straight lower 0.80 m, tapered shoulders to 1.15 m.
 def ap(z):return .5 if z<=.8 else .5-(z-.8)*(.225/.35)
 levels=[0,.2,.4,.6,.8,.975,1.15]
 # Octagon with face normals on all cardinal axes.
 angles=[pi/8+i*pi/4 for i in range(8)]
 def pt(a,z,inset=0):
  r=(ap(z)-inset)/cos(pi/8);return(cx+r*cos(a),r*sin(a),z)
 v=[pt(a,z,.014 if z<1.15 else 0) for z in levels for a in angles]
 f=[tuple(reversed(range(8))),tuple(range(48,56))]
 for j in range(6):
  for i in range(8):f.append((8*j+i,8*j+(i+1)%8,8*(j+1)+(i+1)%8,8*(j+1)+i))
 core=mesh('Furnace | continuous pale clay bedding',v,f,'kiln',surface=2)
 cut=arch('temporary mouth',cx,.42,.2,.40,.58,-.68,-.12)
 boolean(core,cut)
 # Each course has 2 stones per octagon face: countable broad, irregular flat facets.
 for j in range(6):
  for side in range(8):
   a=angles[side];b=angles[(side+1)%8]
   # two alternating broad stones across each octagonal face
   splits=[0, (.46 if j%2==0 else .58)+random.uniform(-.07,.07), 1]
   for k in range(2):
    t0=splits[k]+.014;t1=splits[k+1]-.014
    z0=levels[j]+.008 if j else 0;z1=levels[j+1]-.009
    vv=[]
    for inset in [0,.085]:
     for z,t in [(z0,t0),(z0,t1),(z1,t1),(z1,t0)]:
      tadj=t+(random.uniform(-.028,.028) if inset==0 else 0)
      p=Vector(pt(a,z,inset)).lerp(Vector(pt(b,z,inset)),max(.008,min(.992,tadj)));vv.append(tuple(p))
    ob=mesh(f'Stone course {j+1} / facet {side+1} / block {k+1}',vv,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'kiln',tone=random.uniform(.78,1.15),bevel=random.uniform(.018,.029))
    if j in [1,2,3] and side in [4,5,6]:
     for d in ob.data.attributes['tone'].data:d.value*=.68 if side==5 else .82
    if j<3:boolean(ob,cut)
 bpy.data.objects.remove(cut,do_unlink=True)
 # Fired-clay continuous lip, inner void and stone lintel.
 lip=arch('Thick faceted fired-clay mouth lip',cx,.51,.178,.405,.635,-.522,-.467,'kiln')
 for d in lip.data.attributes['surface'].data:d.value=1
 cut=arch('temporary lip opening',cx,.42,.2,.40,.58,-.57,-.42)
 boolean(lip,cut);bpy.data.objects.remove(cut,do_unlink=True)
 box('Broad flat lintel', (cx,-.465,.647),(.57,.15,.075),'kiln',bevel=.016,tone=.74)
 box('Fired clay hearth floor',(cx,-.325,.188),(.42,.45,.024),'kiln',surface=1,bevel=.003,tone=.76)
 # Interior clay back is visibly scorched, never a fourth material.
 box('Scorched interior wall',(cx,-.107,.38),(.44,.035,.38),'kiln',surface=1,tone=.23,bevel=0)
 # Identical faceted heap in both states, grey/dark ash off and orange/yellow on.
 for layer,count in [(0,8),(1,5),(2,3)]:
  for i in range(count):
   x=cx+(i-(count-1)/2)*(.041 if layer==0 else .048)+random.uniform(-.008,.008)
   y=-.405+random.uniform(-.017,.045)
   z=.245+layer*.075
   bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,z));ob=bpy.context.object;ob.name=f'Coal facet heap {layer}-{i}'
   ob.scale=(random.uniform(.048,.066),.065,.065);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
   finish(ob,'fire',fireid=1 if layer==1 and 1<=i<=3 else (2 if i%3==0 else 0))
   if layer==1 and 1<=i<=3:
    for j,d in enumerate(ob.data.attributes['fire_id'].data):d.value=(1/3 if j%3 else 0)
 # Continuous pale clay bedding prevents daylight gaps through the masonry.
 cv=[]
 for z,x,y in [(1.145,-.20,.105),(1.67,-.25,.155)]:
  cv.extend([(x-.13,y-.13,z),(x+.13,y-.13,z),(x+.13,y+.13,z),(x-.13,y+.13,z)])
 mesh('Chimney continuous clay bedding',cv,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'kiln',surface=2,tone=.85)
 # Chimney square .28 section with 5cm backward-left lean, four stone courses.
 for j in range(4):
  z0=1.15+j*.13;z1=z0+.13
  dx0=-.20-(z0-1.15)*.096;dy0=.105+(z0-1.15)*.096
  dx1=-.20-(z1-1.15)*.096;dy1=.105+(z1-1.15)*.096
  # hollow square ring, cardinal masonry blocks
  for side in range(4):
   a=side*pi/2
   mid=Vector((cos(a),sin(a),0))*.115
   loc=((dx0+dx1)/2+mid.x,(dy0+dy1)/2+mid.y,(z0+z1)/2)
   sz=(.055,.28,.121) if side%2==0 else (.17,.055,.121)
   ob=box(f'Chimney stone {j+1}-{side+1}',loc,sz,'kiln',bevel=.009,tone=random.uniform(.80,1.05))
  # clay joints held just inside the stone outer section
  ringloc=((dx0+dx1)/2,(dy0+dy1)/2,z0+.006)
  for side in range(4):
   a=side*pi/2;mid=Vector((cos(a),sin(a),0))*.11
   sz=(.05,.27,.014) if side%2==0 else (.17,.05,.014)
   box(f'Chimney clay joint {j}-{side}',(ringloc[0]+mid.x,ringloc[1]+mid.y,ringloc[2]),sz,'kiln',surface=2,bevel=0)
 box('Flat fired-clay chimney cap',(-.25,.155,1.685),(.32,.32,.03),'kiln',surface=1,bevel=.006,tone=.86)
 # Open crucible and right-pointing pouring spout. Supported in its collar.
 ring('Crucible clay collar',(.105,-.14,1.135),.142,.092,.055,'kiln',surface=1)
 # Cup bottom 1.15 / top 1.35, width .26. Thick polygonal rim.
 ring('Crucible thick cup',(.105,-.14,1.25),.13,.098,.20,'kiln',surface=1)
 cyl('Crucible interior floor',(.105,-.14,1.157),.10,.014,'kiln',surface=1,tone=.26)
 # Only molten fill is state-dependent geometry, as requested empty vs full.
 fill=cyl('Molten fill — hidden when empty',(.105,-.14,1.343),.098,.008,'fire',fireid=0)
 fill['lit_only']=True
 mesh('Crucible pouring spout',[(.213,-.191,1.29),(.213,-.089,1.29),(.288,-.115,1.336),(.288,-.165,1.336),(.215,-.19,1.35),(.215,-.09,1.35)],[(0,1,2,3),(0,3,4),(1,5,2),(4,3,2,5)],'kiln',surface=1)
 # Wooden rack from x .30 to .60, y +/- .60; front-to-back split billets.
 for x in [.426,.574]:
  for y in [-.574,.574]:box('Rack upright',(x,y,.35),(.052,.052,.70),'boards',bevel=.005,tone=.91)
 for y in [-.558,.558]:
  for z in [.16,.50]:box('Rack cross plank',(.50,y,z),(.20,.038,.086),'boards',bevel=.004,tone=.96)
 for x in [.445,.55]:box('Rack floor plank',(x,0,.078),(.09,1.20,.075),'boards',bevel=.004)
 for z,xs in [(.205,[.50]),(.335,[.50]),(.465,[.50]),(.595,[.50])]:
  for x in xs:
   # angular split wood, same wood family; UV along length
   ob=cyl('Split firewood billet',(x,random.uniform(-.025,.025),z),.073,random.uniform(.93,1.05),'boards',vertices=5,axis='Y',tone=random.uniform(.76,1.08))
   uv=ob.data.uv_layers.active
   for poly in ob.data.polygons:
    for li in poly.loop_indices:
     v=ob.data.vertices[ob.data.loops[li].vertex_index].co;uv.data[li].uv=(v.x*4+v.z*2,v.y*2)
     if abs(poly.normal.y)>.9:uv.data[li].uv=(math.sqrt(v.x*v.x+v.z*v.z)*12,math.atan2(v.z,v.x)/(2*pi))


def fabricator():
 global STATION;STATION='fabricator'
 # Main body at +/- .75 wide, .375 deep; y front=-.375. Chamfers are geometric.
 body=box('Riveted main steel shell',(0,0,.575),(1.50,.75,.95),'plate',bevel=.045)
 # Broad inset panel fields and seam strips, with restrained wear geometry.
 box('Top inset panel',(-.07,-.015,1.047),(1.26,.56,.006),'plate',bevel=.012,tone=1.035)
 for x in [-.62,.62]:
  for y in [-.267,.267]:box('Short forged foot',(x,y,.075),(.19,.20,.15),'iron',bevel=.013)
 # Front seam frame, subtle iron-dark gaps behind the functional steel hatch.
 for x in [-.691,.16,.691]:box('Front rivet seam strip',(x,-.378,.58),(.035,.012,.76),'plate',bevel=.003,tone=.83)
 for z in [.165,.985]:box('Front horizontal rivet seam',(0,-.378,z),(1.37,.014,.033),'plate',bevel=.003,tone=.87)
 for x in [-.691,.16,.691]:
  for z in [.20,.34,.49,.64,.79,.94]:cyl('Round seam rivet',(x,-.389,z),.012,.012,'plate',vertices=10,axis='Y',surface=1,tone=.79)
 for z in [.165,.985]:
  for x in [-.55,-.36,-.17,.02,.32,.51]:cyl('Round seam rivet',(x,-.39,z),.011,.012,'plate',vertices=10,axis='Y',surface=1,tone=.81)
 # Fifty by forty-five centimetre hatch, left of centre.
 box('Hatch dark reveal',(-.30,-.386,.63),(.53,.022,.48),'iron',bevel=.017)
 box('Square steel service hatch',(-.30,-.407,.63),(.50,.035,.45),'plate',bevel=.022,tone=1.08)
 ring('Bare steel porthole rim',(-.30,-.435,.665),.153,.13,.028,'plate',vertices=16,axis='Y',surface=1,tone=.87)
 cyl('Round smoky or amber window',(-.30,-.442,.665),.13,.008,'fire',vertices=24,axis='Y',fireid=3)
 for a in [pi/4,3*pi/4,5*pi/4,7*pi/4]:
  cyl('Porthole fastening',(-.3+.143*cos(a),-.453,.665+.143*sin(a)),.008,.006,'iron',vertices=8,axis='Y')
 for z in [.49,.77]:box('Hatch hinge',(-.558,-.435,z),(.058,.051,.08),'iron',bevel=.008)
 for x in [-.39,-.21]:box('Handle standoff',(x,-.45,.46),(.027,.044,.034),'iron',bevel=.004)
 beam('Stout hatch handle',(-.405,-.473,.46),(-.195,-.473,.46),.031,.033,'iron',bevel=.006)
 # Keep depth within .9 exactly by setting front bound at -0.45 instead of handle -0.49.
 for ob in OBJS[STATION]:
  if ob.name.startswith(('Handle standoff','Stout hatch handle')):ob.location.y+=.044
 # Three gauges in a single row and three chunky knobs under them.
 box('Gauge cluster panel',(.396,-.394,.715),(.42,.027,.35),'plate',bevel=.014,tone=.90)
 for x in [.26,.395,.53]:
  ring('Gauge bare steel bezel',(x,-.419,.785),.058,.044,.02,'plate',vertices=16,axis='Y',surface=1)
  cyl('Gauge face',(x,-.426,.785),.044,.006,'plate',vertices=16,axis='Y',surface=1,tone=.65)
  # Physical iron index marks and needle, no letters or numbers.
  for a in [pi*.12,pi*.37,pi*.62,pi*.87]:
   a0=(x+.033*cos(a),-.431,.785+.033*sin(a));a1=(x+.041*cos(a),-.431,.785+.041*sin(a));beam('Gauge index',a0,a1,.003,.003,'iron',bevel=0)
  beam('Gauge needle',(x,-.433,.785),(x+.024,-.433,.808),.004,.004,'iron',bevel=0)
  cyl('Chunky control knob',(x,-.426,.625),.032,.043,'iron',vertices=8,axis='Y')
  box('Knob face index',(x,-.45,.636),(.006,.003,.018),'plate',surface=1,bevel=0)
 # Lever held in same upper position in both states, for direct material-only comparison.
 box('Lever mounting plate',(.685,-.325,.585),(.075,.035,.28),'plate',bevel=.008,surface=1,tone=.72)
 box('Lever slot',(.696,-.347,.59),(.025,.009,.205),'iron',bevel=.006)
 beam('Right iron lever',(.705,-.345,.54),(.81,-.34,.83),.021,.024,'iron',bevel=.004)
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.04,location=(.81,-.34,.84));ob=bpy.context.object;ob.name='Lever ball';finish(ob,'iron')
 # Cage lamps: diameter .10 lenses, stout cage ribs but no added materials.
 for x in [-.615,.615]:
  cyl('Lamp foot',(x,-.245,1.066),.065,.035,'iron',vertices=12)
  cyl('Lamp lens',(x,-.245,1.123),.05,.084,'fire',vertices=12,fireid=3)
  ring('Lamp lower iron ring',(x,-.245,1.086),.060,.049,.012,'iron')
  ring('Lamp upper iron ring',(x,-.245,1.167),.060,.049,.012,'iron')
  for a in [0,pi/2,pi,3*pi/2]:
   beam('Lamp cage upright',(x+.055*cos(a),-.245+.055*sin(a),1.088),(x+.055*cos(a),-.245+.055*sin(a),1.169),.010,.010,'iron',bevel=.002)
  beam('Lamp crown guard',(x-.052,-.245,1.175),(x+.052,-.245,1.175),.010,.010,'iron',bevel=.002)
 # Angled back-centre hopper mouth, top widening, visibly open throat.
 v=[(-.22,.03,1.052),(.22,.03,1.052),(.22,.24,1.052),(-.22,.24,1.052),(-.27,.12,1.21),(.27,.12,1.21),(.27,.40,1.25),(-.27,.40,1.25)]
 hopper=mesh('Angled steel intake hopper',v,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'plate',tone=.91)
 mod=hopper.modifiers.new('Thick intake lip','SOLIDIFY');mod.thickness=.012;bpy.context.view_layer.objects.active=hopper;bpy.ops.object.modifier_apply(modifier=mod.name)
 box('Hopper recessed throat',(0,.147,1.056),(.425,.20,.012),'plate',tone=.34,bevel=.006)
 for a,b in [(v[4],v[5]),(v[5],v[6]),(v[6],v[7]),(v[7],v[4])]:beam('Hopper worn folded rim',a,b,.019,.019,'plate',surface=1,tone=.79,bevel=.003)
 # Back-right iron exhaust at y .38; rain cap sets height and depth box edges.
 cyl('Stovepipe base collar',(.61,.30,1.068),.082,.036,'iron')
 cyl('Iron exhaust stovepipe',(.61,.335,1.165),.055,.205,'iron')
 cyl('Pipe collar band',(.61,.335,1.21),.06,.018,'iron')
 cyl('Little rain cap',(.61,.36,1.281),.09,.038,'iron',r2=.034)
 # Jerrycan: leftmost x=-.85, occupying margin beside shell.
 box('Strapped painted jerrycan',(-.77,.035,.565),(.138,.35,.47),'plate',bevel=.028,tone=.95)
 # Shoulder and raised forged-in painted handle, treated as plate.
 box('Jerrycan shoulder',(-.77,.035,.807),(.145,.305,.045),'plate',bevel=.018)
 for y in [-.06,.08]:box('Jerrycan handle pedestal',(-.77,y,.86),(.055,.035,.076),'plate',bevel=.008)
 beam('Jerrycan carrying handle',(-.77,-.075,.898),(-.77,.095,.898),.047,.031,'plate',bevel=.008)
 cyl('Bare steel fuel cap',(-.77,.153,.852),.046,.034,'plate',vertices=12,surface=1)
 # Two embossed X ribs on outer face, matching steel panel colour.
 for a,b in [((-.853,-.09,.40),(-.853,.145,.70)),((-.853,-.09,.70),(-.853,.145,.40))]:
  # inward placement keeps strict -0.85 edge
  a=(a[0]+.014,a[1],a[2]);b=(b[0]+.014,b[1],b[2]);beam('Jerrycan pressed stiffener',a,b,.016,.018,'plate',tone=.83,bevel=.003)
 box('Jerrycan outer iron strap',(-.846,.028,.565),(.008,.044,.47),'iron',bevel=.002)
 for z in [.334,.795]:box('Jerrycan strap return',(-.772,.028,z),(.15,.044,.008),'iron',bevel=.002)
 # Side and back panel seams / countable rivet heads, no extra features.
 for x in [-.754,.754]:
  for y in [-.285,.285]:
   box('Side vertical rivet strip',(x,y,.59),(.009,.032,.74),'plate',tone=.84,bevel=.002)
   for z in [.25,.44,.63,.82,.94]:cyl('Side seam rivet',(x+(.007 if x>0 else -.007),y,z),.011,.01,'plate',axis='X',vertices=10,surface=1,tone=.79)
 for x in [-.67,0,.67]:
  box('Rear seam strip',(x,.378,.575),(.032,.01,.77),'plate',tone=.84,bevel=.002)
  for z in [.22,.40,.58,.76,.94]:cyl('Rear round rivet',(x,.39,z),.011,.012,'plate',axis='Y',vertices=10,surface=1,tone=.78)
 # Small angular steel edge chips seated on the plate, painted steel's own substrate.
 for i in range(30):
  x=random.uniform(-.66,.65);z=random.choice([.168,.978])+random.uniform(-.008,.008)
  w=random.uniform(.005,.019);h=random.uniform(.002,.006)
  mesh('Paint worn through at seam',[(x,-.398,z),(x+w,-.398,z+h),(x+w*.7,-.398,z-h),(x-w*.25,-.398,z-h*.4)],[(0,1,2,3)],'plate',surface=1,tone=random.uniform(.72,.95))

forge()
# Preserve the independent steel-wear sequence after reducing the rack from six billets to four.
for _ in range(6):random.random()
fabricator()
for ob in OBJS['forge']:
 if ob.name.startswith(('Crucible ', 'Molten fill')):
  ob.location.x-=.04;ob.location.y+=.02
for ob in OBJS['fabricator']:
 if ob.name.startswith('Hatch hinge'):ob.location.y+=.011
 if ob.name.startswith('Porthole fastening'):ob.location.y+=.007
 if ob.name.startswith('Knob face index'):ob.location.y+=.002
for sname,h in [('forge',1.7),('fabricator',1.3)]:
 collection=bpy.data.collections.new(sname.upper());scene.collection.children.link(collection)
 root=bpy.data.objects.new(sname+' | BOX CENTRE',None);collection.objects.link(root);root.location=(0,0,h/2);root.empty_display_size=.12
 bpy.context.view_layer.update()
 for ob in OBJS[sname]:
  world=ob.matrix_world.copy()
  for old in list(ob.users_collection):old.objects.unlink(ob)
  collection.objects.link(ob);ob.parent=root;ob.matrix_world=world
# Camera uses world Z up and front at -Y. Box midpoint maps to exact canvas centre.
bpy.ops.object.camera_add();camera=bpy.context.object;camera.name='Calibrated orthographic / eye-height perspective';scene.camera=camera

def bounds(obs):
 pts=[o.matrix_world@Vector(v) for o in obs if o.type=='MESH' for v in o.bound_box]
 return {'min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]}

def aim(loc,target,top=False):
 camera.location=loc;direction=Vector(target)-camera.location
 camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
 if top:camera.rotation_euler=(0,0,0)

prior_measure=json.loads((ROOT/'checks'/'geometry.json').read_text()) if (ROOT/'checks'/'geometry.json').exists() else {}
measure={'units':'metres','canvas':[S,S],'pixels_per_metre':PPM,'background_srgb':BG,'axis_convention':'+X station right, -Y front, +Z up','stations':{}}
for name,boxdim in [('forge',(1.2,1.2,1.7)),('fabricator',(1.7,.9,1.3))]:
 bpy.context.view_layer.update();bb=bounds(OBJS[name]);bb['size']=[bb['max'][i]-bb['min'][i] for i in range(3)]
 measure['stations'][name]={'target_size_xyz':boxdim,'bounds':bb,'materials':sorted(set(o['material_family'] for o in OBJS[name])),'parts':{},'cameras':prior_measure.get('stations',{}).get(name,{}).get('cameras',{})}
 for ob in OBJS[name]:measure['stations'][name]['parts'][ob.name]={'bounds':bounds([ob]),'material':ob['material_family'],'lit_only':bool(ob.get('lit_only',False))}
(ROOT/'checks'/'geometry.json').write_text(json.dumps(measure,indent=2))
# Blend stores all source geometry and materials; no external downloads required.
for o in OBJS['forge']+OBJS['fabricator']:o.hide_render=False
bpy.data.collections['FABRICATOR'].hide_viewport=True
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'stations.blend'))
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
selected=args[0] if args else 'all'
views=args[1].split(',') if len(args)>1 else ['front','side','left','top','back','hero','front_lit','hero_lit']
for station in ['forge','fabricator']:
 if selected not in ['all',station]:continue
 h=1.7 if station=='forge' else 1.3;target=Vector((0,0,h/2))
 for view in views:
  lit=view.endswith('_lit');base=view.replace('_lit','')
  for node in FIRE:node.outputs[0].default_value=int(lit)
  for name,obs in OBJS.items():
   for ob in obs:ob.hide_render=name!=station or (ob.get('lit_only',False) and not lit)
  camera.data.type='ORTHO';camera.data.ortho_scale=S/PPM;camera.data.lens=50
  locs={'front':(0,-5,h/2),'back':(0,5,h/2),'side':(5,0,h/2),'left':(-5,0,h/2),'top':(0,0,5)}
  if base=='hero':
   camera.data.type='PERSP';camera.data.lens=48
   # horizontal distance 3.5m, camera height 1.6m
   aim((2.475,-2.475,1.6),target)
  else:aim(locs[base],target,top=base=='top')
  bpy.context.view_layer.update()
  measure['stations'][station].setdefault('cameras',{})[view]={'projection':camera.data.type,'location_m':list(camera.location),'target_m':list(target),'matrix_world':[list(r) for r in camera.matrix_world],'ortho_scale_m':camera.data.ortho_scale,'lens_mm':camera.data.lens}
  (ROOT/'checks'/'geometry.json').write_text(json.dumps(measure,indent=2))
  scene.render.filepath=str(ROOT/'renders'/f'{station}_{view}.png')
  bpy.ops.render.render(write_still=True)
  if lit:
   # Explicit visible-fire mask; same camera, sample count, and geometry.
   backups=[]
   for mname,matl in MATS.items():
    n=matl.node_tree.nodes;l=matl.node_tree.links;em=next(q for q in n if q.type=='EMISSION')
    oldlink=em.inputs[0].links[0];backups.append((matl,oldlink.from_socket,em))
    l.remove(oldlink);em.inputs[0].default_value=(1,1,1,1) if mname=='fire' else (0,0,0,1)
   scene.cycles.use_denoising=False
   scene.render.filepath=str(ROOT/'renders'/f'{station}_{view}_firemask.png');bpy.ops.render.render(write_still=True)
   for matl,socket,em in backups:matl.node_tree.links.new(socket,em.inputs[0])
   scene.cycles.use_denoising=True
for node in FIRE:node.outputs[0].default_value=0
for sname,obs in OBJS.items():
 for ob in obs:ob.hide_render=sname!='forge' or bool(ob.get('lit_only',False))
camera.data.type='ORTHO';camera.data.ortho_scale=S/PPM;aim((0,-5,.85),(0,0,.85));scene.render.filepath=str(ROOT/'renders'/'forge_front.png')
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'stations.blend'))
print('Geometry and render stage complete.')
