"""Original Trike anatomy and reproducible atlas geometry.

The hide is a continuous closed surface: sculpted trunk/neck/head/tail stations
and four muscular bent limbs joined by a voxel union, relaxed and reduced.
The skull shield, jaws, horns, eyelids and toes are individually authored closed
surfaces. Nothing is read from assets/raw. Layout data is emitted under var for
the original painter; the committed PNGs remain normal asset inputs.
"""

import hashlib
import heapq
import json
import math
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import rig
from parts import Part, activate, join, smooth_rows
from plan import BODY, BONES, EYE, EYE_RADIUS, HORNS, LEGS, LEG_DEPTH, LEG_WIDTH, NASAL, hooves, pads, to_animal, to_blender

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
OUT = ROOT / "var/trike-art"
SKIN_BODY = (.02,.50,.98,.98)
SKIN_FRONT = (.02,.09,.23,.36)
SKIN_BACK = (.25,.09,.46,.36)
SKIN_HEAD = (.48,.22,.98,.47)
SKIN_ORBIT_OUTER = (.75,.02,.86,.19)
SKIN_ORBIT_INNER = (.87,.02,.98,.19)
SKIN_FRILL = (.75,.02,.98,.47)
SKIN_FRILL_FRONT = (.02,.02,.98,.42)
SKIN_FRILL_BACK = (.02,.58,.98,.98)
SKIN_FRILL_EDGE = (.02,.45,.98,.55)
ORAL = (.75,.75,.98,.79)
TONGUE = (.75,.80,.98,.835)
PALATE = (.75,.845,.98,.88)
NAILS = (.76,.90,.98,.98)
_shield_surface=None
_shield_faces=None
_shield_edge=None
_body_surface=None
_trunk_surface=None
_leg_surfaces={}
_orbital_surface=None
_cranial_surface=None
_oral_surface=None


def rect_uv(rect,u,v):
    return (rect[0]+(rect[2]-rect[0])*u,rect[1]+(rect[3]-rect[1])*v)


def on_shield(p):
    # Retain anatomical surface provenance through the continuous union.
    # A coarse Y/Z cut misclassified both the raised neck and lower shield
    # keel, making different physical surfaces overwrite the same UV island.
    q=to_blender(p)
    return _shield_surface.find_nearest(q)[3] < _body_surface.find_nearest(q)[3]


def surface_tree(objects):
    points=[];faces=[]
    for obj in objects:
        base=len(points);points.extend(tuple(v.co) for v in obj.data.vertices)
        faces.extend(tuple(base+i for i in p.vertices) for p in obj.data.polygons)
    return BVHTree.FromPolygons(points,faces)


def shield_front(p):
    # Retain the actual authored front/back surfaces through the remesh.
    # An approximate ellipsoidal mid-plane mislabels the strongly vaulted
    # lateral base, where the two sides then collide in the same UV chart.
    q=to_blender(p)
    return _shield_faces[0].find_nearest(q)[3] <= _shield_faces[1].find_nearest(q)[3]


