"""Rebuild the concept plates in Blender 5.3. No network or external assets.
blender -b -t 12 --python build_stations.py -- --station all --views all
Coordinates: X right, Y back, Z up; ground Z=0. Distances are metres.
"""
import bpy, bmesh, math, random, json, sys, argparse, time, os
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parent
random.seed(2319)
START = time.time()
parser=argparse.ArgumentParser()
parser.add_argument('--station',default='all')
parser.add_argument('--views',default='all')
parser.add_argument('--resolution',type=int,default=1254)
parser.add_argument('--samples',type=int,default=48)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.context.preferences.filepaths.file_preview_type='NONE'
bpy.context.preferences.filepaths.save_version=0
BG=(214,212,206)
SPECS={'mortar':{'box':[.60,.50,.60],'ppm':1600,'materials':['stone','hide','lashing']},
       'smithy':{'box':[1.60,1.10,.80],'ppm':700,'materials':['boards','iron','hide']},
       'bin':{'box':[.80,1.20,.70],'ppm':850,'materials':['boards','kiln','fire']}}
PALETTE={'stone':(141,138,131),'hide':(122,86,56),'lashing':(176,152,92),
         'boards':(172,128,82),'iron':(44,41,39),'kiln':(80,74,68),'fire':(96,92,88)}
ATLAS={'boards':(0,.5),'hide':(.5,.5),'stone':(0,0),'iron':(.5,0)}
MATS={}; MODES=[]; FIRE=[]; PARTS={}; STATION=''
def linear(c):
    c=c/255
    return c/12.92 if c<.04045 else ((c+.055)/1.055)**2.4
def rgba(rgb):return tuple(linear(v) for v in rgb)+(1,)
def node(nt,typ,name=None):
    n=nt.nodes.new(typ)
    if name:n.name=name
    return n
