"""Build dimensioned tool masters and orthographic RGBA plates. Blender 5.x.
All geometry is in metres. Run from the concept directory.
"""
import bpy, math, random, json, sys, time
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.geometry import delaunay_2d_cdt
ROOT=Path(__file__).resolve().parents[1]
random.seed(8127)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for x in list(bpy.data.materials): bpy.data.materials.remove(x)
SC=bpy.context.scene
SC.render.engine='CYCLES'; SC.cycles.samples=32; SC.cycles.use_denoising=False
SC.render.resolution_x=1254; SC.render.resolution_y=1254; SC.render.resolution_percentage=100
SC.render.image_settings.file_format='PNG'; SC.render.image_settings.color_mode='RGBA'; SC.render.film_transparent=True
SC.view_settings.view_transform='Standard'; SC.view_settings.look='None'; SC.view_settings.exposure=0; SC.view_settings.gamma=1
SC.render.image_settings.color_depth='8'
SC.world.color=(.25,.25,.25)
SC.unit_settings.system='METRIC'
TOOL=None
GROUPS={}; COMPONENTS={}; MATERIALS=[]

def lin(v):
    v=v/255
    return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4

def rgb(h):
    return tuple(lin(int(h[i:i+2],16)) for i in (0,2,4))+(1,)

def node(t,k): return t.nodes.new(k)
def mathn(t,op,a,b=None):
    n=node(t,'ShaderNodeMath');n.operation=op
    if hasattr(a,'node'): t.links.new(a,n.inputs[0])
    else:n.inputs[0].default_value=a
    if b is not None:
        if hasattr(b,'node'):t.links.new(b,n.inputs[1])
        else:n.inputs[1].default_value=b
    return n.outputs[0]
def vm(t,op,a,b=None):
    n=node(t,'ShaderNodeVectorMath');n.operation=op
    for k,v in enumerate([a,b]):
        if v is None: continue
        if hasattr(v,'node'):t.links.new(v,n.inputs[k])
        else:n.inputs[k].default_value=v
    return n.outputs['Value'] if op in ['LENGTH','DISTANCE','DOT_PRODUCT'] else n.outputs['Vector']
def mixc(t,f,a,b):
    n=node(t,'ShaderNodeMixRGB');n.blend_type='MIX'
    for k,v in enumerate([f,a,b]):
        if hasattr(v,'node'):t.links.new(v,n.inputs[k])
        else:n.inputs[k].default_value=v
    return n.outputs[0]
def multc(t,a,b):
    n=node(t,'ShaderNodeMixRGB');n.blend_type='MULTIPLY';n.inputs[0].default_value=1
    for k,v in enumerate([a,b],1):
        if hasattr(v,'node'):t.links.new(v,n.inputs[k])
        else:n.inputs[k].default_value=v
    return n.outputs[0]
def noise(t,v,scale,detail=2):
    n=node(t,'ShaderNodeTexNoise'); t.links.new(v,n.inputs['Vector']); n.inputs['Scale'].default_value=scale;n.inputs['Detail'].default_value=detail;n.inputs['Roughness'].default_value=.68
    return n.outputs['Fac']
def separate(t,v):
    n=node(t,'ShaderNodeSeparateXYZ');t.links.new(v,n.inputs[0]);return n.outputs

