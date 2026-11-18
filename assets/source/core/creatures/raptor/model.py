"""Measured axial profiles and muscle paths fuse into one continuous deforming skin.
The mobile lower jaw, scutes, eyes and pennaceous vanes remain distinct surfaces.
"""
import math
import bmesh
import bpy
import numpy as np
from mathutils import Vector
from parts import Part, activate, join, smooth_rows
from plan import AXIS, JAW, BONES, ARM, EYE, LEG, from_blender, mirror, to_blender
from rig import bind

# The face and limb strips on raptor_detail. Repeating wraps occupy single
# columns; the small transverse recesses pick up the same highlight on each side.
DETAIL={key: ((i+.06)/8,.015,(i+.94)/8,.985) for i,key in enumerate(
    ("claw","tooth","mouth","eye","naris","tarsus","brow","lip"))}

def axial(name, stations, bone=None):
    p=Part(name, bone=bone)
    rings=[]
    sides=48
    for z,w,low,top in smooth_rows(stations,3):
        # The jaw and the upper tooth arcade have a flatter floor than the throat.
        skull=min(1,max(0,(z-.835)/.22))
        ring=[]
        for a in range(sides):
            angle=math.tau*a/sides
            sn,cs=math.sin(angle),math.cos(angle)
            power=1-.38*skull
            x=w*math.copysign(abs(cs)**power,cs)
            y=(low+top)/2+(top-low)*.5*math.copysign(abs(sn)**power,sn)
            # A shallow hollow under the postorbital and along the maxilla.
            if name=="axial":
                x*=1-.13*math.exp(-((z-1.16)/.082)**2-((y-1.436)/.032)**2)
            ring.append(p.point((x,y,z)))
        rings.append(ring)
    for a,b in zip(rings,rings[1:]):
        for i in range(sides): p.face((a[i],a[(i+1)%sides],b[(i+1)%sides],b[i]))
    for ring in [rings[0],rings[-1]]: p.face(ring)
    return p.object()

def path(name,rows,material="raptor_hide",rect=(.01,.01,.99,.99),bone=None,sides=14,sub=2):
    return Part(name,material,bone).loft(rows,sides,rect,sub).object()

def mirrored(rows,sg):
    return [(sg*x,y,z,a,b) for x,y,z,a,b in rows]

def atlas_uv(obj):
    mesh=obj.data
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    for f in mesh.polygons:
        f.use_smooth=True
        for i in f.loop_indices:
            x,y,z=from_blender(mesh.vertices[mesh.loops[i].vertex_index].co)
            uv.data[i].uv=((z+2.30)/3.92,(y+.09+.075*abs(x)) /1.82)

def skin_weights(obj):
    """Muscle envelopes meet at the hip, hock, shoulder and the base of the skull.
    The short reach across the ribs prevents an elbow from pulling on the belly."""
    coords=np.array([from_blender(v.co) for v in obj.data.vertices])
    x,y,z=coords.T
    fields=[]
    names=[]
    for n,parent,a,b in BONES:
        if n=="jaw": continue
        a,b=np.array(a),np.array(b)
        delta=b-a
        t=np.clip((coords-a)@delta/(delta@delta),.07,.93)
        distance=np.sqrt(np.sum((coords-(a+t[:,None]*delta))**2,axis=1))
        width=.116
        if n.startswith("tail"): width=.07
        if n in ("skull","neck_1","neck_2"): width=.077
        side=n[-2:] in ("_l","_r")
        if side:
            width=.059 if n.startswith(("shank","metatarsus","toes","forearm","manus")) else .093
        # A compact distance field blends muscles into the wider axial envelope.
        score=-distance**2/(2*width**2)
        if side:
            leg=n.startswith(("thigh","shank","metatarsus","toes"))
            if leg:
                score+=3.6*np.clip((1.15-y)/.28,0,1)
                score-=9*np.clip((z-.28)/.15,0,1)
            else:
                score+=3.5*np.clip((1.12-y)/.21,0,1)
                score-=10*np.clip((.26-z)/.12,0,1)
            score-=11*np.clip((.105-(x if n.endswith("_l") else -x))/.13,0,1)
        fields.append(score)
        names.append(n)
    scores=np.array(fields).T
    # Eliminate accidental attraction between the underside and the adjacent
    # folded forearm. The wrist remains free of ribcage influence.
    lower_arm=(abs(x)>.218)&(z>.24)&(z<.76)&(y<.955)
    for j,n in enumerate(names):
        if not n.startswith(("humerus","forearm","manus")): scores[lower_arm,j]-=7
    selected=np.argsort(scores,axis=1)[:,-4:]
    chosen=np.take_along_axis(scores,selected,axis=1)
    weights=np.exp(chosen-chosen.max(axis=1)[:,None])
    weights/=weights.sum(axis=1)[:,None]
    groups=[obj.vertex_groups.new(name=n) for n in names]
    for i,(bones,values) in enumerate(zip(selected,weights)):
        for bone,w in zip(bones,values):
            if w>.0001: groups[bone].add([i],w,"REPLACE")

