"""Original Rex sculpt, palate, paired dental arcades, orbit and foot anatomy."""
import json, math
from pathlib import Path
import bmesh,bpy,numpy as np
from mathutils import Vector
from parts import Part,activate,join,smooth_rows
from plan import ARM,BODY,BONES,EYE,JAW,LEGS,SKULL,mirror,to_animal,to_blender
import rig
OUT=Path(__file__).resolve().parents[5]/'var/rex'
# Atlas rectangles for hard/soft details. Linear physical gradients are painted
# separately in each island; the rest of the head is unwrapped from its own skin.
CLAW=(.02,.02,.25,.48);TOOTH=(.28,.02,.48,.47);TONGUE=(.52,.02,.98,.47)
EYES=(.02,.52,.37,.98);ORAL=(.41,.52,.68,.98);LIDS=(.72,.52,.98,.98)

def rings(part,rows):
    ids=[[part.point(p) for p in row] for row in rows];n=len(ids[0])
    for a,b in zip(ids,ids[1:]):
        for k in range(n):part.face((a[k],a[(k+1)%n],b[(k+1)%n],b[k]))
    part.face(list(reversed(ids[0])));part.face(ids[-1])
    return part.object()

def trunk():
    result=[]
    for z,y,w,up,down in smooth_rows(BODY,3):
        row=[]
        for k in range(40):
            a=math.tau*k/40;c=math.cos(a);s=math.sin(a)
            row.append((w*c*(1-.105*max(0,s)),y+(up if s>0 else down)*s,z))
        result.append(row)
    return rings(Part('axial_skin'),result)

def shell(stations,upper):
    contour=([(0,1),(.43,.99),(.72,.93),(.91,.80),(.99,.59),(1,.41),(.98,.23),(.95,.105),(.89,0),
              (.75,.025),(.56,.115),(.30,.154),(0,.161)] if upper else
             [(0,0),(.36,.035),(.67,.13),(.88,.27),(.97,.49),(1,.73),(.96,.94),(.88,1),
              (.69,.925),(.46,.848),(.19,.814),(0,.815)])
    contour+= [(-x,y) for x,y in reversed(contour[1:-1])]
    rows=[]
    for z,w,a,b in smooth_rows(stations,3):
        low,high=(a,b) if upper else (b,a)
        rows.append([(max(.009,w)*x,low+(high-low)*y,z) for x,y in contour])
    return rings(Part('maxilla' if upper else 'dentary','rex_head',None if upper else 'jaw'),rows)

def loft(name,path,sign=1,power=1,sides=18):
    return Part(name).loft([(*mirror(row[:3],sign),*row[3:]) for row in path],sides,subdivisions=3,section_power=power).object()