def finish_material(m,color,bump=None,rough=.85):
    t=m.node_tree
    geo=node(t,'ShaderNodeNewGeometry')
    dot=node(t,'ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';dot.name='VIEW_NORMAL';dot.inputs[1].default_value=(1,0,0);t.links.new(geo.outputs['Normal'],dot.inputs[0])
    low=.36 if m.name.startswith('Plant fibre') else .64
    light=mathn(t,'ADD',low,mathn(t,'MULTIPLY',1-low,mathn(t,'ABSOLUTE',dot.outputs['Value'])))
    ec=multc(t,color,light)
    em=node(t,'ShaderNodeEmission');t.links.new(ec,em.inputs['Color']);em.inputs['Strength'].default_value=1
    bs=node(t,'ShaderNodeBsdfPrincipled');t.links.new(color,bs.inputs['Base Color']);bs.inputs['Roughness'].default_value=rough;bs.inputs['Specular IOR Level'].default_value=.22
    if bump is not None:
        bn=node(t,'ShaderNodeBump');bn.inputs['Strength'].default_value=.18;bn.inputs['Distance'].default_value=.00018;t.links.new(bump,bn.inputs['Height']);t.links.new(bn.outputs[0],bs.inputs['Normal'])
    sw=node(t,'ShaderNodeMixShader');sw.name='HERO_SWITCH';sw.inputs[0].default_value=0;t.links.new(em.outputs[0],sw.inputs[1]);t.links.new(bs.outputs[0],sw.inputs[2]);out=node(t,'ShaderNodeOutputMaterial');t.links.new(sw.outputs[0],out.inputs[0]);MATERIALS.append(m)
    return m

def material_start(name):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.clear();t=m.node_tree
    tc=node(t,'ShaderNodeTexCoord')
    return m,t,tc.outputs['Object'],tc.outputs['UV']

m,t,p,uv=material_start('Wood | stripped honey branch, pale hand wear')
tex=node(t,'ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'textures/wood_albedo.png'));tex.image.pack();tex.extension='REPEAT';t.links.new(uv,tex.inputs[0]);bw=node(t,'ShaderNodeRGBToBW');t.links.new(tex.outputs['Color'],bw.inputs[0])
texmod=mathn(t,'ADD',.60,mathn(t,'MULTIPLY',1.25,bw.outputs[0]))
z=separate(t,p)['Z'];wear=mathn(t,'MAXIMUM',0,mathn(t,'SUBTRACT',1,mathn(t,'DIVIDE',mathn(t,'ABSOLUTE',z),.095)))
color=mixc(t,wear,rgb('A4784C'),rgb('B88C5C'));color=multc(t,color,texmod)
WOOD=finish_material(m,color,bw.outputs[0],.86)

m,t,p,uv=material_start('Wood | exposed broken end grain')
q=vm(t,'MULTIPLY',p,(1,1,0));r=vm(t,'LENGTH',q);wave=mathn(t,'SINE',mathn(t,'MULTIPLY',r,3600));n=noise(t,p,850)
c=mixc(t,mathn(t,'ADD',.35,mathn(t,'MULTIPLY',.1,wave)),rgb('9D744D'),rgb('C19A67'));c=multc(t,c,mathn(t,'ADD',.88,mathn(t,'MULTIPLY',.2,n)))
ENDWOOD=finish_material(m,c,n)
m,t,p,uv=material_start('Bark | small retained grey brown rind')
n=noise(t,vm(t,'MULTIPLY',p,(3,3,.28)),600);c=mixc(t,n,rgb('38291F'),rgb('65503B'));BARK=finish_material(m,c,n,.97)
m,t,p,uv=material_start('Plant fibre | straw with green cast')
n=noise(t,p,2100);c=mixc(t,n,rgb('887440'),rgb('A78F51'));CORD=finish_material(m,c,n,.92)
m,t,p,uv=material_start('Plant fibre | finer strands')
n=noise(t,p,3300);c=mixc(t,n,rgb('AA9356'),rgb('BEA86B'));FIBRE=finish_material(m,c,n,.95)


def segment_distance(t,p,a,b):
    d=Vector(b)-Vector(a);q=vm(t,'SUBTRACT',p,a);dot=vm(t,'DOT_PRODUCT',q,tuple(d));f=mathn(t,'DIVIDE',dot,d.length_squared);f=mathn(t,'MINIMUM',1,mathn(t,'MAXIMUM',0,f))
    n=node(t,'ShaderNodeVectorMath');n.operation='SCALE';n.inputs[0].default_value=tuple(d);t.links.new(f,n.inputs[3]);foot=vm(t,'ADD',n.outputs[0],a)
    return vm(t,'DISTANCE',p,foot)

def stone_material(tool,idx,center,edge_segments):
    m,t,p,uv=material_start(f'{tool} | flake {idx:02d}')
    ispick=tool=='pick';variation=random.uniform(.82,1.13)
    c=rgb('807E78' if ispick else '4A484C');c=tuple(v*variation for v in c[:3])+(1,)
    profile=vm(t,'MULTIPLY',p,(0,1,1) if tool!='spear' else (1,0,1))
    rad=vm(t,'DISTANCE',profile,center)
    # Radial conchoidal rings with extremely low amplitude, plus fine natural speckle.
    ns=noise(t,p,440,2);phase=mathn(t,'ADD',mathn(t,'MULTIPLY',rad,3400),mathn(t,'MULTIPLY',ns,1.8))
    wave=mathn(t,'SINE',phase);rip=mathn(t,'ADD',.985,mathn(t,'MULTIPLY',.022,wave));fine=noise(t,p,2400,2)
    speck=mathn(t,'ADD',.87,mathn(t,'MULTIPLY',.26,fine));mod=mathn(t,'MULTIPLY',rip,speck)
    mod=mathn(t,'MULTIPLY',mod,mathn(t,'ADD',.87,mathn(t,'MULTIPLY',.26,noise(t,p,180,3))))
    if ispick:
        yy=separate(t,p)['Y'];fresh=mathn(t,'GREATER_THAN',yy,.165);fc=rgb('A8A49C')
    else:
        distances=[segment_distance(t,profile,a,b) for a,b in edge_segments]
        dist=distances[0]
        for d in distances[1:]: dist=mathn(t,'MINIMUM',dist,d)
        fresh=mathn(t,'LESS_THAN',dist,.008);fc=rgb('9C9890')
    color=mixc(t,fresh,c,fc)
    if not ispick:
        xyz=separate(t,p)
        if tool=='hatchet':
            q=vm(t,'MULTIPLY',vm(t,'SUBTRACT',p,(0,-.034,.305)),(0,1/.012,1/.027));r=vm(t,'LENGTH',q)
            cortex=mathn(t,'LESS_THAN',mathn(t,'ADD',r,mathn(t,'MULTIPLY',noise(t,p,650),.22)),1)
        else:
            q=vm(t,'MULTIPLY',vm(t,'SUBTRACT',p,(-.010,0,1.325)),(1/.008,0,1/.018));r=vm(t,'LENGTH',q)
            cortex=mathn(t,'MULTIPLY',mathn(t,'GREATER_THAN',xyz['Y'],0),mathn(t,'LESS_THAN',mathn(t,'ADD',r,mathn(t,'MULTIPLY',noise(t,p,650),.23)),1))
        color=mixc(t,cortex,color,rgb('C8BCA4'))
    color=multc(t,color,mod)
    return finish_material(m,color,mathn(t,'ADD',fine,mathn(t,'MULTIPLY',wave,.12)),.82 if ispick else .69)


def mesh(name,verts,faces,mat,kind,uvs=None,smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    if isinstance(mat,list):
        for m in mat:me.materials.append(m)
    else:me.materials.append(mat)
    if uvs:
        layer=me.uv_layers.new(name='Material coordinates')
        for poly in me.polygons:
            for li in poly.loop_indices:layer.data[li].uv=uvs[me.loops[li].vertex_index]
    for poly in me.polygons:poly.use_smooth=smooth
    # Recalculate consistent outward normals.
    bpy.context.view_layer.objects.active=ob;ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
    ob['tool']=TOOL;ob['component']=kind
    GROUPS[TOOL].append(ob);COMPONENTS[TOOL].setdefault(kind,[]).append(ob)
    return ob

def centerline(tool,z):
    if tool=='spear':
        # Even bow, origin at grip, 8 mm maximum deviation from endpoint chord.
        return (0,.008/(.95*.95)*z*(z-1.3))
    values=[(-.12,0),(0,0),(.07,.002),(.15,.006),(.22,.003),(.28,0),(.385,0)]
    for (a,v),(b,w) in zip(values,values[1:]):
        if a<=z<=b:
            k=(z-a)/(b-a);return (0,(v+(w-v)*k)*(-1 if tool=='pick' else 1))
    return (0,0)

def shaft(tool):
    if tool=='spear':
        rings=[(-.60,.001),(-.597,.009),(-.590,.013),(-.48,.0133),(0,.014),(.3,.0137),(.6,.013),(1,.0119),(1.2,.0114),(1.25,.0112),(1.295,.011),(1.3,.010)]
    else:
        rings=[(-.12,.019),(-.112,.0188),(-.095,.0157),(-.06,.0152),(0,.015),(.03,.0149),(.07,.0148),(.1,.0145),(.15,.0142),(.2,.014),(.24,.0137),(.265,.0135),(.29,.0135),(.335,.0135),(.36,.0134),(.377,.0126),(.383,.008),(.385,.002)]
    n=12;verts=[];uvs=[]
    for j,(z,r) in enumerate(rings):
        cx,cy=centerline(tool,z)
        for i in range(n):
            a=i*2*math.pi/n;var=1+.018*math.sin(a*3+j*.7)
            zz=z+(0.0015*(.5+.5*math.sin(a*3)) if j==0 and tool!='spear' else 0)
            verts.append((cx+r*math.cos(a)*var,cy+r*math.sin(a)*var,zz));uvs.append((i/n,(z+.6)/.60))
    faces=[]
    for j in range(len(rings)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(rings)-1)*n+i for i in range(n))])
    ob=mesh(tool+' | stripped branch',verts,faces,[WOOD,ENDWOOD],'haft',uvs)
    ob.data.polygons[-1].material_index=1;ob.data.polygons[-2].material_index=1
    if tool!='pick':
        # A real split slot leaves paired wooden cheeks around the stone tongue.
        bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,.290 if tool=='hatchet' else 1.295))
        cutter=bpy.context.object;cutter.name='temporary split cutter'
        cutter.dimensions=(.024,.10,.080) if tool=='hatchet' else (.10,.013,.09)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        mod=ob.modifiers.new('stone seating split','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    # Small retained bark flake on the +X/+Y quarter, shared by every projection.
    z0=.2 if tool!='spear' else .60;rad=.014 if tool!='spear' else .013
    angles=[-.12,.24,.48,.72,.91];zends=[(-.009,.010),(-.015,.014),(-.013,.017),(-.009,.011),(-.005,.006)]
    vv=[]
    for a,(lo,hi) in zip(angles,zends):
        for z in [z0+lo,z0+hi]:
            cx,cy=centerline(tool,z);vv.append((cx+(rad+.00023)*math.cos(a),cy+(rad+.00023)*math.sin(a),z))
    ff=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(angles)-1)]
    mesh(tool+' | retained bark patch',vv,ff,BARK,'bark')
    if tool!='spear':
        z=.1 if tool=='pick' else .03;cx,cy=centerline(tool,z)
        start=Vector((cx,cy-.013,z)) if tool=='pick' else Vector((cx+.013,cy,z))
        axis=Vector((0,-1,0)) if tool=='pick' else Vector((1,0,0))
        u=Vector((1,0,0)) if tool=='pick' else Vector((0,1,0));v=Vector((0,0,1));vv=[];uv=[]
        for j,(d,r) in enumerate([(0,.0052),(.006,.005),(.014,.005)]):
            for i in range(10):
                a=i*2*math.pi/10;vv.append(tuple(start+axis*d+u*(r*math.cos(a))+v*(r*math.sin(a))));uv.append((i/10,j*.1))
        ff=[(j*10+i,j*10+(i+1)%10,(j+1)*10+(i+1)%10,(j+1)*10+i) for j in range(2) for i in range(10)]+[tuple(range(20,30))]
        ob=mesh(tool+' | one flat severed twig',vv,ff,[WOOD,ENDWOOD],'stub',uv);ob.data.polygons[-1].material_index=1
    else:
        # Embedded knot, not a protruding twig.
        vv=[(.01335,centerline(tool,.6)[1],.6)]
        for i in range(14):
            a=math.tau*i/14;vv.append((.0133,centerline(tool,.6)[1]+.003*math.cos(a),.6+.005*math.sin(a)))
        ff=[(0,i+1,(i+1)%14+1) for i in range(14)]
        mesh('spear | small healed knot',vv,ff,ENDWOOD,'knot')


