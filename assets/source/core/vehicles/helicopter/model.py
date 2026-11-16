"""The original utility helicopter. Closed surface parts, a genuinely hollow four-seat cabin and measured movable doors.

The concept in ref/concept.png guides the silhouette; geometry is authored here, not reconstructed from the picture.
Every semantic surface has a tag and a model-space paint coordinate, so all seven material maps remain aligned.
"""
import json
import math
import os
import bmesh
import bpy
from mathutils import Matrix, Vector
from parts import E2B, MATERIALS, TAG, TAGS, Part, boolean, cylinder, duplicate, is_closed, layout, layout_hash, remove, retag, rbox, tags_of, transform
from shape import BONES, ring, sample, stations

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = {"body": 2048, "trim": 2048, "cabin": 2048}
groups = {name: [] for name, _ in BONES}


def put(obj, bone="chassis", rigid=None):
    # A stationary hub shares the rotor's existing texture charts but keeps the chassis weight. This lets the
    # renderer replace fast blades with a motion card without hiding the hub hardware or changing UVs.
    if rigid:
        obj.vertex_groups.new(name=rigid).add(list(range(len(obj.data.vertices))),1,"REPLACE")
    groups[bone].append(obj)
    return obj


def joined(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def loft(name, rings, tag):
    p = Part()
    p.loft(rings, tag, caps=(tag, tag))
    return p.obj(name)


def prism(name, outline, axis, start, end, tag):
    def at(q, v):
        return (v, q[1], q[0]) if axis == "x" else (q[0], v, q[1])
    return loft(name, [[at(q, v) for q in outline] for v in (start, end)], tag)


def rounded(outline, ratio=.12):
    pts = []
    for i, p in enumerate(outline):
        a, b = outline[i - 1], outline[(i + 1) % len(outline)]
        near = (p[0] + (a[0] - p[0]) * ratio, p[1] + (a[1] - p[1]) * ratio)
        far = (p[0] + (b[0] - p[0]) * ratio, p[1] + (b[1] - p[1]) * ratio)
        for j in range(5):
            t = j / 4
            pts.append(((1-t)**2 * near[0] + 2*t*(1-t)*p[0] + t*t*far[0], (1-t)**2*near[1] + 2*t*(1-t)*p[1] + t*t*far[1]))
    return pts


def tube(name, points, r, tag, n=12):
    rings = []
    for i, p in enumerate(points):
        p = Vector(p)
        d = Vector(points[min(len(points)-1, i+1)]) - Vector(points[max(0, i-1)])
        d.normalize()
        u = d.cross(Vector((0, 1, 0)) if abs(d.y) < .9 else Vector((1, 0, 0))).normalized()
        v = d.cross(u).normalized()
        rings.append([p + r * (math.cos(k*math.tau/n)*u + math.sin(k*math.tau/n)*v) for k in range(n)])
    return loft(name, rings, tag)


def side_x(y,z):
    w,low,high=sample(z)
    c=(low+high)/2; h=(high-low)/2
    v=max(-1,min(1,(y-c)/h))
    co=abs(v)**(1/(.78 if v>=0 else .45))
    return w*(max(0,1-co*co)**.5)**.64


def bow_z(x,y):
    z=1.38
    for k in range(1000):
        candidate=1.38+(2.45-1.38)*k/999
        _,low,high=sample(candidate)
        if low<=y<=high and abs(x)<=side_x(y,candidate): z=candidate
    return z


def glass(name, shell, cutter, axis, sign, bone="chassis"):
    pane = boolean(duplicate(shell, name), cutter, "INTERSECT")
    retag(pane, lambda t, c, n: "glass_in" if (n.x * sign < -.3 if axis == "x" else n.z < -.2) else "glass")
    put(pane, bone)
    return pane


# A lofted closed outer shell, then an inner volume removed. The inner roof leaves 1.40m above every seat pelvis.
outer = loft("cabin-shell", [ring(z) for z in stations(-2.02, 2.45, .075)], "paint")
inner_rings=[]
for z in stations(-1.93,2.33,.075):
    w,low,high=sample(z)
    c=(low+high)/2
    inner_rings.append([(x*max(.1,w-.065)/w,c+(y-c)*max(.1,(high-low)/2-.065)/((high-low)/2),zz) for x,y,zz in ring(z)])
inside = loft("cabin-volume",inner_rings,"panel")
# Keep exact authoring rings for the real human mesh fit audit, including the flatter boot wells.
with open(os.path.join(HERE,"ref","interior.json"),"w") as f: json.dump(inner_rings,f)
shell = boolean(outer, inside, "DIFFERENCE")
remove(inside)
whole_shell = duplicate(shell, "door-source")

# Door apertures and separate shells, front and rear. Thin solid surrounds keep the window edge substantial at range.
for side, suffix in ((1, "left"), (-1, "right")):
    for row, za, zb in (("front", -.08, 1.37), ("rear", -1.59, -.17)):
        bone = f"door_{row}_{suffix}"
        outline = rounded([(za, .78), (zb, .78), (zb, 2.36 if row == "front" else 2.43), (za, 2.43)])
        cut = prism(f"{bone}-opening", outline, "x", side*.78, side*1.65, "jamb")
        door = boolean(duplicate(whole_shell, bone), cut, "INTERSECT")
        boolean(shell, cut, "DIFFERENCE")
        remove(cut)
        # A slight inset prevents the shut door and frame sharing any surface.
        for v in door.data.vertices:
            v.co.z = (v.co.z - (za+zb)/2)*.975 + (za+zb)/2
            v.co.y = (v.co.y - 1.60)*.975 + 1.60
        win_outline = rounded([(za+.10, 1.36), (zb-.10, 1.36), (zb-.10, 2.29 if row == "front" else 2.34), (za+.10, 2.34)])
        wc = prism(f"{bone}-window", win_outline, "x", side*.80, side*1.60, "rubber")
        glass(f"{bone}-glass", door, wc, "x", side, bone)
        boolean(door, wc, "DIFFERENCE")
        remove(wc)
        put(door, bone)
        # The handle is behind the hinge, low enough for the standing survivor to reach.
        hx = side*(side_x(1.24,za+.30)+.008)
        put(rbox(f"{bone}-handle-pocket", (min(hx, hx+side*.018), 1.20, za+.18), (max(hx, hx+side*.018), 1.28, za+.42), .018, "plastic"), bone)
        put(cylinder(f"{bone}-handle", (hx+side*.026, 1.25, za+.22), (hx+side*.026, 1.25, za+.38), .018, "metal", 10), bone)
        for y in (1.02, 1.95):
            hinge=side*(1.20 if row=="front" else 1.22)
            skin=side*side_x(y,zb-.02)
            put(rbox(f"{bone}-hinge-bracket",(min(skin,hinge)-.008,y-.032,zb-.065),(max(skin,hinge)+.008,y+.032,zb+.025),.008,"metal",2),bone)
            put(cylinder(f"{bone}-hinge", (hinge, y-.045, zb-.02), (hinge, y+.045, zb-.02), .034, "metal", 12), bone)

# Broad two-piece windscreen. Its inside is transparent; its outside keeps only a rim and restrained reflection streaks.
for side in (1, -1):
    cut = rbox(f"windscreen-cut-{side}", (min(side*.045, side*1.13), 1.34, 1.38), (max(side*.045, side*1.13), 2.80, 2.65), .08, "rubber", 4)
    glass(f"windscreen-{side}", whole_shell, cut, "z", 1)
    boolean(shell, cut, "DIFFERENCE")
    remove(cut)
remove(whole_shell)
put(shell)

# Opaque cabin structure and tidy interior trim. The floor and roof are real meshes, visible from every seat.
put(rbox("floor", (-.90, .53, -1.43), (.90, .58, 1.62), .07, "carpet"))
put(rbox("rear-bulkhead", (-.93, .67, -1.72), (.93, 2.28, -1.63), .08, "panel"))
put(rbox("overhead-console", (-.18, 2.38, -.85), (.18, 2.47, 1.06), .05, "dash"))

# Four separate upholstered seats. Humans sit on the cushion; all usable space was set from HUMAN's pose first.
for x in (.48, -.48):
    for z in (.65, -.95):
        tag = f"seat-{x}-{z}"
        put(rbox(tag+"-base", (x-.27, .55, z-.26), (x+.27, .96, z+.24), .05, "metal"))
        put(rbox(tag+"-cushion", (x-.30, .96, z-.30), (x+.30, 1.09, z+.32), .075, "leather", 5))
        put(rbox(tag+"-back", (x-.31, 1.04, z-.40), (x+.31, 1.79, z-.25), .08, "leather", 5))
        put(rbox(tag+"-headrest", (x-.20, 1.82, z-.40), (x+.20, 2.04, z-.23), .07, "leather", 5))
        for sx in (-.22, .22):
            put(cylinder(tag+"-headrest-post", (x+sx*.65, 1.70, z-.32), (x+sx*.65, 1.90, z-.32), .012, "chrome", 8))
        # Belt webbing is stowed at the seat's side, so it does not cut through different body proportions.
        put(rbox(tag+"-belt", (x+.255, 1.10, z-.30), (x+.295, 1.58, z-.27), .008, "rubber", 2))
        put(rbox(tag+"-buckle", (x-.29, 1.08, z+.02), (x-.25, 1.15, z+.09), .008, "amber", 2))

# Low binnacle gives the pilot a view of the landing area. Display graphics are painted on measured tagged faces.
put(rbox("instrument-pedestal", (-.40, .55, 1.48), (.40, 1.29, 1.78), .09, "dash", 4))
panel = put(rbox("instrument-panel", (-.78, 1.25, 1.48), (.78, 1.52, 1.75), .07, "dash", 4))
for x in (.43, -.43):
    put(rbox("display-frame", (x-.245, 1.29, 1.465), (x+.245, 1.48, 1.49), .018, "plastic"))
    put(rbox("display", (x-.21, 1.315, 1.455), (x+.21, 1.46, 1.47), .006, "gauge", 2))
for x in (-.13, 0, .13):
    put(cylinder("switch", (x, 1.28, 1.44), (x, 1.28, 1.47), .015, "amber" if x==0 else "metal", 10))
put(tube("pilot-cyclic", [(0.48,.73,1.15), (.40,1.13,1.05), (.34,1.29,.97)], .025, "metal"), "cyclic")
put(rbox("cyclic-grip", (.305,1.29,.935), (.375,1.43,1.005), .025, "grip"), "cyclic")
put(cylinder("collective", (.81,.95,.42), (.76,1.30,.79), .025, "metal", 12))
put(cylinder("collective-grip", (.76,1.30,.79), (.76,1.30,.95), .035, "grip", 12))
for dx in (-.13,.13):
    put(cylinder("pedal-support", (.48+dx,.57,1.61), (.48+dx,.68,1.61), .02, "metal", 8))
    put(rbox("pedal", (.48+dx-.065,.66,1.53), (.48+dx+.065,.70,1.70), .018, "rubber"))

# Curved landing skids, two load-bearing cross tubes and rubber footboards. No unsupported rods end at the skin.
for side in (-1,1):
    x=side*1.40
    points=[(x,.18,-1.95),(x,.09,-1.75),(x,.075,-1.40),(x,.075,1.52),(x,.09,1.72),(x,.17,1.92),(x,.30,2.05)]
    put(tube(f"skid-{side}",points,.075,"rubber",16))
    for z in (-1.10,1.05):
        put(tube("skid-strut",[(side*.66,.63,z),(side*.95,.55,z),(side*1.28,.14,z),(x,.13,z)],.057,"metal",12))
        put(rbox("skid-mount",(side*.66-.10,.60,z-.13),(side*.66+.10,.72,z+.13),.04,"metal"))
    put(rbox("step-board",(min(side*1.43,side*1.13),.27,-1.35),(max(side*1.43,side*1.13),.32,1.25),.035,"tread",3))

# Tapered tail boom, flowing out of the cabin's aft shoulder. A single original section family keeps the livery continuous.
tail=[]
for z in stations(-1.65,-5.65,.13):
    t=(-z-1.65)/4.0
    w=.48*(1-t)+.075*t
    h=.40*(1-t)+.09*t
    cy=1.65+.26*t
    tail.append([(w*math.sin(k*math.tau/24),cy+h*math.cos(k*math.tau/24),z) for k in range(24)])
put(loft("tail-boom",tail,"paint"))
fin=rounded([(-5.77,1.27),(-5.47,1.35),(-5.10,2.75),(-5.22,2.95),(-5.48,2.90),(-5.85,1.73)],.06)
put(prism("tail-fin",fin,"x",-.065,.065,"paint"))
for side in (-1,1):
    p=Part()
    p.loft([[(side*.08,1.73,-4.82),(side*.08,1.76,-4.48),(side*.08,1.80,-4.45),(side*.08,1.77,-4.82)],[(side*.70,1.78,-4.78),(side*.70,1.79,-4.50),(side*.70,1.82,-4.50),(side*.70,1.81,-4.78)]],"paint",caps=("paint","paint"))
    put(p.obj("tailplane"))
put(cylinder("tail-drive",(-.12,2,-5.50),(.35,2,-5.50),.11,"metal",16))

# Turbine fairing, intake screens, exhaust and rotor mast with distinct mechanical collars and pitch links.
cowling=put(rbox("turbine-cowling",(-.58,2.43,-1.58),(.58,2.87,.48),.25,"paint",6))
for side in (-1,1):
    put(rbox("intake-surround",(min(side*.54,side*.60),2.55,-1.30),(max(side*.54,side*.60),2.78,-.48),.045,"plastic"))
    put(rbox("intake-screen",(min(side*.592,side*.607),2.58,-1.24),(max(side*.592,side*.607),2.75,-.54),.025,"mesh"))
    put(cylinder("exhaust-lip",(side*.33,2.62,-1.42),(side*.33,2.62,-1.78),.12,"exhaust",20))
    put(cylinder("exhaust-dark",(side*.33,2.62,-1.785),(side*.33,2.62,-1.79),.089,"plastic",20))
put(cylinder("mast",(0,2.68,-.30),(0,3.22,-.30),.075,"chrome",20))
for y,r,h in ((2.88,.19,.06),(3.04,.27,.045),(3.15,.19,.10)):
    put(cylinder("mast-collar",(0,y,-.30),(0,y+h,-.30),r,"metal",24))
for side in (-1,1):
    put(cylinder("pitch-link",(side*.18,2.91,-.30),(side*.28,3.15,-.30),.016,"chrome",10))


def blade(name, centre, radius, axis, angle, width, bone):
    # Closed aerofoil sections, with root thick enough to read and a swept narrow tip.
    p=Part()
    rings=[]
    for r,w,thick,sweep in ((.22,width*.62,.045,0),(.45,width,.037,0),(radius*.76,width,.022,.02),(radius-.13,width*.78,.012,.10),(radius,width*.42,.008,.17)):
        points=[]
        for chord,up in ((-.5,0),(-.34,.65),(.05,1),(.42,.40),(.5,0),(.05,-.45)):
            b=chord*w+sweep; h=up*thick
            a=math.sqrt(max(0,r*r-b*b)) if r==radius else r
            xx=a*math.cos(angle)-b*math.sin(angle); zz=a*math.sin(angle)+b*math.cos(angle)
            points.append((centre[0]+xx,centre[1]+h,centre[2]+zz) if axis=="y" else (centre[0]+h,centre[1]+xx,centre[2]+zz))
        rings.append(points)
    p.loft(rings,lambda row,k:"amber" if row==3 else "plastic",caps=("metal","amber"))
    put(p.obj(name),bone)


for k in range(4):
    blade(f"main-blade-{k}",(0,3.15,-.30),4.60,"y",k*math.tau/4,.235,"rotor_main")
    a=k*math.tau/4
    put(cylinder("rotor-grip",(.15*math.cos(a),3.15,-.30+.15*math.sin(a)),(.48*math.cos(a),3.15,-.30+.48*math.sin(a)),.045,"metal",12),"rotor_main",rigid="chassis")
put(cylinder("hub-cap",(0,3.20,-.30),(0,3.32,-.30),.23,"metal",24),"rotor_main",rigid="chassis")
for k in range(2):
    blade(f"tail-blade-{k}",(.28,2,-5.50),.68,"x",.5+k*math.pi,.14,"rotor_tail")
put(cylinder("tail-hub",(.23,2,-5.50),(.37,2,-5.50),.085,"metal",16),"rotor_tail",rigid="chassis")

# Functional small details: navigation lamps, landing lamps, refuel cap and antennas. They remain opaque materials.
for side in (-1,1):
    light_x=side*(side_x(1.435,1.415)+.015)
    put(rbox("navigation-light",(light_x-.04,1.40,1.35),(light_x+.04,1.47,1.48),.025,"taillamp" if side>0 else "headlamp"))
    front=bow_z(side*.31,1.14)
    put(cylinder("landing-lamp-housing",(side*.31,1.14,front-.035),(side*.31,1.14,front+.035),.088,"plastic",16))
    put(cylinder("landing-lamp",(side*.31,1.14,front+.025),(side*.31,1.14,front+.048),.075,"headlamp",16))
put(cylinder("fuel-cap",(-1.253,1.25,-1.43),(-1.278,1.25,-1.43),.065,"metal",16))
put(tube("aft-antenna",[(0,2.80,-1.10),(0,3.05,-1.28)],.012,"plastic",8))
put(tube("belly-antenna",[(0,.58,-.75),(0,.28,-.95)],.012,"plastic",8))

# Join each rigid part before laying out, but keep its closed islands. Joining avoids making rivets independent entities.
for name, objects in groups.items():
    for o in objects:
        if is_closed(o): print("open-before-join", name, o.name, is_closed(o))
parts={name:joined(name,objs) for name,objs in groups.items() if objs}
for o in parts.values():
    transform(o,E2B)
    bm=bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm,faces=bm.faces,quad_method="BEAUTY",ngon_method="BEAUTY")
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(o.data); bm.free()