def feather(p, start, end, width, cross, bone, variant):
    """A bowed shaft with asymmetrical closed vanes and occasional split barbs."""
    a,b=Vector(start),Vector(end)
    axis=b-a
    c=Vector(cross); c=(c-axis*c.dot(axis)/axis.length_squared).normalized()
    normal=axis.normalized().cross(c)
    if normal.y<0: normal=-normal
    rows=[]
    for i in range(13):
        t=i/12
        centre=a+axis*t+normal*(.035*axis.length*math.sin(math.pi*t))+c*(.065*width*math.sin(2*math.pi*t))
        shape=.038+.962*(math.sin(math.pi*t**.94)**.67 if i not in (0,12) else 0)*(1.14-.28*t)
        nick=.76 if (i+variant)%7==0 and 4<i<11 else 1
        offsets=[(0,.11),(.82*nick,0),(0,-.085),(-1.10,0)]
        rows.append([p.point(centre+c*(width*shape*h)+normal*(width*shape*k)) for h,k in offsets])
    left,right=(variant%4+.018)/4,(variant%4+.982)/4
    us=[.50,.98,.50,.02]
    for j,(r,s) in enumerate(zip(rows,rows[1:])):
        for i in range(4):
            k=(i+1)%4
            p.face((r[i],r[k],s[k],s[i]),[(left+(right-left)*us[h],.03+.94*v/12) for h,v in [(i,j),(k,j),(k,j+1),(i,j+1)]])
    for r in (rows[0],rows[-1]): p.face(r,[(left,.03)]*4)

def eye_patch(name, center, sg, ry,rz,protrude,rect,bone):
    """Convex lens in a closed navicular rim. Its UV iris stays circular through LOD."""
    p=Part(name,"raptor_detail",bone)
    rows=[]
    for d in range(9):
        a=math.pi*d/8
        radial=max(.001,math.sin(a))
        ring=[]
        for i in range(24):
            th=math.tau*i/24
            h,v=math.cos(th)*radial,math.sin(th)*radial
            pos=(sg*(center[0]+protrude*math.cos(a)-.32*rz*h),center[1]+ry*v+.13*rz*h,center[2]+rz*h)
            ring.append((p.point(pos),(.5+.48*h,.5+.48*v)))
        rows.append(ring)
    for row,nextrow in zip(rows,rows[1:]):
        for i in range(24):
            k=(i+1)%24
            corners=[row[i],row[k],nextrow[k],nextrow[i]]
            p.face([t[0] for t in corners],[(rect[0]+(rect[2]-rect[0])*u,rect[1]+(rect[3]-rect[1])*v) for _,(u,v) in corners])
    for r in (rows[0],rows[-1]): p.face([t[0] for t in r],[(rect[0]+(rect[2]-rect[0])*.5,.5)]*len(r))
    return p.object()