def make_hide():
    global _shield_surface,_body_surface,_trunk_surface,_leg_surfaces,_orbital_surface,_cranial_surface,_oral_surface
    body=Part("hide_sculpt")
    stations=smooth_rows(BODY,3)
    rings=[];sides=32
    for z,y,w,up,down in stations:
        ring=[]
        for i in range(sides):
            a=i*math.tau/sides;s=math.sin(a)
            # Low keel between the forelimbs, broad back and full abdomen.
            h=up if s>=0 else down
            ring.append(body.point((w*math.cos(a), y+h*s,z)))
        rings.append(ring)
    for a,b in zip(rings,rings[1:]):
        for i in range(sides):body.face((a[i],a[(i+1)%sides],b[(i+1)%sides],b[i]))
    body.face(tuple(reversed(rings[0])));body.face(rings[-1])
    objects=[body.object()]
    _trunk_surface=surface_tree(objects);_leg_surfaces={}
    for end,points in LEGS.items():
        for side,sign in (("l",1),("r",-1)):
            begin=len(objects)
            if end=="front":
                # Posterolateral humerus, a distinct rear olecranon, paired
                # forearm shafts and an expanded but short carpal platform.
                # Section changes carry the anatomy before scales are painted.
                shape=[(.40,2.00,.55,.10,.10),(.62,1.93,.55,.25,.30),
                       (.81,1.72,.43,.30,.34),(.91,1.45,.23,.285,.26),
                       (.94,1.22,.035,.245,.265),(.94,1.08,.17,.205,.205),
                       (.91,.91,.32,.18,.185),(.885,.70,.49,.155,.165),
                       (.86,.49,.65,.135,.14),(.86,.37,.73,.185,.15),
                       (.86,.24,.85,.23,.215),(.86,.17,.94,.26,.21)]
            else:
                # Weight-bearing femur and tibia, not a long canine hock.
                shape=[(.40,2.00,-1.53,.10,.10),(.67,1.92,-1.53,.33,.39),
                       (.82,1.68,-1.43,.36,.35),(.89,1.36,-1.27,.28,.285),
                       (.90,1.14,-1.24,.225,.25),(.88,.96,-1.32,.195,.23),
                       (.865,.74,-1.43,.155,.195),(.85,.49,-1.54,.145,.16),
                       (.85,.35,-1.53,.18,.17),(.85,.23,-1.45,.225,.21),
                       (.85,.17,-1.39,.26,.20)]
            rows=[(x*sign,y,z,w,d) for x,y,z,w,d in shape]
            # The broad fleshy toe pad is supported by the last short segment.
            foot=points[-1]
            objects.append(Part(f"{end}_sculpt_{side}").loft(rows,sides=24,section_power=.82 if end=='front' else .90).object())
            for name,centre,radii,sides,rings in pads(end):
                objects.append(Part(f'{end}_{name}_{side}').ellipsoid(
                    (centre[0]*sign,centre[1],centre[2]),radii,(.01,.01,.99,.99),sides,rings).object())
            # Muscle bellies fade into the ribs and pelvis. The leg's top cap
            # is buried; these volumes form the visible scapular/thigh contour.
            muscle=[(.34,2.20,-.18,.07,.15),(.52,2.25,-.10,.12,.26),(.67,2.08,.10,.17,.30),
                    (.80,1.87,.23,.23,.29),(.91,1.59,.12,.21,.245),
                    (.97,1.30,-.06,.17,.20),(.96,1.18,-.07,.12,.13)] if end=="front" else [
                (.56,2.17,-1.77,.10,.23),(.78,1.95,-1.67,.24,.40),
                (.96,1.67,-1.53,.245,.34),(.98,1.36,-1.34,.21,.245),(.91,1.14,-1.28,.14,.15)]
            objects.append(Part(f"{end}_muscle_{side}").loft([(x*sign,y,z,w,d) for x,y,z,w,d in muscle],24,subdivisions=2,section_power=.85).object())
            if end=='front':
                # The anterior deltopectoral mass remains distinct from the
                # posterior triceps; its lower tendon narrows into the elbow.
                deltoid=[(.62,1.93,.62,.12,.15),(.80,1.67,.58,.18,.20),
                         (.92,1.40,.34,.13,.15),(.94,1.26,.20,.055,.065)]
                objects.append(Part(f'deltoid_{side}').loft([(x*sign,y,z,w,d) for x,y,z,w,d in deltoid],20,subdivisions=2).object())
            _leg_surfaces[f'{end}_{side}']=surface_tree(objects[begin:])
    orbitals=[]
    for side,sign in (("l",1),("r",-1)):
        # A planar jugal bridge connects the orbit, cheek and basal shield.
        # It is a continuous bony arch, not a spherical cheek pasted on hide.
        jugal=[(.43*sign,1.73,2.30,.10,.12),(.53*sign,1.78,2.14,.12,.16),
               (.60*sign,1.84,2.02,.12,.14),(.68*sign,1.98,1.83,.14,.15),
               (.82*sign,2.20,1.56,.13,.15),(.86*sign,2.39,1.34,.085,.11),
               (.77*sign,2.50,1.21,.055,.07)]
        objects.append(Part(f'jugal_arch_{side}').loft(jugal,24,subdivisions=2,section_power=.72).object())
        objects.append(Part(f"cheek_{side}").ellipsoid((.44*sign,1.76,2.16),(.12,.205,.31),(.01,.01,.99,.99),24,12).object())
        # An asymmetric ascending orbital buttress merges the lower cheek
        # into the dorsal horn root. A complete spheroid here leaves a donut
        # around the aperture even after the cavity is cut.
        orbit=[(.46,1.85,2.27,.075,.12),(.565,1.94,2.17,.095,.155),
               (.60,2.045,2.08,.105,.18),(.565,2.15,2.035,.13,.17),
               (.47,2.235,2.055,.14,.14),(.43,2.26,2.09,.095,.10)]
        objects.append(Part(f"orbital_brow_{side}").loft([(x*sign,y,z,w,d) for x,y,z,w,d in orbit],24,subdivisions=2,section_power=.85).object())
        orbitals.append(objects[-1])
        # A narrow fleshy horn sheath joins the keratin to the bony brow,
        # rather than ending a smooth conical horn directly on a flat hide.
        collar=[(.43*sign,2.10,2.04,.16,.145),(.44*sign,2.18,2.11,.16,.14),
                (.45*sign,2.25,2.17,.145,.125)]
        objects.append(Part(f'horn_sheath_{side}').loft(collar,20,subdivisions=2).object())
        orbitals.append(objects[-1])
    _orbital_surface=surface_tree(orbitals)
    nasal_sheath=[(0,1.89,2.65,.15,.14),(0,1.95,2.68,.185,.16),(0,2.025,2.70,.14,.13)]
    objects.append(Part('nasal_sheath').loft(nasal_sheath,24,subdivisions=2).object())
    _cranial_surface=surface_tree([obj for obj in objects if obj not in orbitals])
    shield=make_frill()
    _shield_surface=surface_tree([shield]);_body_surface=surface_tree(objects)
    objects.append(shield)
    obj=join(objects,"trike_hide")
    activate(obj)
    obj.data.remesh_voxel_size=.027
    obj.data.use_remesh_preserve_volume=True
    bpy.ops.object.voxel_remesh()
    smooth=obj.modifiers.new("continuous_muscle_surface","SMOOTH")
    smooth.factor=.48;smooth.iterations=3
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    # Broad compressed skin folds beneath the jugal/neck junction belong in
    # the silhouette as well as the normal map. Their envelope fades into the
    # cheek and throat rather than adding separate tubular wrinkles.
    for vertex in obj.data.vertices:
        p=to_animal(vertex.co)
        envelope=math.exp(-((p.z-1.65)/.43)**2-((p.y-1.53)/.20)**2)
        envelope*=max(0,min(1,(abs(p.x)-.28)/.22))
        p.x+=math.copysign(.019*envelope*math.sin(p.z*32+p.y*12),p.x)
        vertex.co=to_blender(p)
    brow_surface=surface_tree([obj])
    for side,sign in (("l",1),("r",-1)):
        # The eyes sit in orbital cavities. Nostrils are cavities too, rather
        # than buttons stuck onto the snout. Their dark lining is added below.
        for name,centre,radii in (("orbit",((EYE[0]+.018)*sign,EYE[1],EYE[2]),(.090,.047,.075)),
                                  ("nares",(.285*sign,1.83,2.64),(.080,.048,.080))):
            cutter=Part(f"{name}_cutter_{side}").ellipsoid(centre,radii,(.01,.01,.99,.99),24,12).object()
            activate(obj)
            cut=obj.modifiers.new(f"{name}_{side}","BOOLEAN");cut.operation="DIFFERENCE";cut.solver="EXACT";cut.object=cutter
            bpy.ops.object.modifier_apply(modifier=cut.name)
            bpy.data.objects.remove(cutter,do_unlink=True)
    # Recess the real upper oral cavity into the skull. Its curved roof and
    # commissure are actual continuous hide, not a red strip below a solid
    # muzzle. The underside opens into the mouth; the roof stays enclosed.
    oral=[(0,1.48,1.81,.025,.035),(0,1.49,1.95,.275,.19),
          (0,1.46,2.20,.315,.18),(0,1.40,2.46,.26,.17),
          (0,1.36,2.71,.185,.155),(0,1.35,2.89,.09,.105),
          (0,1.36,2.955,.012,.025)]
    cutter=Part('upper_oral_cavity').loft(oral,24,subdivisions=2).object()
    _oral_surface=surface_tree([cutter]);activate(obj)
    cut=obj.modifiers.new('recessed_oral_roof','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
    bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
    obj.data.calc_loop_triangles()
    dec=obj.modifiers.new("authored_surface_budget","DECIMATE")
    dec.ratio=min(1,16200/max(1,len(obj.data.loop_triangles)))
    dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    # Cut an exact keratin/skin transition instead of coloring whole triangles
    # that straddle it and leave a jagged cream patch on the muzzle.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                           plane_co=to_blender((0,1.6,2.93)),plane_no=to_blender((0,-.17,1)),
                           clear_inner=False,clear_outer=False,dist=.00001)
    # Boolean orbit boundaries can leave sub-millimetre sliver edges. Clean
    # those in the authored hide before UVs/weights and native quantization;
    # otherwise the quantized sliver can open a tiny hole at the eye socket.
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0006)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.00001)
    # Welding sub-millimetre remesh slivers can leave an isolated, zero-volume
    # pair of opposite triangles. Remove that actual source debris rather
    # than sending a two-sided membrane to the native closed-surface builder.
    bm.verts.index_update();paired={}
    for face in bm.faces:
        key=tuple(sorted(v.index for v in face.verts))
        paired.setdefault(key,[]).append(face)
    debris=[]
    for faces in paired.values():
        if len(faces)!=2:continue
        verts=set(faces[0].verts)
        if all(set(v.link_faces)==set(faces) for v in verts):debris.extend(verts)
    if debris:bmesh.ops.delete(bm,geom=list(set(debris)),context='VERTS')
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    # Ground pads have a real supporting plane, not a pointed spheroid.
    for vertex in obj.data.vertices:
        p=to_animal(vertex.co)
        if p.y<.065:vertex.co=to_blender((p.x,.065,p.z))
    horn=bpy.data.materials.get("trike_horn") or bpy.data.materials.new("trike_horn")
    obj.data.materials.append(horn)
    frill=bpy.data.materials.get('trike_frill') or bpy.data.materials.new('trike_frill')
    obj.data.materials.append(frill)
    for polygon in obj.data.polygons:
        polygon.use_smooth=True
        centre=sum((to_animal(obj.data.vertices[i].co) for i in polygon.vertices),Vector())/len(polygon.vertices)
        if _oral_surface.find_nearest(to_blender(centre))[3]<.022 and 1.82<centre.z<2.95:polygon.material_index=1
        elif centre.z>2.93+.17*(centre.y-1.6):polygon.material_index=1
        elif on_shield(centre):polygon.material_index=2
    hide_uv(obj)
    skin_hide(obj)
    return obj,brow_surface