objects=list(parts.values())
density=layout(objects,SIZES)
# Quantize the UV layout to the native pack's grid before Blender computes tangents. Tiny Boolean triangles then
# have their actual final winding during export, so a mirrored wedge is split correctly instead of changing later.
for o in objects:
    for uv in o.data.uv_layers.active.data:
        uv.uv = (round(uv.uv.x*65535)/65535,round(uv.uv.y*65535)/65535)
print("helicopter texels/metre:",density)
final=[bpy.data.materials.get(m) or bpy.data.materials.new(m) for m in MATERIALS]
rig=bpy.data.objects["helicopter"]
for bone,o in parts.items():
    bad=is_closed(o)
    if bad:
        raise SystemExit(f"helicopter: {bone} has {bad} boundary edges")
    me=o.data; tags=tags_of(o)
    attr=me.attributes.new("tag","INT","FACE")
    for p,t in zip(me.polygons,tags): attr.data[p.index].value=TAG[t]
    me.materials.clear()
    for m in final: me.materials.append(m)
    for p,t in zip(me.polygons,tags): p.material_index=MATERIALS.index(dict(TAGS)[t]); p.use_smooth=True
    me.set_sharp_from_angle(angle=math.radians(35))
    group=o.vertex_groups.new(name=bone); group.add([v.index for v in me.vertices if not v.groups],1,"REPLACE")
    o.parent=rig; o.modifiers.new("Armature","ARMATURE").object=rig

digest=layout_hash(objects)
print("helicopter layout:",digest)
known=os.path.join(HERE,"tex","layout.json")
if os.environ.get("HELICOPTER_LAYOUT") != "new":
    wanted=json.load(open(known))["hash"] if os.path.exists(known) else None
    if wanted != digest: raise SystemExit(f"helicopter layout changed: {digest}; repaint textures from tex/bake.py")
