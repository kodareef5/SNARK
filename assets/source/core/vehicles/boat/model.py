"""Original open four-seat workboat: measured closed hull, dry interior, controls, cargo, single outboard and safe ladder.

No reference geometry is imported. Generic part construction and connected UV charting come from the compact's pipeline.
"""
import json
import math
import os
import bpy
import bmesh
from mathutils import Vector
from parts import E2B, MATERIALS, TAG, TAGS, Part, cylinder, is_closed, layout, layout_hash, rbox, tags_of, transform
from shape import BONES, HULL, SECTION_TAGS, sample, section, stations

HERE=os.path.dirname(os.path.abspath(__file__))
SIZES={"body":2048,"trim":2048,"cabin":2048}
groups={name:[] for name,_ in BONES}


def put(obj,bone="chassis"):
    groups[bone].append(obj)
    return obj


def loft(name,rings,tag):
    p=Part();p.loft(rings,tag,caps=(tag if isinstance(tag,str) else "paint",)*2)
    return p.obj(name)


def tube(name,points,r,tag,n=12):
    rings=[]
    for i,point in enumerate(points):
        p=Vector(point)
        d=(Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])).normalized()
        u=d.cross(Vector((0,1,0)) if abs(d.y)<.9 else Vector((1,0,0))).normalized();v=d.cross(u).normalized()
        rings.append([p+r*(math.cos(k*math.tau/n)*u+math.sin(k*math.tau/n)*v) for k in range(n)])
    return loft(name,rings,tag)


def loop(name,centre,radius,wire,tag,bone="chassis",n=32):
    # Complete closed torus: unlike capped tubes, no overlapped caps at a wheel's seam.
    p=Part();ids=[]
    for i in range(n):
        a=i*math.tau/n
        ids.append([p.v((centre[0]+(radius+wire*math.cos(k*math.tau/10))*math.cos(a),
                         centre[1]+(radius+wire*math.cos(k*math.tau/10))*math.sin(a),
                         centre[2]+wire*math.sin(k*math.tau/10))) for k in range(10)])
    for i in range(n):
        for k in range(10):p.face((ids[i][k],ids[(i+1)%n][k],ids[(i+1)%n][(k+1)%10],ids[i][(k+1)%10]),tag)
    return put(p.obj(name),bone)


# A single watertight U-section loft includes keel, chine, topsides, gunwale, inner wall and deck.
# No solid top spans the cockpit. Distinct deck/inner tags let salt, wear and grip follow the working surfaces.
zs=sorted(set(stations(-3.40,3.40,.16)+[r[0] for r in HULL]))
put(loft("continuous-hard-hull",[section(z) for z in zs],lambda row,k:SECTION_TAGS[k]))
# Author the actual clear envelope used by the body fit audit. The open top is deliberately unconstrained.
with open(os.path.join(HERE,"ref","interior.json"),"w") as f:
    json.dump([[[w-.09,3.2,z],[w-.09,deck,z],[-w+.09,deck,z],[-w+.09,3.2,z]] for z in zs for w,_,_,_,deck in [sample(z)]],f)

for side in (-1,1):
    path=[(side*sample(z)[0],sample(z)[3]-.07,z) for z in zs]
    put(tube("rub-rail",path,.055,"rubber",14))
    # Beaded chine reinforcement and keel shoe describe the hull's load-bearing structure.
    put(tube("lifting-strake",[(side*sample(z)[0]*.73,sample(z)[2]+.015,z) for z in stations(-3.32,2.90,.25)],.024,"metal",8))
    for za,zb in ((-2.75,-1.95),(-.55,.12),(1.84,2.50)):
        points=[]
        for z,up in ((za,0),(za+.07,.14),(zb-.07,.14),(zb,0)):
            w,_,_,sheer,_=sample(z);points.append((side*(w-.045),sheer+.025+up,z))
        put(tube("gunwale-grab-rail",points,.025,"metal",12))
        for z in (za,zb):
            w,_,_,sheer,_=sample(z)
            put(rbox("rail-foot",(side*(w-.045)-.045,sheer-.005,z-.055),(side*(w-.045)+.045,sheer+.025,z+.055),.008,"metal",2))
    # Recessed aft rigging lockers are outside the four occupied envelopes.
    put(rbox("aft-rigging-locker",(min(side*.70,side*1.13),.76,-3.18),(max(side*.70,side*1.13),1.22,-2.64),.055,"paint",4))
    put(rbox("locker-lid",(min(side*.70,side*1.13)-.005,1.22,-3.19),(max(side*.70,side*1.13)+.005,1.25,-2.63),.025,"tread",3))
    put(rbox("locker-latch",(side*.91-.05,1.253,-2.77),(side*.91+.05,1.265,-2.67),.01,"metal"))
    # Deck scuppers have a dark recess and a visible metal lip.
    put(rbox("scupper-frame",(side*1.10-.07,.755,-3.31),(side*1.10+.07,.87,-3.28),.015,"metal"))
    put(rbox("scupper-opening",(side*1.10-.045,.773,-3.315),(side*1.10+.045,.846,-3.305),.008,"plastic"))
    # Small side boarding pads are clear of moving controls and the propeller.
    put(rbox("boarding-tread",(min(side*1.14,side*1.28),1.366,-1.42),(max(side*1.14,side*1.28),1.388,-.88),.018,"tread",3))