def mat(cat,variant='',color=None,factor=1,texture=True):
    key=(cat,variant)
    if key in MATS:return MATS[key]
    m=bpy.data.materials.new(cat+(' / '+variant if variant else ''));m.use_nodes=True;m['material_family']=cat
    nt=m.node_tree;nt.nodes.clear();links=nt.links
    out=node(nt,'ShaderNodeOutputMaterial')
    rgb=color or PALETTE[cat]
    col=node(nt,'ShaderNodeRGB');col.outputs[0].default_value=rgba(rgb)
    colorout=col.outputs[0]
    if cat in ATLAS and texture:
        uv=node(nt,'ShaderNodeTexCoord');mapping=node(nt,'ShaderNodeVectorMath');mapping.operation='MULTIPLY_ADD'
        mapping.inputs[1].default_value=(.46,.46,1)
        ox,oy=ATLAS[cat];mapping.inputs[2].default_value=(ox+.02,oy+.02,0)
        links.new(uv.outputs['UV'],mapping.inputs[0])
        tex=node(nt,'ShaderNodeTexImage');tex.image=bpy.data.images.get('material_atlas.png') or bpy.data.images.load(str(ROOT/'textures/material_atlas.png'));tex.interpolation='Linear'
        links.new(mapping.outputs[0],tex.inputs[0])
        mix=node(nt,'ShaderNodeMixRGB');mix.blend_type='MIX';mix.inputs[0].default_value=.65
        links.new(col.outputs[0],mix.inputs[1]);links.new(tex.outputs['Color'],mix.inputs[2]);colorout=mix.outputs[0]
    if factor!=1:
        mul=node(nt,'ShaderNodeMixRGB');mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1
        links.new(colorout,mul.inputs[1]);mul.inputs[2].default_value=(factor,factor,factor,1);colorout=mul.outputs[0]
    if variant=='worktop':
        pos=node(nt,'ShaderNodeNewGeometry');offset=node(nt,'ShaderNodeVectorMath');offset.operation='SUBTRACT';offset.inputs[1].default_value=(.055,-.085,0)
        links.new(pos.outputs['Position'],offset.inputs[0])
        scale=node(nt,'ShaderNodeVectorMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=(1/.16,1/.115,0);links.new(offset.outputs[0],scale.inputs[0])
        length=node(nt,'ShaderNodeVectorMath');length.operation='LENGTH';links.new(scale.outputs[0],length.inputs[0])
        noise=node(nt,'ShaderNodeTexNoise');noise.inputs['Scale'].default_value=47;noise.inputs['Detail'].default_value=3;links.new(pos.outputs['Position'],noise.inputs[0])
        noiseamp=node(nt,'ShaderNodeMath');noiseamp.operation='MULTIPLY_ADD';noiseamp.inputs[1].default_value=.55;links.new(noise.outputs['Fac'],noiseamp.inputs[0]);links.new(length.outputs['Value'],noiseamp.inputs[2])
        ramp=node(nt,'ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.55;ramp.color_ramp.elements[0].color=(.055,.055,.055,1);ramp.color_ramp.elements[1].position=1.27
        links.new(noiseamp.outputs[0],ramp.inputs[0]);multiply=node(nt,'ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;links.new(colorout,multiply.inputs[1]);links.new(ramp.outputs[0],multiply.inputs[2]);colorout=multiply.outputs[0]
    if variant=='cabinet':
        geom=node(nt,'ShaderNodeNewGeometry');back=node(nt,'ShaderNodeMixRGB');back.blend_type='MULTIPLY';links.new(geom.outputs['Backfacing'],back.inputs[0]);links.new(colorout,back.inputs[1]);back.inputs[2].default_value=(.13,.13,.13,1);colorout=back.outputs[0]
    # Normal-only form shading for orthographic plates: no illumination or cast shadows.
    geom=node(nt,'ShaderNodeNewGeometry')
    dot=node(nt,'ShaderNodeVectorMath','Plate direction');dot.operation='DOT_PRODUCT';dot.inputs[1].default_value=(.12,-.38,.91)
    links.new(geom.outputs['Normal'],dot.inputs[0])
    shade=node(nt,'ShaderNodeMath');shade.operation='MULTIPLY_ADD';shade.inputs[1].default_value=.26;shade.inputs[2].default_value=.78
    links.new(dot.outputs['Value'],shade.inputs[0])
    colshade=node(nt,'ShaderNodeMixRGB');colshade.blend_type='MULTIPLY';colshade.inputs[0].default_value=1
    links.new(colorout,colshade.inputs[1]);links.new(shade.outputs[0],colshade.inputs[2])
    em=node(nt,'ShaderNodeEmission');links.new(colshade.outputs[0],em.inputs['Color'])
    bs=node(nt,'ShaderNodeBsdfPrincipled');links.new(colorout,bs.inputs['Base Color']);bs.inputs['Roughness'].default_value=1;bs.inputs['Specular IOR Level'].default_value=0
    if texture and cat!='fire':
        texco=node(nt,'ShaderNodeTexCoord');noise=node(nt,'ShaderNodeTexNoise');noise.inputs['Scale'].default_value=145 if cat in ['hide','boards','lashing'] else 90
        noise.inputs['Detail'].default_value=2;links.new(texco.outputs['Generated'],noise.inputs['Vector'])
        bump=node(nt,'ShaderNodeBump');bump.inputs['Strength'].default_value=.17;bump.inputs['Distance'].default_value=.0011
        links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs[0],bs.inputs['Normal'])
    mode=node(nt,'ShaderNodeMixShader','Plate / daylight');mode.inputs[0].default_value=0
    links.new(em.outputs[0],mode.inputs[1]);links.new(bs.outputs[0],mode.inputs[2]);links.new(mode.outputs[0],out.inputs[0]);MODES.append(mode)
    MATS[key]=m;return m
def firemat(name,lit):
    m=bpy.data.materials.new('fire / '+name);m.use_nodes=True;m['material_family']='fire'
    nt=m.node_tree;nt.nodes.clear();out=node(nt,'ShaderNodeOutputMaterial');em=node(nt,'ShaderNodeEmission')
    em.inputs['Color'].default_value=rgba((96,92,88));em.inputs['Strength'].default_value=1
    # Camera-only colour is not a source of scene illumination.
    lp=node(nt,'ShaderNodeLightPath');tr=node(nt,'ShaderNodeBsdfTransparent');mix=node(nt,'ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Camera Ray'],mix.inputs[0]);nt.links.new(tr.outputs[0],mix.inputs[1]);nt.links.new(em.outputs[0],mix.inputs[2]);nt.links.new(mix.outputs[0],out.inputs[0])
    FIRE.append((em,lit));return m
def uv_map(o,grain=None):
    me=o.data
    if not len(me.polygons):return
    if not me.uv_layers:me.uv_layers.new(name='Surface')
    uv=me.uv_layers.active.data
    coords=[v.co for v in me.vertices]
    lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
    dims=[max(hi[i]-lo[i],.001) for i in range(3)]
    for f in me.polygons:
        normal=f.normal;drop=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=drop]
        vaxis=grain if grain in axes else max(axes,key=lambda a:dims[a]);uaxis=next(a for a in axes if a!=vaxis)
        for li in f.loop_indices:
            co=me.vertices[me.loops[li].vertex_index].co
            uv[li].uv=((co[uaxis]-lo[uaxis])/dims[uaxis],(co[vaxis]-lo[vaxis])/dims[vaxis])
def register(o,material,part):
    o.data.materials.append(material);o['station']=STATION;o['part']=part
    PARTS.setdefault(part,[]).append(o);uv_map(o);return o
def mesh(name,verts,faces,material,part=None,bevel=0):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);register(o,material,part or name)
    if bevel:
        mod=o.modifiers.new('Hand softened arrises','BEVEL');mod.width=bevel;mod.segments=1
    return o
def box(name,center,dims,material,bevel=.004,part=None,rot=None,grain=None):
    dx,dy,dz=[v/2 for v in dims]
    vs=[(-dx,-dy,-dz),(-dx,-dy,dz),(-dx,dy,-dz),(-dx,dy,dz),(dx,-dy,-dz),(dx,-dy,dz),(dx,dy,-dz),(dx,dy,dz)]
    fs=[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)]
    o=mesh(name,vs,fs,material,part,bevel);o.location=center
    if rot:o.rotation_euler=rot
    uv_map(o,grain);return o
def beam(name,a,b,width,depth,material,part=None):
    a,b=Vector(a),Vector(b);o=box(name,(a+b)/2,(width,depth,(b-a).length),material,.004,part,grain=2)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def cylinder(name,center,radius,depth,material,n=12,part=None,bevel=.002,rot=None):
    vs=[(radius*math.cos(i*math.tau/n),radius*math.sin(i*math.tau/n),z) for z in [-depth/2,depth/2] for i in range(n)]
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh(name,vs,fs,material,part,bevel);o.location=center
    if rot:o.rotation_euler=rot
    uv_map(o,2);return o
