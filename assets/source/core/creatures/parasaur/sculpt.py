"""Union of tissue envelopes, physical orbital/bill details, and native UV bake."""
import math
import sys
from pathlib import Path
import bpy
import bmesh
import numpy as np
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from plan import AXIS, JAW, CREST, HIND, FORE, BONES, blender, interpolate

HERE=Path(__file__).resolve().parent

TAU=math.tau

def bell(x,c,r): return math.exp(-((x-c)/r)**2)
def signed(x,p): return math.copysign(abs(x)**p,x)
def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj

def material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)

class Sculpt:
    def __init__(self):
        self.v=[];self.f=[]
    def rings(self,sections):
        start=len(self.v)
        k=len(sections[0])
        for j,row in enumerate(sections):
            self.v.extend([blender(p) for p in row])
            if j:
                for i in range(k):
                    a=start+k*(j-1)+i; b=start+k*(j-1)+(i+1)%k
                    self.f.append((a,b,b+k,a+k))
        self.f.extend([tuple(start+i for i in reversed(range(k))),
                       tuple(start+k*(len(sections)-1)+i for i in range(k))])
    def obj(self,name):
        mesh=bpy.data.meshes.new(name)
        mesh.from_pydata(self.v,[],self.f)
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        bm=bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:])
        bm.to_mesh(mesh); bm.free()
        return obj

def section(sculpt,table,kind,n=44):
    rows=[]
    for z,w,lo,hi in interpolate(table,4):
        pts=[]
        for i in range(n):
            c=math.cos(TAU*i/n); s=math.sin(TAU*i/n)
            shape=.78 if kind=='jaw' or (z>2.87 and kind=='axis') else .95
            h=(lo+hi)/2+(hi-lo)/2*signed(s,shape)
            xx=w*signed(c,shape)
            if kind=='axis':
                # Angled scapula crossing the ribs, long femoral fascia and
                # tendons at the tail root. Each relief flows out of the surface.
                scap=.049*bell(z,.85-.47*(h-1.65),.13)*bell(h,1.84,.41)
                ribs=.010*math.cos(15*(z+.08*h))*bell(z,.06,.65)*bell(h,1.73,.43)
                hip=.046*bell(z,-.93+.24*(h-1.71),.26)*bell(h,1.86,.46)
                tendon=.025*bell(h,(lo+hi)*.50+.08,.12)*bell(z,-1.88,.67)
                throat=.013*math.cos(30*z-7*h)*bell(z,1.69,.30)*bell(h,2.02,.28)
                eye=((z-2.39)/.111)**2+((h-2.808)/.092)**2
                orbital_ridge=.024+.029*bell(h,2.85,.047)
                orbit=orbital_ridge*math.exp(-((math.sqrt(eye)-.94)/.38)**2)-.035*math.exp(-eye*1.46)
                # Jugal wedge connects the closed mouth corner back to the
                # throat. It slopes below the orbit toward the dental battery.
                cheek=.030*bell(z,2.39,.19)*bell(h,2.57-.18*(z-2.39),.078)
                nasal=.022*bell(h,2.87-.64*(z-2.54),.046)*bell(z,2.69,.23)
                nostril=-.028*math.exp(-(((z-2.86)/.060)**2+((h-2.639)/.034)**2))
                xx+=(1 if c>0 else -1)*c*c*(scap+ribs+hip+tendon+throat+orbit+nasal+nostril+cheek)
            if kind=='crest':
                # Long vascular gutter on either side of the paired tubes.
                xx*=1-.110*bell(s,-.18,.21)
            pts.append((xx,h,z))
        rows.append(pts)
    sculpt.rings(rows)

def append_limb(sculpt,table,sign,hind):
    rows=[]
    for h,x,z,wx,wz in interpolate(table,4):
        row=[]
        # The broad proximal muscle runs under the flank. Progressively tuck
        # its lateral border into the torso above the knee or elbow.
        u=np.clip((h-(1.28 if hind else 1.36))/(.73 if hind else .48),0,1)
        u=u*u*(3-2*u)
        x-=(.153 if hind else .091)*u
        for i in range(32):
            a=TAU*i/32;c=math.cos(a);s=math.sin(a)
            # The medial aspect lies flatter against the belly, while the
            # lateral head of each muscle changes its ridge through the stride.
            swell=1+.08*math.sin(2*a+.5*h)*bell(h,1.51 if hind else 1.19,.47)
            row.append((sign*(x+wx*c*swell),h,z+wz*s*swell))
        rows.append(row)
    sculpt.rings(rows)

def digit(sculpt,sign,x,z,dx,length,rad,height):
    lengths=[(-.44,.25,.78),(-.18,.79,1.0),(.15,1.04,.98),(.55,.95,.88),(.83,.80,.76),(.98,.60,.7),(1.035,.26,.58)]
    rows=[]
    for t,r,cap in lengths:
        lower=.017+.011*max(t,0)**2
        upper=lower+height*r*cap
        rows.append([(sign*(x+dx*t+rad*r*signed(math.cos(TAU*i/22),.81)),
                      (lower+upper)/2+.5*(upper-lower)*signed(math.sin(TAU*i/22),.72),
                      z+length*t) for i in range(22)])
    sculpt.rings(rows)

