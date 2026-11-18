import bpy
import numpy as np
from geometry import PIVOTS, model, posed, uv_for

COLOURS = [
    (31, 99, 94),
    (237, 226, 189),
    (215, 154, 58),
    (60, 77, 78),
    (38, 40, 39),
    (149, 156, 146),
    (81, 73, 54),
    (223, 218, 173),
    (167, 62, 43),
    (233, 167, 62),
    (103, 135, 133),
    (62, 62, 54),
    (49, 55, 53),
    (96, 78, 59),
    (59, 109, 106),
    (31, 36, 37),
    (229, 222, 191),
]


def mesh(name, parts, rig=None, flat=False):
    verts = []
    faces = []
    coords = []
    groups = {}
    colours = []
    for v, f, t, g, b, *rest in parts:
        n = len(verts)
        verts.extend(v[:, [0, 2, 1]] * [1, -1, 1])
        faces.extend(f + n)
        groups.setdefault(b, []).extend(range(n, n + len(v)))
        if flat:
            colours.extend(np.broadcast_to(t, (len(f),)).tolist())
        else:
            coords.extend(uv_for(rest[0] if rest else v, f, t).reshape(-1, 2))
    m = bpy.data.meshes.new(name)
    m.from_pydata(verts, [], faces)
    m.update()
    obj = bpy.data.objects.new(name, m)
    bpy.context.collection.objects.link(obj)
    if flat:
        # The native palette renderer computes each face normal. Export shared geometric corners
        # here, so an untextured wreck does not carry a new vertex for every Blender face normal.
        m.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
        for i, c in enumerate(COLOURS):
            mat = bpy.data.materials.get(f"metal_{i}") or bpy.data.materials.new(f"metal_{i}")
            mat.diffuse_color = tuple((v / 255) ** 2.2 for v in c) + (1,)
            m.materials.append(mat)
        m.polygons.foreach_set("material_index", np.array(colours, dtype=np.int32))
    else:
        uv = m.uv_layers.new(name="Livery")
        uv.data.foreach_set("uv", np.array(coords, dtype=np.float32).ravel())
        mat = bpy.data.materials.get("livery") or bpy.data.materials.new("livery")
        m.materials.append(mat)
        m.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
        m.set_sharp_from_angle(angle=0.61)
    if rig:
        obj.parent = rig
        mod = obj.modifiers.new("Rigid joints", "ARMATURE")
        mod.object = rig
        for b, index in groups.items():
            obj.vertex_groups.new(name=b).add(index, 1, "REPLACE")
    return obj