def lathe(name,rings,material,n=8,part=None):
    vs=[]
    for z,r in rings:
        vs += [(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for i in range(n)]
    fs=[tuple(reversed(range(n)))]
    for j in range(len(rings)-1):
        fs += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n)]
    fs.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    return mesh(name,vs,fs,material,part)
def tube(name,points,radius,material,n=6,part=None):
    vs=[]
    for j,p in enumerate(points):
        tang=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(j-1,0)])
        tang.normalize();ref=Vector((0,0,1)) if abs(tang.z)<.9 else Vector((1,0,0));u=tang.cross(ref).normalized();v=tang.cross(u).normalized()
        vs += [tuple(Vector(p)+radius*(u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n))) for i in range(n)]
    fs=[tuple(reversed(range(n)))]
    for j in range(len(points)-1):fs += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n)]
    fs.append(tuple(range((len(points)-1)*n,len(points)*n)))
    return mesh(name,vs,fs,material,part)
def taperbox(name,center,bottom,top,height,material,part=None):
    vs=[]
    for z,(w,d) in [(-height/2,bottom),(height/2,top)]:vs += [(-w/2,-d/2,z),(w/2,-d/2,z),(w/2,d/2,z),(-w/2,d/2,z)]
    fs=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    o=mesh(name,vs,fs,material,part,.003);o.location=center;return o
def polyextrude(name,outline,depth,material,part=None):
    # Outline in X,Z; thickness along Y.
    n=len(outline);vs=[(x,y,z) for y in [-depth/2,depth/2] for x,z in outline]
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,vs,fs,material,part,.0015)

def mortar():
    stone=mat('stone');edge=mat('stone','worn edges',color=(168,164,156),texture=False)
    hide=mat('hide');cord=mat('lashing');fibre=mat('lashing','raised fibre',factor=1.07)
    # Octagon plus two vertices bounding the local chip at the front-left corner.
    a=.27;b=a*(math.sqrt(2)-1)
    xy=[(a,b),(b,a),(-b,a),(-a,b),(-a,-b),(-b-.032,-a+.032),(-b,-a),(-b+.041,-a),(b,-a),(a,-b)]
    rings=[(.07,.70),(.102,.79),(.265,.965),(.406,1),(.43,1)]
    vs=[];n=len(xy)
    for j,(z,r) in enumerate(rings):
        for i,(x,y) in enumerate(xy):vs.append((x*r,y*r,z-(.031 if i==6 and j==4 else 0)))
    fs=[tuple(reversed(range(n)))]
    for j in range(4):fs += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n)]
    # True continuous rim and a deep closed concave hollow.
    for j,(z,r) in enumerate([(.424,.21/.27),(.36,.20/.27),(.235,.180/.27),(.145,.170/.27),(.135,.130/.27)]):
        for i,(x,y) in enumerate(xy):vs.append((x*r,y*r,z-(.025 if i==6 and j==0 else 0)))
        ring=5+j
        fs += [((ring-1)*n+i,(ring-1)*n+(i+1)%n,ring*n+(i+1)%n,ring*n+i) for i in range(n)]
    fs.append(tuple(range(9*n,10*n)))
    bowl=mesh('Eight sided hollow stone bowl',vs,fs,stone,'bowl');bowl.data.materials.append(edge)
    bowl.data.materials.append(mat('stone','hollow walls',factor=.74))
    bowl.data.materials.append(mat('stone','hollow floor',factor=.58))
    for p in bowl.data.polygons:
        if 31<=p.index<=40:p.material_index=1
        elif p.index>50:p.material_index=2 if p.index<80 else 3
    # Three flat feet splay out to the 0.60 x 0.60 footprint.
    for i,(bx,by,tx,ty,w,d) in enumerate([(-.205,-.205,-.160,-.160,.190,.190),(.205,-.205,.160,-.160,.190,.190),(0,.205,0,.165,.140,.190)]):
        vs=[]
        for cx,cy,z,wx,dy in [(bx,by,0,w,d),(tx,ty,.070,.17 if i==2 else .20,.20)]:vs += [(cx-wx/2,cy-dy/2,z),(cx+wx/2,cy-dy/2,z),(cx+wx/2,cy+dy/2,z),(cx-wx/2,cy+dy/2,z)]
        mesh('Stone foot '+str(i+1),vs,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],stone,'feet',.002)
    vs=[(x*r,y*r,z) for z,r in [(.225,.931),(.265,.977),(.305,.989)] for x,y in xy]
    fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(2) for i in range(n)]
    band=mesh('Eight centimetre hide waist wrap',vs,fs,hide,'hide_band')
    sol=band.modifiers.new('Hide thickness','SOLIDIFY');sol.thickness=.004
    # Two continuous turns, each formed from three visible twisted strands.
    path=[]
    for k in range(2):
        for j in range(n):
            rr=.970+k*.012
            p=Vector((xy[j][0]*rr,xy[j][1]*rr,.251+k*.012));q=Vector((xy[(j+1)%n][0]*rr,xy[(j+1)%n][1]*rr,.251+k*.012))
            for t in range(10):path.append(tuple(p.lerp(q,t/10)))
    path.append(path[0]);tube('Waist cord core',path,.0045,cord,6,'lashing')
    for strand in range(3):
        pts=[]
        for j,p in enumerate(path):
            v=Vector(p);rad=Vector((p[0],p[1],0)).normalized();ang=j*.95+strand*math.tau/3
            pts.append(tuple(v+rad*(.0045*math.cos(ang))+Vector((0,0,.0045*math.sin(ang)))))
        tube('Twisted waist fibre '+str(strand),pts,.0013,fibre,5,'lashing')
    for i,points in enumerate([[(-.010,-.277,.266),(-.026,-.286,.244),(-.018,-.286,.203),(-.034,-.279,.173)],[(.009,-.279,.264),(.027,-.286,.247),(.038,-.285,.211),(.030,-.278,.181)]]):
        tube('Cut cord tail '+str(i+1),points,.005,cord,7,'lashing')
        for j in range(3):
            p=points[-1];tube('Frayed plant fibre',[(p[0]+j*.001,p[1],p[2]),(p[0]+(j-1)*.003,p[1]-.002,p[2]-.009)],.0007,fibre,4,'lashing')
    tube('Crossed waist knot',[(-.018,-.281,.249),(.018,-.288,.269),(.025,-.286,.253),(-.011,-.288,.267),(-.018,-.281,.249)],.0055,cord,6,'lashing')
    # Club is exactly 0.38 along its axis and leans 30 degrees toward back-right.
    pestle=lathe('Stone club pestle',[(0,.035),(.025,.05),(.080,.05),(.27,.035),(.355,.035),(.38,.030)],stone,10,'pestle')
    direction=Vector((math.sin(math.pi/6)/math.sqrt(2),math.sin(math.pi/6)/math.sqrt(2),math.cos(math.pi/6)))
    pestle.rotation_euler=direction.to_track_quat('Z','Y').to_euler();pestle.location=(-.100,.065,0)
    bpy.context.view_layer.update();maxz=max((pestle.matrix_world@v.co).z for v in pestle.data.vertices);pestle.location.z=.50-maxz
    # Crusted powder, represented by the existing stone material.
    powder=mat('stone','ground powder',factor=1.04)
    cylinder('Powder crust in hollow',(0,0,.138),.125,.004,powder,14,'powder',0)
    for i in range(16):
        r=random.uniform(.025,.115);t=random.uniform(0,math.tau)
        o=lathe('Powder fleck',[(0,.004),(.003,.003)],powder,5,'powder');o.location=(r*math.cos(t),r*math.sin(t),.140)