def make_head(tool):
    if tool=='pick':
        # Profile coordinates are (Y,Z); thickness at root exactly 46 mm.
        outline=[(-.075,.289),(-.075,.330),(-.037,.338),(0,.339),(.074,.338),(.136,.320),(.185,.285),(.146,.292),(.065,.281),(0,.281)]
        inner=[(0,.310),(.090,.310)]
        thick=[.014,.014,.018,.018,.014,.007,.0009,.006,.013,.018,.023,.020]
    elif tool=='hatchet':
        # Rounded, lopsided flint: the fullest sweep is below the midpoint.
        # Coarse scar boundaries remain sparse; extra perimeter vertices make
        # smooth convex cutting arcs and two shallow shoulder flake notches.
        outline=[(-.035,.266),(-.035,.317),(0,.330),(.061,.365),(.104,.325),(.115,.278),(.112,.251),(.096,.225),(0,.250)]
        inner=[(.009,.289),(.066,.293)];thick=[.008,.008,.009,.0015,.0015,.0015,.0015,.0015,.009,.012,.009]
    else:
        outline=[(0,1.470),(.016,1.405),(.026,1.330),(.014,1.290),(.006,1.250),(-.006,1.250),(-.014,1.290),(-.026,1.330),(-.016,1.405)]
        inner=[(.001,1.335),(-.001,1.400)];thick=[.00035,.0009,.0012,.0014,.003,.003,.0014,.0012,.0009,.0065,.005]
    pts=outline+inner;n=len(pts);nb=len(outline)
    edges=[(i,(i+1)%nb) for i in range(nb)]
    if tool=='spear':edges.append((0,nb+1))  # Carry the central ridge all the way into the tip.
    res=delaunay_2d_cdt([Vector(p) for p in pts],edges,[list(range(nb))],1,1e-8)
    rv,re,rf,origv,_,_=res
    # Delaunay does not create Steiner points for these simple outlines.
    remap=[min(range(n),key=lambda j:(Vector(pts[j])-p).length) for p in rv]
    triangles=[[remap[i] for i in f] for f in rf]
    def coord(a,z,d):return (d,a,z) if tool!='spear' else (a,d,z)
    if tool=='hatchet':
        refinements={
            1:[(-.026,.326),(-.012,.330)],
            2:[(.016,.343),(.028,.350),(.032,.348),(.037,.356),(.048,.362)],
            3:[(.076,.357),(.088,.346),(.097,.335)],
            4:[(.110,.309),(.1135,.293)],
            5:[(.1145,.264)],
            6:[(.106,.235)],
            7:[(.083,.2248),(.070,.227),(.065,.232),(.059,.230),(.040,.235),(.020,.243)],
            8:[(-.020,.255),(-.030,.260)]}
        # The 0.225 lower edge station is exact; the shoulder never goes below it.
        refinements[7][0]=(.083,.226)
        coarse=outline[:]; oldtri=triangles[:]; oldthick=thick[:]
        outline=[]; thick=[]; chain={}; remapbase={}
        for j,a in enumerate(coarse):
            remapbase[j]=len(outline);outline.append(a);thick.append(oldthick[j])
            inserted=[];b=coarse[(j+1)%len(coarse)]
            for p in refinements.get(j,[]):
                inserted.append(len(outline));outline.append(p)
                # Boundary thickness follows original end stations; the entire
                # cutting arc retains its 3 mm edge thickness.
                dx,dz=b[0]-a[0],b[1]-a[1]
                f=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)))
                thick.append(oldthick[j]*(1-f)+oldthick[(j+1)%len(coarse)]*f)
            chain[(j,(j+1)%len(coarse))]=inserted
        nb=len(outline)
        for j in range(len(inner)):remapbase[len(coarse)+j]=nb+j
        pts=outline+inner;thick+=oldthick[len(coarse):];n=len(pts)
        triangles=[]
        for tri in oldtri:
            polygon=[]
            for a,b in zip(tri,tri[1:]+tri[:1]):
                polygon.append(remapbase[a])
                polygon+=chain.get((a,b),list(reversed(chain.get((b,a),[]))))
            triangles.append(polygon)
        cutting_indices=list(range(remapbase[3],remapbase[7]+1))
    verts=[coord(a,z,s*thick[i]) for s in [1,-1] for i,(a,z) in enumerate(pts)]
    faces=[];mats=[]
    if tool=='hatchet':cutpairs=list(zip(cutting_indices,cutting_indices[1:]))
    elif tool=='spear':cutpairs=[(i,i+1) for i in [0,1,2,6,7]]+[(8,0)]
    else:cutpairs=[]
    segs=[(coord(*outline[a],0),coord(*outline[b],0)) for a,b in cutpairs]
    for side in [0,1]:
        for tri in triangles:
            faces.append(tuple(i+side*n for i in tri))
            # Each flake's percussion center sits toward one perimeter corner.
            a,z=pts[tri[0]];cen=coord(a,z,0)
            mats.append(stone_material(tool,len(mats),cen,segs))
    for i in range(nb):faces.append((i,(i+1)%nb,(i+1)%nb+n,i+n))
    mats.append(stone_material(tool,len(mats),(0,0,.31 if tool!='spear' else 1.33),segs))
    ob=mesh(tool+' | knapped head',verts,faces,mats,'head')
    for i,poly in enumerate(ob.data.polygons):poly.material_index=min(i,len(mats)-1)
    return ob,{'outline':outline,'inner':inner,'front_facet_count':len(triangles),'thicknesses':thick}