def hide_uv(obj):
    mesh=obj.data
    while mesh.uv_layers:mesh.uv_layers.remove(mesh.uv_layers[0])
    uv=mesh.uv_layers.new(name="UVMap")
    orbital_faces=[];rim_faces=[];head_faces=[];joint_faces={"front":[],"back":[]}
    for face in mesh.polygons:
        centre=sum((to_animal(mesh.vertices[i].co) for i in face.vertices),Vector())/len(face.vertices)
        q=to_blender(centre)
        limb,limb_distance=min(((key,tree.find_nearest(q)[3]) for key,tree in _leg_surfaces.items()),key=lambda row:row[1])
        # A coordinate box also caught the lower ribcage between the legs.
        # Those unrelated surfaces then overwrote one another in the limb
        # chart, producing jagged stretched patches in the rolled pose.
        leg=centre.y<1.75 and limb_distance<_trunk_surface.find_nearest(q)[3]
        head=centre.z>1.35
        frill=face.material_index==2
        # The basal frill/neck junction folds back over the neck. A body
        # cylindrical projection aliases that raised root with the hide below
        # it; give this measured junction a unique chart with the brow.
        cranial_join=1.03<centre.z<1.80 and centre.y>1.83 and abs(centre.x)>.36
        orbital=not frill and (cranial_join or (head and _orbital_surface.find_nearest(q)[3]<_cranial_surface.find_nearest(q)[3]))
        if orbital and face.material_index==0:orbital_faces.append(face.index)
        orbital_outer=abs(centre.x)>=np.interp(centre.y,[1.99,2.12,2.235],[.40,.40,.455])
        end=limb.split('_')[0]
        # The shoulder and haunch roots are non-star-shaped unions of muscle
        # and trunk. Dedicated unwrapped caps avoid projecting the outward
        # muscle and recessed skin below into the same cylindrical texels.
        joint=centre.y>1.60 and abs(centre.x)>.40 and not frill and not orbital and face.material_index==0
        joint_end='front' if -.45<centre.z<1.03 else 'back' if -2.35<centre.z<-.95 else None
        if joint and joint_end:joint_faces[joint_end].append(face.index)
        # The nasal openings and folded lip turn back into the skull. A
        # cylindrical projection aliases their recessed wall with the hide
        # above it even after the orbital root has its own chart.
        if head and not frill and not orbital and not leg and face.material_index==0:
            head_faces.append(face.index)
        rim=frill and _shield_edge.find_nearest(q)[3]<min(tree.find_nearest(q)[3] for tree in _shield_faces)
        if rim:rim_faces.append(face.index)
        shield_rect=SKIN_FRILL_EDGE if rim else SKIN_FRILL_FRONT if shield_front(centre) else SKIN_FRILL_BACK
        oral=face.material_index==1 and 1.82<centre.z<2.95 and _oral_surface.find_nearest(q)[3]<.035
        rect=(PALATE if oral else (.74,.25,.98,.73)) if face.material_index==1 else shield_rect if frill else (SKIN_ORBIT_OUTER if orbital_outer else SKIN_ORBIT_INNER) if orbital else (SKIN_FRONT if end=="front" else SKIN_BACK) if leg else SKIN_HEAD if head else SKIN_BODY
        sole=leg and centre.y<.072
        if sole:rect=(.02,.02,.23,.075) if end=='front' else (.25,.02,.46,.075)
        vals=[]
        for li in face.loop_indices:
            p=to_animal(mesh.vertices[mesh.loops[li].vertex_index].co)
            if oral:
                vals.append([min(1,max(0,(p.x+.36)/.72)),min(1,max(0,(p.z-1.81)/1.15))])
            elif face.material_index==1:
                vals.append([min(1,max(0,(p.x+.26)/.52)),min(1,max(0,(p.z-2.90)/.45))])
            elif frill:
                if rim:
                    # The finite edge needs circumference/depth coordinates.
                    # Projecting it onto XY collapses its thickness and makes
                    # physically distinct front/back texels overwrite each other.
                    a=math.atan2((p.y-2.12)/(1.08 if p.y>=2.12 else .36),abs(p.x)/1.16)
                    middle=1.57-.48*((p.y-2.12)/1.08)-.24
                    vals.append([(a+math.pi/2)/math.pi,.5+(p.z-middle)/.24])
                else:
                    vals.append([min(1,max(0,(p.x+1.30)/2.60)),min(1,max(0,(p.y-1.62)/1.70))])
            elif orbital:
                vals.append([min(1,max(0,(p.z-1.75)/.60)),min(1,max(0,(p.y-1.97)/.34))])
            elif sole:
                foot=LEGS[end][-1]
                vals.append([min(1,max(0,(abs(p.x)-foot[0]+.32)/.64)),min(1,max(0,(p.z-foot[2]+.24)/.70))])
            elif leg:
                # Mirror the two sides; map around the bent limb's central path.
                chain=LEGS[end]
                order=sorted(chain,key=lambda q:q[1])
                cx=np.interp(p.y,[q[1] for q in order],[q[0] for q in order])
                cz=np.interp(p.y,[q[1] for q in order],[q[2] for q in order])
                a=math.atan2(p.z-cz,abs(p.x)-cx)/math.tau+.5
                vals.append([a,min(1,max(0,p.y/1.75))])
            elif head:
                cy=np.interp(p.z,[r[0] for r in BODY],[r[1] for r in BODY])
                angle=math.atan2(p.y-cy,abs(p.x))/math.pi+.5
                vals.append([min(1,max(0,(p.z-1.2)/2.17)),min(1,max(0,angle))])
            else:
                cy=np.interp(p.z,[r[0] for r in BODY],[r[1] for r in BODY])
                a=math.atan2(p.y-cy,abs(p.x))/math.pi+.5
                vals.append([min(1,max(0,(p.z+4.53)/6.05)),min(1,max(0,a))])
        if leg and max(v[0] for v in vals)-min(v[0] for v in vals)>.5:
            vals=[[0 if u>.5 else u,v] for u,v in vals]
        for li,value in zip(face.loop_indices,vals):uv.data[li].uv=rect_uv(rect,*value)
    # The horn collars turn through a cap and orbital basin; a single
    # cylindrical or side projection folds there. Unwrap those selected
    # surfaces into non-overlapping islands inside their own atlas rectangle.
    activate(obj)
    bpy.context.tool_settings.mesh_select_mode=(False,False,True)
    for selected,rect in ((orbital_faces,(.75,.02,.98,.19)),(rim_faces,SKIN_FRILL_EDGE),(head_faces,SKIN_HEAD),
                          (joint_faces['front'],(.02,.375,.23,.47)),(joint_faces['back'],(.25,.375,.46,.47))):
        if not selected:continue
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT')
        bm=bmesh.from_edit_mesh(mesh);bm.faces.ensure_lookup_table()
        for index in selected:bm.faces[index].select_set(True)
        bmesh.update_edit_mesh(mesh)
        bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.018,area_weight=.25,correct_aspect=False,scale_to_bounds=True)
        bpy.ops.object.mode_set(mode='OBJECT')
        uv=mesh.uv_layers.active.data
        for index in selected:
            for li in mesh.polygons[index].loop_indices:uv[li].uv=rect_uv(rect,*uv[li].uv)