def smithy():
    wood=mat('boards');iron=mat('iron');hide=mat('hide');end=mat('boards','cut end',factor=1.07)
    worktop=mat('boards','worktop')
    # Table top width 1.30, thickness .09. Four separate sawn planks.
    for i,(left,right) in enumerate([(-.800,.482),(-.783,.500),(-.795,.487),(-.788,.493)]):
        y=-.375+(i+.5)*.1875
        box('Tabletop plank '+str(i+1),((left+right)/2,y,.755),(right-left,.1825,.09),worktop,.005,'bench_top',grain=0)
    # Flat feet with square legs whose tops move inward; no tilted ground contacts.
    for x in [-.665,.310]:
        for y in [-.317,.317]:
            bx=x+(-.019 if x<0 else .019);by=y+(-.018 if y<0 else .018)
            vs=[]
            for cx,cy,z in [(bx,by,0),(x,y,.715)]:vs += [(cx-.061,cy-.061,z),(cx+.061,cy-.061,z),(cx+.061,cy+.061,z),(cx-.061,cy+.061,z)]
            fs=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
            mesh('Splayed square bench leg',vs,fs,wood,'legs',.004)
    for x in [-.674,.319]:box('Low side stretcher',(x,0,.156),(.102,.67,.105),wood,.004,'stretchers',grain=1)
    for i in range(4):box('Low shelf plank '+str(i+1),(-.177,-.25+i*.1667,.1775),(1.07,.159,.045),wood,.003,'shelf',grain=0)
    # Recessed wooden joinery marks are darkened boards, not added metal hardware.
    mark=mat('boards','nail holes',factor=.28,texture=False)
    for x in [-.665,.310]:
        for y in [-.337,.337]:cylinder('Old nail hole',(x,y,.80015),.0045,.0003,mark,7,'bench_top',0)
    for i,(x,y) in enumerate([(-.38,-.125),(-.12,-.07),(-.27,.10)]):
        o=taperbox('Trapezoid iron ingot '+str(i+1),(x,y,.231),(.235,.087),(.191,.062),.062,iron,'ingots');o.rotation_euler.z=(-.10 if i==1 else .04)
    # Stump tucked under the bench overhang, flat cut at ground and top.
    stump=cylinder('Round wooden anvil stump',(.600,-.200,.3375),.20,.675,wood,12,'stump',.003)
    # Broad polygon cuts and end-grain rings remain boards material.
    stump.data.materials.append(end);stump.data.polygons[1].material_index=1
    ringsmat=mat('boards','end grain lines',factor=.67)
    for rad in [.039,.073,.104,.141,.178]:
        pts=[(.600+rad*math.cos(j*math.tau/32),-.200+rad*math.sin(j*math.tau/32),.6753) for j in range(33)]
        tube('Stump growth ring',pts,.00065,ringsmat,4,'stump')
    for ang in [.2,2.5,4.7]:
        tube('End grain split',[(.600+r*math.cos(ang),-.200+r*math.sin(ang),.6755) for r in [.131,.169,.195]],.001,mark,4,'stump')
    # Anvil heel over the worktop; narrow waist clears its right edge.
    anvil_outline=[(.400,.675),(.768,.675),(.768,.719),(.679,.749),(.657,.817),(.651,.865),(.630,.873),(.180,.873),(.180,.950),(.630,.950),(.630,.891),(.589,.858),(.539,.813),(.526,.756),(.400,.719)]
    # Separate foot and web avoid a self-overlapping polygon at the head.
    foot=taperbox('Anvil flared foot',(.625,-.200,.701),(.330,.230),(.190,.166),.052,iron,'anvil')
    web=polyextrude('Anvil concave waist',[(.530,.724),(.711,.724),(.657,.771),(.651,.852),(.630,.889),(.310,.889),(.310,.866),(.539,.832),(.540,.775)],.111,iron,'anvil');web.location.y=-.200
    head=box('Anvil rectangular face',(.405,-.200,.9115),(.450,.140,.077),iron,.003,'anvil_face')
    # Through-cut square hardy hole in the heel.
    cutter=box('Hardy hole cutter',(.224,-.200,.923),(.027,.027,.160),iron,0,'temporary')
    mod=head.modifiers.new('Square hardy hole','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.context.view_layer.objects.active=head
    for m in list(head.modifiers):bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter,do_unlink=True);PARTS.pop('temporary',None);uv_map(head,0)
    # Faceted conical horn to the exact right box plane, with flattened upper face.
    vs=[]
    for x,ry,rz,zc in [(.625,.069,.032,.916),(.700,.049,.025,.921),(.765,.023,.013,.927),(.800,.003,.004,.933)]:
        for i in range(8):vs.append((x,-.2+ry*math.cos(i*math.tau/8),zc+rz*math.sin(i*math.tau/8)))
    fs=[tuple(reversed(range(8)))]+[(j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i) for j in range(3) for i in range(8)]+[tuple(range(24,32))]
    mesh('Faceted right-pointing horn',vs,fs,iron,'anvil_horn')
    # The one scorch is in the tabletop's board shader, with a ragged natural edge.
    # Hammer and tongs, safely inside the tabletop.
    handle=beam('Hammer timber handle',(-.425,-.210,.817),(-.18,.026,.817),.030,.034,wood,'hammer')
    box('Forged hammer head',(-.165,.043,.8425),(.145,.068,.085),iron,.008,'hammer',rot=(0,0,-.78))
    for i,sgn in enumerate([-1,1]):
        pts=[(-.105+sgn*.032,.275,.809),(.025+sgn*.025,.191,.809),(.106,.142,.812),(.185+sgn*.025,.090,.814),(.225+sgn*.031,.113,.814)]
        tube('Forged tongs arm '+str(i),pts,.009,iron,6,'tongs')
    cylinder('Tongs pivot',(.106,.142,.824),.017,.013,iron,10,'tongs',.001)
    # Post grows from the left back leg. Apron hangs from its forward-facing peg.
    box('Apron post',(-.665,.317,.9075),(.080,.080,.385),wood,.003,'apron_post',grain=2)
    cylinder('Wooden apron peg',(-.665,.242,1.062),.014,.10,wood,8,'apron_peg',.001,rot=(math.pi/2,0,0))
    # Deliberately small workshop apron, with a neck loop and visible faceted folds.
    tube('Leather apron neck loop',[(-.704,.199,1.019),(-.687,.190,1.067),(-.650,.190,1.075),(-.624,.195,1.019)],.007,hide,6,'apron')
    levels=[(1.027,.083),(1.004,.083),(.970,.121),(.822,.132),(.805,.128)]
    vs=[]
    for j,(z,half) in enumerate(levels):
        for k in range(7):
            x=-.665+(k/6*2-1)*half
            y=.187+(.010 if k%2 else -.009)+j*.002
            vs.append((x,y,z+(.006*math.cos(k*1.8) if j==4 else 0)))
    fs=[(j*7+k,j*7+k+1,(j+1)*7+k+1,(j+1)*7+k) for j in range(4) for k in range(6)]
    apron=mesh('Folded tanned hide apron',vs,fs,hide,'apron');sol=apron.modifiers.new('Leather thickness','SOLIDIFY');sol.thickness=.004