def apply(obj,kind,**kwargs):
    active(obj)
    mod=obj.modifiers.new(kind,kind)
    for name,val in kwargs.items():setattr(mod,name,val)
    bpy.ops.object.modifier_apply(modifier=mod.name)

def smooth_union(obj):
    active(obj)
    obj.data.remesh_voxel_size=.018
    bpy.ops.object.voxel_remesh()
    apply(obj,'SMOOTH',factor=.85,iterations=6)
    # Relax the intersections across a broad patch of rib cage and proximal
    # limb. Leave the wrist, toes, eye socket and crest gutter sharply defined.
    group=obj.vertex_groups.new(name='fold into flank')
    for v in obj.data.vertices:
        x,z,h=v.co.x,-v.co.y,v.co.z
        alpha=max(bell(z,-.65,.68)*bell(h,1.68,.53),bell(z,.85,.39)*bell(h,1.63,.43))
        if alpha>.02:group.add([v.index],alpha,'REPLACE')
    apply(obj,'SMOOTH',factor=.94,iterations=72,vertex_group=group.name)
    obj.vertex_groups.remove(obj.vertex_groups['fold into flank'])
    apply(obj,'DECIMATE',ratio=min(1,19300/max(1,len(obj.data.polygons)*2)))
    # Remove submillimetre wedges before the native re-quantization.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=bm.verts[:],dist=.0016)
    bmesh.ops.triangulate(bm,faces=bm.faces[:])
    bm.to_mesh(obj.data);bm.free()

def skin(obj,forced=None):
    rig=bpy.data.objects['parasaur']
    obj.parent=rig
    mod=obj.modifiers.new('Skin','ARMATURE');mod.object=rig
    if forced:
        vg=obj.vertex_groups.new(name=forced)
        vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        return
    points=np.array([(v.co.x,v.co.z,-v.co.y) for v in obj.data.vertices])
    x,h,z=points.T
    def smooth(t):
        t=np.clip(t,0,1);return t*t*(3-2*t)
    # Along the spine, joints are transitions in arc length. The dorsal crest
    # has a rigid attachment even where it projects behind the occiput.
    axial=['tail_5','tail_4','tail_3','tail_2','tail_1','pelvis','chest','neck_1','neck_2','skull']
    pos=z.copy()
    pos[h>2.78]=np.maximum(pos[h>2.78],2.49)
    cuts=[(-3.72,.23),(-3.04,.24),(-2.32,.28),(-1.61,.27),(-.91,.29),(.04,.33),(1.08,.24),(1.57,.23),(2.055,.20)]
    transitions=[smooth((pos-j+w)/(2*w)) for j,w in cuts]
    axial_w=[1-transitions[0]]+[np.clip(a-b,0,1) for a,b in zip(transitions,transitions[1:])]+[transitions[-1]]
    names=[b[0] for b in BONES]; weights=np.zeros((len(points),len(names)))
    for name,weight in zip(axial,axial_w):weights[:,names.index(name)]=weight
    for side,sign in [('l',1),('r',-1)]:
        for table,parts,levels in [(HIND,['toes','hock','shank','thigh'],[(.176,.07),(.755,.13),(1.32,.22)]),
                                   (FORE,['manus','forearm','upper_arm'],[(.21,.07),(1.06,.19)])]:
            sta=np.array(table)
            cx,cz,wx,wz=[np.interp(h,sta[:,0],sta[:,k]) for k in range(1,5)]
            norm=((sign*x-cx)/(wx+.12))**2+((z-cz)/(wz+.16))**2
            hind=parts[0]=='toes'
            fade=smooth((2.41-h)/.83) if hind else smooth((2.20-h)/.73)
            low=smooth((1.29-h)/.34) if hind else smooth((1.36-h)/.3)
            influence=(1-smooth((norm-.20)/1.48))*fade
            near=(np.abs(z-cz)<(.65 if hind else .49))&(x*sign>.03)
            influence=np.where(near,np.maximum(influence,low),influence)
            influence*=smooth((x*sign-.06)/.22)
            blend=[smooth((h-j+w)/(2*w)) for j,w in levels]
            v=[1-blend[0]]+[a-b for a,b in zip(blend,blend[1:])]+[blend[-1]]
            weights*=1-influence[:,None]
            for name,val in zip(parts,v):weights[:,names.index(name+'_'+side)]+=val*influence
    tube=smooth((h-2.92+.18*(2.37-z))/.21)*smooth((2.65-z)/.14)
    tip=smooth((1.97-z)/.31)
    weights*=1-tube[:,None]
    weights[:,names.index('crest_root')]+=tube*(1-tip)
    weights[:,names.index('crest_tip')]+=tube*tip
    chosen=np.argsort(weights,axis=1)[:,-4:]
    groups=[obj.vertex_groups.new(name=n) for n in names]
    for i,js in enumerate(chosen):
        denom=sum(weights[i,j] for j in js)
        for j in js:
            if weights[i,j]>1e-5:groups[j].add([i],weights[i,j]/denom,'REPLACE')