def hide():
    pieces=[trunk(),shell(SKULL,True)]
    for side,sign in [('l',1),('r',-1)]:
        forms={
        'iliac_thigh':[(.34,3.54,-.82,.11,.15),(.57,3.38,-.76,.36,.56),(.76,3.03,-.63,.406,.61),(.79,2.70,-.41,.363,.51),(.75,2.29,-.11,.285,.345),(.72,1.99,.025,.249,.275),(.70,1.86,-.04,.222,.249)],
        'hind_calf':[(.70,2.10,.005,.17,.20),(.72,1.90,-.09,.248,.26),(.72,1.70,-.31,.207,.30),(.69,1.47,-.58,.194,.25),(.655,1.20,-.78,.139,.187),(.64,.99,-.89,.117,.132),(.64,.887,-.854,.119,.128)],
        'metatarsal':[(.64,1.05,-.845,.100,.112),(.64,.933,-.875,.135,.125),(.645,.737,-.796,.098,.116),(.65,.481,-.67,.091,.101),(.65,.295,-.556,.109,.116),(.64,.164,-.44,.184,.161),(.64,.119,-.35,.195,.176)],
        'iliotibial':[(.50,3.53,-1.11,.095,.13),(.74,3.29,-1.03,.223,.34),(.873,2.93,-.86,.217,.32),(.894,2.55,-.55,.146,.22),(.81,2.19,-.18,.078,.116)],
        'scapula':[(.47,3.55,.71,.095,.15),(.63,3.34,.94,.162,.29),(.68,3.15,1.19,.139,.25),(.59,2.97,1.54,.148,.19),(.51,2.89,1.64,.122,.133)],
        'arm':[(.48,3.01,1.61,.103,.12),(.555,2.89,1.61,.138,.142),(.62,2.68,1.46,.105,.108),(.646,2.55,1.425,.086,.095),(.665,2.53,1.59,.075,.075),(.692,2.535,1.76,.054,.058),(.704,2.52,1.868,.057,.063),(.71,2.48,1.94,.064,.055)],
        'orbital_shelf':[(.36,4.045,3.16,.09,.12),(.474,4.116,3.32,.114,.111),(.530,4.132,3.48,.101,.126),(.489,4.101,3.67,.087,.101),(.414,4.046,3.894,.062,.081)],
        'jugal_bar':[(.44,3.506,3.14,.080,.115),(.505,3.62,3.30,.091,.13),(.547,3.74,3.47,.072,.09),(.521,3.79,3.60,.057,.081),(.451,3.775,3.80,.050,.083)],
        'nasal_boss':[(.291,4.099,3.50,.084,.10),(.309,4.146,3.68,.100,.108),(.274,4.126,3.93,.084,.10),(.218,4.08,4.20,.061,.078),(.138,3.997,4.46,.046,.057)]}
        for name,path in forms.items():pieces.append(loft(name+side,path,sign,.85 if name=='jugal_bar' else 1))
        for digit,x,z in ((2,.393,.075),(3,.64,.30),(4,.875,.046)):
            dx=x-.64
            path=[(.64+.22*dx,.123,-.432,.093,.090),(.64+.5*dx,.119,-.266,.096,.093),
                  (.64+.78*dx,.095,-.11+(z-.12)*.34,.084,.078),(x,.081,z-.116,.080,.063),
                  (x+.12*dx,.079,z,.050,.051)]
            pieces.append(loft(f'digit{digit}_{side}',path,sign,sides=14))
        for digit,dx in ((1,-.047),(2,.042)):
            pieces.append(loft(f'manus{digit}_{side}',[(.71+dx*.45,2.49,1.899,.034,.039),
              (.71+dx,2.464,1.98,.032,.034),(.715+dx*1.4,2.422,2.075+dx,.024,.027)],sign,sides=12))
    obj=join(pieces,'rex_continuous_hide');activate(obj)
    obj.data.remesh_voxel_size=.031;obj.data.use_remesh_preserve_volume=True;bpy.ops.object.voxel_remesh()
    m=obj.modifiers.new('blend_anatomical_volumes','SMOOTH');m.factor=.48;m.iterations=3;bpy.ops.object.modifier_apply(modifier=m.name)
    for side,sign in [('l',1),('r',-1)]:
        for name,centre,radii in [('orbit',(.554,4.018,3.492),(.092,.072,.121)),('naris',(.360,3.858,4.49),(.10,.056,.098))]:
            cut=Part(name).ellipsoid(mirror(centre,sign),radii,(0,0,1,1),24,12).object()
            activate(obj);m=obj.modifiers.new(name+side,'BOOLEAN');m.operation='DIFFERENCE';m.solver='EXACT';m.object=cut
            bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(cut,do_unlink=True)
    obj.data.calc_loop_triangles();m=obj.modifiers.new('muscle_topology','DECIMATE')
    m.ratio=min(1,16600/len(obj.data.loop_triangles));m.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=m.name)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0008)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.00004);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    mats=[bpy.data.materials.get(n) or bpy.data.materials.new(n) for n in ['rex_hide','rex_head']]
    obj.data.materials.clear()
    for m in mats:obj.data.materials.append(m)
    for v in obj.data.vertices:
        if v.co.z<.036:v.co.z=.036
    for p in obj.data.polygons:
        q=to_animal(p.center);p.material_index=int(q.z>2.73 and q.y>2.91);p.use_smooth=True
    weights(obj);return obj