def bin_station():
    wood=mat('boards','cabinet');kiln=mat('kiln');clay=mat('kiln','pale mortar and clay',color=(168,132,100),texture=False)
    darkclay=mat('kiln','firebox interior',color=(80,74,68),factor=.22,texture=False)
    # Masonry has a real opening and continuous chamber, never a painted black arch.
    box('Firebox left clay core',(-.2825,0,.15),(.205,.670,.300),clay,.002,'firebox')
    box('Firebox right clay core',(.2825,0,.15),(.205,.670,.300),clay,.002,'firebox')
    box('Firebox back clay core',(0,.255,.15),(.38,.16,.30),clay,.002,'firebox')
    box('Firebox dark inner back',(0,.173,.112),(.38,.004,.174),darkclay,0,'firebox')
    box('Firebox bottom clay hearth',(0,0,.0125),(.80,.70,.025),clay,.002,'firebox')
    box('Firebox ceiling',(0,0,.255),(.38,.66,.09),clay,.002,'firebox')
    # Polygonal arch spans .36 and rises .18 from the hearth surface at .025.
    inner=[(-.18,.025),(-.18,.105),(-.166,.144),(-.130,.178),(-.070,.199),(0,.205),(.070,.199),(.130,.178),(.166,.144),(.18,.105),(.18,.025)]
    for i in range(1,9):
        x1,z1=inner[i];x2,z2=inner[i+1]
        # voussoir tops form the .30 m lintel line
        vs=[(x1,-.333,z1),(x2,-.333,z2),(x2,-.333,.30),(x1,-.333,.30),(x1,-.18,z1),(x2,-.18,z2),(x2,-.18,.30),(x1,-.18,.30)]
        fs=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        mesh('Clay arch wedge '+str(i),vs,fs,clay,'firebox')
    # Large, countable faceted fieldstones bedded in the clay core.
    stone_variants=[mat('kiln','fieldstone '+str(i),factor=f) for i,f in enumerate([.92,1.03,.98,1.10])]
    def fieldstone(name,centre,dims):
        o=box(name,centre,dims,random.choice(stone_variants),.010,'firebox')
        for v in o.data.vertices:
            for axis in range(3):v.co[axis]*=random.uniform(.91,1.0)
        o.data.update();return o
    for side in [-1,1]:
        for row in range(3):
            for k in range(3):
                x=side*.340;y=-.230+k*.230;z=.051+row*.098
                # The side courses stay inside the exact exterior planes.
                fieldstone('Fire-blackened side fieldstone',(x,y,z),(.120,.220,.090))
        for row in range(2):
            fieldstone('Front jamb stone',(side*(.285 if row==0 else .3275),-.307,.068+row*.105),(.210 if row==0 else .125,.080,.096))
        fieldstone('Front upper shoulder stone',(side*.2975,-.309,.256),(.185,.078,.075))
    for i in range(1,9):
        x1,z1=inner[i];x2,z2=inner[i+1];gap=.003
        def outward(x,z):
            r=math.hypot(x,z-.105)
            return (x*(1+.075/r),.105+(z-.105)*(1+.075/r))
        ox1,oz1=outward(x1,z1);ox2,oz2=outward(x2,z2)
        outline=[(x1+gap,z1+.003),(x2-gap,z2+.003),(ox2-gap,oz2-.002),(ox1+gap,oz1-.002)]
        o=polyextrude('Dark arch voussoir '+str(i),outline,.052,kiln,'firebox');o.location.y=-.324
    for row in range(3):
        for i in range(3):fieldstone('Rear fieldstone',(-.263+i*.263,.308,.051+row*.098),(.251,.079,.089))
    # Shallow open clay tray, clearly separate from the masonry opening.
    box('Tray base',(0,-.236,.039),(.330,.207,.018),clay,.005,'tray')
    for x in [-.158,.158]:box('Tray side rim',(x,-.236,.054),(.016,.207,.027),clay,.004,'tray')
    for y in [-.332,-.140]:box('Tray end rim',(0,y,.054),(.302,.016,.027),clay,.004,'tray')
    # Identical coarse pile in both states. Flat fire swatches, no emissive bounce.
    orange=firemat('orange coals',(238,120,30));yellow=firemat('yellow heart',(255,210,80))
    for row in range(3):
        for i in range(5):
            x=-.120+i*.060+random.uniform(-.008,.008);y=-.297+row*.061+random.uniform(-.007,.007)
            z=.057+(.015 if row==1 and i in [1,2,3] else 0)
            o=lathe('Sparkpowder coal',[(0,.030),(.019,.035),(.038,.021),(.043,.008)],orange,5,'fuel');o.location=(x,y,z);o.rotation_euler.z=random.random()
            if row==0 and i in [1,2,3]:
                o.data.materials.append(yellow)
                for p in o.data.polygons:
                    if p.index in [7,8,11,12,13,14,15,16]:p.material_index=1
    # Cabinet bounds: .72 x .62, from Z .30 to 1.00.
    insidewood=mat('boards','dark interior',factor=.16)
    def interior(o,axis,sgn):
        o.data.materials.append(insidewood)
        for f in o.data.polygons:
            if f.normal[axis]*sgn>.8:f.material_index=1
        return o
    for x in [-.325,.325]:
        for y in [-.275,.275]:box('Cabinet corner post',(x,y,.650),(.070,.070,.700),wood,.005,'cabinet',grain=2)
    # Side and back vertical slats, with real 8 mm gaps.
    for side in [-1,1]:
        for i in range(5):interior(box('Cabinet side vertical board',(side*.337,-.215+i*.1075+(.025 if side<0 else 0),.650),(.040,.0995,.658),wood,.003,'cabinet',grain=2),0,-side)
    for i in range(6):interior(box('Cabinet back vertical board',(-.266+i*.1064,.287,.650),(.0984,.044,.658),wood,.003,'cabinet',grain=2),1,-1)
    for z in [.329,.969]:
        box('Cabinet rear frame rail',(0,.273,z),(.580,.060,.058),wood,.003,'cabinet',grain=0)
        for x in [-.320,.320]:box('Cabinet side frame rail',(x,0,z),(.058,.51,.058),wood,.003,'cabinet',grain=1)
    # Door occupies almost the entire front; frame and five vertical boards.
    for i in range(5):interior(box('Door vertical board '+str(i+1),(-.216+i*.108,-.278,.644),(.100,.048,.616),wood,.003,'door',grain=2),1,1)
    for x in [-.268,.268]:box('Door upright stile',(x,-.286,.644),(.042,.050,.636),wood,.003,'door',grain=2)
    for z in [.344,.944]:box('Door horizontal rail',(0,-.300,z),(.577,.020,.044),wood,.002,'door',grain=0)
    for z in [.438,.848]:
        box('Wooden hinge block',(-.300,-.324,z),(.110,.048,.064),wood,.005,'hinges',grain=0)
        cylinder('Wood hinge pin',(-.292,-.324,z),.018,.083,wood,8,'hinges',.002)
    cylinder('Turn latch wooden pivot',(.291,-.320,.650),.020,.044,wood,10,'latch',.002,rot=(math.pi/2,0,0))
    box('Chunky wooden turn latch',(.281,-.338,.650),(.119,.023,.038),wood,.004,'latch',rot=(0,-.18,0),grain=0)
    # Sloped gable boards: outer lid .78 x .68; top ridge exactly 1.12.
    roofrise=.120;run=.390
    for side in [-1,1]:
        for i in range(6):
            y0=-.340+i*(.680/6);y1=y0+.680/6-.003
            vs=[(0,y0,1.120),(side*run,y0,1.000),(side*run,y1,1.000),(0,y1,1.120),
                (0,y0,1.092),(side*run,y0,.972),(side*run,y1,.972),(0,y1,1.092)]
            fs=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
            mesh('Pitched lid plank',vs,fs,wood,'lid',.002)
    for y in [-.304,.304]:
        for i in range(6):
            x0=-.299+i*.0997;x1=x0+.0967
            zz=lambda x:1.092-abs(x)*(.120/.390)
            o=polyextrude('Vertical plank gable',[(x0,.990),(x1,.990),(x1,zz(x1)),(x0,zz(x0))],.018,wood,'lid');o.location.y=y
    # Narrow timber vent and separate raised cap create a readable chimney slot.
    for x in [-.052,.052]:box('Vent side',(x,.125,1.1265),(.018,.104,.077),wood,.002,'vent',grain=2)
    for y in [.082,.168]:box('Vent front back',(0,y,1.1265),(.086,.018,.077),wood,.002,'vent',grain=2)
    for x in [-.045,.045]:
        for y in [.090,.160]:box('Vent cap support',(x,y,1.178),(.014,.014,.036),wood,.001,'vent',grain=2)
    box('Little vent cap',(0,.125,1.192),(.158,.150,.016),mat('boards','vent cap',factor=.91),.003,'vent',grain=0)

