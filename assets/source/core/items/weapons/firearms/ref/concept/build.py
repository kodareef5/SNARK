"""Rebuild the shared concept geometry and render passes with Blender.

Run: blender -b -t 8 --python build.py
All model coordinates are in metres, with the brief's X/Y/Z convention.
Only exterior art geometry is represented; this is not a functional design.
"""
import bpy, math, json, os, sys, time
from mathutils import Vector, Matrix
from pathlib import Path
from math import sin, cos, pi

ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
START=time.time()
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for datablock in bpy.data.materials: bpy.data.materials.remove(datablock)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.cycles.seed=0
scene.cycles.max_bounces=4
scene.render.resolution_x=1254; scene.render.resolution_y=1254
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.view_settings.exposure=0; scene.view_settings.gamma=1
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(1,1,1,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.75
scene.render.threads_mode='FIXED'; scene.render.threads=8
scene.render.image_settings.color_depth='8'
bpy.context.preferences.filepaths.save_version=0
bpy.context.preferences.filepaths.file_preview_type='NONE'

def linear(c):
    return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def rgb(h):
    return tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))+(1,)
def material(name,h,rough=.8,noise=.1,scale=180):
    m=bpy.data.materials.new(name); m.use_nodes=True
    n=m.node_tree.nodes; l=m.node_tree.links; n.clear()
    out=n.new('ShaderNodeOutputMaterial'); bs=n.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Base Color'].default_value=rgb(h); bs.inputs['Roughness'].default_value=rough
    bs.inputs['Specular IOR Level'].default_value=.13
    l.new(bs.outputs[0],out.inputs[0])
    tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=scale; tex.inputs['Detail'].default_value=3
    coord=n.new('ShaderNodeTexCoord'); l.new(coord.outputs['Object'],tex.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB')
    c=rgb(h)
    ramp.color_ramp.elements[0].color=tuple(v*(1-noise) for v in c[:3])+(1,)
    ramp.color_ramp.elements[1].color=tuple(min(1,v*(1+noise)) for v in c[:3])+(1,)
    l.new(tex.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],bs.inputs['Base Color'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.13; bump.inputs['Distance'].default_value=.00008
    l.new(tex.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs[0],bs.inputs['Normal'])
    return m
wood=material('honey hardwood | generated grain','A4784C',.82,.06,320)
n=wood.node_tree.nodes; l=wood.node_tree.links
coord=n.new('ShaderNodeTexCoord'); sep=n.new('ShaderNodeSeparateXYZ'); comb=n.new('ShaderNodeCombineXYZ')
l.new(coord.outputs['Object'],sep.inputs[0])
l.new(sep.outputs['Z'],comb.inputs['X']); l.new(sep.outputs['X'],comb.inputs['Z'])
crossgrain=n.new('ShaderNodeMath');crossgrain.operation='MULTIPLY_ADD';crossgrain.inputs[1].default_value=.67
l.new(sep.outputs['X'],crossgrain.inputs[0]);l.new(sep.outputs['Y'],crossgrain.inputs[2]);l.new(crossgrain.outputs[0],comb.inputs['Y'])
mapping=n.new('ShaderNodeVectorMath'); mapping.operation='SCALE'; mapping.inputs[3].default_value=3.5
l.new(comb.outputs[0],mapping.inputs[0])
tex=n.new('ShaderNodeTexImage'); tex.image=bpy.data.images.load(str(ROOT/'textures/wood_albedo.png')); tex.image.pack();tex.extension='REPEAT'
l.new(mapping.outputs[0],tex.inputs['Vector'])
bs=next(x for x in n if x.type=='BSDF_PRINCIPLED')
l.new(tex.outputs['Color'],bs.inputs['Base Color'])
bump=next(x for x in n if x.type=='BUMP'); l.new(tex.outputs['Color'],bump.inputs['Height']); bump.inputs['Strength'].default_value=.16
woodwear=material('wood | polished hand contact','B88C5C',.68,.12,340)
woodgrip=wood.copy(); woodgrip.name='honey hardwood | grain along grip'
ng=woodgrip.node_tree.nodes; lg=woodgrip.node_tree.links
cg=next(x for x in ng if x.type=='COMBXYZ'); sg=next(x for x in ng if x.type=='SEPXYZ')
lg.new(sg.outputs['Y'],cg.inputs['X'])
cgmath=next(x for x in ng if x.type=='MATH');lg.new(sg.outputs['Z'],cgmath.inputs[2])
steel=material('browned forged steel','404044',.8,.20,450)
edge=material('steel | worn arris','969696',.72,.12,600)
brass=material('aged brass','A8884A',.77,.16,360)
hide=material('tight brown hide','7A5638',.9,.24,650)
hideedge=material('hide | cut edge','896449',.9,.16,500)
cord=material('plant fibre cord','B09858',.92,.18,850)
flint=material('dark fractured flint','4A484C',.86,.16,280)
flintedge=material('flint | fresh edge','9C9890',.8,.1,280)
boremat=material('dark bore interior','242224',1,.15,400)
GUNS={}; current=None

def finish(obj,name,mat,bevel=0):
    obj.name=current+'__'+name
    obj.data.materials.append(mat)
    GUNS[current].append(obj)
    obj['part']=name; obj['gun']=current
    if current not in bpy.data.collections:
        col=bpy.data.collections.new(current);scene.collection.children.link(col)
    col=bpy.data.collections[current]
    for old in list(obj.users_collection):old.objects.unlink(obj)
    col.objects.link(obj)
    if bevel:
        mod=obj.modifiers.new('subtle hand softened arrises','BEVEL'); mod.width=bevel; mod.segments=1
    return obj
def mesh(name,verts,faces,mat,bevel=0):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    obj=bpy.data.objects.new(name,me); scene.collection.objects.link(obj)
    return finish(obj,name,mat,bevel)
def box(name,center,size,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center)
    o=bpy.context.object; o.dimensions=size; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,bevel)
def profile(name,points,width,mat,bevel=0,x=0):
    # Side polygon points are (z,y).
    verts=[(x+s*width/2,y,z) for s in [-1,1] for z,y in points]; N=len(points)
    faces=[tuple(range(N-1,-1,-1)),tuple(range(N,2*N))]
    faces += [(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
    return mesh(name,verts,faces,mat,bevel)
def tube(name,z0,z1,cx,cy,r,mat,n=12,bore=0,r1=None,phase=0):
    r1=r if r1 is None else r1
    rings=[(z0,r),(z1,r1)]
    if bore: rings += [(z1,bore),(z0+.004,bore)]
    v=[(cx+rr*cos(2*pi*i/n+phase),cy+rr*sin(2*pi*i/n+phase),z) for z,rr in rings for i in range(n)]
    f=[]
    for k in range(len(rings)-1):
        f += [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for i in range(n)]
    f.append(tuple(range(n-1,-1,-1)))
    if not bore: f.append(tuple(range(n,2*n)))
    else: f.append(tuple(range(3*n,4*n)))
    obj=mesh(name,v,f,mat)
    if bore:
        obj.data.materials.append(boremat)
        for p in obj.data.polygons:
            if p.index>=2*n and p.index<3*n: p.material_index=1
            if p.index==len(f)-1: p.material_index=1
    return obj
def path(name,pts,r,mat,n=8):
    # A compact tube along a path, used for guards, levers and cord.
    verts=[]
    for i,p in enumerate(pts):
        p=Vector(p); t=Vector(pts[min(i+1,len(pts)-1)])-Vector(pts[max(0,i-1)])
        t.normalize(); a=t.cross(Vector((1,0,0)))
        if a.length<.01: a=t.cross(Vector((0,1,0)))
        a.normalize(); b=t.cross(a).normalized()
        for j in range(n): verts.append(tuple(p+r*(cos(2*pi*j/n)*a+sin(2*pi*j/n)*b)))
    faces=[]
    for i in range(len(pts)-1):
        faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for j in range(n)]
    faces += [tuple(range(n-1,-1,-1)),tuple(range((len(pts)-1)*n,len(pts)*n))]
    return mesh(name,verts,faces,mat)
def ellipsoid(name,c,r,mat,segments=12,rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=c)
    o=bpy.context.object; o.scale=r; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat)
def loft(name,sections,mat):
    # Section = z, width, bottom y, top y. Eight countable corner facets.
    verts=[]
    ring=[(-.70,1),(.70,1),(1,.72),(1,-.72),(.70,-1),(-.70,-1),(-1,-.72),(-1,.72)]
    for z,w,y0,y1 in sections:
        verts += [(a*w/2,(y0+y1)/2+b*(y1-y0)/2,z) for a,b in ring]
    f=[tuple(range(7,-1,-1))]
    for k in range(len(sections)-1): f += [(k*8+i,k*8+(i+1)%8,(k+1)*8+(i+1)%8,(k+1)*8+i) for i in range(8)]
    f.append(tuple(range((len(sections)-1)*8,len(sections)*8)))
    return mesh(name,verts,[tuple(reversed(face)) for face in f],mat)
def sight(name,z,ybase,ytop,width=.003,depth=.007,mat=steel):
    return box(name,(0,(ybase+ytop)/2,z),(width,ytop-ybase,depth),mat,.00025)
def rear(name,z,base,notch,top,width=.014,gap=.004):
    box(name+' base',(0,(base+notch)/2,z),(width,notch-base,.006),steel)
    for s in [-1,1]: box(name+' ear '+str(s),(s*(gap/2+(width-gap)/4),(notch+top)/2,z),((width-gap)/2,top-notch,.006),steel,.0002)
def flatband(name,z,width,xhalf,ymin,ymax,mat):
    # Open sleeve around a shaped forend/barrel cross section.
    coords=[(-xhalf*.7,ymax), (xhalf*.7,ymax),(xhalf,ymax-.004),(xhalf,ymin+.004),(xhalf*.7,ymin),(-xhalf*.7,ymin),(-xhalf,ymin+.004),(-xhalf,ymax-.004)]
    verts=[(x,y,zz) for zz in [z-width/2,z+width/2] for x,y in coords]
    return mesh(name,verts,[(i+8,(i+1)%8+8,(i+1)%8,i) for i in range(8)],mat)
def guard(name,z0,z1,ybottom,mat):
    return path(name,[(0,-.010,z0),(0,-.032,z0-.004),(0,ybottom+.002,z0+.008),(0,ybottom+.002,z1-.008),(0,-.032,z1+.004),(0,-.009,z1)],.002,mat)
def trigger(name,z,mat=steel):
    return profile(name,[(z-.003,-.008),(z+.004,-.010),(z+.003,-.023),(z-.004,-.034),(z-.009,-.034),(z-.004,-.024)],.004,mat,.0004)
def hammer(name,x,ymax,zback,width=.009,mat=steel):
    return profile(name,[(-.019,.032),(-.029,.046),(zback+.009,ymax-.014),(zback-.002,ymax-.009),(zback-.008,ymax-.010),(zback-.009,ymax-.004),(zback,ymax),(zback+.011,ymax-.003),(-.015,.056),(-.009,.038)],width,mat,.0006,x=x)

current='revolver'; GUNS[current]=[]
revolver_grip=[(-.019,.015),(.013,.015),(.009,-.016),(-.001,-.047),(-.008,-.075),(-.016,-.089),(-.035,-.095),(-.052,-.087),(-.050,-.073),(-.036,-.041),(-.028,-.011)]
profile('birds head wood grip',revolver_grip,.030,woodgrip,.0023)
profile('forged frame',[(-.045,.014),(-.045,.050),(-.034,.058),(.005,.058),(.005,.018),(-.007,.009),(-.029,.008)],.028,steel,.0018)
# Five external flutes and five shallow visible chamber mouths.
cyl=tube('five fluted cylinder',.005,.058,0,.040,.023,steel,n=50)
for v in cyl.data.vertices:
    angle=math.atan2(v.co.y-.040,v.co.x)
    radius=.023-.0020*(max(0,cos(5*angle))**6)
    v.co.x=radius*cos(angle); v.co.y=.040+radius*sin(angle)
for i in range(5):
    a=2*pi*i/5+pi/2; cx=.0145*cos(a); cy=.040+.0145*sin(a)
    # Explicit shallow cavity creates chamber mouths without internal mechanism.
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.0045,depth=.012,location=(cx,cy,.058))
    cutter=bpy.context.object
    mod=cyl.modifiers.new('chamber mouth '+str(i+1),'BOOLEAN'); mod.operation='DIFFERENCE'; mod.object=cutter
    bpy.context.view_layer.objects.active=cyl
    bpy.ops.object.modifier_apply(modifier=mod.name); bpy.data.objects.remove(cutter,do_unlink=True)