put(tube("keel-shoe",[(0,sample(z)[1]+.017,z) for z in stations(-3.35,3.36,.20)],.018,"metal",8))

# Four independent marine seats. No armrests fence in the largest armored shoulder/forearm.
for x in (.48,-.48):
    for z in (.40,-1.20):
        name=f"seat-{x}-{z}"
        put(rbox(name+"-base",(x-.245,.745,z-.24),(x+.245,1.14,z+.22),.035,"metal",3))
        put(rbox(name+"-cushion",(x-.30,1.14,z-.30),(x+.30,1.27,z+.32),.07,"leather",5))
        put(rbox(name+"-back",(x-.31,1.22,z-.40),(x+.31,1.97,z-.25),.075,"leather",5))
        put(rbox(name+"-headrest",(x-.20,2.00,z-.40),(x+.20,2.22,z-.23),.06,"leather",4))
        for dx in (-.14,.14):put(cylinder(name+"-post",(x+dx,1.88,z-.32),(x+dx,2.05,z-.32),.012,"chrome",8))
        put(rbox(name+"-belt",(x+.26,1.28,z-.30),(x+.29,1.73,z-.27),.008,"rubber",2))
        put(rbox(name+"-buckle",(x-.29,1.26,z+.02),(x-.25,1.33,z+.09),.008,"amber",2))

# A bridge dashboard keeps its centre and side supports out of the actual boots' travel.
put(rbox("bridge-console",(-1.03,1.68,1.08),(1.03,1.80,1.48),.045,"dash",4))
for x in (-1.04,0,1.04):
    put(rbox("console-support",(x-.045,.75,1.35),(x+.045,1.73,1.49),.025,"panel",3))
for x in (.48,-.48):
    put(rbox("instrument-frame",(x-.26,1.715,1.065),(x+.26,1.865,1.095),.014,"plastic",3))
    put(rbox("instrument",(x-.23,1.735,1.055),(x+.23,1.845,1.068),.004,"gauge",2))
put(cylinder("wheel-column",(.48,1.64,.70),(.48,1.73,1.16),.031,"metal",14))
loop("wheel-rim",(.48,1.64,.67),.18,.020,"grip","steering",40)
put(cylinder("wheel-hub",(.48,1.64,.645),(.48,1.64,.715),.053,"metal",16),"steering")
for angle in (0,math.tau/3,2*math.tau/3):
    put(cylinder("wheel-spoke",(.48,1.64,.68),(.48+.16*math.cos(angle),1.64+.16*math.sin(angle),.68),.012,"metal",8),"steering")
put(rbox("throttle-binnacle",(.92,1.29,.46),(1.04,1.40,.64),.026,"plastic",4))
put(cylinder("throttle-stalk",(.98,1.38,.53),(.98,1.48,.66),.018,"metal",10),"throttle")
put(rbox("throttle-grip",(.94,1.45,.63),(1.02,1.51,.70),.025,"grip",4),"throttle")
# The throttle pedestal lies outside the armored thigh and has a genuine structural attachment.
put(cylinder("throttle-support",(.99,.77,.53),(.99,1.32,.53),.035,"metal",12))