def weights(obj):
    ps=np.array([to_animal(v.co) for v in obj.data.vertices])
    x,y,z=ps.T
    order=[];fields=[]
    widths={'pelvis':.70,'chest':.68,'neck':.36,'skull':.41,'thigh':.38,'shank':.25,'metatarsus':.19,'toes':.15,'tail':.36,'humerus':.14,'forearm':.10,'manus':.09}
    for n,parent,a,b in BONES:
        trunk=n.split('_')[0]
        if trunk not in widths:continue
        a,b=np.asarray(a),np.asarray(b);d=b-a
        t=np.clip((ps-a)@d/(d@d),0,1)
        centre=a+t[:,None]*d;distance=np.linalg.norm(ps-centre,axis=1)
        # Axial segments share a considerable volume at their endpoints. The
        # distal limb and head use tight falloffs to keep teeth and soles rigid.
        width=widths[trunk]
        if trunk=='tail':width=max(.106,.47-.067*int(n[-1]))
        influence=1/((distance**2+(width*.40)**2)**2.7)
        if n[-2:] in ('_l','_r'):
            influence*=np.clip((x*(1 if n.endswith('_l') else -1)-.08)/.24,0,1)**2
            if trunk in ('humerus','forearm','manus'):influence*=np.clip((2.99-y)/.35,0,1)*np.clip((z-1.1)/.3,0,1)
        if trunk in ('pelvis','chest','neck','tail','skull'):
            influence*=np.where((y<1.76)&(z>-1.8)&(z<1.0),0.,1.)
        if trunk!='skull':influence*=1-np.clip((z-2.87)/.43,0,1)
        if trunk not in ('forearm','manus','humerus'):influence*=np.where((y<2.64)&(z>1.34)&(z<2.24),.002,1.)
        if trunk!='toes':influence*=np.where((y<.195)&(z>-.48),.00001,1.)
        if trunk!='metatarsus' and trunk!='toes':influence*=np.where(y<.50,.00003,1.)
        # An actual naris and orbit are cut in the skull that owns them.
        fields.append(influence);order.append(n)
    values=np.array(fields).T;best=np.argsort(values,axis=1)[:,-4:];groups=[obj.vertex_groups.new(name=n) for n in order]
    for i,bones in enumerate(best):
        selected=values[i,bones];selected=np.where(selected>selected.max()*.035,selected,0);selected/=selected.sum()
        for k,w in zip(bones,selected):
            if w:groups[k].add([i],float(w),'REPLACE')

def unwrap_skin(obj):
    activate(obj);mesh=obj.data
    for mat in ('rex_hide','rex_head'):
        matches={i for i,m in enumerate(mesh.materials) if m.name==mat}
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT')
        bm=bmesh.from_edit_mesh(mesh)
        for face in bm.faces:face.select_set(face.material_index in matches)
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.smart_project(angle_limit=math.radians(78),island_margin=.0055,area_weight=.24,correct_aspect=False,scale_to_bounds=True)
        bpy.ops.object.mode_set(mode='OBJECT')

def detail(name,bone,rows,rect,sides=12):
    return Part(name,'rex_detail',bone).loft(rows,sides,rect,2).object()