tube('brass cylinder front band',.050,.058,0,.040,.02335,brass,n=40,bore=.02285)
bar=tube('eight flat octagonal barrel',.058,.230,0,.040,.011/cos(pi/8),steel,n=8,bore=.0055,phase=pi/8)
# Fine worn arrises, same steel family.
for i in range(8):
    a=pi/8+2*pi*i/8; rr=.011/cos(pi/8)
    path('octagon worn edge '+str(i),[(rr*cos(a),.040+rr*sin(a),.059),(rr*cos(a),.040+rr*sin(a),.229)],.00014,edge,n=4)
path('under barrel loading lever',[(0,.020,.075),(0,.020,.171),(0,.022,.190)],.0033,steel)
box('loading lever hinge',(0,.026,.078),(.009,.011,.011),steel,.0005)
box('loading lever latch',(0,.023,.186),(.009,.006,.009),steel,.0007)
hammer('hooked hammer',0,.082,-.040)
box('folded trigger',(0,.001,-.010),(.006,.006,.023),steel,.0007)
rear('rear notch',-.020,.058,.062,.067)
sight('front blade',.220,.051,.062)
verts=[]; steps=240; turns=4.35
def wrap_xz(a,y):
    hits=[]
    for i,(z0,y0) in enumerate(revolver_grip):
        z1,y1=revolver_grip[(i+1)%len(revolver_grip)]
        if min(y0,y1)<=y<=max(y0,y1) and y0!=y1:hits.append(z0+(z1-z0)*(y-y0)/(y1-y0))
    zc=(min(hits)+max(hits))/2;rz=(max(hits)-min(hits))/2+.0008
    c,s=cos(a),sin(a)
    rr=min(.0158/max(abs(c),1e-6),rz/max(abs(s),1e-6))
    return rr*c,zc+rr*s