def distance_segment(p,a,b):
    d=b-a
    t=max(0,min(1,(p-a).dot(d)/d.length_squared))
    return (p-a-d*t).length


def smooth_fraction(value):
    t=min(1,max(0,value))
    return t*t*(3-2*t)


def limb_falloff(mesh):
    """Carry each leg's influence up the connected hide, measured in metres."""
    points=[to_animal(v.co) for v in mesh.vertices]
    neighbours=[[] for _ in points]
    for edge in mesh.edges:
        a,b=edge.vertices
        length=(points[a]-points[b]).length
        neighbours[a].append((b,length));neighbours[b].append((a,length))
    fields={}
    for end,chain in LEGS.items():
        for side,sign in (('l',1),('r',-1)):
            # All of the distal limb establishes the rigid end of the blend.
            # A cut on height alone also selects the tail and opposite foot.
            ankle=chain[2]
            seeds=[]
            for i,p in enumerate(points):
                x=p.x*sign
                distal=p.y<=.91 and abs(p.z-ankle[2])<.75
                # The outside of the thigh and triceps moves with the limb
                # farther up than the medial skin attached to the belly.
                lateral=.91+(.36 if end=='front' else .255)*smooth_fraction((x-.82)/.30)
                cuff=p.y<=lateral and abs(p.z-chain[1][2])<.43
                if (distal or cuff) and abs(x-ankle[0])<.42:
                    seeds.append(i)
            distance=np.full(len(points),np.inf)
            distance[seeds]=0
            queue=[(0.0,i) for i in seeds];heapq.heapify(queue)
            span=1.22
            while queue:
                travel,i=heapq.heappop(queue)
                if travel>distance[i]:continue
                for j,length in neighbours[i]:
                    d=travel+length
                    if d<distance[j] and d<span:
                        distance[j]=d;heapq.heappush(queue,(d,j))
            fields[end,side]=[1-smooth_fraction(d/span) for d in distance]
    return fields