# Broad clear panes with solid metallic surrounds. Only their glass edges/reflection slivers have geometry: the
# clear aperture also stays clear when the low-poly renderer draws flat palette colours without alpha textures.
for side in (-1,1):
    a,b=sorted((side*.025,side*1.04))
    for xa,xb,ya,yb in ((a,a+.012,1.80,2.42),(b-.012,b,1.80,2.42),(a,b,1.80,1.812),(a,b,2.408,2.42)):
        p=Part()
        p.loft([[(x,y,1.48-(y-1.80)*.20/.62+thickness) for x,y in ((xa,ya),(xb,ya),(xb,yb),(xa,yb))] for thickness in (0,.009)],"glass",caps=("glass_in","glass"))
        put(p.obj("windscreen-glass-edge"))
    put(tube("screen-frame",[(side*1.04,1.78,1.50),(side*1.04,2.42,1.29),(side*.025,2.42,1.29)],.027,"metal",12))
put(tube("screen-centre",[(0,1.79,1.49),(0,2.42,1.29)],.020,"metal",10))
put(tube("screen-bottom",[(-1.04,1.80,1.49),(1.04,1.80,1.49)],.026,"metal",12))
put(tube("wiper",[(.08,1.83,1.504),(.38,2.16,1.40),(.70,2.16,1.40)],.009,"rubber",8))

# Bow cargo locker with a real raised lid, hinges, gasket and inset latch.
put(loft("bow-cargo-locker",[[(w,bottom,z),(w,1.275,z),(-w,1.275,z),(-w,bottom,z)]
                            for z,w,bottom in ((1.95,.72,.82),(2.48,.65,.98),(2.95,.36,1.16))],"paint"))
for name,y0,y1,shrink,tag in (("cargo-lid-gasket",1.273,1.285,.012,"rubber"),("cargo-lid",1.285,1.30,.020,"paint")):
    put(loft(name,[[(w-shrink,y0,z),(w-shrink,y1,z),(-w+shrink,y1,z),(-w+shrink,y0,z)]
                   for z,w in ((1.98,.71),(2.48,.65),(2.92,.37))],tag))
for x in (-.28,.28):put(cylinder("cargo-hinge",(x-.07,1.31,2.80),(x+.07,1.31,2.80),.018,"metal",10))
put(rbox("cargo-latch-pocket",(-.075,1.301,2.12),(.075,1.312,2.26),.025,"plastic",3))
put(rbox("cargo-latch",(-.050,1.313,2.15),(.050,1.33,2.23),.018,"metal",3))
for side in (-1,1):
    for z in (-2.43,2.65):
        w,_,_,sheer,_=sample(z);x=side*(w-.12)
        put(rbox("cleat-base",(x-.05,sheer,z-.12),(x+.05,sheer+.025,z+.12),.012,"metal"))
        put(cylinder("cleat-post",(x,sheer+.02,z),(x,sheer+.09,z),.022,"metal",10))
        put(cylinder("cleat-bar",(x,sheer+.09,z-.12),(x,sheer+.09,z+.12),.024,"metal",10))
put(cylinder("fuel-fill",(-1.23,1.36,-2.38),(-1.23,1.385,-2.38),.055,"metal",16))

# One outboard: closed cowling, ventilation, mount, shaft, anti-cavitation plate, skeg and three pitched blades.
put(rbox("transom-bracket",(-.38,.62,-3.53),(.38,1.13,-3.27),.045,"metal",4))
put(cylinder("steering-pivot",(0,.64,-3.48),(0,1.15,-3.48),.080,"chrome",16))
put(rbox("engine-cowling",(-.37,1.03,-4.07),(.37,1.78,-3.45),.19,"engine",6),"outboard")
put(rbox("cowling-lower",(-.29,.79,-3.99),(.29,1.12,-3.45),.10,"plastic",4),"outboard")
for side in (-1,1):
    put(rbox("engine-vent",(side*.365-.008,1.45,-3.92),(side*.365+.008,1.59,-3.60),.022,"mesh",3),"outboard")
put(rbox("shaft-leg",(-.10,.03,-3.78),(.10,.98,-3.51),.07,"engine",4),"outboard")
put(rbox("cavitation-plate",(-.31,.35,-4.08),(.31,.39,-3.48),.04,"engine",3),"outboard")
put(cylinder("gear-case",(0,.08,-3.47),(0,.08,-3.95),.115,"engine",18),"outboard")
p=Part();p.loft([[(-.035,.08,-3.79),(-.035,-.28,-3.90),(-.035,-.19,-3.58),(-.035,.08,-3.49)],
                 [(.035,.08,-3.79),(.035,-.28,-3.90),(.035,-.19,-3.58),(.035,.08,-3.49)]],"engine",caps=("engine","engine"));put(p.obj("skeg"),"outboard")