for i in range(steps+1):
    t=i/steps; a=t*turns*2*pi; y=-.069+t*.063
    for yy in [y-.006,y+.006]:
        xx,zz=wrap_xz(a,yy);verts.append((xx,yy,zz))
mesh('single spiral hide grip wrap',verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(steps)],hide)
for sign in [-1,1]:
    pts=[]
    for i in range(steps+1):
        t=i/steps;a=t*turns*2*pi;y=-.069+t*.063
        yy=y+sign*.006;xx,zz=wrap_xz(a,yy);pts.append((xx,yy,zz))
    path('spiral cut edge '+str(sign),pts,.00028,hideedge,n=4)

current='rifle';GUNS[current]=[]
loft('butt and narrow wrist',[(-.380,.040,-.088,.017),(-.363,.040,-.086,.019),(-.260,.038,-.065,.020),(-.150,.035,-.043,.020),(-.045,.030,-.018,.018),(.028,.030,-.018,.018),(.120,.030,-.030,.018)],wood)
loft('steel butt plate',[(-.3802,.0404,-.0882,.0172),(-.376,.0404,-.0882,.0172)],steel)
loft('long wood neck',[(.120,.030,-.030,.022),(.300,.030,-.021,.022),(.600,.030,-.004,.022),(.700,.030,.002,.022)],wood)
box('receiver',(0,.0215,.025),(.0306,.047,.190),steel,.001)
tube('round barrel',.120,.960,0,.022,.011,steel,n=12,bore=.0045)
tube('thick muzzle',.960,.980,0,.022,.013,steel,n=12,bore=.0045)
for z in [.400,.680]: flatband('brass neck band '+str(z),z,.010,.0157,.002 if z>.6 else -.018,.034,brass)
path('right bolt stem',[(.012,.030,-.030),(.024,.031,-.030),(.035,.030,-.030)],.0036,steel)
ellipsoid('right round bolt knob',(.035,.030,-.030),(.010,.010,.010),steel)
trigger('trigger',-.010)
guard('brass trigger guard',-.040,.045,-.045,brass)
rear('open rear sight',.200,.033,.052,.058,width=.016,gap=.005)
sight('front blade',.960,.033,.052,width=.0035,depth=.008)
# Left cheek pad, visible in top and extra detail view, absent on right.
profile('left hide cheek pad',[(-.330,.015),(-.150,.016),(-.150,-.014),(-.180,-.025),(-.310,-.031),(-.330,-.021)],.004,hide,.001,x=-.020)
for i in range(9):
    z=-.318+i*.019
    path('cheek pad lacing '+str(i),[(-.023,.011,z),(-.024,-.005,z+.012),(-.023,-.022,z)],.0008,cord,n=5)