def skin_hide(obj):
    for group in list(obj.vertex_groups):obj.vertex_groups.remove(group)
    bones={n:(Vector(a),Vector(b)) for n,_,a,b in BONES}
    spine=["pelvis","body","chest","neck","skull","tail_1","tail_2","tail_3","tail_tip"]
    def envelope(p,names):
        distances=sorted((distance_segment(p,*bones[name]),name) for name in names)
        weights=[(math.exp(-((d-distances[0][0])/.20)**2)*math.exp(-d*.25),name) for d,name in distances[:4]]
        total=sum(w for w,_ in weights)
        return [(w/total,name) for w,name in weights]
    def leg_weights(p,end,side):
        # A forearm vertex belongs to its actual segment and its adjacent
        # joint transition. A four-nearest-bones Gaussian also reached the
        # distant toe/ankle and pulled low skin through the floor on collapse.
        names=[f'{end}_{part}_{side}' for part in ('upper','lower','foot','toes')]
        # Flexion through the elbow and knee traverses a thick skin cuff.
        # Projection onto the nearest bent shaft has a jump at the bisector.
        if p.y>.71:
            elbow=LEGS[end][1][1]
            upper=smooth_fraction((p.y-elbow+.26)/.52)
            return [(upper,names[0]),(1-upper,names[1])]
        lengths=[(bones[n][1]-bones[n][0]).length for n in names]
        best=None;offset=0.0
        for name,length in zip(names,lengths):
            a,b=bones[name];d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared))
            candidate=((p-a-d*t).length_squared,offset+t*length,name)
            if best is None or candidate[0]<best[0]:best=candidate
            offset+=length
        along=best[1];joint=0.0
        for i,band in enumerate((.15,.10,.10)):
            joint+=lengths[i]
            if abs(along-joint)<band:
                t=(along-joint+band)/(2*band);t=t*t*(3-2*t)
                return [(1-t,names[i]),(t,names[i+1])]
        return [(1.0,best[2])]
    fields=limb_falloff(obj.data)
    for name in bones:obj.vertex_groups.new(name=name)
    for vertex in obj.data.vertices:
        p=to_animal(vertex.co)
        side="l" if p.x>=0 else "r"
        if on_shield(p):
            # Bony fan remains rigid; the basal fleshy junction transitions
            # through a measured 26 cm band into the skull/neck instead of
            # relying on a few topology-dependent neighbour smoothing passes.
            t=max(0,min(1,(p.y-1.88)/.26));t=t*t*(3-2*t)
            obj.vertex_groups[f"frill_{side}"].add([vertex.index],t,"REPLACE")
            obj.vertex_groups['skull'].add([vertex.index],1-t,"REPLACE")
            continue
        axial=envelope(p,spine)
        limb=[]
        for (end,leg_side),field in fields.items():
            if field[vertex.index]<=0:continue
            # In the ventral groin and axilla the broad hide follows its
            # own girdle. A distant shin must not pull on the opposite end
            # of the belly when both surface-distance bands reach the trunk.
            local=abs(p.z-LEGS[end][1][2])
            coupling=1-smooth_fraction((local-.32)/.65)*smooth_fraction((p.y-.70)/.28)
            value=field[vertex.index]*coupling
            if value>0:limb.append((value,end,leg_side))
        total_limb=sum(w for w,_,_ in limb)
        influence=min(total_limb,1.0)
        # Within a moving axilla or groin retain its actual axial attachment.
        # The trunk's wider envelope returns gradually beyond the muscle.
        anchored=smooth_fraction(influence/.28)
        row={name:w*(1-influence)*(1-anchored) for w,name in axial}
        for w,end,leg_side in limb:
            share=w/total_limb
            parent='chest' if end=='front' else 'pelvis'
            row[parent]=row.get(parent,0)+(1-influence)*anchored*share
            for v,name in leg_weights(p,end,leg_side):
                row[name]=row.get(name,0)+influence*share*v
        total=sum(row.values())
        for name,w in row.items():
            if w>1e-8:obj.vertex_groups[name].add([vertex.index],w/total,'REPLACE')
    # Smooth on the actual connected surface, independent of Blender UI mode.
    # Normalize after retaining the four strongest influences at each vertex.
    names=[group.name for group in obj.vertex_groups]
    weights=np.zeros((len(obj.data.vertices),len(names)))
    for vertex in obj.data.vertices:
        for group in vertex.groups:weights[vertex.index,group.group]=group.weight
    edges=np.asarray([edge.vertices[:] for edge in obj.data.edges],dtype=np.int32)
    coords=np.asarray([v.co[:] for v in obj.data.vertices])
    # Decimation leaves unequal edges. Uniform neighbour voting across a
    # 20 cm face can move one side of a 2 cm edge across a weight band.
    conductance=1/np.maximum(.008,np.linalg.norm(coords[edges[:,0]]-coords[edges[:,1]],axis=1))**2
    degree=np.bincount(edges[:,0],weights=conductance,minlength=len(weights))
    degree+=np.bincount(edges[:,1],weights=conductance,minlength=len(weights))
    for _ in range(4):
        neighbour=np.zeros_like(weights)
        np.add.at(neighbour,edges[:,0],conductance[:,None]*weights[edges[:,1]])
        np.add.at(neighbour,edges[:,1],conductance[:,None]*weights[edges[:,0]])
        weights=weights*.45+neighbour/np.maximum(degree,1)[:,None]*.55
    for group in list(obj.vertex_groups):obj.vertex_groups.remove(group)
    for name in names:obj.vertex_groups.new(name=name)
    for index,row in enumerate(weights):
        p=to_animal(obj.data.vertices[index].co)
        if p.y<.42:
            # The full low pad follows its toe segment. A sole-only 35 mm band
            # left the adjacent heel skin partly weighted to the shin, pulling
            # it through terrain once the ankle became articulated.
            end='front' if p.z>-.35 else 'back';side='l' if p.x>=0 else 'r'
            t=max(0,min(1,(p.y-.24)/.18));t=t*t*(3-2*t)
            row*=t;row[names.index(f'{end}_toes_{side}')]+=1-t
        chosen=np.argsort(row)[-4:];total=row[chosen].sum()
        for bone in chosen:
            if row[bone]>1e-8:obj.vertex_groups[int(bone)].add([index],float(row[bone]/total),'REPLACE')


