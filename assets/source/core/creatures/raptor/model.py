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

def section_width(y,z):
    zs=[row[0] for row in AXIS]
    w,lo,hi=[float(np.interp(z,zs,[row[i] for row in AXIS])) for i in (1,2,3)]
    power=1-.38*min(1,max(0,(z-.835)/.22))
    t=min(.999,abs((2*y-hi-lo)/(hi-lo)))
    return w*(1-t**(2/power))**(power/2)*(1-.13*math.exp(-((z-1.16)/.082)**2-((y-1.436)/.032)**2))

def crown(z,x):
    zs=[row[0] for row in AXIS]
    w,lo,hi=[float(np.interp(z,zs,[row[i] for row in AXIS])) for i in (1,2,3)]
    return (lo+hi)/2+(hi-lo)/2*math.sqrt(max(0,1-(x/w)**2))

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
            y=center[1]+ry*v*(1-.23*abs(h))+.11*rz*h
            z=center[2]+rz*h
            pos=(sg*(section_width(y,z)-.0035+protrude*math.cos(a)),y,z)
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
              (.250,.815,.627,.026,.030),(.241,.790,.681,.024,.031),(.245,.781,.696,.016,.016),(.246,.776,.702,.007,.008)]
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
        for i,(x,reach,drop,spread) in enumerate(((.227,.714,.732,-.018),(.249,.785,.724,.004),(.266,.811,.738,.020))):
            # Each digit starts under the continuous feathered hand, thins
            # through its knuckles and carries the dark sheath on its tip.
            row=[(x,.803,.650,.016,.016),
                 (x+.003,.780,.685+.007*i,.016,.015),
                 (x+spread*.55,drop+.020,reach-.024,.013,.012),
                 (x+spread,drop+.004,reach-.006,.010,.010),
                 (x+spread,drop,reach,.008,.008)]
            hard.append(path("manual phalanges",mirrored(row,sg),"raptor_detail",DETAIL["tarsus"],"manus_"+side,12))
            hard.append(path("manual hook",mirrored([(x+spread,drop+.003,reach-.004,.010,.010),
                      (x+spread,drop-.007,reach+.006,.008,.009),
                      (x+spread-.002,drop-.020,reach+.006,.004,.006),
                      (x+spread-.003,drop-.027,reach-.001,.001,.001)],sg),
                      "raptor_detail",DETAIL["claw"],"manus_"+side,10))
        # Primaries attach along digit II and secondaries along the ulna. Their
        # shafts sweep toward the hip and stack into one folded forewing.
        for i in range(12):
            t=i/11
            a=(sg*(.250+.018*t),.886-.084*t,.306+.369*t)
            # The long distal primaries lie outside the covert row. Their
            # separation from the thigh survives a running silhouette.
            b=(sg*(.319+.087*t+.012*math.sin(3*t)),.781-.153*t+.019*math.sin(4*t),
               .14-.34*t+.015*math.sin(7*t))
            vane(a,b,.038+.014*t,(sg*.24,.94,.27),"forearm_"+side if i<7 else "manus_"+side,0 if i<4 else 1)
        for i in range(9):
            t=i/8
            a=(sg*(.262+.010*t),.906-.081*t,.302+.349*t)
            b=(sg*(.327+.043*t),.827-.092*t,.166+.075*t)
            vane(a,b,.039,(sg*.18,.96,.26),"forearm_"+side if i<7 else "manus_"+side,2)
        for i in range(5):
            t=i/4
            vane((sg*(.250+.022*t),.916-.053*t,.300+.203*t),
                 (sg*(.292+.024*t),.862-.061*t,.215+.160*t),
                 .029,(sg*.41,.90,.19),"forearm_"+side,3)
        # Rectrices open from a short distal fleshy shaft, with a gently
        # upward arcing centre and dropped outer edges as in a folded fan.
        for i in range(10):
            t=i/9
            a=(sg*(.018+.008*t),1.055+.036*t,-1.46-.45*t)
            b=(sg*(.272*(1-t**1.85)+.037*t),1.015+.175*t,-1.95-.42*t-.048*math.sin(math.pi*t))
            vane(a,b,.051-.012*t,(sg*.90,.42-.33*t,0),"tail_4" if i<4 else "tail_5",1 if i<4 else 2)
        # Small overlapping dorsal coverts hide the transition from the
        # fleshy tail shaft to the long rectrices.
        for i in range(8):
            t=i/7; z=-1.43-.65*t
            x=.018+.010*(1-t)
            vane((sg*x,crown(z,x)-.005,z),(sg*(.116-.053*t),1.10+.078*t,z-.227-.070*t),
                 .032+.007*math.sin(math.pi*t),(sg*.96,.19,0),"tail_4" if i<4 else "tail_5",3)
        # The nape has two unequal, rear-lying rows which follow the contour
        # down to the shoulder. The outer webs break the outline in groups.
        for row,(zs,lengths) in enumerate([
            ([.751,.791,.842,.891,.920,.949,.974],[.098,.147,.154,.183,.176,.141,.135]),
            ([.769,.818,.860,.917,.957],[.092,.116,.132,.146,.117])]):
            for i,(z,length) in enumerate(zip(zs,lengths)):
                x=(.038 if row==0 else .067)+.009*math.sin(i*2.3)
                tx=x+(.019 if row==0 else .026)
                tip_z=z-length
                rise=(.018 if row==0 else .004)+.015*math.sin(i*1.35)**2
                vane((sg*x,crown(z,x)-.012,z),
                     (sg*tx,crown(tip_z,tx)+rise,tip_z),
                     (.025 if row==0 else .022)+.006*math.sin(i*1.86)**2,
                     (sg*.73,.58,.35),"neck_2" if z<.88 else "skull",3)
        # The coat itself forms the upper and lower orbit. Both lids close
        # into the skin and enclose a shallow almond-shaped corneal surface.
        eye_y,eye_z=1.482,1.075
        eye_rect=(DETAIL["eye"][0],.4375,DETAIL["eye"][2],.5625)
        hard.append(eye_patch("cornea",(0,eye_y,eye_z),sg,.022,.033,.014,eye_rect,"skull"))
        for upper in (True,False):
            rim=[]
            for i in range(11):
                t=i/10
                z=eye_z-.037+.075*t
                y=eye_y+.010*(t-.5)+(1 if upper else -1)*(.021 if upper else .017)*math.sin(math.pi*t)**.72
                radius=.003+.006*math.sin(math.pi*t)**.67
                rim.append((section_width(y,z)+.004,y,z,radius*.85,radius))
            lid=path("orbital fold",mirrored(rim,sg),bone="skull",sides=12)
            atlas_uv(lid);hard.append(lid)
        hard.append(eye_patch("naris",(0,1.427,1.413),sg,.007,.022,.005,DETAIL["naris"],"skull"))
        for i in range(16):
            z=1.052+i*.0269+.0024*math.sin(i*2.43)
            w=float(np.interp(z,[r[0] for r in AXIS],[r[1] for r in AXIS]))
            low=float(np.interp(z,[r[0] for r in AXIS],[r[2] for r in AXIS]))
            vital=.46+.54*(.5+.5*math.sin(i*2.13))
            length=.010+.013*vital
            width=.0033+.0015*vital
            pts=[(.53*w,low+.014,z,width,.006),(.56*w,low+.004,z,width,.005),
                 (.59*w,low-.004,z-.001,.003,.003),(.59*w,low-length,z-.005-.001*vital,.0007,.001)]
            hard.append(path("tooth",mirrored(pts,sg),"raptor_detail",DETAIL["tooth"],"skull",7,1))
        # Moist flexible commissure at the back of the gape stretches
        # between both rami as the animal opens its mouth.
        web=path("commissure",mirrored([(.062,1.373,.984,.014,.025),(.079,1.376,1.017,.013,.037),
                 (.083,1.380,1.056,.009,.032),(.076,1.383,1.093,.006,.023),
                 (.069,1.384,1.114,.003,.009)],sg),"raptor_detail",DETAIL["mouth"],sides=12)
        upper=web.vertex_groups.new(name="skull"); lower=web.vertex_groups.new(name="jaw")
        for vertex in web.data.vertices:
            t=min(1,max(0,(from_blender(vertex.co)[1]-1.355)/.048))
            upper.add([vertex.index],t,"REPLACE");lower.add([vertex.index],1-t,"REPLACE")
        hard.append(web)
        # Small lower crowns sit behind the labial tissue at idle. The
        # opposing tooth rows become visible at full gape.
        for i in range(12):
            z=1.084+i*.032+.002*math.sin(i)
            w=float(np.interp(z,[r[0] for r in JAW],[r[1] for r in JAW]))
            top=float(np.interp(z,[r[0] for r in JAW],[r[3] for r in JAW]))+.020
            length=.009+.009*math.sin(i*1.51)**2
            rows=[(.53*w,top-.006,z,.004,.005),(.54*w,top+.002,z+.001,.003,.004),
                  (.56*w,top+length,z-.003,.0007,.001)]
            hard.append(path("dentary tooth",mirrored(rows,sg),"raptor_detail",DETAIL["tooth"],"jaw",7,1))
    # One fusion pass makes groin, scapula and nape continuous with the trunk.
    body=join(muscles,"mantle")
    activate(body)
    body.data.remesh_voxel_size=.011
    bpy.ops.object.voxel_remesh()
    sm=body.modifiers.new("Soften muscle insertions","SMOOTH"); sm.factor=.86; sm.iterations=9
    bpy.ops.object.modifier_apply(modifier=sm.name)
    body.data.calc_loop_triangles()
    dec=body.modifiers.new("Retain silhouette curvature","DECIMATE")
    dec.ratio=min(1,11900/len(body.data.loop_triangles)); dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    body.data.materials.clear(); body.data.materials.append(bpy.data.materials["raptor_hide"])
    atlas_uv(body)
    skin_weights(body)
    jaw_stations=[(z,w*1.055,low+.004,top+.024-.005*max(0,(1.12-z)/.27)) for z,w,low,top in JAW]
    jaw=axial("mandible",jaw_stations,"jaw"); atlas_uv(jaw)
    # Dark oral cavity is visible under the palate on the open beat of a bite.
    palate=path("palate",[(0,1.373,.973,.049,.012),(0,1.378,1.067,.086,.014),
                 (0,1.378,1.22,.071,.012),(0,1.374,1.37,.045,.009),(0,1.394,1.475,.010,.008)],
                 "raptor_detail",DETAIL["mouth"],"skull",18)
    tongue=path("tongue",[(0,1.389,.974,.039,.018),(0,1.399,1.046,.073,.019),
                (0,1.397,1.160,.055,.015),(0,1.389,1.304,.040,.014),(0,1.387,1.438,.015,.009)],
                "raptor_detail",DETAIL["mouth"],"jaw",16)
    for i in range(3):
        vane(((i-1)*.016,1.081,-1.89),((i-1)*.036,1.182,-2.413+.018*abs(i-1)),.047,(1,.06,0),"tail_5",i)
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