current='shotgun';GUNS[current]=[]
loft('straight grip butt',[(-.360,.040,-.090,.020),(-.340,.040,-.087,.020),(-.240,.037,-.062,.020),(-.130,.033,-.035,.018),(-.035,.030,-.018,.018),(.060,.034,-.018,.018)],wood)
loft('steel butt plate',[(-.3602,.0404,-.0902,.0202),(-.356,.0404,-.0902,.0202)],steel)
box('wide twin action',(0,.014,-.000),(.046,.052,.120),steel,.002)
for x in [-.0125,.0125]: tube('left barrel' if x<0 else 'right barrel',.060,.680,x,.020,.012,steel,n=16,bore=.009)
# Rib drops very gently to allow its muzzle bead to meet the rear reference.
profile('central sight rib',[(.060,.031),(.680,.031),(.680,.036),(.060,.040),(-.0602,.040),(-.0602,.034)],.006,steel)
for x in [-.013,.013]: hammer('exposed hammer '+str(x),x,.070,-.045,width=.008)
for z in [-.005,.012]: trigger('twin trigger '+str(z),z)
guard('steel twin trigger guard',-.035,.049,-.045,steel)
loft('stubby wooden forend',[(.080,.034,-.012,.017),(.095,.044,-.020,.018),(.280,.044,-.020,.018),(.300,.032,-.009,.019)],wood)
loft('hide forend sleeve',[(.110,.045,-.0207,.014),(.270,.045,-.0207,.014)],hide)
for z in [.113,.267]: flatband('hide binding edge '+str(z),z,.003,.0227,-.021,.014,hideedge)
# One brass capsule sleeve, open at both ends, around both bores.
coords=[]
for i in range(9):
    a=-pi/2+i*pi/8;coords.append((.0125+.0127*cos(a),.020+.0127*sin(a)))