put(cylinder("propeller-hub",(0,.08,-3.87),(0,.08,-4.03),.065,"metal",16),"propeller")
for angle in (0,math.tau/3,2*math.tau/3):
    rings=[]
    for radius,width,pitch in ((.05,.055,0),(.16,.13,.02),(.255,.095,.045),(.27,.025,.05)):
        rings.append([(radius*math.cos(angle)-(side*width)*math.sin(angle),.08+radius*math.sin(angle)+(side*width)*math.cos(angle),-3.94+pitch+thick) for side,thick in ((-.5,-.008),(.5,-.008),(.5,.008),(-.5,.008))])
    put(loft("pitched-prop-blade",rings,"metal"),"propeller")
for side in (-1,1):
    put(tube("engine-rigging",[(side*.25,1.01,-3.30),(side*.33,1.03,-3.51),(side*.23,.92,-3.63)],.024,"rubber",10))
put(tube("engine-guard",[(-.63,1.16,-3.25),(-.63,1.47,-3.24),(.63,1.47,-3.24),(.63,1.16,-3.25)],.035,"metal",14))
put(cylinder("tow-post",(0,.75,-2.96),(0,1.42,-2.96),.045,"metal",14))
put(cylinder("tow-bar",(-.18,1.42,-2.96),(.18,1.42,-2.96),.032,"metal",12))

# Offset recovery ladder never crosses the engine/propeller corridor. Back rungs extend below the unladen waterline.
for x in (.84,1.22):
    put(tube("ladder-rail",[(x,-.15,-3.48),(x,1.06,-3.48),(x,1.15,-3.42),(x,1.15,-3.19),(x,1.01,-3.14)],.027,"metal",12))
for y in (-.10,.20,.50,.80):
    put(cylinder("ladder-rung",(.84,y,-3.48),(1.22,y,-3.48),.026,"metal",12))
    put(cylinder("rung-grip",(.88,y,-3.48),(1.18,y,-3.48),.031,"rubber",12))
for side in (-1,1):
    put(rbox("navigation-housing",(side*1.0-.055,1.48,1.80),(side*1.0+.055,1.54,1.94),.025,"plastic",3))
    put(rbox("navigation-lens",(side*1.0-.045,1.50,1.87),(side*1.0+.045,1.55,1.945),.02,"taillamp" if side>0 else "headlamp",3))

# Assemble rigid semantic parts, retain closed islands, pack connected UV charts and quantize before tangent export.
parts={}
for name,objects in groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();obj=objects[0];obj.name=name
    transform(obj,E2B)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=bm.faces,quad_method="BEAUTY",ngon_method="BEAUTY");bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(obj.data);bm.free()
    parts[name]=obj
objects=list(parts.values());density=layout(objects,SIZES)
for obj in objects:
    for uv in obj.data.uv_layers.active.data:uv.uv=(round(uv.uv.x*65535)/65535,round(uv.uv.y*65535)/65535)
print("boat texels/metre:",density)
final=[bpy.data.materials.get(m) or bpy.data.materials.new(m) for m in MATERIALS]
rig=bpy.data.objects["boat"]
for bone,obj in parts.items():
    bad=is_closed(obj)
    if bad:raise SystemExit(f"boat: {bone} has {bad} boundary edges")
    me=obj.data;tags=tags_of(obj);attr=me.attributes.new("tag","INT","FACE")
    for face,tag in zip(me.polygons,tags):attr.data[face.index].value=TAG[tag]
    me.materials.clear()
    for m in final:me.materials.append(m)
    for face,tag in zip(me.polygons,tags):face.material_index=MATERIALS.index(dict(TAGS)[tag]);face.use_smooth=True
    me.set_sharp_from_angle(angle=math.radians(35))
    obj.vertex_groups.new(name=bone).add(list(range(len(me.vertices))),1,"REPLACE")
    obj.parent=rig;obj.modifiers.new("Armature","ARMATURE").object=rig
digest=layout_hash(objects);print("boat layout:",digest)
known=os.path.join(HERE,"tex","layout.json")
if os.environ.get("BOAT_LAYOUT")!="new":
    wanted=json.load(open(known))["hash"] if os.path.exists(known) else None
    if wanted!=digest:raise SystemExit(f"boat layout changed: {digest}; repaint textures from tex/bake.py")