def make_frill():
    global _shield_faces,_shield_edge
    part=Part("cranial_shield",bone="skull")
    # A broad, shallow vaulted shield with an original short scalloped edge.
    # Both faces share their rim. Radial ribs occur in geometry and skin pattern.
    steps=96;rows=9
    centre=Vector((0,2.12,1.49))
    grids=[];sides=[]
    for face_sign in (1,-1):
        start=len(part.faces)
        grid=[]
        for j in range(rows+1):
            t=.025+.975*j/rows
            ring=[]
            for i in range(steps):
                a=i*math.tau/steps
                edge=1+.026*math.cos(10*a)+.017*math.cos(17*a+.6)
                upper=math.sin(a)
                # Adult edge ossifications are unequal low triangular teeth,
                # strongest along the shoulders of the shield, not a cogwheel.
                tooth=max(0,math.cos(12*a+.2))**8*.11*(.65+.35*math.sin(a*5+.8))*max(.1,upper+.5)*(1-.50*max(0,upper)**4)
                # A C1 transition removes the old abrupt tangent corner at
                # the lateral root. Outside this band the upper fan silhouette
                # is retained; the lower root narrows into the cheek/neck.
                blend=max(0,min(1,(upper+.28)/.56));blend=blend*blend*(3-2*blend)
                width=(1.16+.85*upper*(1-blend))*math.cos(a)*t*(edge+tooth)
                height=(.50+.58*blend)*upper*t*(edge+tooth)
                # The shield curves backwards at its perimeter around a
                # forward central keel. Broad left/right buttresses carry
                # each horn root into the upper edge; no flat fan section.
                z=1.57-.48*(height/1.08)-.24*t*t+.16*math.sin(math.pi*t)
                keel=.20*math.exp(-(width/.24)**2)*math.sin(math.pi*t)
                basal=max(0,min(1,(upper+.35)/.65))
                basal=basal*basal*(3-2*basal)
                rib=.165*math.cos(3*a)**8*math.sin(math.pi*t)**.7*basal
                edge_scute=.035*max(0,math.cos(12*a+.2))**6*max(0,(t-.65)/.35)
                lower=max(0,min(1,(upper+.04)/.46));lower=lower*lower*(3-2*lower)
                # The ventral root tapers into the skull. Carrying the upper
                # fan's full vaulted section across this lower quadrant made
                # a broad horizontal shelf above the neck.
                thickness=(.065+(.15+.10*(1-t))*math.sqrt(max(0,1-t*t)))*(.30+.70*lower)
                thickness+=(rib+keel+edge_scute)*(.45+.55*lower)
                # Broad bony supports are sculpted into the shield section,
                # rising from the brow roots and tapering into the upper fan.
                # A single-valued surface keeps them physically continuous
                # rather than attaching separate floating cylinders.
                y=centre.y+height
                along=max(0,min(1,(y-2.12)/.80))
                low=max(0,min(1,(y-1.94)/.22));high=max(0,min(1,(y-2.85)/.30))
                buttress=.22*math.exp(-((abs(width)-(.43+.14*along))/.15)**2)
                buttress*=low*low*(3-2*low)*(1-high*high*(3-2*high))
                if face_sign>0:thickness+=buttress
                p=(width,centre.y+height,z+face_sign*thickness)
                ring.append(part.point(p))
            grid.append(ring)
        grids.append(grid)
        for j in range(rows):
            for i in range(steps):
                k=(i+1)%steps
                face=(grid[j][i],grid[j][k],grid[j+1][k],grid[j+1][i])
                if face_sign<0:face=tuple(reversed(face))
                part.face(face,[rect_uv(SKIN_FRILL,(part.points[v][0]+1.24)/2.48,(part.points[v][1]-1.52)/1.64) for v in face])
        part.face(tuple(reversed(grid[0])) if face_sign>0 else grid[0],
                  [rect_uv(SKIN_FRILL,.5,.37)]*steps)
        sides.append(part.faces[start:])
    _shield_faces=tuple(BVHTree.FromPolygons([to_blender(p) for p in part.points],faces) for faces in sides)
    # A real edge band closes the shield at finite thickness, so it never
    # reads as a paper card in profile.
    edge_start=len(part.faces)
    for i in range(steps):
        j=(i+1)%steps
        face=(grids[0][-1][i],grids[0][-1][j],grids[1][-1][j],grids[1][-1][i])
        part.face(face,[rect_uv(SKIN_FRILL,(part.points[v][0]+1.3)/2.6,(part.points[v][1]-1.62)/1.7) for v in face])
    _shield_edge=BVHTree.FromPolygons([to_blender(p) for p in part.points],part.faces[edge_start:])
    obj=part.object()
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    return obj


def orbital_lid(side, sign, upper, hide):
    """Lid margin, tarsal fold and buried orbital attachment, in animal metres."""
    part = Part(f"{'upper' if upper else 'lower'}_lid_{side}")
    columns = 16
    # The first two rows turn over the free lip, the last joins the actual hide.
    layers = (0, .11, .33, .60, .82, 1) if upper else (0, .16, .56, 1)
    rect = (.49,.18,.60,.205) if upper else (.61,.18,.72,.205)
    sweep = math.radians(68)
    def cheek_x(y,z):
        hit = hide.ray_cast(to_blender((1.25*sign,EYE[1]+y,EYE[2]+z)),Vector((-sign,0,0)))[0]
        return abs(hit.x)-EYE[0]

    positions, weights, uv = [], [], []
    faces = []
    for j in range(columns+1):
        u = 2*j/columns-1
        shape = math.sqrt(max(0,1-u*u))
        # The anterior corner runs a little lower, matching the muzzle slope.
        cant = -.0025*u
        upper_y = .026*shape-.015*(1-shape)**2+cant
        lower_y = -.015-.0075*shape+cant
        surface = cheek_x(upper_y,.052*u)
        rim_x = surface-.004+(.047-surface+.004)*shape
        # At full blink the upper margin laps the lower by 4 mm at the middle.
        close = (upper_y-lower_y+.004*shape)/(math.sin(sweep)*rim_x+(1-math.cos(sweep))*upper_y)
        closed_x = rim_x+close*((math.cos(sweep)-1)*rim_x+math.sin(sweep)*upper_y)
        near_y = upper_y if upper else lower_y
        near_x = rim_x if upper else closed_x-.0018*shape
        far_z = .084*u
        far_y = cant + (.062 if upper else -.058)*shape
        root_x = cheek_x(near_y,.052*u)
        for t in layers:
            y = near_y*(1-t)+far_y*t
            z = u*.052*(1-t)+far_z*t
            # The margin and its slight rolled edge blend back tangent to the
            # unbroken cranial hide. The outer and corner vertices end inside it.
            relief = (.0020*math.exp(-((t-.12)/.10)**2)-.0008*math.exp(-((t-.40)/.15)**2))*shape
            x = cheek_x(y,z)+(near_x-root_x)*(1-t)**2+relief-.0025*t*t
            positions.append((sign*(EYE[0]+x),EYE[1]+y,EYE[2]+z))
            weights.append(close*(1-t)**1.4 if upper else 0)
            uv.append(rect_uv(rect,(u+1)*.5,t))
    rows = len(layers)
    for j in range(columns):
        for k in range(rows-1):
            a = j*rows+k
            faces.append((a,a+rows,a+rows+1,a+1))
    # A closed inner surface provides the narrow wet edge without an exposed
    # tube or a floating lower rim. Both sides share the same skin weights.
    back_uv=[(u,.208+(v-.18)*.20) for u,v in uv]
    for inside in (False,True):
        for x,y,z in positions:
            part.point((x-sign*.0035*inside,y,z))
        offset = len(positions) if inside else 0
        for face in faces:
            corners = face[::-1] if inside else face
            chart = back_uv if inside else uv
            part.face(tuple(offset+i for i in corners),[chart[i] for i in corners])
    boundary = [j*rows for j in range(columns+1)] + [columns*rows+k for k in range(1,rows)] + [j*rows+rows-1 for j in range(columns-1,-1,-1)] + list(range(rows-2,0,-1))
    # Unwrap thickness on its own narrow strip. Joining the two main charts
    # here would paint the thin leading wall over the whole exposed lid.
    for i,(a,b) in enumerate(zip(boundary,boundary[1:]+boundary[:1])):
        strip=(rect[0],.214,rect[2],.218)
        coords=[rect_uv(strip,j/len(boundary),v) for j,v in ((i,0),(i+1,0),(i+1,1),(i,1))]
        part.face((a,b,b+len(positions),a+len(positions)),coords)
    obj = part.object()
    rim_edges = {tuple(sorted((a,b))) for a,b in zip(boundary,boundary[1:]+boundary[:1])}
    for edge in obj.data.edges:
        if tuple(sorted(edge.vertices)) in rim_edges:
            edge.use_edge_sharp = True
    fixed = obj.vertex_groups.new(name='skull')
    moving = obj.vertex_groups.new(name=f'lid_{side}') if upper else None
    for i,w in enumerate(weights*2):
        if w: moving.add([i],w,'REPLACE')
        if w<1: fixed.add([i],1-w,'REPLACE')
    return obj