for i in range(9):
    a=pi/2+i*pi/8;coords.append((-.0125+.0127*cos(a),.020+.0127*sin(a)))
N=len(coords);v=[(x,y,z) for z in [.666,.680] for x,y in coords]
mesh('single brass muzzle band',v,[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],brass)
inner=[]
for i in range(9):
    a=-pi/2+i*pi/8;inner.append((.0125+.012*cos(a),.020+.012*sin(a)))
for i in range(9):
    a=pi/2+i*pi/8;inner.append((-.0125+.012*cos(a),.020+.012*sin(a)))
mesh('muzzle band front thickness',[(x,y,.680) for x,y in coords+inner],[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],brass)
ellipsoid('brass muzzle bead',(0,.038,.670),(.002,.002,.002),brass,segments=12,rings=8)

current='flare';GUNS[current]=[]
profile('curved wood grip',[(-.030,.015),(.010,.015),(.008,-.014),(.003,-.048),(-.005,-.072),(-.015,-.084),(-.030,-.090),(-.046,-.085),(-.050,-.077),(-.042,-.060),(-.029,-.026)],.032,woodgrip,.0025)
profile('wooden neck and hammer pivot support',[(-.048,.030),(-.048,.037),(-.014,.037),(.015,.023),(.012,.012),(-.022,.012),(-.025,.026)],.022,woodgrip,.001)
tube('carved hollow wood barrel',-.015,.175,0,.048,.028,wood,n=12,bore=.018)
tube('flared wood muzzle',.175,.200,0,.048,.028,wood,n=12,bore=.018,r1=.031)
ellipsoid('rounded wooden breech',(0,.048,-.015),(.028,.028,.015),wood,segments=12,rings=8)
for j,z in enumerate([.010,.095,.180]):
    # Six adjoining turns form each 12 mm wide fibre binding.
    for k in range(6):
        zz=z-.005+k*.002
        rad=.028 if zz<.175 else .028+(.031-.028)*(zz-.175)/.025
        pts=[]
        for i in range(65):
            a=2*pi*i/64
            rr=rad+.00085+.00016*sin(a*12+k)
            pts.append((rr*cos(a),.048+rr*sin(a),zz))
        path('cord binding '+str(j+1)+' turn '+str(k+1),pts,.001,cord,n=5)