def bounds(objects):
    dg=bpy.context.evaluated_depsgraph_get();points=[]
    for obj in objects:
        if obj.name not in bpy.data.objects:continue
        ev=obj.evaluated_get(dg);me=ev.to_mesh()
        points.extend(ev.matrix_world@v.co for v in me.vertices);ev.to_mesh_clear()
    lo=[min(v[i] for v in points) for i in range(3)];hi=[max(v[i] for v in points) for i in range(3)]
    return {'min_xyz':lo,'max_xyz':hi,'size_xyz':[hi[i]-lo[i] for i in range(3)]}
def measures(station):
    spec=SPECS[station];w,h,d=spec['box'];obs=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('station')==station]
    data={'station':station,'units':'metres','axis':'X right, Y back, Z up; front looks along +Y',
          'specified_box_whd':spec['box'],'pixels_per_metre':spec['ppm'],'canvas':[1254,1254],
          'box_center_pixel':[627,627],'box_center_world':[0,0,h/2],'geometry':bounds(obs),
          'parts':{k:bounds(v) for k,v in PARTS.items() if v},'material_families':sorted(set(m['material_family'] for o in obs for m in o.data.materials)),
          'shared_geometry_in_all_views':True,'part_objects':{k:[o.name for o in v] for k,v in PARTS.items()}}
    lo=data['geometry']['min_xyz'];hi=data['geometry']['max_xyz']
    data['outside_box_metres']=[max(0,-w/2-lo[0],hi[0]-w/2),max(0,-d/2-lo[1],hi[1]-d/2),max(0,-lo[2],hi[2]-h)]
    data['feature_measurements']={}
    fm=data['feature_measurements']
    if station=='mortar':
        pestle=PARTS['pestle'][0];v=[q.co for q in pestle.data.vertices]
        fm['pestle_axial_length']=max(q.z for q in v)-min(q.z for q in v)
        fm['pestle_grip_diameter']=2*max(math.hypot(q.x,q.y) for q in v if .26<q.z<.36)
        fm['pestle_grinding_diameter']=2*max(math.hypot(q.x,q.y) for q in v)
        fm['pestle_lean_degrees']=math.degrees((pestle.matrix_world.to_3x3()@Vector((0,0,1))).angle(Vector((0,0,1))))
        b=PARTS['bowl'][0];fm['lip_thickness']=b.data.vertices[40].co.x-b.data.vertices[50].co.x
        profiles=[(.135,.130),(.145,.170),(.235,.180),(.360,.200),(.424,.210),(.430,.210)]
        clear=[]
        for vertex in pestle.data.vertices:
            point=pestle.matrix_world@vertex.co
            if point.z>.430:continue
            radius=profiles[0][1]
            for (za,ra),(zb,rb) in zip(profiles,profiles[1:]):
                if za<=point.z<=zb:radius=ra+(rb-ra)*(point.z-za)/(zb-za);break
            clear += [radius-abs(point.x),radius-abs(point.y),(radius*math.sqrt(2)-abs(point.x)-abs(point.y))/math.sqrt(2)]
        fm['pestle_min_hollow_clearance']=min(clear)
    if station=='bin':
        arch=[o for o in PARTS['firebox'] if o.name.startswith('Clay arch wedge')]
        pts=[o.matrix_world@o.data.vertices[i].co for o in arch for i in [0,1]]
        fm['arch_width']=max(q.x for q in pts)-min(q.x for q in pts)
        hearth=next(o for o in PARTS['firebox'] if o.name.startswith('Firebox bottom'))
        fm['arch_height']=max(q.z for q in pts)-bounds([hearth])['max_xyz'][2]
    (ROOT/'checks'/f'{station}_geometry.json').write_text(json.dumps(data,indent=2))
    print('MEASURE',station,json.dumps(data['geometry']),flush=True)
    if max(data['outside_box_metres'])>.0001:print('WARNING OUTSIDE BOX',data['outside_box_metres'],flush=True)

