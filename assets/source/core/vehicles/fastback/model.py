"""Build the fastback on the game's compact frame. Blender is only required when rebuilding the source art."""

import math
import runpy
import sys
from pathlib import Path
import bmesh
import bpy

HERE = Path(__file__).resolve().parent
COMPACT = HERE.parent / "compact"
sys.path.append(str(COMPACT))
from parts import E2B, transform, tags_of
from shape import BONES
from finish import FINISH
from bodywork import body_parts, canopy, main_glass
from hardware import fascia, wheels, cockpit, steering, doorside

runpy.run_path(str(COMPACT / "rig.py"), run_name="__main__")
rig = bpy.data.objects["compact"]
rig.name = rig.data.name = "fastback"
parts = {name: [] for name, _ in BONES}
body, doors = body_parts()
parts["chassis"] = [body] + canopy() + fascia(body) + cockpit()
for sign, bone, door in zip((1, -1), ("door_left", "door_right"), doors):
    parts[bone] = [door] + main_glass(sign) + doorside(sign)
for name, at in BONES[1:5]:
    parts[name] = wheels(at, 1 if at[0] > 0 else -1)
parts["steering_wheel"] = steering()
mats = [bpy.data.materials.new("enamel"), bpy.data.materials.new("detail")]
finish_names = list(FINISH)


def mapped(q, axis, sign, lo, hi):
    # Positive determinant in Blender UV space on every box-projection face, including mirrored pressings.
    if axis == 0:
        a, b, direction = 2, 1, -sign
    elif axis == 1:
        a, b, direction = 0, 2, -sign
    else:
        a, b, direction = 0, 1, sign
    u = (q[a] - lo[a]) / max(0.0001, hi[a] - lo[a])
    v = (q[b] - lo[b]) / max(0.0001, hi[b] - lo[b])
    return u if direction > 0 else 1 - u, v


def finish(obj, bone):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.42), verts=list(bm.verts), edges=list(bm.edges), delimit={"MATERIAL"})
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="BEAUTY", ngon_method="BEAUTY")
    # Boolean intersections can leave needles that round to zero area in the skin format.
    for _ in range(6):
        thin = [
            f
            for f in bm.faces
            if f.calc_area() < 0.0005 * max(e.calc_length() for e in f.edges) ** 2
            or min(e.calc_length() for e in f.edges) < 0.0003
        ]
        candidates = []
        touched = set()
        for f in thin:
            e = min(f.edges, key=lambda e: e.calc_length())
            a, b = e.verts
            if a in touched or b in touched or len(e.link_faces) != 2:
                continue
            if {j.other_vert(a) for j in a.link_edges} & {j.other_vert(b) for j in b.link_edges} != {
                v for g in e.link_faces for v in g.verts if v != a and v != b
            }:
                continue
            touched.update(v for g in a.link_faces for v in g.verts)
            candidates.append(e)
        if not candidates:
            break
        bmesh.ops.collapse(bm, edges=candidates, uvs=False)
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    # Keep the curved bumper trims on the chassis envelope without moving the mechanical exhaust sockets.
    if not obj.name.startswith("Rolled exhaust"):
        for vert in bm.verts:
            z = vert.co.z
            excess = max(0, abs(z) - 1.72)
            vert.co.z = z - math.copysign(0.23 * excess * excess, z)
    bm.to_mesh(me)
    bm.free()
    me.update()
    tags = tags_of(obj)
    uv = me.uv_layers.new(name="UVMap")
    localmin = [min(v.co[k] for v in me.vertices) for k in range(3)]
    localmax = [max(v.co[k] for v in me.vertices) for k in range(3)]
    for poly, tag in zip(me.polygons, tags):
        axis = max(range(3), key=lambda k: abs(poly.normal[k]))
        sgn = 1 if poly.normal[axis] > 0 else -1
        if obj == body and tag == "paint" and poly.normal.y < -0.96 and poly.center.y < 0.18:
            tag = "under"
        if obj.name.startswith("Roof cantrail") and tag == "headlining" and poly.center.y < 0.96:
            tag = "paint"
        for loop in poly.loop_indices:
            q = me.vertices[me.loops[loop].vertex_index].co
            if tag == "paint":
                u, v = mapped(q, axis, sgn, (-0.91, 0, -2), (0.91, 1.5, 2))
                uv.data[loop].uv = (0.02 + 0.96 * u, 0.02 + 0.96 * v)
            else:
                u, v = mapped(q, axis, sgn, localmin, localmax)
                cell = finish_names.index(tag)
                uv.data[loop].uv = ((cell % 8 + 0.058 + 0.884 * u) / 8, 1 - (cell // 8 + 0.942 - 0.884 * v) / 8)
        # A triangle narrower than a packed UV step must not turn a shared tangent over after quantization.
        corners = [uv.data[li].uv.copy() for li in poly.loop_indices]

        def signed(pts):
            a, b, c = pts
            return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])

        packed = [(round(pt.x * 65535), round(pt.y * 65535)) for pt in corners]
        if signed(packed) * signed(corners) < 0:
            index = min(range(3), key=lambda k: (corners[k] - corners[(k + 1) % 3]).length_squared)
            uv.data[poly.loop_indices[index]].uv = corners[(index + 1) % 3]
        poly.material_index = 0 if tag == "paint" else 1
        poly.use_smooth = True
    # Remap only after polygons have their new indices, as clearing slots rewrites those indices.
    indices = [p.material_index for p in me.polygons]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    for p, i in zip(me.polygons, indices):
        p.material_index = i
    me.set_sharp_from_angle(angle=math.radians(45))
    transform(obj, E2B)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("Rigid skin", "ARMATURE").object = rig


for bone, objects in parts.items():
    for obj in objects:
        finish(obj, bone)
print("Fastback:", sum(len(o.data.polygons) for group in parts.values() for o in group), "triangles")