profile('wood hammer and jaw',[(-.053,.027),(-.038,.028),(-.036,.059),(-.034,.080),(-.027,.089),(-.031,.095),(-.050,.094),(-.056,.085),(-.050,.060)],.016,wood,.0008)
# 30 mm stone wedge, pointing forward and down at the rounded breech.
fl=mesh('clamped flint wedge',[(-.010,.089,-.036),(.010,.089,-.036),(-.009,.076,-.006),(.009,.076,-.006),(-.006,.095,-.031),(.006,.095,-.031)],[(0,1,5,4),(0,2,3,1),(0,4,2),(1,3,5),(2,4,5,3)],flint)
mesh('flint fresh cutting edge',[(-.009,.0761,-.006),(.009,.0761,-.006),(.00864,.07838,-.009),(-.00864,.07838,-.009)],[(0,1,2,3)],flintedge)
profile('wood peg trigger',[(.011,.020),(.020,.020),(.019,.002),(.014,-.005),(.010,-.004)],.007,woodwear,.0005)
profile('carved front sight bump',[(.184,.077),(.196,.0785),(.193,.084),(.188,.084)],.005,wood)

# Camera and neutral frontal illumination.
bpy.ops.object.camera_add();camera=bpy.context.object;camera.name='orthographic camera';scene.camera=camera
bpy.ops.object.light_add(type='AREA');light=bpy.context.object;light.name='broad neutral frontal light';light.data.energy=100;light.data.shape='DISK';light.data.size=4
AXES={'side':(Vector((0,0,1)),Vector((0,1,0)),Vector((1,0,0))),
      'top':(Vector((0,0,1)),Vector((-1,0,0)),Vector((0,1,0))),
      'front':(Vector((-1,0,0)),Vector((0,1,0)),Vector((0,0,1))),
      'aim':(Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,-1))),
      'left':(Vector((0,0,-1)),Vector((0,1,0)),Vector((-1,0,0)))}
MANIFEST={'canvas':[1254,1254],'background_rgb':[214,212,206],'units':'metres','views':{},'objects':{},'started_utc':'2026-11-15T16:39:06Z'}
def visible(gun):
    for g,objs in GUNS.items():
        for o in objs:o.hide_render=g!=gun
def ortho(gun,view,name,scale,origin=(470,760),size=1254,aim_y=None):
    visible(gun)
    right,up,back=AXES[view]
    center=right*((size/2-origin[0])/scale)+up*((origin[1]-size/2)/scale)
    if aim_y is not None:center.y=aim_y
    camera.location=center+back*3
    # Right is reversed for a physical camera; post-process reflection implements
    # the brief's explicit screen axes, which form left-handed projections.
    camera.rotation_euler=Matrix((tuple(-right),tuple(up),tuple(back))).transposed().to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=size/scale;camera.data.clip_start=.01;camera.data.clip_end=20
    scene.render.resolution_x=size;scene.render.resolution_y=size
    light.location=center+back*2+up*.6-right*.35
    light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
    light.data.energy=65;light.data.size=4
    scene.render.filepath=str(ROOT/'renders'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
    MANIFEST['views'][name]={'gun':gun,'view':view,'pixels_per_metre':scale,'origin':list(origin),'canvas':[size,size],'screen_right':list(right),'screen_up':list(up),'camera_from':list(back),'horizontal_reflection':True,'aim_y':aim_y}

# Save geometry and evaluated object bounds independently of camera settings.
deps=bpy.context.evaluated_depsgraph_get()
for gun,objs in GUNS.items():
    MANIFEST['objects'][gun]={}
    for obj in objs:
        ev=obj.evaluated_get(deps); me=ev.to_mesh()
        vs=[ev.matrix_world@v.co for v in me.vertices]
        MANIFEST['objects'][gun][obj['part']]={'min':[min(v[i] for v in vs) for i in range(3)],'max':[max(v[i] for v in vs) for i in range(3)],'vertices':len(vs),'materials':[m.name for m in obj.data.materials if m]}
        ev.to_mesh_clear()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'concept_geometry.blend'))
