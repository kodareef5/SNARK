"""Write the prepared rigid parts to the native Blender intake in engine metres."""

import gzip
import json
import bpy
import numpy as np


def export(folder):
    arm = bpy.data.armatures.new(folder.name)
    rig = bpy.data.objects.new(folder.name, arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (x, y, z) in json.loads((folder / "rig.json").read_text()).items():
        b = arm.edit_bones.new(name)
        b.head = (x, -z, y)
        b.tail = (x, -z, y + 0.1)
        if name != "chassis":
            b.parent = arm.edit_bones["chassis"]
    bpy.ops.object.mode_set(mode="OBJECT")
    positions = []
    faces = []
    uvs = []
    groups = {}
    for bone, tile, vertices, tris in json.loads(gzip.decompress((folder / "lod0.json.gz").read_bytes())):
        v = np.array(vertices).reshape(-1, 3)
        f = np.array(tris).reshape(-1, 3)
        groups.setdefault(bone, []).extend(range(len(positions), len(positions) + len(v)))
        faces.extend(f + len(positions))
        positions.extend(v[:, [0, 2, 1]] * [1, -1, 1])
        p = v[f]
        normal = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
        axis = np.abs(normal).argmax(1)
        q = (p - v.min(0)) / np.maximum(np.ptp(v, axis=0), 0.00001)
        u = np.where((axis == 0)[:, None], q[:, :, 2], q[:, :, 0])
        # The sign on each face reads in the direction of the viewer's right.
        u = np.where(((axis == 0) & (normal[:, 0] > 0) | (axis == 2) & (normal[:, 2] < 0))[:, None], 1 - u, u)
        w = np.where((axis == 1)[:, None], q[:, :, 2], q[:, :, 1])
        u += ((axis * 2 + (normal[np.arange(len(f)), axis] > 0))[:, None] - 2.5) * 0.003
        uvs.extend(
            np.stack(
                ((tile % 4 + 0.025 + 0.95 * u) / 4, (3 - tile // 4 + 0.025 + 0.95 * w) / 4), axis=-1
            ).reshape(-1, 2)
        )
    data = bpy.data.meshes.new(folder.name)
    data.from_pydata(positions, [], faces)
    data.update()
    obj = bpy.data.objects.new(folder.name + "_body", data)
    bpy.context.collection.objects.link(obj)
    data.uv_layers.new(name="Fleet livery").data.foreach_set("uv", np.asarray(uvs, dtype=np.float32).ravel())
    data.materials.append(bpy.data.materials.new("livery"))
    data.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
    data.set_sharp_from_angle(angle=0.61)
    obj.parent = rig
    obj.modifiers.new("Rigid joints", "ARMATURE").object = rig
    for bone, indices in groups.items():
        obj.vertex_groups.new(name=bone).add(indices, 1, "REPLACE")