def soft_parts():
    out=[]
    # Oral roof, tongue and gingiva remain anchored on opposite sides of the joint.
    out.append(detail('palatal_ridges','skull',[(0,3.565,3.16,.18,.033),(0,3.56,3.58,.35,.046),(0,3.55,4.09,.28,.044),(0,3.55,4.52,.211,.035),(0,3.58,4.83,.052,.017)],ORAL,20))
    out.append(detail('mobile_tongue','jaw',[(0,3.42,3.10,.12,.050),(0,3.444,3.40,.305,.070),(0,3.425,3.75,.278,.065),(0,3.414,4.17,.211,.054),(0,3.425,4.50,.118,.040),(0,3.45,4.73,.027,.023)],TONGUE,24))
    for side,sg in [('l',1),('r',-1)]:
        for upper,st in [(True,SKULL),(False,JAW)]:
            name='upper' if upper else 'lower';bone='skull' if upper else 'jaw'
            stations=np.array(st);lip_column=2
            def gum(z):
                w=np.interp(z,stations[:,0],stations[:,1])
                y=np.interp(z,stations[:,0],stations[:,lip_column])
                return (.72*w*sg,y+(.042 if upper else -.031),z)
            gumline=[(*gum(z),.048,.032) for z in np.linspace(3.40,4.81,15)]
            out.append(detail(name+'_gingiva_'+side,bone,gumline,ORAL))
            locations=np.linspace(3.44,4.80,13 if upper else 12)+(.029 if not upper else 0)
            for i,z in enumerate(locations):
                xx,yy,_=gum(z);h=(.082+.134*math.sin(math.pi*(i+.7)/(len(locations)+1))**.64)*(.78 if not upper else 1)
                h*=.88+.12*math.sin(i*2.49+(0 if upper else .7));r=.024+h*.103;direction=-1 if upper else 1
                out.append(detail(f'{name}_tooth_{side}_{i}',bone,[(xx,yy-direction*.022,z,r*.63,r*.84),
                 (xx,yy,z,r,r*1.08),(xx-.005*sg,yy+direction*h*.46,z-.007,r*.74,r*.86),
                 (xx-.011*sg,yy+direction*h*.83,z-.030,r*.31,r*.42),(xx-.017*sg,yy+direction*h,z-.049,.0016,.0026)],TOOTH,9))
        ex,ey,ez=mirror(EYE,sg)
        eye=Part('recessed_eye_'+side,'rex_detail','eye_'+side).ellipsoid((ex,ey,ez),(.045,.048,.070),EYES,24,12).object();out.append(eye)
        # The delicate orbital rims share the soft head paint; the mobile upper
        # lid rolls across the seated globe in the blink and torpor performances.
        for upper in (True,False):
            path=[]
            for i in range(13):
                a=math.pi*i/12;u=math.cos(a);s=math.sin(a)
                path.append(((.536+.015*s)*sg,ey+(.025 if upper else -.024)*s,ez+.072*u,.012+.007*s,.011+.013*s))
            out.append(detail(('upperlid' if upper else 'lowerlid')+side,'lid_'+side if upper else 'skull',path,LIDS,10))
        for digit,x,z in ((2,.393,.075),(3,.64,.30),(4,.875,.046)):
            dx=x-.64;x+=dx*.12
            out.append(detail(f'claw_{side}_{digit}','toes_'+side,[(x*sg,.09,z-.060,.043,.040),(x*sg,.091,z,.055,.051),
             ((x+dx*.11)*sg,.080,z+.105,.033,.036),((x+dx*.21)*sg,.043,z+.203,.003,.003)],CLAW,12))
        for i,dx in enumerate((-.047,.042)):
            z=2.055+dx
            out.append(detail(f'finger_claw_{side}_{i}','manus_'+side,[((.715+dx*1.4)*sg,2.433,z-.016,.024,.024),
             ((.72+dx*1.45)*sg,2.416,z+.023,.028,.028),((.719+dx*1.6)*sg,2.376,z+.073,.019,.020),
             ((.704+dx*1.6)*sg,2.324,z+.053,.002,.002)],CLAW,10))
        out.append(detail('hallux_'+side,'metatarsus_'+side,[(.609*sg,.32,-.575,.046,.049),(.55*sg,.28,-.63,.047,.045),(.52*sg,.22,-.70,.027,.029),(.52*sg,.19,-.751,.003,.004)],CLAW,12))
    return out

def build():
    obj=join([hide(),shell(JAW,False)],'rex_skin')
    unwrap_skin(obj)
    obj=join([obj,*soft_parts()],'rex_model')
    mesh=obj.data
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    uv=mesh.uv_layers.active.data
    # Mirror boundaries must remain separate tangent charts after quantization.
    for loop in uv:loop.uv=[round(v*65535)/65535 for v in loop.uv]
    for face in mesh.polygons:
        a,b,c=[uv[li].uv for li in face.loop_indices]
        if (b.x-a.x)*(c.y-a.y)<(b.y-a.y)*(c.x-a.x):
            for li in face.loop_indices:uv[li].uv.x+=2/65535
    for v in mesh.vertices:v.co.z-=.036
    rig.bind(obj)
    OUT.mkdir(parents=True,exist_ok=True)
    points=np.asarray([to_animal(v.co) for v in mesh.vertices],np.float32);mesh.calc_loop_triangles()
    tris=mesh.loop_triangles
    np.savez_compressed(OUT/'layout.npz',points=points,triangles=np.asarray([t.vertices for t in tris],np.int32),
      uvs=np.asarray([[tuple(uv[li].uv) for li in t.loops] for t in tris],np.float32),materials=np.array([t.material_index for t in tris]))
    (OUT/'layout.json').write_text(json.dumps({'materials':[m.name for m in mesh.materials],'vertices':len(points),'triangles':len(tris),'bounds':[points.min(0).tolist(),points.max(0).tolist()]},indent=2)+'\n')
if __name__=='__main__':build()