def aim(o,at):o.rotation_euler=(Vector(at)-o.location).to_track_quat('-Z','Y').to_euler()
def setup_scene():
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=args.samples;scene.cycles.use_denoising=True
    scene.render.resolution_x=args.resolution;scene.render.resolution_y=args.resolution;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8';scene.render.film_transparent=True
    scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    world=bpy.data.worlds.new('Neutral daylight');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(1,1,1,1);world.node_tree.nodes['Background'].inputs[1].default_value=.78;scene.world=world
    ld=bpy.data.lights.new('Broad soft daylight','AREA');ld.energy=150;ld.shape='DISK';ld.size=5
    light=bpy.data.objects.new('Broad soft daylight',ld);scene.collection.objects.link(light);light.location=(-3,-4,6);aim(light,(0,0,.4))
    scene.render.threads_mode='FIXED';scene.render.threads=12
    camera=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',camera);scene.collection.objects.link(cam);scene.camera=cam
    return scene,cam
def render_station(station):
    global STATION,PARTS,MATS,MODES,FIRE
    random.seed({'mortar':2319,'smithy':2319,'bin':2419}[station])
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    STATION=station;PARTS={};MATS={};MODES=[];FIRE=[]
    {'mortar':mortar,'smithy':smithy,'bin':bin_station}[station]()
    bpy.context.view_layer.update();measures(station)
    scene,cam=setup_scene();w,h,d=SPECS[station]['box'];ppm=SPECS[station]['ppm']
    views=['front','side','top','back','hero'] if args.views=='all' else args.views.split(',')
    if station=='bin' and args.views=='all':views+=['front_lit','hero_lit']
    for view in views:
        lit=view.endswith('_lit');base=view.replace('_lit','');hero=base=='hero'
        for em,rgb in FIRE:em.inputs['Color'].default_value=rgba(rgb if lit else (96,92,88))
        for m in MODES:m.inputs[0].default_value=1 if hero else 0
        # Soft form direction follows each elevation, with modest top weighting.
        dirs={'front':(.12,-.48,.87),'side':(.48,-.12,.87),'back':(-.12,.48,.87),'top':(.12,-.18,.975)}
        for matl in MATS.values():matl.node_tree.nodes['Plate direction'].inputs[1].default_value=dirs.get(base,dirs['front'])
        target=(0,0,h/2)
        if hero:
            cam.data.type='PERSP';cam.location=(1.5,-2.598076211,1.6) if station=='mortar' else (2.12,-2.12,1.6);aim(cam,(0,0,h*.46))
            # True standing eye at three metres; focal length is adapted for page occupancy.
            cam.data.lens={'mortar':102,'smithy':58,'bin':66}[station];cam.data.sensor_width=36
        else:
            cam.data.type='ORTHO';cam.data.ortho_scale=1254/ppm
            cam.location={'front':(0,-5,h/2),'side':(5,0,h/2),'top':(0,0,5+h/2),'back':(0,5,h/2)}[base]
            aim(cam,target)
            if base=='top':cam.rotation_euler=(0,0,0)
        # Orthos use the camera/geometry exactly; no contact shadow in their output.
        scene.cycles.samples=args.samples if hero else 8
        scene.cycles.use_denoising=hero
        scene.render.filepath=str(ROOT/'renders'/f'{station}_{view}_rgba.png')
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'{station}.blend')) if view==views[0] else None
        bpy.ops.render.render(write_still=True)
        if hero:
            # Render a ground shadow separately; the inventory mask remains the real object alpha.
            groundmat=bpy.data.materials.get('Neutral ground')
            if groundmat is None:
                groundmat=bpy.data.materials.new('Neutral ground');groundmat.diffuse_color=rgba(BG);groundmat.use_nodes=True
                bs=groundmat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=rgba(BG);bs.inputs['Roughness'].default_value=1;bs.inputs['Specular IOR Level'].default_value=0
            ground=box('Temporary neutral ground',(0,0,-.021),(200,200,.04),groundmat,0,'temporary_ground')
            ground.is_shadow_catcher=True
            scene.render.filepath=str(ROOT/'renders'/f'{station}_{view}_ground.png');bpy.ops.render.render(write_still=True)
            bpy.data.objects.remove(ground,do_unlink=True);PARTS.pop('temporary_ground',None)
        print('FINISHED',station,view,flush=True)
    scene['concept_spec']=json.dumps(SPECS[station]);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'{station}.blend'))
    print('STATION SECONDS',station,time.time()-START,flush=True)

if __name__=='__main__':
    for s in SPECS if args.station=='all' else [args.station]:render_station(s)
    # All artifacts are saved. Avoid desktop audio/add-on shutdown handlers in headless runs.
    sys.stdout.flush();sys.stderr.flush();os._exit(0)