def make_details(hide):
    out=[]
    for side,sign in (("l",1),("r",-1)):
        rows=[(.42*sign,2.08,2.02,.115,.105)]+[(p[0]*sign,p[1],p[2],radius,radius*.88) for p,radius in HORNS]
        out.append(Part(f'brow_horn_{side}','trike_horn',f'horn_{side}').loft(rows,16,(.02,.02,.46,.98),3).object())
        eye=(EYE[0]*sign,EYE[1],EYE[2])
        out.append(Part(f"eye_globe_{side}","trike_horn",f"eye_{side}").ellipsoid(eye,(.038,.028,.051),(.80,.02,.98,.20),16,6).object())
        for upper in (True,False):
            out.append(orbital_lid(side,sign,upper,hide))
        # Side nostril sockets and contrasting horny rims have actual relief.
        # No nostril sphere: the carved recess itself receives dark pigment.
        for end,points in LEGS.items():
            foot=points[-1]
            for k,sections in hooves(end):
                nail=Part(f"{end}_nail_{k}_{side}","trike_horn",f"{end}_toes_{side}")
                rings=[[nail.point((x*sign,y,z)) for x,y,z in section] for section in sections]
                for j in range(3):
                    for i in range(8):
                        n=(i+1)%8
                        nail.face((rings[j][i],rings[j][n],rings[j+1][n],rings[j+1][i]),
                                  [rect_uv(NAILS,u/8,v/3) for u,v in ((i,j),(i+1,j),(i+1,j+1),(i,j+1))])
                nail.face(rings[0],[rect_uv(NAILS,.5,.1)]*8)
                nail.face(tuple(reversed(rings[-1])),[rect_uv(NAILS,.5,.9)]*8)
                out.append(nail.object())
    rows=[(*p,r,r*.84) for p,r in NASAL]
    out.append(Part('nasal_horn','trike_horn','horn_nose').loft(rows,16,(.48,.02,.69,.98),3).object())
    # A deep angular dentary, closed at rest to a narrow lip seam. Its upper
    # edge follows the skull's gape, not a smiling U-shaped tube.
    jaw=Part("lower_jaw",bone="jaw");rings=[];sides=20
    # Independent lip, oral-floor and ventral landmarks. The ramus is deep
    # beneath the cheek, the anterior dentary narrows, and the predentary has
    # a short rounded termination inside the hooked upper beak.
    sections=[(1.62,.245,1.81,.10,.15),(1.84,.41,1.79,.12,.34),
              (2.08,.42,1.735,.11,.36),(2.36,.36,1.655,.10,.31),
              (2.60,.27,1.61,.075,.25),(2.82,.21,1.565,.060,.18),
              (3.025,.16,1.545,.040,.195),(3.14,.09,1.50,.025,.110),
              (3.19,.035,1.455,.012,.045),(3.215,.009,1.43,.004,.012)]
    for z,width,lip,floor,depth in smooth_rows(sections,2):
        ring=[]
        for i in range(sides):
            a=i*math.tau/sides;s=math.sin(a)
            y=lip-floor*s*s if s>0 else lip+depth*s
            ring.append(jaw.point((width*math.cos(a),y,z)))
        rings.append(ring)
    for row,(a,b) in enumerate(zip(rings,rings[1:])):
        for i in range(sides):
            j=(i+1)%sides
            jaw.face((a[i],a[j],b[j],b[i]),[rect_uv((.49,.02,.72,.175),u/sides,v/(len(rings)-1)) for u,v in ((i,row),(i+1,row),(i+1,row+1),(i,row+1))])
    jaw.face(tuple(reversed(rings[0])),[(.6,.10)]*sides);jaw.face(rings[-1],[(.6,.10)]*sides)
    obj=jaw.object()
    # The oral floor is concave. Blender's face-normal heuristic can choose
    # the inward orientation for this closed shell; measure the triangulated
    # enclosed volume, then retain the physically outward surface.
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    obj.data.materials.append(bpy.data.materials['trike_horn'])
    uv=obj.data.uv_layers.active.data
    for face in obj.data.polygons:
        p=sum((to_animal(obj.data.vertices[i].co) for i in face.vertices),Vector())/len(face.vertices)
        cy=np.interp(p.z,[s[0] for s in BODY],[s[1] for s in BODY])-.075
        width=np.interp(p.z,[s[0] for s in sections],[s[1] for s in sections])
        # Oral material follows the upward-facing floor. A centre-height
        # predicate also caught exterior wall triangles and made black teeth
        # along the closed lip.
        oral=1.88<p.z<2.94 and to_animal(face.normal).y>0
        keratin=p.z>=2.94
        if not oral and not keratin:continue
        face.material_index=1
        rect=ORAL if oral else (.74,.25,.98,.73)
        for li in face.loop_indices:
            q=to_animal(obj.data.vertices[obj.data.loops[li].vertex_index].co)
            uv[li].uv=rect_uv(rect,min(1,max(0,(q.x+.40)/.8)),min(1,max(0,(q.z-(2.0 if oral else 2.94))/(1 if oral else .21))))
    out.append(obj)
    tongue=[(0,1.69,1.94,.085,.026),(0,1.66,2.16,.14,.060),(0,1.59,2.42,.13,.056),
            (0,1.54,2.64,.09,.040),(0,1.535,2.73,.015,.014)]
    out.append(Part('oral_tongue','trike_horn','jaw').loft(tongue,16,TONGUE,2).object())
    return out