def tube(name,points,r,material,kind='binding',sides=7):
    ps=[Vector(p) for p in points];verts=[]
    for i,p in enumerate(ps):
        tangent=(ps[min(i+1,len(ps)-1)]-ps[max(0,i-1)]).normalized()
        ref=Vector((0,0,1)) if abs(tangent.z)<.92 else Vector((0,1,0))
        u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
        for j in range(sides):
            a=math.tau*j/sides;verts.append(tuple(p+r*(u*math.cos(a)+v*math.sin(a))))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(len(ps)-1) for j in range(sides)]
    faces += [tuple(range(sides-1,-1,-1)),tuple((len(ps)-1)*sides+j for j in range(sides))]
    return mesh(name,verts,faces,material,kind,smooth=True)

def rope(name,points,r=.0021,kind='binding',fibres=True):
    tube(name+' | core',points,r*.76,CORD,kind,8)
    if not fibres:return
    ps=[Vector(p) for p in points];dist=0;strands=[[] for _ in range(3)]
    for i,p in enumerate(ps):
        if i:dist+=(p-ps[i-1]).length
        tangent=(ps[min(i+1,len(ps)-1)]-ps[max(0,i-1)]).normalized();ref=Vector((0,0,1)) if abs(tangent.z)<.92 else Vector((0,1,0));u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
        for k in range(3):
            a=dist/.008*math.tau+k*math.tau/3;strands[k].append(tuple(p+r*.62*(math.cos(a)*u+math.sin(a)*v)))
    for k,pts in enumerate(strands):tube(name+f' | twisted ply {k}',pts,r*.40,FIBRE,kind,7)

