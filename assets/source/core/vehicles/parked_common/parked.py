# A road vehicle as years in a ruined street leave it, for a map to set down as a static (content/vehicles/wrecks.ts):
# the live vehicle as its own model script builds it (../<vehicle>/model.py), its rig taken off and its parts posed and
# joined at rest into one rigid mesh each, on the vehicle's own layout, so the pictures paint.py prepares from the
# vehicle's are drawn on it. An asset folder <vehicle>_abandoned calls `build` from its script. The looks:
#   abandoned  where it stopped, settled on soft tyres, its front wheels a little turned;
#   stripped   its wheels, steering wheel and driver's door taken, down on its sills, the passenger's door ajar;
#   roof       on its roof, its cabin crushed, as a flood or a storm left it.

import math
import os
import runpy
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

VEHICLES = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _model(vehicle):
    """The vehicle's parts as its model script leaves them, and where each bone's joint is, its rig then taken off."""
    folder = os.path.join(VEHICLES, vehicle)
    sys.path.insert(0, folder)
    runpy.run_path(os.path.join(folder, "model.py"), run_name="__main__")
    sys.path.remove(folder)
    joints = {}
    for rig in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
        for b in rig.data.bones:
            joints[b.name] = rig.matrix_world @ b.head_local
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.data.objects if o.type == "MESH"]
    for o in parts:
        # A part that shares its mesh with another (one wheel made four times) is given its own, to move by itself.
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.transform(o.matrix_world)
        o.modifiers.clear()
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for rig in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
        bpy.data.objects.remove(rig)
    return parts, joints


def _copied(objs):
    out = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        out.append(c)
    return out


def _joined(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    out.vertex_groups.clear()
    return out


def _on(o, bone):
    """The indices of o's vertices that follow `bone` most."""
    group = o.vertex_groups.get(bone)
    if group is None:
        return []
    out = []
    for v in o.data.vertices:
        for g in v.groups:
            if g.group == group.index and g.weight > 0.5:
                out.append(v.index)
    return out


def _turn(objs, bone, angle, about, axis="Z"):
    """Turns what follows `bone` about `about` by `angle` round `axis`."""
    m = Matrix.Translation(about) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-about)
    for o in objs:
        for i in _on(o, bone):
            o.data.vertices[i].co = m @ o.data.vertices[i].co


def _drop(objs, bones):
    """Takes away what follows any of `bones`."""
    for o in objs:
        doomed = set()
        for b in bones:
            doomed.update(_on(o, b))
        if not doomed:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in doomed], context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
    for o in [o for o in objs if len(o.data.vertices) == 0]:
        objs.remove(o)
        bpy.data.objects.remove(o)


def _low(o):
    return min(v.co.z for v in o.data.vertices)


def _authored(vehicle, name, levels, pose, taken=None):
    """The heavy road vehicle's own coarser levels (../<vehicle>/lod<n>.json.gz, made by hand in its palette) as the
    abandoned look's `name`_LOD1 and on, posed as its finest is: each face in the palette colour of its tile. A look
    is without the parts `taken(bone, points)` says it has lost, at every level."""
    import gzip
    import json

    folder = os.path.join(VEHICLES, vehicle)
    with open(os.path.join(folder, "palette.json")) as f:
        palette = json.load(f)
    mats = []
    for i, (r, g, b) in enumerate(palette):
        m = bpy.data.materials.get(f"{name}_tile_{i}") or bpy.data.materials.new(f"{name}_tile_{i}")
        # glTF writes the Principled shader's base colour, which the pack reads the palette colour from (box_trailer).
        linear = tuple(c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4 for c in (r, g, b))
        m.diffuse_color = linear + (1,)
        m.use_nodes = True
        m.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = linear + (1,)
        mats.append(m)
    for k, level in enumerate(levels, 1):
        with open(os.path.join(folder, f"lod{level}.json.gz"), "rb") as f:
            parts = json.loads(gzip.decompress(f.read()))
        verts, faces, tiles = [], [], []
        for bone, tile, v, tris in parts:
            if taken and taken(bone, v):
                continue
            n = len(verts)
            verts.extend((v[i], -v[i + 2], v[i + 1]) for i in range(0, len(v), 3))
            faces.extend((n + tris[i], n + tris[i + 1], n + tris[i + 2]) for i in range(0, len(tris), 3))
            tiles.extend([tile] * (len(tris) // 3))
        data = bpy.data.meshes.new(f"{name}_LOD{k}")
        data.from_pydata(verts, [], faces)
        for m in mats:
            data.materials.append(m)
        for poly, tile in zip(data.polygons, tiles):
            poly.material_index = tile
        data.transform(pose)
        data.update()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(f"{name}_LOD{k}", data))


def build(vehicle, name, looks=("abandoned",), belt=0.95, steer=0.18, levels=()):
    """Leaves an object `name` (and `name`_stripped, `name`_roof for those looks) for build.py to write; with `levels`,
    the heavy road vehicle's own coarser levels as the abandoned look's.
    Blender's frame: the vehicle faces -Y, +Z up, the driver's side +X, as every model of the fleet is built."""
    parts, joints = _model(vehicle)
    front = [b for b in joints if b.startswith("wheel_front")]
    if "roof" in looks:
        # The cabin crushed to 60% of its height over the belt, the whole turned over about its length, a little down at
        # the nose and to one side.
        roof = _joined(_copied(parts), name + "_roof")
        for v in roof.data.vertices:
            if v.co.z > belt:
                v.co.z = belt + (v.co.z - belt) * 0.6
        roof.data.transform(Matrix.Rotation(math.radians(2.5), 4, "X") @ Matrix.Rotation(math.radians(183), 4, "Y"))
        roof.data.transform(Matrix.Translation((0, 0, -_low(roof))))
        roof.data.update()
    if "stripped" in looks:
        # No wheels, steering wheel or driver's door; the passenger's door ajar on its hinge where it has one; down on its
        # sills, lower at the nose, where the engine's weight is.
        stripped = _copied(parts)
        _drop(stripped, [b for b in joints if b.startswith("wheel_")] + ["steering_wheel", "door_left"])
        if "door_right" in joints:
            _turn(stripped, "door_right", 0.35, joints["door_right"])
        stripped = _joined(stripped, name + "_stripped")
        stripped.data.transform(Matrix.Rotation(math.radians(-1.2), 4, "X") @ Matrix.Rotation(math.radians(0.8), 4, "Y"))
        stripped.data.transform(Matrix.Translation((0, 0, -_low(stripped))))
        stripped.data.update()
    # Where it stopped: its front wheels left a little turned, its tyres gone soft, 4 cm down, a degree to the passenger's side.
    for b in front:
        _turn(parts, b, steer, joints[b])
    car = _joined(parts, name)
    pose = Matrix.Translation((0, 0, -0.04)) @ Matrix.Rotation(math.radians(-1.0), 4, "Y")
    car.data.transform(pose)
    car.data.update()
    if levels:
        _authored(vehicle, name, levels, pose)
    print(f"parked: {name} from {vehicle}, {', '.join(looks)}")