def preview_materials():
    for name,colour in (("trike_skin",(.28,.36,.29,1)),("trike_horn",(.50,.38,.22,1)),('trike_frill',(.40,.24,.15,1))):
        mat=bpy.data.materials.get(name)
        mat.diffuse_color=colour
        mat.use_nodes=True
        node=mat.node_tree.nodes.get("Principled BSDF")
        node.inputs["Base Color"].default_value=colour
        node.inputs["Roughness"].default_value=.70
        base=HERE/"tex"/f"{name}_base.png"
        if base.exists():
            tex=mat.node_tree.nodes.new("ShaderNodeTexImage");tex.image=bpy.data.images.load(str(base),check_existing=True)
            mat.node_tree.links.new(tex.outputs["Color"],node.inputs["Base Color"])


def export_layout(obj):
    OUT.mkdir(parents=True,exist_ok=True)
    mesh=obj.data;mesh.calc_loop_triangles()
    uv=mesh.uv_layers.active.data
    points=np.asarray([tuple(to_animal(v.co)) for v in mesh.vertices],dtype=np.float32)
    triangles=np.asarray([t.vertices for t in mesh.loop_triangles],dtype=np.int32)
    uvs=np.asarray([[tuple(uv[l].uv) for l in t.loops] for t in mesh.loop_triangles],dtype=np.float32)
    materials=np.asarray([t.material_index for t in mesh.loop_triangles],dtype=np.int32)
    path=OUT/"layout.npz"
    np.savez_compressed(path,points=points,triangles=triangles,uvs=uvs,materials=materials)
    manifest={"triangles":len(triangles),"vertices":len(points),"materials":[m.name for m in mesh.materials],
              "geometry_sha256":hashlib.sha256(points.tobytes()+triangles.tobytes()+uvs.tobytes()).hexdigest(),
              "bounds":[points.min(axis=0).tolist(),points.max(axis=0).tolist()]}
    from plan import GROUND
    manifest['ground_shift']=GROUND
    manifest['body_sections']=BODY
    manifest['eye_centre']=EYE
    (OUT/"layout.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print("trike original anatomy:",json.dumps(manifest))


def finish_surface(obj,brow):
    """Close the source on triangles and split mirrored projection charts.

    Tangents alone cannot split a chart where the two projected sides happen
    to have identical tangent frames. Separate those UV corners explicitly,
    on the native 16-bit UV grid, before Blender computes the tangent frames.
    The small inset is inside the atlas padding and is repainted from geometry.
    """
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    uv=obj.data.uv_layers.active.data
    for loop in uv:loop.uv=[round(v*65535)/65535 for v in loop.uv]
    for face in obj.data.polygons:
        a,b,c=[uv[k].uv for k in face.loop_indices]
        sign=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y)
        if sign<0:
            for k in face.loop_indices:uv[k].uv.x+=2/65535
    mesh=obj.data
    # The orbit is cut before the final triangle reduction. Across its narrow
    # attachment the skin and the lid share the surface normal of the intact
    # brow. The free, moving margin keeps its own rolled cross-section.
    normals=[(0,0,0)]*len(mesh.loops)
    sampled={}
    for face in mesh.polygons:
        if mesh.materials[face.material_index].name!="trike_skin": continue
        for li in face.loop_indices:
            loop=mesh.loops[li]
            p=to_animal(mesh.vertices[loop.vertex_index].co)
            dy,dz=p.y-EYE[1],p.z-EYE[2]
            if abs(abs(p.x)-EYE[0])>.085 or abs(dy)>.080 or abs(dz)>.095: continue
            if loop.vertex_index not in sampled:
                side=1 if p.x>0 else -1
                hit,normal,_,_=brow.ray_cast(to_blender((1.25*side,p.y,p.z)),Vector((-side,0,0)))
                sampled[loop.vertex_index]=(abs(hit.x),normal)
            depth,normal=sampled[loop.vertex_index]
            u,v=uv[li].uv
            lid=(.4899<u<.7201 and .1799<v<.2051)
            if lid:
                t=min(1,max(0,(v-.18)/.025))
                width=min(1,abs((u-(.545 if u<.605 else .665))/.055))
                mix=max(min(1,t/.50)**1.6, width**5)
            else:
                # The original brow and its Boolean border meet tangentially.
                dist=((dz/.095)**2+(dy/.075)**2)**.5
                mix=min(1,max(0,(1-dist)/.28))*min(1,max(0,(abs(p.x)-depth+.015)/.012))
            if mix>0:
                n=mesh.corner_normals[li].vector.lerp(normal,mix).normalized()
                normals[li]=tuple(n)
    mesh.normals_split_custom_set(normals)
    mesh.calc_tangents(uvmap='UVMap')


def build():
    hide,brow_surface=make_hide()
    obj=join([hide,*make_details(brow_surface)],"trike_model")
    finish_surface(obj,brow_surface)
    from plan import GROUND
    for vertex in obj.data.vertices:vertex.co.z-=GROUND
    rig.bind(obj)
    preview_materials()
    export_layout(obj)
    return obj


if __name__=="__main__":
    build()