def band(name,zmin,zmax,rx,ry,turns,r=.0021):
    ps=[]
    for i in range(turns*100+1):
        f=i/(turns*100);a=f*turns*math.tau;z=zmin+r+f*(zmax-zmin-2*r);cx,cy=centerline(TOOL,z)
        ps.append((cx+rx*math.cos(a),cy+ry*math.sin(a),z))
    rope(name,ps,r)

def lerp_path(control,step=.00075):
    pts=[]
    for a,b in zip(control,control[1:]):
        a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/step))
        pts += [tuple(a.lerp(b,j/n)) for j in range(n)]
    pts.append(tuple(control[-1]));return pts

def bind(tool):
    if tool in ['pick','hatchet']:
        if tool=='pick':
            band('pick | lower winding',.265,.282,.0157,.0157,4)
            band('pick | upper winding',.340,.355,.0157,.0157,3)
            lo,hi=.276,.346
            start=(.010,-.014,.268)
        else:
            band('hatchet | lower winding',.220,.250,.0158,.0158,7)
            band('hatchet | upper winding',.335,.360,.0157,.0157,6)
            lo,hi=.242,.344
            start=(.010,-.014,.226)
        head=COMPONENTS[tool]['head'][0]
        def face_path(y1,z1,y2,z2,sign,k):
            ps=[]
            for i in range(151):
                f=i/150;y=y1*(1-f)+y2*f;z=z1*(1-f)+z2*f
                hit,loc,_,_=head.ray_cast(Vector((sign*.1,y,z)),Vector((-sign,0,0)))
                stone=abs(loc.x) if hit else 0
                cy=centerline(tool,z)[1]
                wood=math.sqrt(max(0,.0138**2-(y-cy)**2))
                # Tight cord sits directly on wood or stone, with two rope layers at X.
                x=max(stone,wood)+.0022+(.0012 if k==1 else 0)
                ps.append((sign*x,y,z))
            return ps
        for k in range(3):
            o=(k-1)*.0038
            # Two crossed, closed windings, tied into the upper/lower helical bands.
            for diag in [-1,1]:
                ylo=-diag*.012+o;yhi=diag*.012+o
                front=face_path(ylo,lo,yhi,hi,1,k)
                back=face_path(yhi,hi,ylo,lo,-1,k)
                # Connect through the wrap volumes at each end; no free spanning bars.
                bridge_hi=lerp_path([front[-1],(0,math.copysign(.016,yhi),hi),back[0]])
                bridge_lo=lerp_path([back[-1],(0,math.copysign(.016,ylo),lo),front[0]])
                path=front+bridge_hi[1:]+back[1:]+bridge_lo[1:]
                rope(tool+f' | figure eight {k+1} diagonal {diag}',path,.00205)
    else:
        band('spear | tight point socket winding',1.20,1.278,.014,.014,13,.003)
        head=COMPONENTS[tool]['head'][0];shaftob=COMPONENTS[tool]['haft'][0]
        def point_face(x1,z1,x2,z2,sign):
            ps=[]
            for j in range(71):
                f=j/70;x=x1*(1-f)+x2*f;z=z1*(1-f)+z2*f;ys=[]
                for ob in [head,shaftob]:
                    hit,loc,_,_=ob.ray_cast(Vector((x,sign*.1,z)),Vector((0,-sign,0)))
                    if hit:ys.append(abs(loc.y))
                y=max(ys or [0])+.00165
                ps.append((x,sign*y,z))
            return ps
        for k in range(2):
            o=(k-.5)*.0028
            for diagonal in [-1,1]:
                xlo=-diagonal*.009+o;xhi=diagonal*.011+o
                front=point_face(xlo,1.278,xhi,1.288,1)
                back=point_face(xhi,1.288,xlo,1.278,-1)
                bridge_hi=lerp_path([front[-1],(math.copysign(.0152,xhi),0,1.288),back[0]])
                bridge_lo=lerp_path([back[-1],(math.copysign(.014,xlo),0,1.278),front[0]])
                rope(f'spear | crossed point seat {k} diagonal {diagonal}',front+bridge_hi[1:]+back[1:]+bridge_lo[1:],.0016)
        start=(.010,-.010,1.203)
    # Two short, stiff, slightly splayed cord tails; spear forms a short buttward tuft.
    for k in range(2):
        if tool=='spear': end=tuple(Vector(start)+Vector((.008*(k+1),-.005*(k+1),-.032)).normalized()*.034)
        else:end=(start[0]+.004*(k+1),start[1]-.025-(k*.003),start[2]-.016+k*.016)
        mid=Vector(start).lerp(Vector(end),.6);mid.x+=.001
        rope(tool+f' | cut tail {k+1}',lerp_path([start,mid,end]),.002,'tails')
        # Fine cut fibre tips, only 1 mm beyond the severed ends.
        for j in range(3):
            e=Vector(end);d=(e-Vector(start)).normalized();tip=e+d*.001+Vector((j*.0003,0,(j-1)*.0003))
            tube(tool+f' | tail {k+1} cut fibres {j}',[e,tip],.00028,FIBRE,'tails',5)

