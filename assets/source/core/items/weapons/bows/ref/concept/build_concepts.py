"""Deterministic, metre-scale concept models and orthographic render sources.

Run: blender -b -t 16 --python build_concepts.py -- [view names | all]
Then: python3 finish_sheets.py
Everything written by this script stays beside this file.
"""
import bpy, math, json, sys, time, os
from pathlib import Path
from mathutils import Vector, Matrix
from math import sin, cos, pi

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'checks' / 'render_sources'
RAW.mkdir(parents=True, exist_ok=True)
START = time.time()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in [bpy.data.materials, bpy.data.meshes, bpy.data.curves, bpy.data.cameras]:
    for d in list(datablocks):
        if d.users == 0: datablocks.remove(d)
scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
if hasattr(bpy.context.preferences.filepaths, 'file_preview_type'):
    bpy.context.preferences.filepaths.file_preview_type = 'NONE'
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.resolution_x = scene.render.resolution_y = 1254
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.film_transparent = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 16
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.render.image_settings.compression = 30
scene.world.color = (0.5, 0.5, 0.5)

GROUPS = {'bow': [], 'crossbow': []}
CURRENT = 'bow'
MATERIAL_CONTROLS = []
LANDMARKS = {'bow': {}, 'crossbow': {}}

def srgb(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def color(h):
    h = h.lstrip('#')
    return tuple(srgb(int(h[i:i+2], 16)/255) for i in (0, 2, 4)) + (1,)

def node(nt, kind, name=None):
    n = nt.nodes.new(kind)
    if name: n.name = n.label = name
    return n

def material(name, low, high, axis='Y', kind='wood'):
    """Object-space natural detail with shadowless, view-relative form shading.

    The hero toggles the same material to a rough diffuse surface. The technical
    views use an emission response to the perturbed normal, removing cast shadows,
    view-dependent highlights and any dependence on photographic exposure.
    """
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt=m.node_tree; nt.nodes.clear(); L=nt.links
    out=node(nt,'ShaderNodeOutputMaterial')
    geo=node(nt,'ShaderNodeTexCoord')
    mapping=node(nt,'ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
    grain_scale={'X':(3,170,170),'Y':(170,3,170),'Z':(170,170,3)}[axis]
    if kind=='leather': grain_scale=(620,620,620)
    if kind=='cord': grain_scale=(290,290,290)
    if kind=='steel': grain_scale=(105,105,105)
    mapping.inputs[1].default_value=grain_scale; L.new(geo.outputs['Object'],mapping.inputs[0])
    noise=node(nt,'ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=1
    noise.inputs['Detail'].default_value=3; noise.inputs['Roughness'].default_value=.7
    L.new(mapping.outputs['Vector'],noise.inputs['Vector'])
    ramp=node(nt,'ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position=.20
    ramp.color_ramp.elements[0].color=color(low); ramp.color_ramp.elements[1].position=.79
    ramp.color_ramp.elements[1].color=color(high); L.new(noise.outputs['Fac'],ramp.inputs[0])
    base_color=ramp.outputs[0]
    if kind=='wood':
        # Fine continuous growth fibres under the larger natural streaks. A
        # distorted band field prevents the wood from reading as uniform stripes.
        wave=node(nt,'ShaderNodeTexWave'); wave.wave_type='BANDS'
        wave.bands_direction='X' if axis!='X' else 'Z'
        wave.inputs['Scale'].default_value=410
        wave.inputs['Distortion'].default_value=6
        wave.inputs['Detail'].default_value=4
        wave.inputs['Detail Scale'].default_value=.3
        L.new(geo.outputs['Object'],wave.inputs['Vector'])
        fine=node(nt,'ShaderNodeValToRGB');fine.color_ramp.elements[0].position=.20
        fine.color_ramp.elements[0].color=(.55,.55,.55,1)
        fine.color_ramp.elements[1].position=.62;fine.color_ramp.elements[1].color=(1,1,1,1)
        L.new(wave.outputs['Color'],fine.inputs[0])
        grain=node(nt,'ShaderNodeMixRGB');grain.blend_type='MULTIPLY';grain.inputs[0].default_value=.25
        L.new(ramp.outputs[0],grain.inputs[1]);L.new(fine.outputs[0],grain.inputs[2]);base_color=grain.outputs[0]
    micro=node(nt,'ShaderNodeTexNoise'); micro.inputs['Scale'].default_value=2200 if kind!='wood' else 1400
    micro.inputs['Detail'].default_value=2
    L.new(geo.outputs['Object'],micro.inputs['Vector'])
    bump=node(nt,'ShaderNodeBump'); bump.inputs['Strength'].default_value=.22
    bump.inputs['Distance'].default_value={'wood':.00010,'leather':.00013,'cord':.00012,'steel':.000035}[kind]
    L.new(micro.outputs['Fac'],bump.inputs['Height'])
    if kind=='wood':
        grain_bump=node(nt,'ShaderNodeBump'); grain_bump.inputs['Strength'].default_value=.25
        grain_bump.inputs['Distance'].default_value=.00017
        L.new(noise.outputs['Fac'],grain_bump.inputs['Height']); L.new(bump.outputs[0],grain_bump.inputs['Normal'])
        normal=grain_bump.outputs[0]
    else: normal=bump.outputs[0]
    dot=node(nt,'ShaderNodeVectorMath','Technical front direction'); dot.operation='DOT_PRODUCT'
    L.new(normal,dot.inputs[0]); dot.inputs[1].default_value=(.12,.2,1)
    maximum=node(nt,'ShaderNodeMath'); maximum.operation='MAXIMUM'; maximum.inputs[1].default_value=0
    L.new(dot.outputs['Value'],maximum.inputs[0])
    response=node(nt,'ShaderNodeMath'); response.operation='MULTIPLY_ADD'
    response.inputs[1].default_value=.37; response.inputs[2].default_value=.64
    L.new(maximum.outputs[0],response.inputs[0])
    tint=node(nt,'ShaderNodeVectorMath'); tint.operation='SCALE'
    L.new(base_color,tint.inputs[0]); L.new(response.outputs[0],tint.inputs['Scale'])
    em=node(nt,'ShaderNodeEmission'); L.new(tint.outputs[0],em.inputs[0])
    diffuse=node(nt,'ShaderNodeBsdfPrincipled'); L.new(base_color,diffuse.inputs['Base Color'])
    diffuse.inputs['Roughness'].default_value=.83 if kind!='steel' else .65
    diffuse.inputs['Metallic'].default_value=.12 if kind=='steel' else 0
    diffuse.inputs['Specular IOR Level'].default_value=.18
    L.new(normal,diffuse.inputs['Normal'])
    mix=node(nt,'ShaderNodeMixShader','Hero material switch'); mix.inputs[0].default_value=0
    L.new(em.outputs[0],mix.inputs[1]); L.new(diffuse.outputs[0],mix.inputs[2]); L.new(mix.outputs[0],out.inputs[0])
    MATERIAL_CONTROLS.append((dot,mix))
    return m

WOOD_B=material('Honey wood — longitudinal bow grain','#91673F','#BC9060','Y')
WOOD_C=material('Honey wood — longitudinal stock grain','#91673F','#BC9060','Z')
WOOD_G=material('Worn honey wood — pistol grip','#A87D50','#C39B6B','Y')
WOOD_CUT=material('Open groove end grain and recessed fibres','#664A30','#8E6841','Z')
HIDE=material('Supple brown hide','#67452D','#916946',kind='leather')
HIDE_EDGE=material('Hide overlap edge','#775237','#A47B52',kind='leather')
CORD=material('Straw plant fibre','#988044','#C0AA6E',kind='cord')
CORD_LIGHT=material('Fibre strand variation','#A28B4D','#C4AC70',kind='cord')
STEEL=material('Browned blued steel','#37363B','#4A494C',kind='steel')
STEEL_EDGE=material('Steel softly worn edges','#646367','#969696',kind='steel')

def mesh(name, verts, faces, mats, face_mats=None, bevel=0):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); scene.collection.objects.link(ob)
    GROUPS[CURRENT].append(ob)
    for m in mats: me.materials.append(m)
    if face_mats:
        for p,i in zip(me.polygons,face_mats): p.material_index=i
    bpy.context.view_layer.objects.active=ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    if bevel:
        mod=ob.modifiers.new('Small hand-finished arris','BEVEL'); mod.width=bevel; mod.segments=1
        mod.affect='EDGES'; mod.material=1 if len(mats)>1 else 0
        mod.limit_method='ANGLE'; mod.angle_limit=.35
    return ob

def section(rx,rz,cut=.24):
    return [(-rx,-rz*(1-cut)),(-rx*(1-cut),-rz),(rx*(1-cut),-rz),(rx,-rz*(1-cut)),
            (rx,rz*(1-cut)),(rx*(1-cut),rz),(-rx*(1-cut),rz),(-rx,rz*(1-cut))]

def loft(name,rings,mats,bevel=0):
    n=len(rings[0]); verts=[v for r in rings for v in r]
    faces=[tuple(range(n-1,-1,-1))]
    for k in range(len(rings)-1):
        for j in range(n): faces.append((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j))
    faces.append(tuple((len(rings)-1)*n+j for j in range(n)))
    return mesh(name,verts,faces,mats,bevel=bevel)

def tube(name,pts,r,mat,sides=8,closed=False):
    pts=[Vector(p) for p in pts]
    if closed and (pts[-1]-pts[0]).length>1e-9: pts.append(pts[0])
    rings=[]; prev=None
    for i,p in enumerate(pts):
        tangent=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized()
        if closed and i in (0,len(pts)-1): tangent=(pts[1]-pts[-2]).normalized()
        ref=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((0,1,0))
        a=tangent.cross(ref).normalized(); b=tangent.cross(a).normalized()
        if prev is not None and a.dot(prev)<0: a=-a; b=-b
        prev=a
        rings.append([tuple(p+r*(cos(2*pi*j/sides)*a+sin(2*pi*j/sides)*b)) for j in range(sides)])
    return loft(name,rings,[mat])

def smooth_path(points,steps=7):
    """Corner softened polylines, interpolated only locally (no shape overshoot)."""
    p=[Vector(v) for v in points]; out=[p[0]]
    for i in range(1,len(p)-1):
        a=p[i]*.77+p[i-1]*.23; b=p[i]*.77+p[i+1]*.23
        out.append(a)
        for j in range(1,steps+1):
            t=j/steps; out.append((1-t)**2*a+2*t*(1-t)*p[i]+t*t*b)
    out.append(p[-1]); return out

def rope(name,points,radius,pitch=.016,closed=False):
    """Three actual twisted plies; envelope diameter is twice radius."""
    p=[Vector(v) for v in points]
    if closed and (p[-1]-p[0]).length>1e-9: p.append(p[0])
    samples=[]; distances=[]; distance=0
    for a,b in zip(p[:-1],p[1:]):
        length=(b-a).length; count=max(1,math.ceil(length/(pitch/10)))
        for j in range(count): samples.append(a+(b-a)*(j/count)); distances.append(distance+length*j/count)
        distance+=length
    samples.append(p[-1]); distances.append(distance)
    offset=radius*.49; strand=radius*.51
    for ply in range(3):
        q=[]; prev=None
        for i,c in enumerate(samples):
            tangent=(samples[min(i+1,len(samples)-1)]-samples[max(0,i-1)]).normalized()
            ref=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((0,1,0))
            a=tangent.cross(ref).normalized(); b=tangent.cross(a).normalized()
            if prev is not None and a.dot(prev)<0: a=-a; b=-b
            prev=a; angle=2*pi*(distances[i]/pitch+ply/3)
            q.append(c+offset*(a*cos(angle)+b*sin(angle)))
        tube(name+f' / ply {ply+1}',q,strand,CORD_LIGHT if ply==1 else CORD,sides=6)

def mark(name,p): LANDMARKS[CURRENT][name]=list(p)

def bow_centre(y):
    t=max(0,min(1,(abs(y)-.075)/.425))
    if abs(y)<=.5: return -.005-.140*t**1.72
    return -.145-.020*(abs(y)-.50)/.16

def bow_dims(y):
    u=abs(y)
    if u<=.50:
        t=max(0,min(1,(u-.075)/.425)); return (.018-.005*t,.036-.010*t)
    return (.013+.007*min(1,(u-.50)/.02),.024)

def bow():
    global CURRENT; CURRENT='bow'
    for sign,label in [(1,'Upper'),(-1,'Lower')]:
        rings=[]
        for i in range(17):
            y=.075+.425*i/16; x=bow_centre(y); d,w=bow_dims(y)
            rings.append([(x+px,sign*y,pz) for px,pz in section(d/2,w/2)])
        loft(label+' sweeping wood limb',rings,[WOOD_B])
        rings=[]
        for y,w,d in [(.500,.024,.013),(.520,.024,.020),(.636,.024,.020),(.643,.030,.022),(.653,.030,.022),(.660,.022,.019)]:
            rings.append([(bow_centre(y)+px,sign*y,pz) for px,pz in section(d/2,w/2,.30)])
        loft(label+' rigid ear and carved nock knob',rings,[WOOD_B])
        # Five tight turns, 40 mm from edge to edge, genuinely continuous winding.
        pts=[]; radius=.0038
        for i in range(5*64+1):
            t=i/(5*64); y=.4838+t*.0324; phase=2*pi*5*t
            depth,width=bow_dims(y)
            # Superellipse keeps the wrap close to the countable timber facets.
            sx=math.copysign(abs(cos(phase))**.55,cos(phase))
            sz=math.copysign(abs(sin(phase))**.55,sin(phase))
            pts.append((bow_centre(y)+(depth/2+.0042)*sx,sign*y,(width/2+.0042)*sz))
        rope(label+' ear joint continuous binding',pts,radius,pitch=.016)
        for i,side in enumerate([-1,1]):
            y=.490+i*.012
            p=[(bow_centre(y)-.010,sign*y,side*.016),
               (bow_centre(y)-.022,sign*(y-.007),side*.022),
               (bow_centre(y)-.035,sign*(y-.015),side*.023)]
            rope(label+f' joint cut tail {i+1}',smooth_path(p),.0028,pitch=.013)
        # A loop seats over each carved knob, joining the straight bowstring.
        pts=[(-.172,sign*.652,0),(-.177,sign*.649,.009),(-.170,sign*.656,.014),
             (-.157,sign*.658,.008),(-.155,sign*.658,-.008),(-.170,sign*.656,-.014),(-.177,sign*.649,-.009),(-.172,sign*.652,0)]
        rope(label+' string nock loop',smooth_path(pts,4),.00145,pitch=.012)
    rope('Straight twisted bowstring',[(-.172,-.660,0),(-.172,.660,0)],.0025,pitch=.019)
    # Solid hide under the overlap. The final envelope is 40 x 30 mm.
    rings=[]
    for y in [-.075,.075]: rings.append([(-.005+x,y,z) for x,z in section(.0194,.0144,.26)])
    loft('Hide covered grip core',rings,[HIDE])
    # One helical strip. Clipping the ribbon to the end planes leaves no bare wood.
    verts=[]; faces=[]; mi=[]; pitch=.025; turns=8; steps=turns*128
    perimeter=section(.0194,.0144,.26)
    for i in range(steps+1):
        t=i/128; a=(t%1)*8; j=int(a)%8; f=a-int(a)
        x=perimeter[j][0]*(1-f)+perimeter[(j+1)%8][0]*f
        z=perimeter[j][1]*(1-f)+perimeter[(j+1)%8][1]*f
        for s in [0,.04,1]:
            y=max(-.075,min(.075,-.102+pitch*t+.026*s))
            offset=.0006*(1-s)
            verts.append((-.005+x*(1+offset/.0194),y,z*(1+offset/.0144)))
    for i in range(steps):
        for j in range(2):
            faces.append((3*i+j,3*(i+1)+j,3*(i+1)+j+1,3*i+j+1)); mi.append(1 if j==0 else 0)
    mesh('Single overlapping spiral hide strip',verts,faces,[HIDE,HIDE_EDGE],mi)
    # Shelf is carved out of the same wood and exists on -Z only.
    shelf_rings=[]
    for y,factor in [(.075,.70),(.078,1),(.088,1),(.095,.25)]:
        # ten millimetres proud of the local 18 mm half-width
        shelf_rings.append([(-.004+px,y,-.018+pz) for px,pz in section(.013*factor,.010*factor,.45)])
    loft('Integral left arrow shelf',shelf_rings,[WOOD_B])
    for name,p in {
        'origin':(0,0,0),'grip_front':(.015,0,0),'grip_back':(-.025,0,0),
        'grip_left':(-.005,0,-.015),'grip_right':(-.005,0,.015),
        'grip_upper':(-.005,.075,0),'grip_lower':(-.005,-.075,0),
        'upper_joint':(-.145,.5,0),'lower_joint':(-.145,-.5,0),
        'upper_tip':(-.165,.66,0),'lower_tip':(-.165,-.66,0),
        'upper_string':(-.172,.66,0),'lower_string':(-.172,-.66,0),
        'shelf_extreme':(-.004,.085,-.028),
        'upper_binding_start':(bow_centre(.48),.48,0),'upper_binding_end':(bow_centre(.52),.52,0),
    }.items(): mark(name,p)

def crossbow():
    global CURRENT; CURRENT='crossbow'
    rings=[]
    for z in [-.220,-.210,-.180,-.120,0,.395,.460]:
        t=max(0,min(1,(-z-.120)/.100)); w=.040+.006*t; top=.018+.002*t; bottom=-.040-.030*t; c=.003
        profile=[(-w/2,bottom+c),(-w/2+c,bottom),(w/2-c,bottom),(w/2,bottom+c),
                 (w/2,top-c),(w/2-c,top),(.004,top),(.004,top-.005),(-.004,top-.005),(-.004,top),(-w/2+c,top),(-w/2,top-c)]
        rings.append([(x,y,z) for x,y in profile])
    stock=loft('Grooved honey wood tiller with flared square butt',rings,[WOOD_C,WOOD_CUT])
    for polygon in stock.data.polygons:
        if polygon.index>0 and (polygon.index-1)%12 in [6,7,8]: polygon.material_index=1
    rings=[]
    for y,z in [(-.038,0),(-.050,-.003),(-.112,-.026),(-.125,-.030)]:
        rings.append([(x,y,z+pz) for x,pz in section(.015,.020,.30)])
    loft('Raked wood pistol grip',rings,[WOOD_G])
    trigger=[(0,-.032,.029),(0,-.048,.028),(0,-.066,.025),(0,-.073,.020)]
    tube('Forged trigger lever',smooth_path(trigger,4),.0023,STEEL,8)
    # Roller axis is X. An open top notch catches the 6 mm cord at y=.027.
    profile=[(.030,.0305),(.030,.0355),(.024,.0355),(.024,.0445),(.030,.0445),(.030,.0495),
             (.025,.0525),(.016,.054),(.009,.052),(.0035,.047),(.002,.040),(.0035,.033),(.009,.028),(.016,.026),(.025,.0275)]
    loft('Notched steel roller nut',[[(x,y,z) for y,z in profile] for x in [-.012,.012]],[STEEL,STEEL_EDGE],.00045)
    rings=[]
    for i in range(25):
        x=-.300+.600*i/24; t=abs(x)/.300; z=.430-.060*t**1.65
        h=.038-.012*t; d=.013-.005*t
        rings.append([(x,.005+py,z+pz) for py,pz in section(h/2,d/2,.16)])
    loft('Faceted bowed steel leaf spring prod',rings,[STEEL,STEEL_EDGE],.00065)
    for sign,label in [(-1,'Left'),(1,'Right')]:
        rope(label+' drawn string leg',[(sign*.300,.005,.370),(0,.027,.040)],.003,pitch=.019)
        p=[]
        for i in range(65):
            a=2*pi*i/64
            p.append((sign*.296,.005+.0138*cos(a),.370+.0060*sin(a)))
        rope(label+' prod tip string loop',p,.0015,pitch=.012)
    # Four passes in each direction. The upper second diagonal makes the crossing
    # leg of a stout figure eight; underside routes enclose the wooden nose.
    for diag in [-1,1]:
        for j in range(4):
            off=(j-1.5)*.0062
            a=.430-diag*.018+off; b=.430+diag*.018+off
            yy=.027 if diag==-1 else .0326
            points=[(-.0279,yy,a),(.0279,yy,b),(.0225,.010,b),(.0218,-.0428,b-.001*diag),
                    (-.0218,-.0428,a+.001*diag),(-.0225,.010,a),(-.0279,yy,a)]
            rope(f'Figure eight binding diagonal {diag} pass {j+1}',smooth_path(points,5),.0028,pitch=.014)
    for sign in [-1,1]:
        points=[(sign*.025,.033,.421),(sign*.038,.023,.416),(sign*.048,.016,.413)]
        rope(f'Nose binding cut tail {sign}',smooth_path(points),.0028,pitch=.013)
    # Octagonal section on the stirrup, no polished reflection or extra fittings.
    stirrup=[(-.016,.005,.450),(-.033,.005,.478),(-.039,.005,.500),(-.039,.005,.543),
             (-.032,.005,.554),(.032,.005,.554),(.039,.005,.543),(.039,.005,.500),(.033,.005,.478),(.016,.005,.450)]
    stir=tube('Forged blunt steel foot stirrup',smooth_path(stirrup,3),.006,STEEL,8)
    stir.data.materials.append(STEEL_EDGE)
    # Narrow worn facets, with most of the section retaining its dark finish.
    for p in stir.data.polygons:
        if p.index%8==2: p.material_index=1
    for name,p in {
        'origin':(0,0,0),'butt':(0,0,-.220),'nose':(0,0,.460),
        'deck':(0,.018,.200),'bottom':(0,-.040,.200),
        'butt_top':(0,.020,-.220),'butt_bottom':(0,-.070,-.220),
        'butt_left':(-.023,0,-.220),'butt_right':(.023,0,-.220),
        'tiller_left':(-.020,0,.200),'tiller_right':(.020,0,.200),
        'pistol_end':(0,-.125,-.030),'trigger_end':(0,-.075,.020),
        'nut':(0,.027,.040),'nut_top':(0,.030,.040),
        'prod_centre':(0,.005,.430),'prod_left':(-.300,.005,.370),'prod_right':(.300,.005,.370),
        'stirrup_front':(0,.005,.560),'stirrup_left':(-.045,.005,.520),'stirrup_right':(.045,.005,.520),
        'groove_left':(-.004,.018,.200),'groove_right':(.004,.018,.200),'groove_floor':(0,.013,.200),
    }.items(): mark(name,p)

bow(); crossbow()

VIEWS={
 'bow_side': dict(group='bow',view=(0,0,1),right=(1,0,0),up=(0,1,0),ppm=800,origin=(627,627),centre=(0,0,0)),
 'bow_back': dict(group='bow',view=(-1,0,0),right=(0,0,1),up=(0,1,0),ppm=800,origin=(627,627),centre=(0,0,0)),
 'bow_top': dict(group='bow',view=(0,1,0),right=(1,0,0),up=(0,0,-1),ppm=800,origin=(627,627),centre=(0,0,0)),
 'bow_grip_side': dict(group='bow',view=(0,0,1),right=(1,0,0),up=(0,1,0),ppm=3000,origin=(627,627),centre=(0,0,0)),
 'bow_grip_back': dict(group='bow',view=(-1,0,0),right=(0,0,1),up=(0,1,0),ppm=3000,origin=(627,627),centre=(0,0,0)),
 'bow_ear_side': dict(group='bow',view=(0,0,1),right=(1,0,0),up=(0,1,0),ppm=3000,origin=(627,627),centre=(-.150,.550,0)),
 'crossbow_side': dict(group='crossbow',view=(1,0,0),right=(0,0,1),up=(0,1,0),ppm=1500,origin=(380,627),centre=(0,0,0)),
 'crossbow_top': dict(group='crossbow',view=(0,1,0),right=(0,0,1),up=(-1,0,0),ppm=1500,origin=(380,627),centre=(0,0,0)),
 'crossbow_front': dict(group='crossbow',view=(0,0,1),right=(-1,0,0),up=(0,1,0),ppm=1500,origin=(627,627),centre=(0,0,0)),
}

cam_data=bpy.data.cameras.new('Metric orthographic camera'); cam=bpy.data.objects.new('Metric orthographic camera',cam_data)
scene.collection.objects.link(cam); scene.camera=cam

def set_camera(config):
    view=Vector(config['view']); up=Vector(config['up']); desired=Vector(config['right'])
    right=up.cross(view); mirror=right.dot(desired)<0
    centre=Vector(config['centre'])
    # Use centre of continuous pixel coordinates. finish_sheets reflects about
    # column 627 when required, including the half-pixel correction documented there.
    target=centre+desired*((627-config['origin'][0])/config['ppm'])-up*((627-config['origin'][1])/config['ppm'])
    cam.location=target+view*4
    cam.rotation_euler=Matrix((right,up,view)).transposed().to_euler()
    cam_data.type='ORTHO'; cam_data.ortho_scale=1254/config['ppm']; cam_data.lens=60
    cam_data.clip_start=.01; cam_data.clip_end=100
    # Bias the frontal tone very gently upward/right, avoiding strong key light.
    light=(view+.22*up+.12*right).normalized()
    for dot,mix in MATERIAL_CONTROLS:
        dot.inputs[1].default_value=light; mix.inputs[0].default_value=0
    for group,obs in GROUPS.items():
        for ob in obs: ob.hide_render=group!=config['group']
    return mirror

def render_view(name,config):
    mirror=set_camera(config)
    scene.render.filepath=str(RAW/(name+'.png')); bpy.ops.render.render(write_still=True)
    config['mirror_x']=mirror

def export_geometry():
    deps=bpy.context.evaluated_depsgraph_get(); data={}
    for group,obs in GROUPS.items():
        data[group]={}
        for ob in obs:
            evaluated=ob.evaluated_get(deps); me=evaluated.to_mesh()
            vertices=[tuple(ob.matrix_world@v.co) for v in me.vertices]
            data[group][ob.name]={'min':[min(v[i] for v in vertices) for i in range(3)],
                'max':[max(v[i] for v in vertices) for i in range(3)],'vertices':len(vertices),'polygons':len(me.polygons)}
            evaluated.to_mesh_clear()
    (ROOT/'checks'/'geometry_bounds.json').write_text(json.dumps(data,indent=2))

def hero():
    # Lie both objects on a neutral plane, preserving scale and all source meshes.
    for dot,mix in MATERIAL_CONTROLS: mix.inputs[0].default_value=1
    for ob in GROUPS['bow']:
        ob.hide_render=False
        # Bow Y -> world X, X -> -world Y; original Z becomes the floor normal.
        ob.matrix_world=Matrix.Translation((-.03,.20,.0285)) @ Matrix.Rotation(-65*pi/180,4,'Z')
    for ob in GROUPS['crossbow']:
        ob.hide_render=False
        # Rest on the grip heel and stirrup; pitch the nose down to the surface.
        rot=Matrix(((0,0,1,0),(1,0,0,0),(0,1,0,0),(0,0,0,1)))
        ob.matrix_world=Matrix.Translation((-.18,-.23,.123)) @ Matrix.Rotation(-25*pi/180,4,'Z') @ Matrix.Rotation(.217,4,'Y') @ rot
    floor=bpy.data.materials.new('Neutral warm grey unmarked surface'); floor.use_nodes=True
    bs=floor.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=color('#D6D4CE'); bs.inputs['Roughness'].default_value=.95
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.003)); plane=bpy.context.object; plane.name='Hero neutral surface'; plane.data.materials.append(floor)
    world=scene.world; world.use_nodes=True; world.node_tree.nodes.get('Background').inputs[0].default_value=(.8,.85,.9,1)
    world.node_tree.nodes.get('Background').inputs[1].default_value=.175
    for name,loc,power,size in [('Soft daylight',(-1.5,-2,3.5),175,4),('Broad fill',(2,1,3),55,5)]:
        d=bpy.data.lights.new(name,'AREA'); o=bpy.data.objects.new(name,d); scene.collection.objects.link(o)
        o.location=loc; o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler(); d.energy=power; d.shape='DISK'; d.size=size
    cam_data.type='PERSP'; cam_data.lens=70
    target=Vector((.10,-.04,.04)); cam.location=(.95,-1.70,2.30)
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.film_transparent=False; scene.cycles.samples=64; scene.cycles.use_denoising=True
    scene.render.resolution_x=scene.render.resolution_y=1254
    scene.render.filepath=str(ROOT/'hero.png'); bpy.ops.render.render(write_still=True)
    for group in GROUPS.values():
        for ob in group: ob.matrix_world=Matrix.Identity(4)
    bpy.data.objects.remove(plane,do_unlink=True)
    for ob in list(scene.objects):
        if ob.type=='LIGHT': bpy.data.objects.remove(ob,do_unlink=True)
    scene.render.film_transparent=True; scene.cycles.use_denoising=False; scene.cycles.samples=24
    scene.render.resolution_x=scene.render.resolution_y=1254

requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['all']
all_views=not requested or 'all' in requested
export_geometry()
for name,conf in VIEWS.items():
    # Always calculate camera handedness, even for a subset render.
    conf['mirror_x']=Vector(conf['up']).cross(Vector(conf['view'])).dot(Vector(conf['right']))<0
    if all_views or name in requested: render_view(name,conf)
if all_views or 'hero' in requested: hero()
(ROOT/'checks'/'projection_spec.json').write_text(json.dumps({'canvas':[1254,1254],'background_rgb':[214,212,206],'views':VIEWS,'landmarks_m':LANDMARKS},indent=2))
set_camera(VIEWS['bow_side'])
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'concept_models.blend'))
with (ROOT/'checks'/'render_runs.jsonl').open('a') as f:
    f.write(json.dumps({'started_unix':START,'ended_unix':time.time(),'seconds':time.time()-START,'views':requested,'blender':bpy.app.version_string})+'\n')
print('CONCEPT BUILD COMPLETE',time.time()-START)
# This host's PulseAudio destructor can stall even with -noaudio. All render,
# JSON and blend writes above are synchronous and closed before a batch exit.
if bpy.app.background:
    sys.stdout.flush();sys.stderr.flush();os._exit(0)