selection=os.environ.get('CONCEPT_RENDER','all')
if selection!='all' and (ROOT/'checks/scene_measurements.json').exists():
    previous=json.loads((ROOT/'checks/scene_measurements.json').read_text())
    MANIFEST['views']=previous.get('views',{})
    if 'hero' in previous:MANIFEST['hero']=previous['hero']
for gun,scale,origin in [('revolver',3000,(470,760)),('rifle',800,(380,627)),('shotgun',1100,(470,627)),('flare',3000,(470,760))]:
    for view in ['side','top','front']:
        name=gun+'_'+view
        if selection=='all' or name in selection.split(','):
            ortho(gun,view,name,3000 if view=='front' else scale,(627,760) if view=='front' else origin)
for view in ['side','top']:
    name='rifle_action_'+view
    if selection=='all' or name in selection.split(','):ortho('rifle',view,name,3000,(380,760))
for gun,y in [('revolver',.062),('rifle',.052),('shotgun',.040),('flare',.084)]:
    name=gun+'_aim'
    if selection=='all' or name in selection.split(','):ortho(gun,'aim',name,6500,(627,627),aim_y=y)
if selection=='all' or 'rifle_left' in selection.split(','):ortho('rifle','left','rifle_left',2500,(200,700))
# Hero: all four at the same scale, lying on their left faces, in a coherent scene.
if selection=='all' or 'hero' in selection.split(','):
    # World X becomes the surface normal; Y and Z are the table plane.
    placements={'rifle':(.0,.20,0),'shotgun':(.0,-.025,.04),'revolver':(.0,-.27,-.14),'flare':(.0,-.28,.36)}
    turns={'rifle':-.055,'shotgun':.035,'revolver':-.15,'flare':.13}
    for gun,objs in GUNS.items():
        # Shift each model so its leftmost vertex touches the surface X=0.
        xmin=min(v['min'][0] for v in MANIFEST['objects'][gun].values())
        transform=Matrix.Translation(Vector((-xmin,placements[gun][1],placements[gun][2])))@Matrix.Rotation(turns[gun],4,'X')
        for o in objs:o.hide_render=False;o.matrix_world=transform@o.matrix_world
    current='hero';GUNS[current]=[]
    surface=material('neutral warm grey surface','D6D4CE',1,0,1)
    box('surface',(-.012,0,.30),(.020,200,200),surface)
    center=Vector((.025,-.025,.30));back=Vector((1,.45,.55)).normalized()
    right=Vector((0,0,-1));right=(right-back*right.dot(back)).normalized();up=back.cross(right).normalized()
    camera.location=center+back*3.3;camera.rotation_euler=Matrix((tuple(right),tuple(up),tuple(back))).transposed().to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=1.50
    scene.render.resolution_x=1254;scene.render.resolution_y=1254
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    light.location=(1.8,1.5,-.6);light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=70;light.data.size=2.5
    scene.cycles.samples=64;scene.render.film_transparent=False
    scene.render.filepath=str(ROOT/'renders/hero.png');bpy.ops.render.render(write_still=True)
    MANIFEST['hero']={'canvas':[1254,1254],'projection':'orthographic three quarters','common_scale':True}
MANIFEST['render_seconds']=time.time()-START
(ROOT/'checks/scene_measurements.json').write_text(json.dumps(MANIFEST,indent=2))
print('COMPLETE',round(time.time()-START,1),'seconds')