def build():
    muscles=[axial("axial",AXIS)]
    hard=[]
    feathers={}
    def vane(a,b,w,c,bone,variant):
        p=feathers.setdefault(bone,Part("pennons_"+bone,"raptor_feather",bone))
        feather(p,a,b,w,c,bone,variant)
    for sg,side in ((1,"l"),(-1,"r")):
        # Deep iliac origin descends forward into the patella. Gastrocnemius
        # tapers back to the hock; the flexed hand lies just outside the ribs.
        thigh=[(.097,1.206,-.234,.102,.152),(.154,1.113,-.176,.121,.204),
               (.193,.970,-.099,.106,.173),(.200,.828,.014,.088,.122),
               (.206,.710,.107,.071,.085),(.205,.663,.109,.060,.056),
               (.202,.624,.050,.066,.085),(.195,.547,-.036,.064,.088),
               (.190,.453,-.138,.048,.056),(.191,.345,-.240,.039,.041),
               (.191,.304,-.232,.034,.029),(.191,.205,-.164,.032,.030),
               (.192,.102,-.100,.033,.033),(.192,.064,-.069,.042,.032)]
        fore=[(.105,1.151,.419,.079,.090),(.175,1.074,.427,.075,.083),
              (.205,1.000,.400,.061,.069),(.234,.914,.295,.048,.047),
              (.240,.886,.299,.046,.046),(.248,.870,.386,.044,.050),
              (.254,.855,.489,.034,.039),(.254,.845,.563,.025,.029),
              (.250,.815,.627,.026,.030),(.241,.790,.688,.024,.031)]
        for name,rows in (("leg",thigh),("arm",fore)):
            muscles.append(path(name,mirrored(rows,sg),sides=24))
        # The third and fourth pedal digits support the animal. II folds back
        # before its large keratin sheath sweeps down and forward.
        for off,length,spread in ((.002,.246,.004),(.024,.212,.088),(-.016,.152,-.058)):
            cx=.192+off
            if off<0:
                rows=[(cx,.065,-.076,.039,.033),(cx-.012,.095,-.021,.029,.039),
                      (cx-.028,.142,.020,.027,.033),(cx+spread,.158,.041,.024,.027)]
                claw=[(cx+spread,.155,.036,.024,.028),(cx+spread-.003,.183,.074,.024,.030),
                      (cx+spread-.004,.188,.107,.020,.023),(cx+spread-.005,.169,.140,.014,.018),
                      (cx+spread-.004,.131,.162,.008,.010),(cx+spread-.003,.102,.167,.002,.003)]
            else:
                rows=[(cx,.065,-.087,.037,.033),(cx+spread*.24,.039,-.039,.032,.031),
                      (cx+spread*.55,.032,length*.18,.026,.028),(cx+spread*.78,.031,length*.38,.026,.024),
                      (cx+spread,.026,length*.58,.017,.018)]
                claw=[(cx+spread,.030,length*.55,.017,.019),(cx+spread,.031,length*.65,.015,.016),
                      (cx+spread+.003,.021,length*.76,.009,.010),(cx+spread+.004,.009,length*.83,.002,.003)]
            muscles.append(path("pedal digit",mirrored(rows,sg),sides=12))
            hard.append(path("ungual",mirrored(claw,sg),"raptor_detail",DETAIL["claw"],"toes_"+side))
        for i in range(3):
            x=.229+i*.013
            row=[(x,.804,.641,.015,.017),(x+.012,.779,.694+i*.009,.014,.016),
                 (x+.010,.753,.710+i*.029,.009,.011),(x+.004,.740,.706+i*.034,.006,.007)]
            hard.append(path("manual digit",mirrored(row,sg),"raptor_detail",DETAIL["tarsus"],"manus_"+side,10))
            hard.append(path("manual hook",mirrored([(row[-1][0],.744,row[-1][2],.008,.008),
                      (x+.001,.725,.706+i*.036,.006,.006),(x-.003,.715,.699+i*.035,.001,.001)],sg),"raptor_detail",DETAIL["claw"],"manus_"+side,9))
        # Primaries attach along digit II and secondaries along the ulna. Their
        # shafts sweep toward the hip and stack into one folded forewing.
        for i in range(11):
            t=i/10
            a=(sg*(.248+.008*math.sin(t*math.pi)),.887-.085*t,.306+.362*t)
            b=(sg*(.281+.034*t),.803-.165*t+.044*t*t,.136+.059*t-.185*t*t)
            vane(a,b,.031+.011*t,(0,.91,.35),"forearm_"+side if i<7 else "manus_"+side,i%3)
        for i in range(8):
            t=i/7
            vane((sg*.251,.905-.086*t,.308+.317*t),(sg*(.280+.012*t),.830-.097*t,.202+.154*t),
                 .031,(0,.94,.32),"forearm_"+side,i%3)
        # Tapering outward rectrices remain nearly horizontal at the shaft.
        for i in range(9):
            t=i/8
            a=(sg*(.014+.021*t),1.076,-1.43-.52*t)
            b=(sg*(.174-.139*t),1.022+.102*t,-1.80-.55*t)
            vane(a,b,.045-.017*t,(sg*.94,.33,0),"tail_4" if i<4 else "tail_5",i%3)
        for i in range(9):
            t=i/8
            a=(sg*(.054+.026*t),1.381+.151*t,.717+.27*t)
            b=(sg*(.072+.045*t),1.398+.212*t,.610+.232*t)
            vane(a,b,.023+.008*t,(sg*.90,.44,0),"neck_2" if i<6 else "skull",3)
        # Facial skin follows the slight yaw of the orbital rim and nasal slit.
        hard.append(eye_patch("orbit",(.116,1.480,1.078),sg,.040,.054,.017,DETAIL["lip"],"skull"))
        hard.append(eye_patch("eye",(.124,1.484,1.081),sg,.027,.038,.015,DETAIL["eye"],"skull"))
        brow=[(.118,1.473,1.025,.008,.010),(.127,1.496,1.045,.010,.012),
              (.127,1.510,1.076,.010,.014),(.117,1.512,1.101,.010,.013),(.102,1.498,1.132,.005,.007)]
        hard.append(path("superciliary margin",mirrored(brow,sg),"raptor_detail",DETAIL["brow"],"skull",12))
        hard.append(eye_patch("naris",(.064,1.428,1.414),sg,.009,.025,.004,DETAIL["naris"],"skull"))
        for i in range(13):
            z=1.052+i*.034
            w=float(np.interp(z,[r[0] for r in AXIS],[r[1] for r in AXIS]))
            low=float(np.interp(z,[r[0] for r in AXIS],[r[2] for r in AXIS]))
            length=.019+.006*math.sin(i*.9)**2
            pts=[(.77*w,low+.019,z,.005,.007),(.78*w,low+.002,z+.001,.004,.006),
                 (.77*w,low+.011-length,z-.002,.0025,.003),(.74*w,low+.003-length,z-.005,.0008,.001)]
            hard.append(path("tooth",mirrored(pts,sg),"raptor_detail",DETAIL["tooth"],"skull",7,1))
    # One fusion pass makes groin, scapula and nape continuous with the trunk.
    body=join(muscles,"mantle")
    activate(body)
    body.data.remesh_voxel_size=.011
    bpy.ops.object.voxel_remesh()
    sm=body.modifiers.new("Soften muscle insertions","SMOOTH"); sm.factor=.86; sm.iterations=5
    bpy.ops.object.modifier_apply(modifier=sm.name)
    body.data.calc_loop_triangles()
    dec=body.modifiers.new("Retain silhouette curvature","DECIMATE")
    dec.ratio=min(1,12300/len(body.data.loop_triangles)); dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    body.data.materials.clear(); body.data.materials.append(bpy.data.materials["raptor_hide"])
    atlas_uv(body)
    skin_weights(body)
    jaw=axial("mandible",JAW,"jaw"); atlas_uv(jaw)
    # Dark oral cavity is visible under the palate on the open beat of a bite.
    palate=path("palate",[(0,1.373,.973,.049,.012),(0,1.378,1.067,.086,.014),
                 (0,1.378,1.22,.071,.012),(0,1.374,1.37,.045,.009),(0,1.394,1.475,.010,.008)],
                 "raptor_detail",DETAIL["mouth"],"skull",18)
    tongue=path("tongue",[(0,1.380,.974,.045,.016),(0,1.378,1.046,.087,.013),
                (0,1.372,1.160,.069,.014),(0,1.366,1.304,.050,.013),(0,1.365,1.438,.019,.009)],
                "raptor_detail",DETAIL["mouth"],"jaw",16)
    for i in range(3):
        vane(((i-1)*.012,1.083,-1.89),((i-1)*.034,1.107,-2.374+.018*abs(i-1)),.037,(1,.06,0),"tail_5",i)
    model=join([body,jaw,palate,tongue]+hard+[p.object() for p in feathers.values()],"raptor_model")
    # Triangulate before MikkTSpace tangent export. Reserve separate
    # quantised UVs across mirror boundaries, including the midline.
    mesh=model.data
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free()
    uv=mesh.uv_layers.active.data
    for loop in uv: loop.uv=[round(v*65535)/65535 for v in loop.uv]
    for face in mesh.polygons:
        a,b,c=[uv[i].uv for i in face.loop_indices]
        if (b.x-a.x)*(c.y-a.y)<(b.y-a.y)*(c.x-a.x):
            for i in face.loop_indices: uv[i].uv.x+=2/65535
    bind(model)
    return model
if __name__=="__main__": build()