HEAD_DATA={}
for tool in ['pick','hatchet','spear']:
    TOOL=tool;GROUPS[tool]=[];COMPONENTS[tool]={};shaft(tool);_,HEAD_DATA[tool]=make_head(tool);bind(tool)

# Export exact component bounds and geometry for audit, before posing for hero.
records={}
for tool,components in COMPONENTS.items():
    records[tool]={}
    for kind,objects in components.items():
        coords=[tuple(ob.matrix_world@v.co) for ob in objects for v in ob.data.vertices]
        mins=[min(v[i] for v in coords) for i in range(3)];maxs=[max(v[i] for v in coords) for i in range(3)]
        records[tool][kind]={'min_xyz_m':mins,'max_xyz_m':maxs,'dimensions_m':[b-a for a,b in zip(mins,maxs)],'objects':[ob.name for ob in objects]}
(ROOT/'checks/geometry.json').write_text(json.dumps({'components':records,'head_profiles':HEAD_DATA},indent=2))

camera_data=bpy.data.cameras.new('Dimensioned orthographic camera');CAM=bpy.data.objects.new('Dimensioned orthographic camera',camera_data);bpy.context.collection.objects.link(CAM);SC.camera=CAM
VIEWS={}
for tool in ['pick','hatchet']:
    for view in ['side','edge','end']:
        VIEWS[tool+'_'+view]={'tool':tool,'view':view,'ppm':2000,'col':400 if view!='end' else 627,'row':760 if view!='edge' else 627,'zref':0}