def add_eye(sculpt,sign):
    # A shallow corneal dome fills the palpebral aperture. The angular outer
    # canthus, recessed iris and upper hood come from the surrounding skull.
    rings=[]
    for j in range(19):
        d=(j+.05)/18.10*math.pi
        rr=math.sin(d)
        row=[]
        for k in range(36):
            a=TAU*k/36
            z=2.39+.078*rr*math.cos(a)
            h=2.809+.040*rr*signed(math.sin(a),1.38)+.13*(z-2.39)
            x=.245+.045*math.cos(d)
            row.append((sign*x,h,z))
        rings.append(row)
    sculpt.rings(rings)

def split_uv_signs(mesh):
    uv=mesh.uv_layers.active.data
    for p in uv:
        p.uv=[round(c*65535)/65535 for c in p.uv]
    for polygon in mesh.polygons:
        a,b,c=[uv[k].uv for k in polygon.loop_indices]
        if (b.x-a.x)*(c.y-a.y)<(b.y-a.y)*(c.x-a.x):
            for k in polygon.loop_indices: uv[k].uv.x+=2/65535

def save_layout(obj):
    mesh=obj.data;mesh.calc_loop_triangles()
    uv=mesh.uv_layers.active.data
    points=np.array([(v.co.x,v.co.z,-v.co.y) for v in mesh.vertices],np.float32)
    tri=np.array([p.vertices[:] for p in mesh.loop_triangles],np.int32)
    uvs=np.array([[tuple(uv[j].uv) for j in p.loops] for p in mesh.loop_triangles],np.float32)
    slots=np.array([mesh.polygons[p.polygon_index].material_index for p in mesh.loop_triangles],np.int16)
    source=np.array([g.name for g in mesh.materials])
    bone_names=[b[0] for b in BONES]
    joints=np.zeros((len(points),4),np.uint8)
    weights=np.zeros((len(points),4),np.float32)
    for v in mesh.vertices:
        for j,g in enumerate(sorted(v.groups,key=lambda g:g.weight,reverse=True)[:4]):
            joints[v.index,j]=bone_names.index(obj.vertex_groups[g.group].name)
            weights[v.index,j]=g.weight
    np.savez_compressed(HERE/'skin.npz',points=points,tri=tri,uv=uvs,slots=slots,materials=source,
                        joints=joints,weights=weights,bones=np.array(bone_names),
                        coat=np.array([mesh.attributes['surface_kind'].data[p.polygon_index].value for p in mesh.loop_triangles],np.uint8))

def build():
    skin_sculpt=Sculpt()
    section(skin_sculpt,AXIS,'axis')
    section(skin_sculpt,CREST,'crest')
    for sign in [-1,1]:
        append_limb(skin_sculpt,HIND,sign,True)
        append_limb(skin_sculpt,FORE,sign,False)
        for i in [-1,0,1]:
            digit(skin_sculpt,sign,.46+i*.102,-.64,i*.072,.387 if i==0 else .304,.075,.156)
            digit(skin_sculpt,sign,.438+i*.073,1.133,i*.024,.196 if i==0 else .155,.053,.111)
    body=skin_sculpt.obj('living_hide')
    smooth_union(body);skin(body)
    for m in ['parasaur_hide','parasaur_face']:body.data.materials.append(material(m))
    for p in body.data.polygons:
        z=-p.center.y;h=p.center.z
        p.material_index=int(z>1.92 or h>2.78)
    jaw=Sculpt();section(jaw,JAW,'jaw',36)
    mandible=jaw.obj('mandible')
    skin(mandible,'jaw')
    mandible.data.materials.append(material('parasaur_face'))
    eyes=Sculpt()
    for sign in [-1,1]:add_eye(eyes,sign)
    eye=eyes.obj('eyes');skin(eye,'skull');eye.data.materials.append(material('parasaur_face'))
    for tag,o in enumerate((body,mandible,eye)):
        source=o.data.attributes.new('surface_kind','INT','FACE')
        for f in source.data: f.value=tag
        o.data.update()
    # The head and hide each have their own full atlas. Unwrap them in batches.
    active(body);mandible.select_set(True);eye.select_set(True)
    bpy.ops.object.join()
    body.name='parasaur_model'
    active(body)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris()
    for index in [0,1]:
        bpy.ops.mesh.select_all(action='DESELECT')
        body.active_material_index=index
        bpy.ops.object.material_slot_select()
        bpy.ops.uv.smart_project(angle_limit=math.radians(68),island_margin=.003,area_weight=.8)
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in body.data.polygons:p.use_smooth=True
    split_uv_signs(body.data)
    save_layout(body)
    print('Parasaur hide and jaw',len(body.data.polygons),'faces')

if __name__=='__main__':
    # Emitting the canonical editable surface is a deliberate sculpt edit.
    if 'parasaur' not in bpy.data.armatures:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        from rig import build as make_rig
        make_rig()
    build()