for view in ['side','edge']:
    VIEWS['spear_'+view]={'tool':'spear','view':view,'ppm':560,'col':376,'row':627,'zref':0}
    VIEWS['spear_head_'+view]={'tool':'spear','view':view,'ppm':2000,'col':247,'row':627,'zref':1.10}
VIEWS['spear_head_end']={'tool':'spear','view':'end','ppm':2000,'col':627,'row':627,'zref':0}
(ROOT/'checks/cameras.json').write_text(json.dumps(VIEWS,indent=2))


def set_camera(spec):
    v=spec['view'];ppm=spec['ppm'];col=spec['col'];row=spec['row'];zr=spec['zref']
    # Side definition in brief has opposite handedness to a physical camera.
    # Render physically from +X with -Z right, then reflect raster horizontally.
    if v=='side':right=Vector((0,0,-1));up=Vector((0,1,0));back=Vector((1,0,0));cc=1254-col
    elif v=='edge':right=Vector((0,0,1));up=Vector((1,0,0));back=Vector((0,1,0));cc=col
    else:right=Vector((1,0,0));up=Vector((0,1,0));back=Vector((0,0,1));cc=col
    anchor=Vector((0,0,zr))
    center=anchor+right*((627-cc)/ppm)+up*((row-627)/ppm)
    CAM.matrix_world=Matrix(((right.x,up.x,back.x,0),(right.y,up.y,back.y,0),(right.z,up.z,back.z,0),(0,0,0,1)))
    CAM.location=center+back*4;CAM.data.type='ORTHO';CAM.data.ortho_scale=1254/ppm;CAM.data.clip_start=.01;CAM.data.clip_end=2.90 if spec['tool']=='spear' and v=='end' else 10
    for m in MATERIALS:m.node_tree.nodes['VIEW_NORMAL'].inputs[1].default_value=back
    for tool,obs in GROUPS.items():
        for ob in obs:ob.hide_render=tool!=spec['tool']
    return back

args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
selected=args or list(VIEWS)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
for name in selected:
    if name not in VIEWS:continue
    set_camera(VIEWS[name]);SC.render.filepath=str(ROOT/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
# Persist a useful camera with all three objects at canonical coordinates.
set_camera(VIEWS['pick_side'])
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/tool_masters.blend'))
print('BUILD_COMPLETE',len(GROUPS['pick']),len(GROUPS['hatchet']),len(GROUPS['spear']),flush=True)

# Blender audio shutdown hangs in this sandbox after work is saved.
# Explicit batch mode flushes all logs and exits only after successful work.
import os as _os, sys as _sys
if _os.environ.get("TOOL_CONCEPT_BATCH") == "1":
    _sys.stdout.flush(); _sys.stderr.flush(); _os._exit(0)
